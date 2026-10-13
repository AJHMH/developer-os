// Explicit credential-free native boundary and controller crash qualification.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const result = JSON.parse(
  execFileSync(
    process.execPath,
    [
      "dist/cli.js",
      "qualify-windows-controls",
      "--id",
      "46f3cefb-57e3-48fa-be4f-24fae4b37505",
      "--state-dir",
      "C:/Users/mraar/.developer-os/ticket19-native/state",
      "--podman-machine",
      "aios-podman-noshare",
      "--worker-policy",
      "C:/Users/mraar/.developer-os/ticket19-native/pins-windows-ticket24-main-1b5b545-20261012.json",
      "--adversarial",
    ],
    {
      encoding: "utf8",
      timeout: 600000,
      maxBuffer: 1048576,
      stdio: ["ignore", "pipe", "inherit"],
    },
  ),
);
writeFileSync(
  new URL("ticket24-windows-main-1b5b545-controls-observation.json", import.meta.url),
  JSON.stringify(
    {
      observedAt: new Date().toISOString(),
      scope:
        "Synthetic signing/publication exclusion, effective mounts, descendant stop, revoked repository fencing, killed controller and exact-session recovery; no provider inference",
      controls: result.windowsControls,
      qualification: result.qualification,
    },
    null,
    2,
  ) + "\n",
);
assert.equal(result.windowsControls.outcome, "passed");
assert.equal(result.windowsControls.mode, "live");
assert.ok(
  result.windowsControls.censuses.every((c) => c.remainingProcesses === 0),
);
assert.equal(result.windowsControls.productionEnabled, false);
console.log(
  JSON.stringify({
    outcome: "passed",
    checks: result.windowsControls.checks.map((c) => c.name),
    remainingProcesses: 0,
    productionEnabled: false,
  }),
);
