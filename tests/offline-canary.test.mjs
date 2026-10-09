import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readFileSync,
  symlinkSync,
  linkSync,
  renameSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeliveryController } from "../dist/controller.js";
import { PodmanHostAdapter } from "../dist/podman-host.js";
import { spawnSync } from "node:child_process";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "aios-offline-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "repo");
  mkdirSync(repository);
  writeFileSync(join(repository, "canary.txt"), "AIOS offline canary input\n");
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
  const worker = new PodmanHostAdapter({
    machine: "aios-test",
    policyPath,
    mode: "controlled",
    observe: () => ({ binding, effective }),
  });
  let stopped = false;
  const runtime = {
    mode: "controlled",
    async execute(request) {
      assert.equal(request.mayDispatch(), true);
      assert.equal(
        request.files[0].bytes.toString(),
        "AIOS offline canary input\n",
      );
      this.request = request;
      return {
        ...request.session,
        status: "running",
        bindingSha256: request.bindingSha256,
        policySha256: request.policySha256,
        fresh: true,
        binding,
        effective,
      };
    },
    async stop(session) {
      stopped = true;
      return {
        ...session,
        status: "stopped",
        revoked: true,
        descendantsStopped: true,
        bindingSha256: this.request.bindingSha256,
        policySha256: this.request.policySha256,
      };
    },
    async collect(session) {
      assert.equal(stopped, true, "collection requires independent stop");
      return {
        ...session,
        status: "stopped",
        bindingSha256: this.request.bindingSha256,
        policySha256: this.request.policySha256,
        files: [
          {
            path: "result.txt",
            bytes: Buffer.from("AIOS offline canary complete\n"),
            ordinary: true,
            links: 1,
            beforeSha256:
              "8c7c900981cc61b52bb01e7bcd601dc8454f8e9b0565a0c082d7ae13a76234e5",
            afterSha256:
              "8c7c900981cc61b52bb01e7bcd601dc8454f8e9b0565a0c082d7ae13a76234e5",
          },
        ],
      };
    },
  };
  const state = join(root, "state");
  const controller = new DeliveryController(
    state,
    {},
    { worker, offline: runtime },
  );
  const delivery = controller.start({
    repository,
    request: "Synthetic offline canary",
  });
  return {
    controller,
    delivery,
    state,
    runtime,
    repository,
    binding,
    effective,
  };
}

test("an admitted synthetic round trip retains bindings and collects only after verified stop", async (t) => {
  const f = fixture(t);
  const result = await f.controller.offlineCanary(f.delivery.id);
  assert.equal(result.offlineCanary.outcome, "completed");
  assert.equal(result.execution.state, "stopped");
  assert.equal(result.qualification.liveReady, false);
  assert.equal(result.phase, "blocked");
  const evidence = result.evidence.find((e) => e.kind === "offline-canary");
  assert.equal(
    JSON.parse(readFileSync(evidence.path)).output.content,
    "AIOS offline canary complete\n",
  );
  assert.deepEqual(
    new DeliveryController(f.state).status(result.id).offlineCanary,
    result.offlineCanary,
  );
});

test("timed-out dispatch is fenced before collection and late starts lose authority", async (t) => {
  const f = fixture(t);
  let finish;
  let pendingRequest;
  f.runtime.execute = (request) => {
    pendingRequest = request;
    f.runtime.request = request;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  f.runtime.collect = async () => {
    assert.fail("timed-out execution cannot collect");
  };
  const controller = new DeliveryController(
    f.state,
    {},
    {
      worker: new PodmanHostAdapter({
        machine: "aios-test",
        mode: "controlled",
        policyPath: join(f.state, "..", "pins.json"),
        observe: () => ({ binding: f.binding, effective: f.effective }),
      }),
      offline: f.runtime,
      observationTimeoutMs: 10,
    },
  );
  const result = await controller.offlineCanary(f.delivery.id);
  assert.equal(result.offlineCanary.outcome, "rejected");
  assert.equal(result.execution.state, "stopped");
  assert.equal(pendingRequest.mayDispatch(), false);
  finish({ ...pendingRequest.session, ...pendingRequest, status: "running" });
  await Promise.resolve();
  assert.equal(controller.status(result.id).execution.state, "stopped");
});

test("reopening with the matching driver can reconcile uncertainty without collecting or redispatching", async (t) => {
  const f = fixture(t);
  const stop = f.runtime.stop.bind(f.runtime);
  f.runtime.stop = async () => {
    throw Error("token=synthetic-provider-secret");
  };
  const result = await f.controller.offlineCanary(f.delivery.id);
  assert.equal(result.execution.state, "uncertain");
  f.runtime.stop = stop;
  f.runtime.execute = async () => {
    assert.fail("recovery cannot dispatch");
  };
  f.runtime.collect = async () => {
    assert.fail("recovery cannot collect");
  };
  const recovered = await new DeliveryController(
    f.state,
    {},
    { offline: f.runtime },
  ).recover(result.id);
  assert.equal(recovered.execution.state, "stopped");
  assert.equal(recovered.offlineCanary.outcome, "rejected");
  assert.equal(
    recovered.evidence.some((e) => e.kind === "offline-canary"),
    false,
  );
  assert.equal(
    JSON.stringify(recovered).includes("synthetic-provider-secret"),
    false,
  );
});

test("a ledger outage during shutdown preserves a dispatched session for explicit recovery", async (t) => {
  const f = fixture(t);
  const execute = f.runtime.execute.bind(f.runtime);
  const savedState = f.state + "-outage";
  f.runtime.execute = async (request) => {
    const receipt = await execute(request);
    renameSync(f.state, savedState);
    return receipt;
  };
  f.runtime.collect = async () => {
    assert.fail("ledger outage cannot collect");
  };
  await assert.rejects(
    () => f.controller.offlineCanary(f.delivery.id),
    /stop could not be recorded/i,
  );
  rmSync(f.state, { recursive: true, force: true });
  renameSync(savedState, f.state);
  const reopened = new DeliveryController(f.state, {}, { offline: f.runtime });
  assert.equal(reopened.status(f.delivery.id).execution.state, "dispatched");
  assert.throws(() => reopened.release(f.delivery.id), /shutdown/i);
  const recovered = await reopened.recover(f.delivery.id);
  assert.equal(recovered.execution.state, "stopped");
  assert.equal(recovered.offlineCanary.outcome, "rejected");
});

test("unknown stop observations retain ownership and forbid collection across restart", async (t) => {
  const f = fixture(t);
  let collected = false;
  f.runtime.stop = async (session) => ({
    ...session,
    status: "stopped",
    revoked: true,
    descendantsStopped: false,
    bindingSha256: f.runtime.request.bindingSha256,
    policySha256: f.runtime.request.policySha256,
  });
  f.runtime.collect = async () => {
    collected = true;
    throw Error("forbidden");
  };
  const result = await f.controller.offlineCanary(f.delivery.id);
  assert.equal(result.offlineCanary.outcome, "uncertain");
  assert.equal(collected, false);
  const reopened = new DeliveryController(f.state);
  assert.equal(reopened.status(result.id).execution.state, "uncertain");
  assert.throws(() => reopened.release(result.id), /shutdown/i);
  await assert.rejects(
    () => reopened.offlineCanary(result.id),
    /Stop and reconcile/i,
  );
});

test("pause during dispatch stops the canary and prevents output import", async (t) => {
  const f = fixture(t);
  const execute = f.runtime.execute.bind(f.runtime);
  f.runtime.execute = async (request) => {
    const response = await execute(request);
    await f.controller.pause(f.delivery.id);
    return response;
  };
  f.runtime.collect = async () => {
    assert.fail("paused canaries cannot collect");
  };
  const result = await f.controller.offlineCanary(f.delivery.id);
  assert.equal(result.phase, "paused");
  assert.equal(result.execution.state, "stopped");
  assert.equal(
    result.evidence.some((e) => e.kind === "offline-canary"),
    false,
  );
});

test("unsafe paths, secret input and linked entries refuse dispatch", async (t) => {
  const f = fixture(t);
  f.runtime.execute = async () => {
    assert.fail("unsafe input cannot dispatch");
  };
  for (const path of [
    "../canary.txt",
    ".git/config",
    ".env",
    "nested\\canary.txt",
    "canary.txt:stream",
    "CON",
    "canary.txt.",
  ]) {
    const result = await f.controller.offlineCanary(f.delivery.id, [
      { path, sha256: "0".repeat(64) },
    ]);
    assert.equal(result.offlineCanary.outcome, "refused", path);
    assert.equal(result.execution, undefined);
  }
  writeFileSync(join(f.repository, "canary.txt"), "token=synthetic-secret\n");
  assert.equal(
    (await f.controller.offlineCanary(f.delivery.id)).offlineCanary.outcome,
    "refused",
  );
  rmSync(join(f.repository, "canary.txt"));
  const source = join(f.repository, "source.txt");
  writeFileSync(source, "AIOS offline canary input\n");
  linkSync(source, join(f.repository, "canary.txt"));
  assert.equal(
    (await f.controller.offlineCanary(f.delivery.id)).offlineCanary.outcome,
    "refused",
  );
  rmSync(join(f.repository, "canary.txt"));
  const directory = join(f.repository, "linked");
  symlinkSync(f.repository, directory, "junction");
  const result = await f.controller.offlineCanary(f.delivery.id, [
    { path: "linked/source.txt", sha256: "0".repeat(64) },
  ]);
  assert.equal(result.offlineCanary.outcome, "refused");
  assert.equal(JSON.stringify(result).includes("synthetic-secret"), false);
});

test("changed output snapshots, links, secrets and stale receipts never enter evidence", async (t) => {
  const f = fixture(t);
  const collect = f.runtime.collect.bind(f.runtime);
  for (const mutate of [
    (receipt) => {
      receipt.files[0].afterSha256 = "0".repeat(64);
    },
    (receipt) => {
      receipt.files[0].ordinary = false;
    },
    (receipt) => {
      receipt.files[0].links = 2;
    },
    (receipt) => {
      receipt.files[0].path = "../result.txt";
    },
    (receipt) => {
      receipt.files[0].path = ".git/config";
    },
    (receipt) => {
      receipt.files[0].bytes = Buffer.from("token=synthetic-output-secret");
    },
    (receipt) => {
      receipt.workerSessionId = "stale-session";
    },
    (receipt) => {
      receipt.bindingSha256 = "0".repeat(64);
    },
  ]) {
    f.runtime.collect = async (...args) => {
      const receipt = await collect(...args);
      mutate(receipt);
      return receipt;
    };
    const result = await f.controller.offlineCanary(f.delivery.id);
    assert.equal(result.offlineCanary.outcome, "rejected");
    assert.equal(result.execution.state, "stopped");
    assert.equal(
      result.evidence.some((e) => e.kind === "offline-canary"),
      false,
    );
    assert.equal(
      JSON.stringify(result).includes("synthetic-output-secret"),
      false,
    );
  }
});

test("a fresh worker with weakened effective controls is stopped without collection", async (t) => {
  const f = fixture(t);
  const execute = f.runtime.execute.bind(f.runtime);
  f.runtime.execute = async (request) => ({
    ...(await execute(request)),
    effective: { ...f.effective, network: "host" },
  });
  f.runtime.collect = async () => {
    assert.fail("unsafe execution cannot collect");
  };
  const result = await f.controller.offlineCanary(f.delivery.id);
  assert.equal(result.offlineCanary.outcome, "rejected");
  assert.equal(result.execution.state, "stopped");
});

test("the native CLI records refused admission without dispatch or production readiness", (t) => {
  const f = fixture(t);
  const result = spawnSync(
    process.execPath,
    [
      "dist/cli.js",
      "offline-canary",
      "--id",
      f.delivery.id,
      "--state-dir",
      f.state,
      "--podman-machine",
      "aios-missing",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const status = JSON.parse(result.stdout);
  assert.equal(status.offlineCanary.outcome, "refused");
  assert.equal(status.qualification.offlineAdmission.allowed, false);
  assert.equal(status.qualification.liveReady, false);
  assert.equal(status.execution, undefined);
});
