// Explicit owner-approved synthetic online qualification. No provider inference.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { DeliveryController } from "../../dist/controller.js";
import { NativePodmanDriver } from "../../dist/podman-native.js";
import { PodmanHostAdapter } from "../../dist/podman-host.js";
import { NativeOnlineAccess } from "../../dist/online-native.js";
assert.equal(process.argv[2], "--approved-synthetic-unknown-usage");
assert.equal(process.platform, "darwin");
const state = "/Users/aaronhoward/.developer-os/ticket4-macos/state";
const policyPath =
  "/Users/aaronhoward/.developer-os/ticket4-macos/pins-ticket25-memory-3072-20261014.json";
const id = "29727630-9a13-4050-a217-7a554b04448e";
const native = new NativePodmanDriver("aios-macos-noshare", state, policyPath);
const base = new PodmanHostAdapter({
  machine: native.machine,
  policyPath,
  native,
  adversarial: true,
});
const admission = await new DeliveryController(
  state,
  {},
  { worker: base },
).qualify(id);
assert.equal(
  admission.qualification.subscriptionMediation.mechanismDecision?.qualified,
  true,
);
let approved = false;
const worker = {
  async probe(delivery, authority) {
    const q = await base.probe(delivery, authority);
    assert.equal(q.offlineAdmission.allowed, true);
    assert.equal(q.subscriptionMediation.gatewayIntegration, "passed");
    // Grant only after slow native requalification, before the one dispatch.
    assert.equal(approved, false);
    const usage = (await controller.checkUsage(id)).usage;
    assert.equal(usage.decision, "approval-required");
    controller.approveUsage(id, usage.checkId);
    approved = true;
    return q;
  },
};
const runtime = new NativeOnlineAccess(native);
assert.equal(runtime.requiresExactApproval, undefined);
assert.equal(runtime.inferenceRequest, undefined);
const controller = new DeliveryController(
  state,
  {},
  { worker, offline: native, online: runtime },
);
const result = await controller.onlineCanary(id);
writeFileSync(
  new URL("ticket25-macos-online-observation.json", import.meta.url),
  JSON.stringify(
    {
      observedAt: new Date().toISOString(),
      scope:
        "Owner-approved one-run unknown usage; VM-local synthetic model/dependency/bypass qualification only; no inference",
      onlineAccess: result.onlineAccess,
      usage: result.usage,
      qualification: result.qualification,
    },
    null,
    2,
  ) + "\n",
);
assert.equal(result.onlineAccess.outcome, "passed");
assert.equal(result.onlineAccess.shutdown.remainingProcesses, 0);
assert.equal(result.onlineAccess.shutdown.revoked, true);
assert.equal(result.usage.approval.operationId, result.onlineAccess.runId);
assert.equal(result.onlineAccess.productionEnabled, false);
console.log(
  JSON.stringify({
    runId: result.onlineAccess.runId,
    outcome: "passed",
    remainingProcesses: 0,
    productionEnabled: false,
  }),
);

