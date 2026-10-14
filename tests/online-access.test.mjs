import { initializeWindowsAuthDirectory } from "../dist/windows-auth-store.js";
import { ownWindowsFixturePaths } from "./helpers/windows-fixture-owner.mjs";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  chmodSync,
  unlinkSync,
  symlinkSync,
  linkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DeliveryController } from "../dist/controller.js";
import {
  subscriptionGatewayVersion,
  gatewayRequest,
} from "../dist/subscription-gateway.js";
import { modelRelayVersion } from "../dist/model-relay.js";
const hash = (v) => createHash("sha256").update(v).digest("hex");
function fixture(t, online, target = "macos") {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-decision-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  if (target === "windows" && process.platform === "win32")
    initializeWindowsAuthDirectory(root);
  const repo = join(root, "repo"),
    state = join(root, "state");
  mkdirSync(repo);
  let q;
  let c = new DeliveryController(
    state,
    {},
    { worker: { probe: async () => structuredClone(q) } },
  );
  const d = c.start({ repository: repo, request: "Mediation decision" });
  const policy = join(root, "pins.json"),
    registration = join(root, "registration.json");
  writeFileSync(policy, "synthetic independent pins", { mode: 0o600 });
  writeFileSync(registration, "synthetic registration", { mode: 0o600 });
  q = {
    ready: false,
    liveReady: false,
    mode: "controlled",
    checkedAt: new Date().toISOString(),
    probes: [],
    blockers: ["Production disabled"],
    policySha256: hash(readFileSync(policy)),
    bindingSha256: "a".repeat(64),
    offlineAdmission: {
      allowed: true,
      scope: "offline-probe-only",
      binding:
        target === "macos"
          ? { platform: "darwin", arch: "arm64", provider: "applehv" }
          : { platform: "win32", arch: "x64", provider: "hyperv" },
    },
    subscriptionMediation: {
      qualified: false,
      hostGateway: "passed",
      hostGatewayVersion: subscriptionGatewayVersion,
      gatewayIntegration: "passed",
      workerExecutableSha256: "b".repeat(64),
      codexCredentialIsolation: "passed",
      endpointEnforcement: "passed",
      deliveryCapabilities: "passed",
      relayDeliveryId: d.id,
      subscriptionInference: "not-run",
      nextAction: "Synthetic only",
    },
  };
  const run = "00000000-0000-4000-8000-000000000021";
  const record = {
    schema: 1,
    deliveryId: d.id,
    repositorySha256: hash(realpathSync(repo)),
    runId: run,
    observedAt: new Date().toISOString(),
    accountId: "c".repeat(64),
    policyPath: policy,
    policySha256: q.policySha256,
    bindingSha256: q.bindingSha256,
    registrationPath: registration,
    registrationSha256: hash(readFileSync(registration)),
    gatewayVersion: subscriptionGatewayVersion,
    relayVersion: modelRelayVersion,
    nativeVersion: hash(
      readFileSync(new URL("../dist/podman-native.js", import.meta.url)),
    ),
    workerExecutableSha256: q.subscriptionMediation.workerExecutableSha256,
    requestSha256: hash(gatewayRequest),
    subscriptionInference: "passed",
    gatewayRevoked: true,
    workerRemaining: 0,
    relayRemaining: 0,
  };
  const recordPath = join(state, "subscription-decision-" + d.id + ".json");
  writeFileSync(
    join(state, "inference-" + run + ".consumed"),
    "one-shot approval consumed\n",
    { mode: 0o600 },
  );
  writeFileSync(recordPath, JSON.stringify(record), { mode: 0o600 });
  if (target === "windows")
    ownWindowsFixturePaths([
      state,
      policy,
      registration,
      recordPath,
      join(state, "inference-" + run + ".consumed"),
    ]);
  const usage = {
    observedAt: new Date().toISOString(),
    accountId: record.accountId,
    authMode: "chatgpt",
    exhausted: false,
    windows: [
      {
        id: "weekly",
        usedPercent: 10,
        resetsAt: Math.floor(Date.now() / 1000) + 86400,
      },
    ],
  };
  const options = {
    worker: { probe: async () => structuredClone(q) },
    online,
    subscription: async () => ({
      ...structuredClone(usage),
      observedAt: new Date().toISOString(),
    }),
  };
  c = new DeliveryController(state, {}, options);
  return { c, d, usage, state, options, recordPath, q };
}
test("online synthetic dispatch requires trusted authentication and records separate access proof without enabling production", async (t) => {
  let calls = 0;
  const runtime = {
    mode: "controlled",
    async execute(plan, mayDispatch) {
      calls++;
      assert.equal(await mayDispatch(), true);
      return {
        runId: plan.runId,
        policyVersion: plan.policyVersion,
        model: "passed",
        dependency: "passed",
        bypass: "passed",
      };
    },
    async stop(runId) {
      return { runId, revoked: true, remainingProcesses: 0 };
    },
  };
  const f = fixture(t, runtime);
  const done = await f.c.onlineCanary(f.d.id);
  assert.equal(calls, 1);
  assert.equal(done.onlineAccess.outcome, "passed");
  assert.equal(done.onlineAccess.state, "stopped");
  assert.equal(done.onlineAccess.productionEnabled, false);
  assert.equal(done.qualification.ready, false);
  const reopened = new DeliveryController(f.state, {}, f.options);
  assert.equal(
    reopened.status(f.d.id).onlineAccess.runId,
    done.onlineAccess.runId,
  );
  rmSync(f.recordPath);
  await assert.rejects(
    () => reopened.onlineCanary(f.d.id),
    /authentication|mediation/i,
  );
  assert.equal(calls, 1);
});

test("low and unknown usage consume one account/window/run grant and exhaustion preserves work", async (t) => {
  let calls = 0;
  const runtime = {
    mode: "controlled",
    async execute(plan, authorize) {
      calls++;
      assert.equal(await authorize(), true);
      return {
        runId: plan.runId,
        policyVersion: plan.policyVersion,
        model: "passed",
        dependency: "passed",
        bypass: "passed",
      };
    },
    async stop(runId) {
      return { runId, revoked: true, remainingProcesses: 0 };
    },
  };
  const f = fixture(t, runtime);
  f.usage.windows[0].usedPercent = 80;
  await assert.rejects(() => f.c.onlineCanary(f.d.id), /usage approval/);
  let check = await f.c.checkUsage(f.d.id);
  f.c.approveUsage(f.d.id, check.usage.checkId);
  const done = await f.c.onlineCanary(f.d.id);
  assert.equal(done.onlineAccess.outcome, "passed");
  assert.equal(done.usage.approval.operationId, done.onlineAccess.runId);
  const reopened = new DeliveryController(f.state, {}, f.options);
  await assert.rejects(() => reopened.onlineCanary(f.d.id), /usage approval/);
  assert.equal(calls, 1);
  f.usage.windows[0].usedPercent = 100;
  check = await reopened.checkUsage(f.d.id);
  assert.throws(
    () => reopened.approveUsage(f.d.id, check.usage.checkId),
    /exhaustion/,
  );
  await assert.rejects(() => reopened.onlineCanary(f.d.id), /exhaustion/);
  assert.equal(reopened.status(f.d.id).request, "Mediation decision");
  f.usage.windows = [];
  check = await reopened.checkUsage(f.d.id);
  reopened.approveUsage(f.d.id, check.usage.checkId);
  assert.equal(
    (await reopened.onlineCanary(f.d.id)).onlineAccess.outcome,
    "passed",
  );
  assert.equal(calls, 2);
  assert.equal(
    reopened.status(f.d.id).onlineRuns[0].runId,
    done.onlineAccess.runId,
  );
});

test("account/window change and exhausted foreground checks revoke without authorizing subsequent traffic", async (t) => {
  for (const change of [
    (u) => (u.accountId = "d".repeat(64)),
    (u) => (u.windows[0].resetsAt += 20),
    (u) => (u.windows[0].usedPercent = 100),
  ]) {
    let allowed,
      stops = 0;
    let f;
    const runtime = {
      mode: "controlled",
      async execute(plan, authorize) {
        assert.equal(await authorize(), true);
        change(f.usage);
        allowed = await authorize();
        return {
          runId: plan.runId,
          policyVersion: plan.policyVersion,
          model: "passed",
          dependency: "passed",
          bypass: "passed",
        };
      },
      async stop(runId) {
        stops++;
        return { runId, revoked: true, remainingProcesses: 0 };
      },
    };
    f = fixture(t, runtime);
    const result = await f.c.onlineCanary(f.d.id);
    assert.equal(allowed, false);
    assert.equal(result.onlineAccess.outcome, "refused");
    assert.equal(result.onlineAccess.state, "stopped");
    assert.equal(stops, 1);
  }
});

test("uncertain shutdown blocks restart, release and qualification until recovery observes revocation", async (t) => {
  let stopped = false;
  const runtime = {
    mode: "controlled",
    async execute(plan, authorize) {
      assert.equal(await authorize(), true);
      throw Error("synthetic transport failure");
    },
    async stop(runId) {
      return { runId, revoked: stopped, remainingProcesses: stopped ? 0 : 1 };
    },
  };
  const f = fixture(t, runtime);
  const uncertain = await f.c.onlineCanary(f.d.id);
  assert.equal(uncertain.onlineAccess.state, "uncertain");
  const reopened = new DeliveryController(f.state, {}, f.options);
  await assert.rejects(() => reopened.onlineCanary(f.d.id), /recover/i);
  await assert.rejects(() => reopened.qualify(f.d.id), /recover/i);
  assert.throws(() => reopened.release(f.d.id), /recover/i);
  assert.throws(() => reopened.resume(f.d.id), /recover/i);
  stopped = true;
  assert.equal((await reopened.recover(f.d.id)).onlineAccess.state, "stopped");
  assert.equal(reopened.status(f.d.id).request, "Mediation decision");
});

test("an active synthetic run cannot receive a replacement usage grant", async (t) => {
  let f;
  const runtime = {
    mode: "controlled",
    async execute(plan, authorize) {
      assert.equal(await authorize(), true);
      const check = await f.c.checkUsage(f.d.id);
      assert.throws(
        () => f.c.approveUsage(f.d.id, check.usage.checkId),
        /stopped|active/,
      );
      return {
        runId: plan.runId,
        policyVersion: plan.policyVersion,
        model: "passed",
        dependency: "passed",
        bypass: "passed",
      };
    },
    async stop(runId) {
      return { runId, revoked: true, remainingProcesses: 0 };
    },
  };
  f = fixture(t, runtime);
  f.usage.windows[0].usedPercent = 80;
  const check = await f.c.checkUsage(f.d.id);
  f.c.approveUsage(f.d.id, check.usage.checkId);
  assert.equal((await f.c.onlineCanary(f.d.id)).onlineAccess.outcome, "passed");
});

test("pause revokes a pending online run and concurrently attempted dispatch cannot overlap", async (t) => {
  let entered, finish;
  const active = new Promise((resolve) => (entered = resolve)),
    pending = new Promise((resolve) => (finish = resolve));
  let authorization;
  const runtime = {
    mode: "controlled",
    async execute(plan, authorize) {
      authorization = authorize;
      assert.equal(await authorize(), true);
      entered();
      await pending;
      assert.equal(await authorize(), false);
      return {
        runId: plan.runId,
        policyVersion: plan.policyVersion,
        model: "passed",
        dependency: "passed",
        bypass: "passed",
      };
    },
    async stop(runId) {
      finish();
      return { runId, revoked: true, remainingProcesses: 0 };
    },
  };
  const f = fixture(t, runtime),
    run = f.c.onlineCanary(f.d.id);
  await active;
  await assert.rejects(
    () => new DeliveryController(f.state, {}, f.options).onlineCanary(f.d.id),
    /stopped|recover/,
  );
  assert.throws(() => f.c.release(f.d.id), /recover/i);
  const paused = await f.c.pause(f.d.id);
  assert.equal(paused.phase, "paused");
  assert.equal(paused.onlineAccess.state, "stopped");
  assert.equal((await run).onlineAccess.outcome, "refused");
  assert.equal(await authorization(), false);
  assert.equal(f.c.resume(f.d.id).request, "Mediation decision");
});

test("recovery clears the online shutdown blocker after independently verified stop", async (t) => {
  let stopped = false;
  const runtime = {
    mode: "controlled",
    async execute() {
      throw Error("transport unavailable");
    },
    async stop(runId) {
      return { runId, revoked: stopped, remainingProcesses: stopped ? 0 : 1 };
    },
  };
  const f = fixture(t, runtime);
  assert.equal(
    (await f.c.onlineCanary(f.d.id)).blocker.code,
    "UNCERTAIN_SESSION",
  );
  stopped = true;
  assert.equal(
    (await new DeliveryController(f.state, {}, f.options).recover(f.d.id))
      .blocker.code,
    "DELIVERY_NOT_ENABLED",
  );
});

test("public foreground usage polling stops an exhausted online canary and preserves its request", async (t) => {
  let entered, finish;
  const active = new Promise((resolve) => (entered = resolve)),
    pending = new Promise((resolve) => (finish = resolve));
  const runtime = {
    mode: "controlled",
    async execute(plan, authorize) {
      assert.equal(await authorize(), true);
      entered();
      await pending;
      return {
        runId: plan.runId,
        policyVersion: plan.policyVersion,
        model: "passed",
        dependency: "passed",
        bypass: "passed",
      };
    },
    async stop(runId) {
      finish();
      return { runId, revoked: true, remainingProcesses: 0 };
    },
  };
  const f = fixture(t, runtime);
  const run = f.c.onlineCanary(f.d.id);
  await active;
  f.usage.windows[0].usedPercent = 100;
  const polled = await f.c.pollUsage(f.d.id);
  // Always release the fixture even if this assertion fails.
  await f.c.pause(f.d.id);
  await run;
  assert.equal(polled.onlineAccess.state, "stopped");
  assert.equal(polled.request, "Mediation decision");
  assert.equal(polled.usage.decision, "exhausted");
});

test("an unknown-usage approval cannot move to a newly endorsed account", async (t) => {
  let calls = 0;
  const runtime = {
    mode: "controlled",
    async execute(plan, authorize) {
      calls++;
      assert.equal(await authorize(), true);
      return {
        runId: plan.runId,
        policyVersion: plan.policyVersion,
        model: "passed",
        dependency: "passed",
        bypass: "passed",
      };
    },
    async stop(runId) {
      return { runId, revoked: true, remainingProcesses: 0 };
    },
  };
  const f = fixture(t, runtime);
  f.usage.windows = [];
  await f.c.qualify(f.d.id);
  const check = await f.c.checkUsage(f.d.id);
  f.c.approveUsage(f.d.id, check.usage.checkId);
  const record = JSON.parse(readFileSync(f.recordPath));
  record.accountId = "e".repeat(64);
  writeFileSync(f.recordPath, JSON.stringify(record));
  f.usage.accountId = record.accountId;
  await assert.rejects(() => f.c.onlineCanary(f.d.id), /usage approval/);
  assert.equal(calls, 0);
});

test("operator-pinned npm artifact dispatch admits exact bytes and refuses candidate policy, redirects and changed artifacts", async (t) => {
  const { NpmArtifactRuntime } = await import("../dist/npm-artifact.js");
  const bytes = Buffer.from("synthetic npm archive bytes\n"),
    digest = hash(bytes);
  let deliveries = 0,
    requests = [],
    verifiedBytes = true;
  const inner = {
    mode: "controlled",
    async execute(plan, authorize, artifact) {
      deliveries++;
      assert.equal(await authorize(), true);
      assert.equal(artifact.bytes.toString(), bytes.toString());
      assert.equal(plan.dependency.artifactSha256, digest);
      return {
        runId: plan.runId,
        policyVersion: plan.policyVersion,
        model: "passed",
        dependency: "passed",
        bypass: "passed",
        ...(verifiedBytes ? { dependencyArtifactSha256: digest } : {}),
      };
    },
    async stop(runId) {
      return { runId, revoked: true, remainingProcesses: 0 };
    },
  };
  const f = fixture(t, undefined);
  const policy = join(f.state, "npm-policy.json");
  writeFileSync(
    policy,
    JSON.stringify({
      schema: 1,
      registry: "https://registry.npmjs.org",
      artifact: {
        path: "/fixture/-/fixture-1.0.0.tgz",
        sha256: digest,
        bytes: bytes.length,
      },
    }),
    { mode: 0o600 },
  );
  let response = { status: 200, bytes };
  const runtime = new NpmArtifactRuntime(inner, policy, async (url) => {
    requests.push(url);
    return response;
  });
  const c = new DeliveryController(
    f.state,
    {},
    { ...f.options, online: runtime },
  );
  const passed = await c.onlineCanary(f.d.id);
  assert.equal(passed.onlineAccess.outcome, "passed");
  assert.equal(deliveries, 1);
  assert.deepEqual(requests, [
    "https://registry.npmjs.org/fixture/-/fixture-1.0.0.tgz",
  ]);
  verifiedBytes = false;
  assert.equal((await c.onlineCanary(f.d.id)).onlineAccess.outcome, "refused");
  verifiedBytes = true;
  response = { status: 302, bytes };
  assert.equal((await c.onlineCanary(f.d.id)).onlineAccess.outcome, "refused");
  assert.equal(deliveries, 2);
  response = { status: 200, bytes: Buffer.from("changed archive bytes") };
  assert.equal((await c.onlineCanary(f.d.id)).onlineAccess.outcome, "refused");
  assert.equal(deliveries, 2);
  const candidate = join(f.d.repository, "policy.json");
  writeFileSync(candidate, readFileSync(policy), { mode: 0o600 });
  const denied = new DeliveryController(
    f.state,
    {},
    {
      ...f.options,
      online: new NpmArtifactRuntime(inner, candidate, async () => ({
        status: 200,
        bytes,
      })),
    },
  );
  await assert.rejects(() => denied.onlineCanary(f.d.id), /policy|artifact/);
  assert.equal(deliveries, 2);
  const malicious = JSON.parse(readFileSync(policy));
  malicious.registry = "https://other.invalid";
  writeFileSync(policy, JSON.stringify(malicious));
  await assert.rejects(() => c.onlineCanary(f.d.id), /policy|artifact/);
  assert.equal(deliveries, 2);
});

test("inference dispatch requires approval of its exact prepared plan even with healthy usage, and consumes it before provider effects", async (t) => {
  let effects = 0;
  const runtime = {
    mode: "controlled",
    requiresExactApproval: true,
    inferenceRequest: () => ({
      requestSha256: hash(gatewayRequest),
      gatewayVersion: subscriptionGatewayVersion,
      hostId: "synthetic-host",
    }),
    async execute(plan, authorize) {
      effects++;
      assert.equal(await authorize(), true);
      return {
        runId: plan.runId,
        policyVersion: plan.policyVersion,
        model: "passed",
        dependency: "passed",
        bypass: "passed",
      };
    },
    async stop(runId) {
      return { runId, revoked: true, remainingProcesses: 0 };
    },
  };
  const f = fixture(t, runtime);
  await assert.rejects(() => f.c.onlineCanary(f.d.id), /exact|plan|approval/i);
  assert.equal(effects, 0);
  const prepared = await f.c.prepareOnline(f.d.id);
  assert.equal(
    prepared.onlinePlan.plan.inference.requestSha256,
    hash(gatewayRequest),
  );
  assert.equal(effects, 0);
  assert.throws(
    () =>
      f.c.approveOnline(
        f.d.id,
        prepared.onlinePlan.plan.runId,
        "0".repeat(64),
        true,
      ),
    /exact|plan/i,
  );
  await assert.rejects(() => f.c.onlineCanary(f.d.id), /exact|plan|approval/i);
  f.c.approveOnline(
    f.d.id,
    prepared.onlinePlan.plan.runId,
    prepared.onlinePlan.sha256,
    true,
  );
  const run = await f.c.onlineCanary(f.d.id);
  assert.equal(run.onlineAccess.outcome, "passed");
  assert.equal(run.onlinePlan.consumed, true);
  assert.equal(effects, 1);
  await assert.rejects(
    () => new DeliveryController(f.state, {}, f.options).onlineCanary(f.d.id),
    /exact|plan|approval/i,
  );
  assert.equal(effects, 1);
});

test("an exact inference plan that expires during qualification cannot be dispatched", async (t) => {
  let effects = 0;
  const runtime = {
    mode: "controlled",
    requiresExactApproval: true,
    inferenceRequest: () => ({
      requestSha256: hash(gatewayRequest),
      gatewayVersion: subscriptionGatewayVersion,
      hostId: "synthetic-host",
    }),
    async execute() {
      effects++;
      return { model: "passed" };
    },
    async stop(runId) {
      return { runId, revoked: true, remainingProcesses: 0 };
    },
  };
  const f = fixture(t, runtime);
  const prepared = await f.c.prepareOnline(f.d.id);
  f.c.approveOnline(
    f.d.id,
    prepared.onlinePlan.plan.runId,
    prepared.onlinePlan.sha256,
    true,
  );

  t.mock.timers.enable({ apis: ["Date"], now: new Date() });
  f.options.worker.probe = async () => {
    t.mock.timers.setTime(prepared.onlinePlan.expiresAt + 1);
    return structuredClone(f.q);
  };

  await assert.rejects(() => f.c.onlineCanary(f.d.id), /approval changed/i);
  assert.equal(effects, 0);
  assert.equal(f.c.status(f.d.id).onlinePlan.consumed, false);
});

test("Windows positive mediation permits only synthetic online controls and keeps production disabled", async (t) => {
  let count = 0;
  const online = {
    mode: "controlled",
    async execute(plan, authorize) {
      assert.equal(await authorize(), true);
      count++;
      return {
        runId: plan.runId,
        policyVersion: plan.policyVersion,
        model: "passed",
        dependency: "passed",
        bypass: "passed",
      };
    },
    async stop(runId) {
      return { runId, revoked: true, remainingProcesses: 0 };
    },
  };
  const f = fixture(t, online, "windows");
  const result = await f.c.onlineCanary(f.d.id);
  assert.equal(result.onlineAccess.outcome, "passed");
  assert.equal(result.onlineAccess.productionEnabled, false);
  assert.equal(count, 1);
});

for (const target of ["windows", "macos"])
  test(`synthetic ${target} site task validates only inside its worker and imports after verified shutdown`, async (t) => {
    const {
      syntheticSiteInput,
      syntheticSiteOutput,
      syntheticSiteValidator,
      syntheticTaskVersion,
    } = await import("../dist/synthetic-task.js");
    const { canaryOutput, sha256 } = await import("../dist/offline-canary.js");
    const f = fixture(t, undefined, target);
    const repo = f.d.repository;
    writeFileSync(join(repo, "canary.txt"), "AIOS offline canary input\n");
    writeFileSync(join(repo, "index.html"), syntheticSiteInput);
    writeFileSync(join(repo, "validate.sh"), syntheticSiteValidator);
    f.q.offlineAdmission.effective = {};
    let request,
      stopped = false,
      valid = true,
      collected = 0;
    const runtime = {
      mode: "controlled",
      version: syntheticTaskVersion,
      stage(files) {
        assert.equal(files[0].bytes.toString(), syntheticSiteInput);
      },
      async execute(r) {
        assert.equal(r.mayDispatch(), true);
        request = r;
        stopped = false;
        return {
          ...r.session,
          bindingSha256: r.bindingSha256,
          policySha256: r.policySha256,
          status: "running",
          fresh: true,
          binding: r.binding,
          effective: r.effective,
        };
      },
      async stop(session, pins) {
        stopped = true;
        return {
          ...session,
          ...pins,
          status: "stopped",
          revoked: true,
          descendantsStopped: true,
          evidence: {
            observedProcesses: 2,
            remainingProcesses: 0,
            censusSha256: "d".repeat(64),
          },
        };
      },
      async collect(session, pins) {
        assert.equal(stopped, true);
        return {
          ...session,
          ...pins,
          status: "stopped",
          files: [
            {
              path: "result.txt",
              bytes: Buffer.from(canaryOutput),
              ordinary: true,
              links: 1,
              beforeSha256: sha256(canaryOutput),
              afterSha256: sha256(canaryOutput),
            },
          ],
        };
      },
      async collectTask(session) {
        assert.equal(stopped, true);
        collected++;
        return {
          operationId: session.operationId,
          version: syntheticTaskVersion,
          inputSha256: sha256(syntheticSiteInput),
          outputSha256: sha256(syntheticSiteOutput),
          output: syntheticSiteOutput,
          validation: valid ? "passed" : "failed",
          negativeValidation: "passed",
          httpValidation: "passed",
          collectionSha256: "e".repeat(64),
        };
      },
    };
    const c = new DeliveryController(
      f.state,
      {},
      { ...f.options, offline: runtime, synthetic: runtime },
    );
    const result = await c.syntheticTask(f.d.id);
    assert.equal(result.syntheticTask.outcome, "completed");
    assert.equal(result.syntheticTask.result.output, syntheticSiteOutput);
    assert.equal(result.syntheticTask.productionEnabled, false);
    assert.equal(
      readFileSync(join(repo, "index.html"), "utf8"),
      syntheticSiteInput,
    );
    assert.equal(collected, 1);
    valid = false;
    const rejected = await c.syntheticTask(f.d.id);
    assert.equal(rejected.syntheticTask.outcome, "refused");
    assert.equal(rejected.syntheticTask.result, undefined);
    let probes = 0,
      dispatches = 0;
    const originalExecute = runtime.execute;
    runtime.execute = async (...args) => {
      dispatches++;
      return originalExecute(...args);
    };
    f.options.worker.probe = async () => {
      if (++probes === 2) unlinkSync(f.recordPath);
      return structuredClone(f.q);
    };
    await c.syntheticTask(f.d.id);
    assert.equal(dispatches, 0, "authentication drift must prevent dispatch");
  });
