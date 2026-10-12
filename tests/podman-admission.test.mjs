import assert from "node:assert/strict";
import { test } from "node:test";
import {
  realpathSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeliveryController } from "../dist/controller.js";
import { PodmanHostAdapter } from "../dist/podman-host.js";
import { spawnSync } from "node:child_process";

function fixture(t, hostBinding = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-podman-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "repo");
  mkdirSync(repository);
  const binding = {
    platform: "win32",
    arch: "x64",
    osVersion: "10.0.26100",
    provider: "hyperv",
    machine: "aios-test",
    hostId: "a".repeat(64),
    engineVersion: "6.0.2",
    vmImageSha256: "b".repeat(64),
    template: "example.org/worker@sha256:" + "c".repeat(64),
    workerVersion: "0.161.0",
    policyVersion: "offline-v1",
    ...hostBinding,
  };
  const effective = {
    hypervisor: true,
    dedicated: true,
    mounts: [],
    managementExposed: false,
    rootful: false,
    network: "none",
    readOnly: true,
    user: "65534:65534",
    capabilities: [],
    noNewPrivileges: true,
  };
  const policyPath = join(root, "pins.json");
  writeFileSync(policyPath, JSON.stringify({ schema: 1, binding }));
  let observation = { binding, effective };
  const worker = new PodmanHostAdapter({
    policyPath,
    machine: "aios-test",
    mode: "controlled",
    observe: () => observation,
  });
  const state = join(root, "state");
  const controller = new DeliveryController(state, {}, { worker });
  const delivery = controller.start({
    repository,
    request: "Offline admission",
  });
  return {
    controller,
    delivery,
    state,
    set: (value) => {
      observation = value;
    },
    binding,
    effective,
  };
}

test("a matching dedicated Windows VM admits only an offline probe and records durable bindings", async (t) => {
  const f = fixture(t);
  const result = await f.controller.qualify(f.delivery.id);
  assert.equal(result.qualification.offlineAdmission.allowed, true);
  assert.equal(
    result.qualification.offlineAdmission.binding.engineVersion,
    "6.0.2",
  );
  assert.equal(result.qualification.liveReady, false);
  assert.equal(result.qualification.ready, false);
  assert.equal(result.qualification.subscriptionMediation.qualified, false);
  assert.equal(result.qualification.subscriptionMediation.protocol, "not-run");
  assert.match(
    result.qualification.subscriptionMediation.nextAction,
    /trusted.*relay/i,
  );
  assert.equal(result.execution, undefined);
  assert.deepEqual(
    new DeliveryController(f.state).status(f.delivery.id).qualification,
    result.qualification,
  );
});

test("qualification records revocable synthetic relay proof without granting live authority", async (t) => {
  const f = fixture(t);
  const result = await f.controller.qualify(f.delivery.id);
  assert.equal(
    result.qualification.subscriptionMediation.relayRevocation,
    "passed",
  );
  assert.equal(
    result.qualification.subscriptionMediation.hostGateway,
    "passed",
  );
  assert.equal(result.qualification.liveReady, false);
  assert.equal(
    result.qualification.subscriptionMediation.credentialIsolation,
    "not-run",
  );
  assert.deepEqual(
    new DeliveryController(f.state).status(f.delivery.id).qualification,
    result.qualification,
  );
});

test("changed bindings, host shares, management access and weaker hosts revoke offline admission", async (t) => {
  const f = fixture(t);
  for (const observation of [
    {
      binding: { ...f.binding, engineVersion: "6.0.3" },
      effective: f.effective,
    },
    {
      binding: { ...f.binding, vmImageSha256: undefined },
      effective: f.effective,
    },
    { binding: f.binding, effective: { ...f.effective, mounts: ["/host"] } },
    {
      binding: f.binding,
      effective: { ...f.effective, managementExposed: true },
    },
    { binding: f.binding, effective: { ...f.effective, dedicated: undefined } },
    { binding: { ...f.binding, platform: "linux" }, effective: f.effective },
  ]) {
    f.set(observation);
    const result = await f.controller.qualify(f.delivery.id);
    assert.equal(result.qualification.offlineAdmission.allowed, false);
    assert.equal(result.qualification.ready, false);
    assert.equal(result.execution, undefined);
  }
});

test("raw observation errors and unknown native controls cannot become admission or durable secrets", async (t) => {
  const f = fixture(t);
  f.set({
    binding: { ...f.binding, password: "synthetic-secret-detail" },
    effective: { mounts: [], rootful: false },
  });
  const result = await f.controller.qualify(f.delivery.id);
  assert.equal(result.qualification.offlineAdmission.allowed, false);
  assert.equal(
    JSON.stringify(result).includes("synthetic-secret-detail"),
    false,
  );
});

test("candidate pin policies and CLI adapter misuse refuse admission without dispatch", async (t) => {
  const f = fixture(t);
  const candidatePolicy = join(f.delivery.repository, "pins.json");
  writeFileSync(
    candidatePolicy,
    JSON.stringify({ schema: 1, binding: f.binding }),
  );
  const controller = new DeliveryController(
    f.state,
    {},
    {
      worker: new PodmanHostAdapter({
        machine: "aios-test",
        policyPath: candidatePolicy,
        mode: "controlled",
        observe: () => ({ binding: f.binding, effective: f.effective }),
      }),
    },
  );
  const result = await controller.qualify(f.delivery.id);
  assert.equal(result.qualification.offlineAdmission.allowed, false);
  assert.equal(result.execution, undefined);
  const invalid = spawnSync(
    process.execPath,
    [
      "dist/cli.js",
      "status",
      "--state-dir",
      f.state,
      "--podman-machine",
      "aios-test",
    ],
    { encoding: "utf8" },
  );
  assert.equal(invalid.status, 1);
  assert.equal(
    new DeliveryController(f.state).status(f.delivery.id).execution,
    undefined,
  );
});

test("candidate-supplied Codex cannot provide authentication capability evidence", async (t) => {
  const f = fixture(t);
  const executable = join(f.delivery.repository, "candidate-codex.exe");
  writeFileSync(executable, "synthetic-secret-detail");
  const controller = new DeliveryController(
    f.state,
    {},
    {
      worker: new PodmanHostAdapter({
        machine: "aios-test",
        policyPath: join(f.state, "..", "pins.json"),
        mode: "controlled",
        codexExecutable: executable,
        observe: () => ({ binding: f.binding, effective: f.effective }),
      }),
    },
  );
  const result = await controller.qualify(f.delivery.id);
  assert.equal(result.qualification.offlineAdmission.allowed, true);
  assert.equal(result.qualification.subscriptionMediation.protocol, "not-run");
  assert.equal(
    result.qualification.subscriptionMediation.executableSha256,
    undefined,
  );
  assert.equal(result.qualification.liveReady, false);
  assert.equal(result.execution, undefined);
  assert.equal(
    JSON.stringify(controller.status(result.id)).includes(
      "synthetic-secret-detail",
    ),
    false,
  );
});

test("independent Apple-silicon AppleHV evidence admits an offline probe without qualifying production", async (t) => {
  const f = fixture(t, {
    platform: "darwin",
    arch: "arm64",
    osVersion: "26.2.0",
    provider: "applehv",
  });
  const result = await f.controller.qualify(f.delivery.id);
  assert.equal(result.qualification.offlineAdmission.allowed, true);
  assert.equal(
    result.qualification.offlineAdmission.binding.provider,
    "applehv",
  );
  assert.equal(result.qualification.ready, false);
  assert.equal(result.qualification.liveReady, false);
  assert.equal(result.qualification.mode, "controlled");
  assert.equal(result.execution, undefined);
  assert.deepEqual(
    new DeliveryController(f.state).status(f.delivery.id).qualification,
    result.qualification,
  );
});

test("macOS admission refuses Intel, older Darwin, implicit providers and conflicting share intent", async (t) => {
  for (const changed of [
    { arch: "x64" },
    { osVersion: "22.6.0" },
    { provider: "libkrun" },
    { provider: "hyperv" },
  ]) {
    const f = fixture(t, {
      platform: "darwin",
      arch: "arm64",
      osVersion: "27.2.0",
      provider: "applehv",
      ...changed,
    });
    assert.equal(
      (await f.controller.qualify(f.delivery.id)).qualification.offlineAdmission
        .allowed,
      false,
    );
  }
  const f = fixture(t, {
    platform: "darwin",
    arch: "arm64",
    osVersion: "27.2.0",
    provider: "applehv",
  });
  f.set({
    binding: f.binding,
    effective: f.effective,
    configurationIntent: { hostSharesConfigured: true, rootful: false },
  });
  const result = await f.controller.qualify(f.delivery.id);
  assert.equal(result.qualification.offlineAdmission.allowed, false);
  assert.equal(result.execution, undefined);
});

test("any changed macOS binding or incomplete effective control revokes admission and cannot inherit Windows proof", async (t) => {
  const f = fixture(t, {
    platform: "darwin",
    arch: "arm64",
    osVersion: "27.2.0",
    provider: "applehv",
  });
  assert.equal(
    (await f.controller.qualify(f.delivery.id)).qualification.offlineAdmission
      .allowed,
    true,
  );
  for (const field of [
    "osVersion",
    "provider",
    "hostId",
    "engineVersion",
    "vmImageSha256",
    "template",
    "workerVersion",
    "policyVersion",
  ]) {
    f.set({
      binding: { ...f.binding, [field]: "changed" },
      effective: f.effective,
    });
    const refused = await f.controller.qualify(f.delivery.id);
    assert.equal(refused.qualification.offlineAdmission.allowed, false, field);
    assert.equal(refused.qualification.liveReady, false);
    assert.equal(refused.execution, undefined);
  }
  for (const field of Object.keys(f.effective)) {
    const effective = { ...f.effective };
    delete effective[field];
    f.set({ binding: f.binding, effective });
    assert.equal(
      (await f.controller.qualify(f.delivery.id)).qualification.offlineAdmission
        .allowed,
      false,
      field,
    );
  }
});

test("public qualification records synthetic credential isolation, endpoint, delivery-capability, and gateway proofs without enabling production", async (t) => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "aios-adversarial-proof-")),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "repo");
  const state = join(root, "state");
  const policyPath = join(root, "pins.json");
  mkdirSync(repository);
  const binding = {
    platform: "win32",
    arch: "x64",
    osVersion: "10.0.26100",
    provider: "hyperv",
    machine: "aios-test",
    hostId: "a".repeat(64),
    engineVersion: "6.0.2",
    vmImageSha256: "b".repeat(64),
    template: "example.org/worker@sha256:" + "c".repeat(64),
    workerVersion: "0.161.0",
    policyVersion: "offline-v1",
  };
  const effective = {
    hypervisor: true,
    dedicated: true,
    mounts: [],
    managementExposed: false,
    rootful: false,
    network: "none",
    readOnly: true,
    user: "65534:65534",
    capabilities: [],
    noNewPrivileges: true,
  };
  writeFileSync(policyPath, JSON.stringify({ schema: 1, binding }), {
    mode: 0o600,
  });
  const gateway = await import("../dist/subscription-gateway.js");
  const delivery = new DeliveryController(
    state,
    {},
    {
      worker: new PodmanHostAdapter({
        machine: binding.machine,
        policyPath,
        adversarial: true,
        native: {
          machine: binding.machine,
          policyPath,
          authorityDirectory: state,
          observe: () => ({ binding, effective }),
          async probeIsolation(_repository, deliveryId) {
            return {
              passed: true,
              binding,
              challengeId: "00000000-0000-4000-8000-000000000111",
              probeVersion: "d".repeat(64),
              escapeAttempts: [
                "passed-escape-unshare",
                "passed-escape-chroot",
                "passed-escape-cgroup",
                "passed-escape-proc",
              ],
              probes: [
                {
                  name: "owner-credentials",
                  outcome: "passed",
                  evidenceSha256: "e".repeat(64),
                },
              ],
              credentialExclusion: {
                hostFilesDenied: true,
                guestFileDenied: true,
                environmentScrubbed: true,
                mountsAbsent: true,
                networkAbsent: true,
                positiveControlsBeforeAfter: true,
              },
              modelFrameTransport: "passed",
              codex: {
                protocol: "passed",
                explicitResume: "passed",
                resumeInferenceRequests: 0,
                observedCodexProcesses: 1,
                credentialIsolation: "passed",
                binarySha256:
                  "9a820c17865fa825d04db416818679a9d63bd72e50835c396f496e5684626c9c",
                shutdown: { remainingProcesses: 0 },
                endpointEnforcement: "passed",
                deliveryCapabilities: "passed",
                relayScope: "synthetic-codex-relay",
                relayDeliveryId: deliveryId,
                relayShutdownRemaining: 0,
                capabilityChecks: [
                  "cross-delivery",
                  "namespace",
                  "revocation",
                  "quota",
                  "expiry",
                ],
                gatewayIntegration: "passed",
                gatewayVersion: gateway.subscriptionGatewayVersion,
              },
            };
          },
        },
      }),
    },
  );
  const request = delivery.start({
    repository,
    request: "Qualification report",
  });
  const result = await delivery.qualify(request.id);
  const mediation = result.qualification.subscriptionMediation;
  assert.equal(result.qualification.offlineAdmission.allowed, true);
  assert.equal(mediation.credentialIsolation, "passed");
  assert.equal(mediation.modelFrameTransport, "passed");
  assert.equal(mediation.workerProtocol, "passed");
  assert.equal(mediation.explicitResume, "passed");
  assert.equal(mediation.endpointEnforcement, "passed");
  assert.equal(mediation.deliveryCapabilities, "passed");
  assert.equal(mediation.gatewayIntegration, "passed");
  assert.equal(result.qualification.liveReady, false);
  assert.equal(result.execution, undefined);
});
