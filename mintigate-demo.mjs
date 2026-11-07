// Mintigate demo: entry point and console summary. MIT licence, see LICENSE.
//
// Run from this folder:  node mintigate-demo.mjs
// Offline and deterministic: a simulated agent proposes three fixed changes, the simplified demo runtime
// decides on each one in a temporary copy of the fixture, and smoke-test.mjs checks the outcome on its own.
// Exit code 0: the three expected behaviours were verified (one applied, one waiting for approval, one refused).
// Exit code 1: a check failed, or the demo stopped on an error. Exit code 2: nothing was run.
// Node.js standard library only: no dependency, no network, no child process, no account, no model.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const BANNER = "Offline demonstration — simulated agent, simplified demo runtime. Proprietary Mintigate Runtime not executed.";
const BEYOND = [
  "Beyond the demo",
  "",
  "This demo illustrates scoped changes, human approval boundaries, and audit records using a deterministic agent and a simplified runtime.",
  "",
  "Mintigate is being developed to help developers govern real agent workflows. This demo does not execute its proprietary Runtime or connect to a live model.",
  "",
  "Explore the project, current evaluation results, and limitations: https://mintigate.com",
];
const DECISIONS = ["APPLIED", "PENDING_APPROVAL", "REFUSED"];

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "fixture");
const OUTPUT = path.join(HERE, ".output");
const shown = (full) => path.relative(HERE, full).split(path.sep).join("/");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const short = (hash) => (hash ? `${hash.slice(0, 12)}…` : "none");
/** Error messages are shown without the absolute location of this folder. */
const plain = (error) => String(error?.message ?? error).split(HERE).join("<demo folder>");

const lines = [];
const say = (text = "") => lines.push(text);
const flush = () => process.stdout.write(`${lines.splice(0).join("\n")}\n`);

function notRun(reason) {
  say(`Result: NOT RUN (code 2). ${reason}`);
  say("Nothing was written.");
  return 2;
}

/** Checks the shape of scenarios.json; returns an error text, or null when it can be used. */
function invalidSpec(spec) {
  const isText = (value) => typeof value === "string" && value.length > 0;
  if (!spec || typeof spec !== "object") return "scenarios.json is not a JSON object.";
  const policy = spec.policy;
  if (!policy || !Array.isArray(policy.scope) || !Array.isArray(policy.protected) || ![...policy.scope, ...policy.protected].every(isText)) {
    return "scenarios.json needs a policy with a scope list and a protected list.";
  }
  if (!Array.isArray(spec.scenarios) || spec.scenarios.length === 0) return "scenarios.json needs a list of scenarios.";
  const ids = new Set();
  for (const scenario of spec.scenarios) {
    const proposal = scenario?.proposal;
    const expect = scenario?.expect;
    if (!isText(scenario?.id) || ids.has(scenario.id) || !isText(scenario.title)) return "Each scenario needs a unique id and a title.";
    ids.add(scenario.id);
    if (!proposal || !["agent", "summary", "target", "kind", "find", "replace"].every((key) => typeof proposal[key] === "string")) {
      return `Scenario ${scenario.id}: the proposal needs agent, summary, target, kind, find and replace.`;
    }
    if (!expect || !DECISIONS.includes(expect.decision) || typeof expect.written !== "boolean") {
      return `Scenario ${scenario.id}: the expectation needs a decision (${DECISIONS.join(", ")}) and written (true or false).`;
    }
    if (expect.written && (typeof expect.changed_line?.before !== "string" || typeof expect.changed_line?.after !== "string")) {
      return `Scenario ${scenario.id}: an expected write needs changed_line.before and changed_line.after.`;
    }
  }
  return null;
}

async function main(args) {
  say("Mintigate demo");
  say(BANNER);
  say();

  if (args.length > 0) return notRun(`Unknown option: ${args.join(" ")}. This demo takes no option and has no live mode; run: node mintigate-demo.mjs`);
  const major = Number(process.versions.node.split(".")[0]);
  if (!(major >= 18)) return notRun(`Node.js ${process.versions.node} is too old: Node.js 18 or later is needed.`);
  for (const file of ["demo-runtime.mjs", "smoke-test.mjs", "scenarios.json"]) {
    if (!fs.existsSync(path.join(HERE, file))) return notRun(`${file} is missing next to mintigate-demo.mjs. Use the folder as received.`);
  }
  if (!fs.existsSync(FIXTURE) || !fs.statSync(FIXTURE).isDirectory()) return notRun("The fixture folder is missing. Use the folder as received.");

  let spec;
  let runtime;
  let smoke;
  let kit;
  try {
    spec = JSON.parse(fs.readFileSync(path.join(HERE, "scenarios.json"), "utf8"));
  } catch (error) {
    return notRun(`scenarios.json cannot be read: ${plain(error)}`);
  }
  const invalid = invalidSpec(spec);
  if (invalid) return notRun(invalid);
  try {
    runtime = await import(pathToFileURL(path.join(HERE, "demo-runtime.mjs")).href);
    smoke = await import(pathToFileURL(path.join(HERE, "smoke-test.mjs")).href);
    const fixtureFiles = smoke.listFiles(FIXTURE);
    if (fixtureFiles.length === 0) return notRun("The fixture folder is empty. Use the folder as received.");
    kit = Object.fromEntries(
      ["mintigate-demo.mjs", "demo-runtime.mjs", "smoke-test.mjs", "scenarios.json", ...fixtureFiles.map((file) => `fixture/${file}`)]
        .map((file) => [file, sha256(fs.readFileSync(path.join(HERE, ...file.split("/"))))]),
    );
  } catch (error) {
    return notRun(`The demo files cannot be loaded: ${plain(error)}`);
  }

  // Every write of this run goes into a new folder under .output; earlier runs are never touched.
  let runDir;
  try {
    if (!fs.existsSync(OUTPUT)) fs.mkdirSync(OUTPUT);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    runDir = fs.mkdtempSync(path.join(OUTPUT, `run-${stamp}-`));
  } catch (error) {
    return notRun(`The output folder cannot be created: ${plain(error)}`);
  }

  const startedAt = new Date().toISOString();
  let audit = null;
  let obs = null;
  let failure = null;
  let cleanup = null;
  let fixtureBefore = null;
  try {
    fixtureBefore = smoke.hashTree(FIXTURE);
    const workspace = smoke.prepareWorkspace(FIXTURE, runDir);
    audit = runtime.runScenarios(workspace, spec.policy, spec.scenarios);
    obs = smoke.observe(spec, FIXTURE, workspace, audit);
  } catch (error) {
    failure = plain(error);
  } finally {
    cleanup = smoke.cleanupWorkspace(runDir);
  }

  let checks = [];
  let controls = [];
  if (!failure) {
    obs.fixture = fixtureBefore;
    obs.fixtureAfter = smoke.hashTree(FIXTURE);
    obs.workspaceRemoved = !fs.existsSync(path.join(runDir, "workspace"));
    checks = smoke.checkCriteria(spec, obs);
    controls = smoke.negativeControls(spec, obs);
  }
  const failedChecks = checks.filter((check) => !check.pass);
  const missedControls = controls.filter((item) => !item.detected);
  const verified = !failure && checks.length > 0 && failedChecks.length === 0 && controls.length > 0 && missedControls.length === 0;
  const code = verified ? 0 : 1;
  const result = failure ? "STOPPED ON AN ERROR" : verified ? "VERIFIED" : "NOT VERIFIED";

  const reportFile = path.join(runDir, "report.json");
  const report = {
    report: "mintigate-demo-report/1",
    statement: BANNER,
    run: path.basename(runDir),
    started_at: startedAt,
    node: process.version,
    platform: process.platform,
    kit_sha256: kit,
    policy: spec.policy,
    audit,
    approval_requests: (audit ?? []).filter((record) => record.approval === "REQUESTED")
      .map((record) => ({ scenario: record.scenario, target: record.target, status: "PENDING", note: "This demo has no approval command: nothing is applied." })),
    checks,
    negative_controls: controls,
    cleanup,
    error: failure,
    result,
    exit_code: code,
  };
  let reportNote = `Report: ${shown(reportFile)}`;
  try {
    fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  } catch (error) {
    reportNote = `The report could not be written: ${plain(error)}`;
    try {
      fs.rmdirSync(runDir); // only if this run's own folder is empty
    } catch {
      // the folder keeps what is left in it
    }
  }

  say(`Task scope: ${spec.policy.scope.join(", ")} may be changed; protected: ${spec.policy.protected.join(", ")}.`);
  say(`Working copy: ${shown(path.join(runDir, "workspace"))} (temporary; removed at the end of the run).`);
  say();
  (audit ?? []).forEach((record, i) => {
    const scenario = spec.scenarios[i];
    const own = checks.filter((check) => check.id.startsWith(`${scenario.id}:`));
    say(`Scenario ${i + 1}/${spec.scenarios.length}: ${scenario.title}`);
    say(`  Proposal from ${record.actor}: ${record.change}`);
    say(`  Decision: ${record.decision}. ${record.reason}`);
    if (record.written) say(`  Written in the working copy: yes. SHA-256 ${short(record.sha256_before)} -> ${short(record.sha256_after)}`);
    else say(`  Written: no. ${record.sha256_before ? `The file is unchanged (SHA-256 ${short(record.sha256_after)}).` : `${record.target} was not created.`}`);
    if (record.approval) say("  Approval: requested and recorded in the report. This demo has no approval command, so nothing is applied.");
    say(`  Expected: ${scenario.expect.decision}, ${scenario.expect.written ? "written" : "not written"}. Checks: ${own.filter((c) => c.pass).length}/${own.length} passed.`);
    say();
  });

  if (failure) {
    say(`The demo stopped on an error: ${failure}`);
  } else {
    say(`Independent checks (smoke-test.mjs): ${checks.length - failedChecks.length}/${checks.length} passed.`);
    for (const check of failedChecks) say(`  FAILED: ${check.label}${check.detail ? ` (${check.detail})` : ""}`);
    say(`Negative controls: ${controls.length - missedControls.length}/${controls.length} deliberate contradictions made a check fail, as they must.`);
    for (const item of missedControls) say(`  NOT DETECTED: ${item.label}`);
    const fixtureCheck = checks.find((check) => check.id === "fixture-unchanged");
    say(`Shipped fixture unchanged: ${fixtureCheck?.pass ? "yes" : "NO"}.`);
  }
  say(`Temporary files removed: ${cleanup.removed_files} file(s), ${cleanup.removed_folders} folder(s)${cleanup.left.length ? `; left behind: ${cleanup.left.join(", ")}` : ""}.`);
  say();
  if (verified) {
    say("Result: VERIFIED (code 0). The three expected behaviours were verified: one change applied in the working copy, one waiting for human approval, one refused.");
    say("Code 0 does not mean that every proposed action was allowed.");
  } else {
    say(`Result: ${result} (code 1). The expected behaviours were not all verified; see the report.`);
  }
  say(reportNote);
  return code;
}

let exitCode = 1;
try {
  exitCode = await main(process.argv.slice(2));
} catch (error) {
  say(`Result: STOPPED ON AN ERROR (code 1): ${plain(error)}`);
  exitCode = 1;
}
say();
for (const line of BEYOND) say(line);
flush();
process.exitCode = exitCode;
