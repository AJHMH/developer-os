import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeliveryController } from "../dist/controller.js";
import { PodmanHostAdapter } from "../dist/podman-host.js";
import { spawnSync } from "node:child_process";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "aios-podman-"));
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
  assert.equal(result.execution, undefined);
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
