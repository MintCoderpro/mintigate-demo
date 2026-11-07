// Mintigate demo: preparation of the working copy and independent checks. MIT licence, see LICENSE.
//
// This file does not import demo-runtime.mjs. It copies the fixture, reads the files itself, computes
// their hashes and compares what happened with the expectations written in scenarios.json. It also runs
// negative controls: deliberately wrong expectations or observations, each of which must make a check fail.
// Node.js standard library only: no network, no child process, no model.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const toPosix = (relative) => relative.split(path.sep).join("/");

/** Lists the regular files under a folder, as sorted relative paths with forward slashes. Links are refused. */
export function listFiles(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(toPosix(path.relative(root, full)));
      else throw new Error(`Unexpected entry (not a regular file or folder): ${toPosix(path.relative(root, full))}`);
    }
  };
  walk(root);
  return files.sort();
}

/** SHA-256 of every regular file under a folder, keyed by relative path. */
export function hashTree(root) {
  return Object.fromEntries(listFiles(root).map((file) => [file, sha256(fs.readFileSync(path.join(root, ...file.split("/"))))]));
}

/** Copies the fixture into a new "workspace" folder of the run folder. Never overwrites a file. */
export function prepareWorkspace(fixtureDir, runDir) {
  const workspace = path.join(runDir, "workspace");
  fs.mkdirSync(workspace);
  for (const file of listFiles(fixtureDir)) {
    const target = path.join(workspace, ...file.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(fixtureDir, ...file.split("/")), target, fs.constants.COPYFILE_EXCL);
  }
  return workspace;
}

/** Reads what the run left in the working copy, for the targets named by the scenarios. */
export function observe(spec, fixtureDir, workspace, audit) {
  const read = (root, file) => {
    const full = path.join(root, ...file.split("/"));
    return fs.existsSync(full) && fs.lstatSync(full).isFile() ? fs.readFileSync(full, "utf8") : null;
  };
  const texts = {};
  for (const scenario of spec.scenarios) {
    const target = plainTarget(scenario.proposal.target);
    if (target) texts[target] = { fixture: read(fixtureDir, target), workspace: read(workspace, target) };
  }
  return { fixture: hashTree(fixtureDir), workspace: hashTree(workspace), texts, audit };
}

/** Removes the temporary working copy of this run: only the files and folders inside it, one by one. */
export function cleanupWorkspace(runDir) {
  const workspace = path.join(runDir, "workspace");
  const result = { removed_files: 0, removed_folders: 0, left: [] };
  if (!fs.existsSync(workspace)) return result;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const label = toPosix(path.relative(runDir, full));
      try {
        if (entry.isDirectory()) {
          walk(full);
          fs.rmdirSync(full);
          result.removed_folders += 1;
        } else {
          fs.unlinkSync(full); // a link, if any, is removed itself and never followed
          result.removed_files += 1;
        }
      } catch {
        result.left.push(label);
      }
    }
  };
  try {
    walk(workspace);
    fs.rmdirSync(workspace);
    result.removed_folders += 1;
  } catch {
    result.left.push("workspace");
  }
  return result;
}

/** The same plain-path reading as a person would do: forward slashes, no leading "./". */
function plainTarget(target) {
  if (typeof target !== "string") return null;
  const parts = target.replace(/\\/g, "/").split("/").filter((part) => part !== ".");
  return parts.length && !parts.includes("..") && !parts.includes("") && !/^[A-Za-z]:|^\//.test(target) ? parts.join("/") : null;
}

const inRule = (rule, file, ignoreCase) => {
  const [r, f] = ignoreCase ? [rule.toLowerCase(), file.toLowerCase()] : [rule, file];
  return r.endsWith("/") ? f.startsWith(r) : f === r;
};

/** Splits two texts into lines and lists the lines that differ; null if the line counts differ. */
function changedLines(before, after) {
  if (before === null || after === null) return null;
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  if (a.length !== b.length) return null;
  return a.flatMap((line, i) => (line === b[i] ? [] : [{ before: line, after: b[i] }]));
}

/** Compares the observations with the expectations. Pure: reads only its arguments. */
export function checkCriteria(spec, obs) {
  const checks = [];
  const add = (id, label, pass, detail = "") => checks.push({ id, label, pass: Boolean(pass), detail });
  const expected = new Set(spec.scenarios.map((scenario) => scenario.expect.decision));
  add("coverage", "The scenarios expect one applied, one pending-approval and one refused change",
    ["APPLIED", "PENDING_APPROVAL", "REFUSED"].every((decision) => expected.has(decision)));
  add("audit-records", "One audit record per scenario, in order",
    obs.audit.length === spec.scenarios.length && spec.scenarios.every((scenario, i) => obs.audit[i]?.scenario === scenario.id));

  spec.scenarios.forEach((scenario, i) => {
    const record = obs.audit[i] ?? {};
    const expect = scenario.expect;
    const target = plainTarget(scenario.proposal.target);
    const before = target ? obs.fixture[target] ?? null : null;
    const after = target ? obs.workspace[target] ?? null : null;
    add(`${scenario.id}:decision`, `Decision is ${expect.decision}`, record.decision === expect.decision, `observed ${record.decision}`);
    add(`${scenario.id}:written`, expect.written ? "The change was written in the working copy" : "Nothing was written",
      record.written === expect.written && (after !== before) === expect.written, `reported written=${record.written}`);
    if (expect.written) {
      const lines = target ? changedLines(obs.texts[target]?.fixture ?? null, obs.texts[target]?.workspace ?? null) : null;
      add(`${scenario.id}:one-line`, "Exactly the expected line changed, and nothing else",
        lines !== null && lines.length === 1 && lines[0].before === expect.changed_line?.before && lines[0].after === expect.changed_line?.after,
        lines === null ? "line counts differ or file missing" : `${lines.length} line(s) changed`);
    } else {
      add(`${scenario.id}:unchanged`, before === null ? "The target was not created" : "The target is unchanged", after === before);
    }
    add(`${scenario.id}:hashes`, "The hashes in the audit record match the files",
      record.sha256_before === before && record.sha256_after === after);
    if (expect.decision === "PENDING_APPROVAL") {
      add(`${scenario.id}:approval`, "An approval request is recorded, and nothing is approved", record.approval === "REQUESTED");
    }
  });

  const fixtureFiles = Object.keys(obs.fixture);
  const protectedFiles = fixtureFiles.filter((file) => spec.policy.protected.some((rule) => inRule(rule, file, true)));
  const outsideScope = fixtureFiles.filter((file) => !spec.policy.scope.some((rule) => inRule(rule, file, false)));
  add("protected-unchanged", "Every protected file is unchanged in the working copy",
    protectedFiles.length > 0 && protectedFiles.every((file) => obs.workspace[file] === obs.fixture[file]), protectedFiles.join(", "));
  add("outside-scope-unchanged", "Every file outside the declared scope is unchanged in the working copy",
    outsideScope.every((file) => obs.workspace[file] === obs.fixture[file]), outsideScope.join(", "));
  add("same-files", "No file was created or deleted in the working copy",
    JSON.stringify(Object.keys(obs.workspace).sort()) === JSON.stringify(fixtureFiles.slice().sort()));
  add("fixture-unchanged", "The shipped fixture is unchanged after the run and the cleanup",
    JSON.stringify(obs.fixture) === JSON.stringify(obs.fixtureAfter));
  add("workspace-removed", "The temporary working copy was removed", obs.workspaceRemoved === true);
  return checks;
}

/** Deliberate contradictions: each one must make the named check fail, or the checks themselves are not trusted. */
export function negativeControls(spec, obs) {
  const controls = [];
  const control = (id, label, mustFail, mutate) => {
    const s = structuredClone(spec);
    const o = structuredClone(obs);
    mutate(s, o);
    const failed = checkCriteria(s, o).filter((check) => !check.pass).map((check) => check.id);
    controls.push({ id, label, must_fail: mustFail, detected: failed.includes(mustFail), failed });
  };
  const other = { APPLIED: "REFUSED", PENDING_APPROVAL: "APPLIED", REFUSED: "APPLIED" };
  spec.scenarios.forEach((scenario, i) => {
    control(`${scenario.id}:wrong-decision`, `Expecting ${other[scenario.expect.decision]} for "${scenario.title}"`, `${scenario.id}:decision`,
      (s) => { s.scenarios[i].expect.decision = other[scenario.expect.decision]; });
    control(`${scenario.id}:wrong-written`, `Expecting ${scenario.expect.written ? "no write" : "a write"} for "${scenario.title}"`, `${scenario.id}:written`,
      (s) => {
        s.scenarios[i].expect.written = !scenario.expect.written;
        if (!scenario.expect.written) s.scenarios[i].expect.changed_line = { before: "", after: "" };
      });
  });
  const applied = spec.scenarios.findIndex((scenario) => scenario.expect.written);
  if (applied >= 0) {
    const id = spec.scenarios[applied].id;
    control(`${id}:wrong-line`, "Expecting another value on the changed line", `${id}:one-line`,
      (s) => { s.scenarios[applied].expect.changed_line.after += " /* other */"; });
    control(`${id}:false-hash`, "An audit record that reports a wrong hash", `${id}:hashes`,
      (s, o) => { o.audit[applied].sha256_after = "0".repeat(64); });
  }
  const protectedFile = Object.keys(obs.fixture).find((file) => spec.policy.protected.some((rule) => inRule(rule, file, true)));
  control("protected-file-written", "A protected file changed in the working copy", "protected-unchanged",
    (s, o) => { if (protectedFile) o.workspace[protectedFile] = "f".repeat(64); });
  control("refused-file-created", "A file created in the working copy", "same-files",
    (s, o) => { o.workspace["created-by-mistake.txt"] = "e".repeat(64); });
  control("fixture-modified", "The shipped fixture changed during the run", "fixture-unchanged",
    (s, o) => { const first = Object.keys(o.fixtureAfter)[0]; o.fixtureAfter[first] = "d".repeat(64); });
  control("workspace-left", "The temporary working copy left behind", "workspace-removed",
    (s, o) => { o.workspaceRemoved = false; });
  control("missing-behaviour", "Scenarios that no longer include a refused change", "coverage",
    (s) => { s.scenarios = s.scenarios.filter((scenario) => scenario.expect.decision !== "REFUSED"); });
  return controls;
}
