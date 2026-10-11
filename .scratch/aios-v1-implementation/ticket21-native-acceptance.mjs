// Explicit disposable macOS-host/MCP positive-control qualification.
// node .scratch/aios-v1-implementation/macos-isolation-acceptance.mjs <delivery-id> <external-pins>
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DeliveryController } from "../../dist/controller.js";
import { PodmanHostAdapter } from "../../dist/podman-host.js";
import { NativePodmanDriver } from "../../dist/podman-native.js";
const id = process.argv[2],
  policyPath = process.argv[3];
assert.match(id ?? "", /^[a-f0-9-]{36}$/);
assert.ok(policyPath);
assert.equal(process.platform, "darwin");
assert.equal(process.arch, "arm64");
const state = join(homedir(), ".developer-os", "ticket4-macos", "state");
const machine = "aios-macos-noshare";
const native = new NativePodmanDriver(machine, state, policyPath);
const worker = new PodmanHostAdapter({
  machine,
  policyPath,
  native,
  adversarial: true,
});
const controller = new DeliveryController(
  state,
  {},
  { worker, offline: native },
);
const before = controller.status(id);
assert.equal(before.execution.state, "stopped");
const observed = await controller.qualify(id);
const evidence = {
  checkedAt: new Date().toISOString(),
  scope:
    "Synthetic macOS credential-file and guest credential exclusion with positive controls; no real owner credentials or inference. Restricted Alpine worker only, not a live Codex worker.",
  qualification: observed.qualification,
};
writeFileSync(
  new URL("ticket21-vm-credential-isolation.json", import.meta.url),
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log(JSON.stringify(evidence));
assert.equal(observed.qualification.offlineAdmission.allowed, true);
for (const name of [
  "owner-credentials",
  "host-files",
  "controller-ledger",
  "cross-delivery",
  "network-bypass",
  "skills-mcp-hooks",
  "host-docker",
]) {
  assert.equal(
    observed.qualification.probes.find((probe) => probe.name === name)?.outcome,
    "passed",
    name,
  );
}
assert.equal(
  observed.qualification.adversarial.scope,
  "synthetic-macos-controls",
);
assert.equal(observed.qualification.adversarial.escapeAttempts.length, 4);
assert.ok(
  observed.qualification.adversarial.escapeAttempts.every((value) =>
    value.startsWith("passed-"),
  ),
);
assert.equal(observed.qualification.liveReady, false);
assert.equal(observed.qualification.ready, false);
assert.equal(observed.execution.state, "stopped");
assert.deepEqual(
  new DeliveryController(state).status(id).qualification,
  observed.qualification,
);
assert.equal(
  observed.qualification.subscriptionMediation.credentialIsolation,
  "passed",
);
assert.equal(
  observed.qualification.subscriptionMediation.credentialIsolationScope,
  "synthetic-restricted-alpine",
);
assert.equal(
  observed.qualification.subscriptionMediation.relayRevocation,
  "passed",
);
assert.equal(observed.qualification.subscriptionMediation.qualified, false);
assert.equal(
  observed.qualification.subscriptionMediation.modelFrameTransport,
  "passed",
);
