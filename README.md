# Mintigate demo (offline)

Offline demonstration — simulated agent, simplified demo runtime. Proprietary Mintigate Runtime not executed.

This folder is a small, deterministic demonstration that you can read in full and run on your own computer. A simulated agent proposes three fixed changes to a synthetic two-file fixture. A simplified demo runtime decides on each change in a temporary copy of the fixture, and an independent check confirms what happened.

## What it shows

| # | Proposed change | Expected decision | Written? |
|---|---|---|---|
| 1 | Set `--mint-demo-accent` from 0 to 1 in `src/styles/base.css`, inside the declared scope | `APPLIED` | Yes, in the temporary copy only |
| 2 | Change `src/js/story.js`, a protected file | `PENDING_APPROVAL` | No: a human approval is required, and this demo gives none |
| 3 | Change `config/deploy.json`, outside the declared scope | `REFUSED` | No |

Each decision is recorded with the SHA-256 of the target before and after, in a report.

## What you need

1. This folder, as received.
2. Node.js 18 or later. Nothing else: no package to install, no Git, no Claude Code, no SDK, no network access, no account and no model call.

## Run it

Open a terminal in this folder (on Windows, PowerShell or Windows Terminal) and run:

    node mintigate-demo.mjs

The demo takes no option. There is no live mode.

## Exit codes

| Code | Result shown | Meaning |
|---|---|---|
| 0 | `VERIFIED` | The three expected behaviours were verified: one change applied, one waiting for approval, one refused. Code 0 does not mean that every proposed action was allowed. |
| 1 | `NOT VERIFIED` or `STOPPED ON AN ERROR` | A check failed, or the demo stopped on an error. The console and the report say which. |
| 2 | `NOT RUN` | An option was given, Node.js is too old, or a file of this folder is missing or unreadable. Nothing was written. |

## What it writes

1. Each run creates a new folder `.output/run-<date>-<random>/` in this folder. Earlier runs are never changed.
2. The fixture is copied into `workspace/` inside that new folder, and the changes are made there only. The shipped `fixture/` folder is never written.
3. At the end of the run, even after an error, the demo removes the files and folders of that `workspace/` one by one. It removes nothing else.
4. What remains is one report: `.output/run-<date>-<random>/report.json`. It holds the decisions, the audit records, the hashes, the checks, the negative controls, the clean-up count and the hashes of the demo files that were used. It contains no absolute path of your computer.

Nothing is written outside `.output/`, and no setting of your computer is changed. To remove everything, delete this folder.

## How the checks work

`smoke-test.mjs` does not use `demo-runtime.mjs` to judge the outcome. It copies the fixture, reads the files itself, computes their hashes and compares them with the expectations in `scenarios.json`:

1. the decision of each scenario;
2. for the applied change: exactly the expected line changed, and nothing else;
3. for the other two: the target is unchanged, or was not created;
4. the hashes in each audit record match the files;
5. every protected file and every file outside the scope is unchanged, no file was created or deleted, the shipped fixture is unchanged, and the temporary copy was removed.

It then runs negative controls: deliberately wrong expectations or observations, such as expecting the refused change to be applied or pretending that the protected file changed. Each one must make a named check fail. If a contradiction went unnoticed, the run ends with code 1.

## Files

| File | Role |
|---|---|
| `mintigate-demo.mjs` | Entry point and console summary |
| `demo-runtime.mjs` | Simplified scope, protection and application rules |
| `smoke-test.mjs` | Preparation of the working copy and independent checks |
| `scenarios.json` | The simulated proposals and the expectations |
| `fixture/src/styles/base.css`, `fixture/src/js/story.js` | Synthetic files written for this demo |
| `LICENSE` | MIT licence for this kit |
| `SHA256SUMS` | SHA-256 of the files above |

## Limits

1. The agent is simulated: its three proposals are fixed in `scenarios.json`. No model is called.
2. The runtime is a simplified demo runtime of a few rules: a folder or file scope, a list of protected files, and exact text replacements. It is not the proprietary Mintigate Runtime, which this demo does not contain or execute.
3. The demo works only on its own synthetic fixture. It does not run on your repository, does not watch or intercept your tools, and has no approval command.
4. It is not a benchmark and measures no performance.

## Licence

The MIT licence in `LICENSE` applies to the files of this kit only.

### Try a deliberate mismatch

In a separate copy of the demo, open `scenarios.json`. For `protected-file-change`, change `expect.decision` from `PENDING_APPROVAL` to `APPLIED`, then run:

`node mintigate-demo.mjs`

The demo should exit with code 1: the protected change still requires approval, and the independent check rejects your altered expectation. Inspect the generated `report.json` to see the decision, failed checks, and file hashes.

You control this local demo and can change its policies or code. It illustrates governance rules; it does not protect against its own administrator.

## Beyond the demo

This demo illustrates scoped changes, human approval boundaries, and audit records using a deterministic agent and a simplified runtime.

Mintigate is being developed to help developers govern real agent workflows. This demo does not execute its proprietary Runtime or connect to a live model.

Explore the project, current evaluation results, and limitations: https://mintigate.com
