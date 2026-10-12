import assert from "node:assert/strict";
import { test } from "node:test";
import { assertWindowsAcceptance } from "../scripts/assert-windows-qualification.mjs";

const report = {
  deliveryId: "delivery",
  target: { platform: "win32", arch: "x64", provider: "hyperv" },
  outcome: "qualified",
  productionEnabled: false,
  checks: Object.fromEntries(
    [
      "hostBinding",
      "offlineTransfer",
      "adversarialIsolation",
      "onlinePolicy",
      "authentication",
      "usageGate",
      "fencingRecovery",
      "syntheticTask",
      "isolatedValidation",
    ].map((name) => [name, { result: "passed", evidenceMode: "live" }]),
  ),
};
const delivery = {
  id: "delivery",
  execution: { state: "stopped" },
  sessions: [{ state: "stopped" }],
  onlineAccess: { state: "stopped" },
  onlineRuns: [{ state: "stopped" }],
};
test("acceptance requires all nine live Windows gates and every retained session stopped", () => {
  assert.doesNotThrow(() => assertWindowsAcceptance(report, delivery));
  assert.throws(() =>
    assertWindowsAcceptance(report, {
      ...delivery,
      onlineRuns: [{ state: "uncertain" }],
    }),
  );
  assert.throws(() =>
    assertWindowsAcceptance(report, {
      ...delivery,
      sessions: [{ state: "uncertain" }],
    }),
  );
  assert.throws(() =>
    assertWindowsAcceptance(report, {
      ...delivery,
      onlineAccess: { state: "dispatched" },
    }),
  );
  assert.throws(() =>
    assertWindowsAcceptance({ ...report, outcome: "blocked" }, delivery),
  );
  assert.throws(() =>
    assertWindowsAcceptance(
      { ...report, deliveryId: "another-delivery" },
      delivery,
    ),
  );
  const controlled = structuredClone(report);
  controlled.checks.authentication.evidenceMode = "controlled";
  assert.throws(() => assertWindowsAcceptance(controlled, delivery));
});
