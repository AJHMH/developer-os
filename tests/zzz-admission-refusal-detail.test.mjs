// Where offline admission and the adversarial probe stopped. The name sorts
// after every other test file, so no other file changes shard.
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DeliveryController } from "../dist/controller.js";
import { PodmanHostAdapter } from "../dist/podman-host.js";

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

// A delivery qualified against pinned `binding`; `adapter` builds the worker.
async function qualified(t, adapter) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-admission-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "repo");
  mkdirSync(repository);
  const state = join(root, "state");
  const policyPath = join(root, "pins.json");
  writeFileSync(policyPath, JSON.stringify({ schema: 1, binding }), {
    mode: 0o600,
  });
  const controller = new DeliveryController(
    state,
    {},
    { worker: new PodmanHostAdapter(adapter({ policyPath, state })) },
  );
  const delivery = controller.start({ repository, request: "Admission" });
  return (await controller.qualify(delivery.id)).qualification;
}
const observing = (observe) => (t) =>
  qualified(t, ({ policyPath }) => ({
    policyPath,
    machine: binding.machine,
    mode: "controlled",
    observe,
  }));

test("refused offline admission names the stage where it stopped", async (t) => {
  for (const [observe, refusal] of [
    [
      () => {
        throw Error("synthetic-private-detail");
      },
      "observation",
    ],
    [
      () => ({
        binding,
        effective,
        configurationIntent: { hostSharesConfigured: true, rootful: false },
      }),
      "configuration",
    ],
    [
      () => ({ binding, effective: { ...effective, mounts: ["/host"] } }),
      "effective-controls",
    ],
  ]) {
    const q = await observing(observe)(t);
    assert.equal(q.offlineAdmission.allowed, false);
    assert.equal(q.offlineAdmission.refusal, refusal);
    assert.equal(q.offlineAdmission.mismatchedKeys, undefined);
    assert.doesNotMatch(JSON.stringify(q), /synthetic-private-detail/);
  }
});

test("a changed binding names only the keys that no longer match the pins", async (t) => {
  const q = await observing(() => ({
    binding: { ...binding, engineVersion: "6.0.3", hostId: "d".repeat(64) },
    effective,
  }))(t);
  assert.equal(q.offlineAdmission.allowed, false);
  assert.equal(q.offlineAdmission.refusal, "binding");
  assert.deepEqual(q.offlineAdmission.mismatchedKeys, [
    "hostId",
    "engineVersion",
  ]);
});

test("an admitted binding records no refusal", async (t) => {
  const q = await observing(() => ({ binding, effective }))(t);
  assert.equal(q.offlineAdmission.allowed, true);
  assert.equal(q.offlineAdmission.refusal, undefined);
});

test("a refused adversarial probe names the stage where it stopped", async (t) => {
  const evidence = {
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
  };
  for (const [probeIsolation, stage] of [
    [
      async () => {
        throw Error("synthetic-private-detail");
      },
      "isolation-probe",
    ],
    [
      async () => ({
        ...evidence,
        binding: { ...binding, hostId: "d".repeat(64) },
      }),
      "isolation-binding",
    ],
    [async () => ({ ...evidence, escapeAttempts: [] }), "isolation-evidence"],
  ]) {
    const q = await qualified(t, ({ policyPath, state }) => ({
      policyPath,
      machine: binding.machine,
      adversarial: true,
      native: {
        machine: binding.machine,
        policyPath,
        authorityDirectory: state,
        observe: () => ({ binding, effective }),
        probeIsolation,
      },
    }));
    assert.equal(q.offlineAdmission.allowed, true);
    assert.equal(q.adversarialBlocker, stage);
    assert.match(
      q.blockers.join(" "),
      /positive controls could not be verified/,
    );
    assert.doesNotMatch(JSON.stringify(q), /synthetic-private-detail/);
  }
});
