// Explicit credential-free native boundary and controller crash qualification.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const result = JSON.parse(
  execFileSync(
    process.execPath,
    [
      "dist/cli.js",
      "qualify-macos-controls",
      "--id",
      "29727630-9a13-4050-a217-7a554b04448e",
      "--state-dir",
      "/Users/aaronhoward/.developer-os/ticket4-macos/state",
      "--podman-machine",
      "aios-macos-noshare",
      "--worker-policy",
      "/Users/aaronhoward/.developer-os/ticket4-macos/pins-ticket25-memory-3072-20261014.json",
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
  new URL("ticket25-macos-controls-observation.json", import.meta.url),
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

