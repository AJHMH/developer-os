import assert from "node:assert/strict";
import { test } from "node:test";
import { monitored } from "./helpers/pr-checks-fixture.mjs";

for (const [name, patch] of [
  ["stale head", { head: "b".repeat(40) }],
  ["spoofed publisher", { publisher: "other" }],
  ["spoofed workflow", { workflow: "untrusted" }],
  ["skipped", { status: "skipped" }],
  ["neutral", { status: "neutral" }],
  ["cancelled", { status: "cancelled" }],
  ["pending", { status: "pending", completedAt: undefined }],
])
  test(`${name} cannot pass required PR checks`, async (t) => {
    const f = await monitored(t),
      snapshot = f.snapshot;
    f.snapshot = () => {
      const s = snapshot();
      Object.assign(s.checks[0], patch);
      return s;
    };
    const d = await f.controller.monitorPRChecks(f.delivery.id);
    assert.notEqual(d.prChecks.runs[0].outcome, "passed");
    assert.notEqual(d.phase, "waiting-review");
  });
