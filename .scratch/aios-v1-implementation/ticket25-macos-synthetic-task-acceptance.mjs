// Native public CLI task and isolated-validation acceptance; no provider inference.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  syntheticSiteInput,
  syntheticSiteValidator,
} from "../../dist/synthetic-task.js";
const state = "/Users/aaronhoward/.developer-os/ticket4-macos/state",
  repo = "/Users/aaronhoward/.developer-os/ticket4-macos/input";
const policy =
    "/Users/aaronhoward/.developer-os/ticket4-macos/pins-ticket25-memory-3072-20261014.json",
  id = "29727630-9a13-4050-a217-7a554b04448e";
for (const [name, text] of [
  ["index.html", syntheticSiteInput],
  ["validate.sh", syntheticSiteValidator],
]) {
  const path = join(repo, name);
  if (existsSync(path)) assert.equal(readFileSync(path, "utf8"), text);
  else writeFileSync(path, text, { flag: "wx", flush: true });
}
const run = (command) =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [
        "dist/cli.js",
        command,
        "--id",
        id,
        "--state-dir",
        state,
        "--podman-machine",
        "aios-macos-noshare",
        "--worker-policy",
        policy,
        "--adversarial",
      ],
      {
        encoding: "utf8",
        timeout: 240000,
        maxBuffer: 1048576,
        stdio: ["ignore", "pipe", "inherit"],
      },
    ),
  );
const result = run("synthetic-task");
writeFileSync(
  new URL(
    "ticket25-macos-synthetic-task-observation.json",
    import.meta.url,
  ),
  JSON.stringify(
    {
      observedAt: new Date().toISOString(),
      scope:
        "Public CLI fixed synthetic HTML edit, isolated repository-script and loopback HTTP validation; no new inference or production execution",
      task: result.syntheticTask,
      qualification: result.qualification,
    },
    null,
    2,
  ) + "\n",
);
assert.equal(result.syntheticTask.outcome, "completed");
assert.equal(result.syntheticTask.result.negativeValidation, "passed");
assert.equal(result.syntheticTask.result.httpValidation, "passed");
assert.equal(result.syntheticTask.shutdownProof.remainingProcesses, 0);
assert.equal(result.syntheticTask.productionEnabled, false);
const report = JSON.parse(
  execFileSync(
    process.execPath,
    ["dist/cli.js", "qualification-report", "--id", id, "--state-dir", state],
    { encoding: "utf8", timeout: 30000 },
  ),
);
writeFileSync(
  new URL(
    "ticket25-macos-qualification-after-task.json",
    import.meta.url,
  ),
  JSON.stringify(report, null, 2) + "\n",
);
assert.equal(report.checks.authentication.result, "passed");
assert.equal(report.checks.syntheticTask.result, "passed");
assert.equal(report.checks.isolatedValidation.result, "passed");
assert.equal(report.productionEnabled, false);
console.log(
  JSON.stringify({
    status: "completed",
    authentication: report.checks.authentication.result,
    syntheticTask: report.checks.syntheticTask.result,
    isolatedValidation: report.checks.isolatedValidation.result,
    outcome: report.outcome,
    productionEnabled: false,
  }),
);

