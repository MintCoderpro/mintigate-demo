// Mintigate demo: simplified demo runtime. MIT licence, see LICENSE.
//
// This is NOT the proprietary Mintigate Runtime. It applies three simple rules to each proposed change:
//   1. the target must be a plain relative path that stays inside the working copy;
//   2. a protected file waits for a human approval, and nothing is written;
//   3. only a file inside the declared scope may be written; anything else is refused.
// An allowed change is an exact text replacement, written in the working copy only.
// Every decision is recorded with the SHA-256 of the target before and after.
// Node.js standard library only: no network, no child process, no model.

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const APPLIED = "APPLIED";
export const PENDING_APPROVAL = "PENDING_APPROVAL";
export const REFUSED = "REFUSED";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Returns the target as a relative path with forward slashes, or null if it is not a plain path inside the copy. */
export function normaliseTarget(target) {
  if (typeof target !== "string" || target.length === 0) return null;
  if (/[\0:*?"<>|]/.test(target)) return null;
  const slashed = target.replace(/\\/g, "/");
  if (slashed.startsWith("/")) return null;
  const parts = slashed.split("/").filter((part) => part !== ".");
  if (parts.length === 0 || parts.some((part) => part === "" || part === "..")) return null;
  return parts.join("/");
}

/** A rule ending with "/" covers a folder; any other rule names one file. */
const covers = (rule, target, ignoreCase) => {
  const [r, t] = ignoreCase ? [rule.toLowerCase(), target.toLowerCase()] : [rule, target];
  return r.endsWith("/") ? t.startsWith(r) : t === r;
};

/** Decides on one proposal from the policy alone, without touching any file. */
export function decide(policy, proposal) {
  const target = normaliseTarget(proposal.target);
  if (target === null) {
    return { target: null, decision: REFUSED, rule: "working-copy", reason: "The path is not a plain relative path inside the working copy." };
  }
  // Protection is checked first and without regard to letter case, so that no spelling of a protected path slips through.
  const protectedRule = policy.protected.find((rule) => covers(rule, target, true));
  if (protectedRule) {
    return { target, decision: PENDING_APPROVAL, rule: `protected: ${protectedRule}`, reason: "Protected file: a human approval is required before any change." };
  }
  const scopeRule = policy.scope.find((rule) => covers(rule, target, false));
  if (!scopeRule) {
    return { target, decision: REFUSED, rule: "scope", reason: "Outside the declared scope of the task." };
  }
  return { target, decision: APPLIED, rule: `scope: ${scopeRule}`, reason: "Inside the declared scope and not protected." };
}

/** Resolves a normalised target inside the working copy, and refuses anything that would leave it. */
function inside(workspace, target) {
  const file = path.resolve(workspace, ...target.split("/"));
  const relative = path.relative(workspace, file);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("A target left the working copy.");
  return file;
}

function hashOf(workspace, target) {
  if (target === null) return null;
  const file = inside(workspace, target);
  return existsSync(file) && lstatSync(file).isFile() ? sha256(readFileSync(file)) : null;
}

/** Applies an allowed exact replacement in the working copy. Returns null when written, or the reason it was not. */
function apply(workspace, target, proposal) {
  if (proposal.kind !== "replace") return "Only exact text replacements are supported by this demo.";
  const file = inside(workspace, target);
  if (!existsSync(file) || !lstatSync(file).isFile()) return "The file to change does not exist in the working copy.";
  const text = readFileSync(file, "utf8");
  if (text.split(proposal.find).length !== 2) return "The text to replace must appear exactly once in the file.";
  writeFileSync(file, text.replace(proposal.find, () => proposal.replace), "utf8");
  return null;
}

/** Runs every scenario in order on the working copy and returns the audit records. */
export function runScenarios(workspace, policy, scenarios) {
  return scenarios.map((scenario, index) => {
    const proposal = scenario.proposal;
    const verdict = decide(policy, proposal);
    const before = hashOf(workspace, verdict.target);
    let { decision, rule, reason } = verdict;
    if (decision === APPLIED) {
      const notApplied = apply(workspace, verdict.target, proposal);
      if (notApplied) [decision, rule, reason] = [REFUSED, "change", notApplied];
    }
    const after = hashOf(workspace, verdict.target);
    return {
      sequence: index + 1,
      scenario: scenario.id,
      actor: proposal.agent,
      change: proposal.summary,
      target: verdict.target ?? String(proposal.target),
      decision,
      rule,
      reason,
      written: decision === APPLIED,
      approval: decision === PENDING_APPROVAL ? "REQUESTED" : null,
      sha256_before: before,
      sha256_after: after,
    };
  });
}
