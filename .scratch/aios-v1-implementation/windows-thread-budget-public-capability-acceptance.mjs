// Operator-endorsed signed receipt; no candidate receipt import or credential reads.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  realpathSync,
  existsSync,
  copyFileSync,
  renameSync,
  constants,
} from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { DeliveryController } from "../../dist/controller.js";
import { NativePodmanDriver } from "../../dist/podman-native.js";
import { PodmanHostAdapter } from "../../dist/podman-host.js";
import { windowsAuthStore } from "../../dist/windows-auth-store.js";
import { modelRelayVersion } from "../../dist/model-relay.js";
const hash = (v) => createHash("sha256").update(v).digest("hex");
const state = "C:/Users/mraar/.developer-os/ticket19-native/state";
const policyPath =
  "C:/Users/mraar/.developer-os/ticket19-native/pins-windows-ticket24-thread-budget-20261012.json";
const registrationPath =
  "C:/Users/mraar/.developer-os-model-auth/windows-ticket24/registration.json";
const id = "46f3cefb-57e3-48fa-be4f-24fae4b37505";
assert.equal(process.platform, "win32");
const receipt = JSON.parse(
  readFileSync(
    new URL(
      "ticket24-windows-thread-budget-gateway-inference-observation.json",
      import.meta.url,
    ),
  ),
);
const plan = JSON.parse(
  readFileSync(
    new URL(
      "ticket24-windows-thread-budget-gateway-inference-plan.json",
      import.meta.url,
    ),
  ),
);
assert.equal(receipt.proof.explicitResume, "passed");
assert.equal(receipt.proof.resumeInferenceRequests, 0);
assert.equal(receipt.runId, plan.runId);
assert.equal(receipt.subscriptionInference, "passed");
assert.equal(receipt.gatewayRevoked, true);
assert.equal(receipt.proof.shutdown.remainingProcesses, 0);
assert.equal(receipt.proof.relayShutdownRemaining, 0);
assert.equal(receipt.proof.binarySha256, plan.workerExecutableSha256);
assert.equal(receipt.proof.gatewayVersion, plan.gatewayVersion);
const native = new NativePodmanDriver("aios-podman-noshare", state, policyPath);
const controller = new DeliveryController(
  state,
  {},
  {
    worker: new PodmanHostAdapter({
      machine: native.machine,
      policyPath,
      native,
      adversarial: true,
    }),
    offline: native,
  },
);
const observed = await controller.qualify(id),
  q = observed.qualification;
assert.equal(q.bindingSha256, plan.bindingSha256);
assert.equal(q.policySha256, plan.policySha256);
assert.equal(q.subscriptionMediation.gatewayIntegration, "passed");
const path = join(state, "subscription-decision-" + id + ".json");
const record = {
  schema: 1,
  deliveryId: id,
  repositorySha256: hash(realpathSync(observed.repository)),
  runId: plan.runId,
  observedAt: receipt.observedAt,
  accountId: plan.accountId,
  policyPath,
  policySha256: plan.policySha256,
  bindingSha256: plan.bindingSha256,
  registrationPath,
  registrationSha256: hash(readFileSync(registrationPath)),
  gatewayVersion: plan.gatewayVersion,
  relayVersion: modelRelayVersion,
  nativeVersion: hash(readFileSync("dist/podman-native.js")),
  workerExecutableSha256: plan.workerExecutableSha256,
  requestSha256: plan.requestSha256,
  subscriptionInference: "passed",
  gatewayRevoked: true,
  workerRemaining: 0,
  relayRemaining: 0,
};
windowsAuthStore(state, [join(state, "inference-" + plan.runId + ".consumed")]);
if (existsSync(path)) {
  windowsAuthStore(state, [path]);
  const backup = path + ".before-" + plan.runId;
  copyFileSync(path, backup, constants.COPYFILE_EXCL);
  windowsAuthStore(state, [backup]);
  const replacement = path + ".new-" + plan.runId;
  writeFileSync(replacement, JSON.stringify(record, null, 2) + "\n", {
    flag: "wx",
    flush: true,
  });
  windowsAuthStore(state, [replacement]);
  renameSync(replacement, path);
} else
  writeFileSync(path, JSON.stringify(record, null, 2) + "\n", {
    flag: "wx",
    flush: true,
  });
windowsAuthStore(state, [path]);
const result = controller.status(id);
assert.equal(
  result.qualification.subscriptionMediation.mechanismDecision.scope,
  "windows-fixed-codex-subscription",
);
assert.equal(
  result.qualification.subscriptionMediation.mechanismDecision
    .inferenceAuthorized,
  false,
);
assert.equal(result.qualification.ready, false);
writeFileSync(
  new URL(
    "ticket24-windows-thread-budget-public-capability-observation.json",
    import.meta.url,
  ),
  JSON.stringify(
    {
      observedAt: new Date().toISOString(),
      scope:
        "Independent Windows positive historical capability; no new inference authority",
      qualification: result.qualification,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    status: "qualified-mechanism",
    inferenceAuthorized: false,
    productionEnabled: false,
  }),
);
