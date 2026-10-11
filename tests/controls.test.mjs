import assert from "node:assert/strict";
import { test } from "node:test";
import { realpathSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeliveryController } from "../dist/controller.js";
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-controls-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "repo");
  mkdirSync(repository);
  const state = join(root, "state");
  return { root, repository, state, controller: new DeliveryController(state) };
}
test("repository ownership queues later requests and is retained across restart and independent repositories", (t) => {
  const f = fixture(t);
  const first = f.controller.start({
    repository: f.repository,
    request: "First feature",
  });
  const reopened = new DeliveryController(f.state);
  const second = reopened.start({
    repository: f.repository,
    request: "Second feature",
  });
  assert.equal(first.ownership.held, true);
  assert.equal(second.phase, "queued");
  assert.equal(second.ownership.held, false);
  const other = join(f.root, "other");
  mkdirSync(other);
  const independent = reopened.start({
    repository: other,
    request: "Independent feature",
  });
  assert.equal(independent.ownership.held, true);
  assert.equal(reopened.status(first.id).phase, "blocked");
});

test("pause, resume and cancel preserve work and require an explicit safe release before advancing the queue", async (t) => {
  const f = fixture(t);
  const first = f.controller.start({
    repository: f.repository,
    request: "Preserve feature",
  });
  const second = f.controller.start({
    repository: f.repository,
    request: "Next feature",
  });
  const paused = await f.controller.pause(first.id);
  assert.equal(paused.phase, "paused");
  assert.equal(paused.priorPhase, "blocked");
  assert.equal(paused.ownership.held, true);
  const resumed = await new DeliveryController(f.state).resume(first.id);
  assert.equal(resumed.phase, "blocked");
  assert.equal(resumed.request, "Preserve feature");
  const cancelled = await f.controller.cancel(first.id);
  assert.equal(cancelled.phase, "cancelled");
  assert.equal(f.controller.status(second.id).phase, "queued");
  assert.throws(() => f.controller.resume(first.id), /cancelled/i);
  f.controller.release(first.id);
  assert.equal(f.controller.status(first.id).ownership.held, false);
  assert.equal(f.controller.status(second.id).ownership.held, true);
  assert.equal(f.controller.status(second.id).phase, "blocked");
});

import { writeFileSync, readFileSync } from "node:fs";
const healthyUsage = async () => ({
  observedAt: new Date().toISOString(),
  accountId: "controlled-owner",
  authMode: "chatgpt",
  exhausted: false,
  windows: [
    {
      id: "weekly",
      usedPercent: 4,
      resetsAt: Math.floor(Date.now() / 1000) + 86400,
    },
  ],
});
function readyFixture(t, worker, subscription = healthyUsage) {
  const f = fixture(t);
  const policyPath = join(f.root, "policy.json");
  writeFileSync(
    policyPath,
    JSON.stringify({
      repository: "AJHMH/profile-page",
      defaultBranch: "main",
      factoryCommit: "a".repeat(40),
      approver: "aaron-howard",
      appLogin: "factory[bot]",
      publicationLogin: "aaron-howard",
      requiredChecks: ["lint"],
      validation: ["isolated-node"],
    }),
  );
  const inspect = () => ({
    localRepository: "AJHMH/profile-page",
    localDefaultBranch: "main",
    repository: "AJHMH/profile-page",
    defaultBranch: "main",
    factoryCommit: "a".repeat(40),
    appLogin: "factory[bot]",
    appRepositoryAccess: true,
    eligibleApprovers: ["aaron-howard"],
    protectionsEnforced: true,
    requiredChecks: ["lint"],
    trustedCheckPublishers: true,
    publicationLogin: "aaron-howard",
    publicationAccess: true,
    localSignature: {
      commit: "b".repeat(40),
      valid: true,
      login: "aaron-howard",
    },
    githubSignature: {
      commit: "b".repeat(40),
      valid: true,
      login: "aaron-howard",
    },
    validation: ["isolated-node"],
  });
  f.options = { policyPath, inspect };
  f.controller = new DeliveryController(f.state, f.options, {
    worker,
    subscription,
  });
  return f;
}
const receipt = (session, status) => ({ ...session, status });
test("qualified controlled worker dispatch has explicit durable identity and cannot be duplicated", async (t) => {
  const starts = [];
  const worker = {
    qualified: () => true,
    start: async (session) => {
      starts.push(session);
      return receipt(session, "running");
    },
    fenceAndStop: async (session) => receipt(session, "stopped"),
  };
  const f = readyFixture(t, worker);
  const first = f.controller.start({
    repository: f.repository,
    request: "Feature",
  });
  const queued = f.controller.start({
    repository: f.repository,
    request: "Later",
  });
  const running = await f.controller.run(first.id);
  assert.equal(running.phase, "implementing");
  assert.equal(starts.length, 1);
  assert.equal(running.execution.deliveryId, first.id);
  assert.match(running.execution.sandboxId, /^[0-9a-f-]{36}$/);
  assert.match(running.execution.workerSessionId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(
    new DeliveryController(f.state).status(first.id).execution,
    running.execution,
  );
  await assert.rejects(() => f.controller.run(first.id), /reconcil|running/i);
  await assert.rejects(() => f.controller.run(queued.id), /owner|queued/i);
  assert.equal(starts.length, 1);
});

test("pause fences a late accepted worker response and preserves the explicit session for recovery", async (t) => {
  let accept;
  const starts = [];
  const stops = [];
  const worker = {
    qualified: () => true,
    start: (session) => {
      starts.push(session);
      return new Promise((resolve) => {
        accept = () => resolve(receipt(session, "running"));
      });
    },
    fenceAndStop: async (session) => {
      stops.push(session);
      return receipt(session, "stopped");
    },
  };
  const f = readyFixture(t, worker);
  const delivery = f.controller.start({
    repository: f.repository,
    request: "Long feature",
  });
  const pending = f.controller.run(delivery.id);
  await new Promise(setImmediate);
  assert.equal(starts.length, 1);
  const paused = await new DeliveryController(f.state, f.options, {
    worker,
  }).pause(delivery.id);
  assert.equal(paused.phase, "paused");
  assert.equal(paused.execution.state, "stopped");
  assert.equal(stops[0].sandboxId, starts[0].sandboxId);
  assert.ok(stops[0].fence > starts[0].fence);
  accept();
  await pending;
  const after = f.controller.status(delivery.id);
  assert.equal(after.phase, "paused");
  assert.equal(after.execution.state, "stopped");
  assert.ok(after.recovery.some((event) => event.outcome === "late-response"));
  const recovered = await new DeliveryController(f.state, f.options, {
    worker,
  }).recover(delivery.id);
  assert.equal(recovered.phase, "paused");
  assert.equal(starts.length, 1);
});

test("crash after worker acceptance reconciles exact sessions and blocked/cancelled work never auto-dispatches", async (t) => {
  const starts = [];
  let quiescent = false;
  const worker = {
    qualified: () => true,
    start: async (session) => {
      starts.push(session);
      throw new Error("password=crash-canary");
    },
    fenceAndStop: async (session) =>
      receipt(session, quiescent ? "stopped" : "unknown"),
  };
  const f = readyFixture(t, worker);
  const delivery = f.controller.start({
    repository: f.repository,
    request: "Preserved feature",
  });
  const interrupted = await f.controller.run(delivery.id);
  assert.equal(interrupted.phase, "blocked");
  assert.equal(interrupted.blocker.code, "UNCERTAIN_SESSION");
  assert.equal(JSON.stringify(interrupted).includes("crash-canary"), false);
  const recovered = await new DeliveryController(f.state, f.options, {
    worker,
  }).recover(delivery.id);
  assert.equal(recovered.phase, "blocked");
  assert.equal(recovered.execution.state, "uncertain");
  assert.throws(() => f.controller.release(delivery.id), /reconcil/i);
  quiescent = true;
  const stopped = await f.controller.recover(delivery.id);
  assert.equal(stopped.phase, "blocked");
  assert.equal(stopped.execution.state, "stopped");
  assert.equal(starts.length, 1);
  const resumed = f.controller.resume(delivery.id);
  assert.equal(resumed.blocker.code, "DELIVERY_NOT_ENABLED");
  assert.equal(starts.length, 1);
  await f.controller.cancel(delivery.id);
  await f.controller.recover(delivery.id);
  assert.equal(f.controller.status(delivery.id).phase, "cancelled");
  assert.equal(starts.length, 1);
});

import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
const cli = resolve("dist/cli.js");
function invoke(f, ...args) {
  return spawnSync(process.execPath, [cli, ...args, "--state-dir", f.state], {
    encoding: "utf8",
    timeout: 10000,
  });
}
test("public CLI pause/resume/cancel/release/recover address explicit delivery IDs and preserve blocked state", (t) => {
  const f = fixture(t);
  const started = invoke(
    f,
    "start",
    "--repo",
    f.repository,
    "--request",
    "CLI feature",
  );
  assert.equal(started.status, 0, started.stderr);
  const id = JSON.parse(started.stdout).id;
  for (const [command, phase] of [
    ["pause", "paused"],
    ["recover", "paused"],
    ["resume", "blocked"],
    ["cancel", "cancelled"],
    ["recover", "cancelled"],
    ["release", "cancelled"],
  ]) {
    const response = invoke(f, command, "--id", id);
    assert.equal(response.status, 0, response.stderr);
    assert.equal(JSON.parse(response.stdout).phase, phase);
  }
  assert.equal(
    JSON.parse(invoke(f, "status", "--id", id).stdout).ownership.held,
    false,
  );
  const missing = invoke(f, "pause");
  assert.equal(missing.status, 1);
  const invalid = invoke(
    f,
    "cancel",
    "--id",
    id,
    "--request",
    "password=cli-canary",
  );
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stderr.includes("cli-canary"), false);
});

test("competing CLI processes admit exactly one owner for the same repository", async (t) => {
  const f = fixture(t);
  const submit = (request) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          cli,
          "start",
          "--repo",
          f.repository,
          "--request",
          request,
          "--state-dir",
          f.state,
        ],
        { windowsHide: true },
      );
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (data) => (stdout += data));
      child.stderr.on("data", (data) => (stderr += data));
      child.on("error", reject);
      child.on("close", (code) => {
        try {
          assert.equal(code, 0, stderr);
          resolve(JSON.parse(stdout));
        } catch (error) {
          reject(error);
        }
      });
    });
  const deliveries = await Promise.all([
    submit("First concurrent feature"),
    submit("Second concurrent feature"),
  ]);
  assert.deepEqual(deliveries.map((d) => d.phase).sort(), [
    "blocked",
    "queued",
  ]);
  assert.equal(deliveries.filter((d) => d.ownership.held).length, 1);
  const owner = deliveries.find((d) => d.ownership.held);
  await f.controller.pause(owner.id);
  assert.equal(
    f.controller.list().deliveries.filter((d) => d.ownership.held).length,
    1,
  );
});

import { pathToFileURL } from "node:url";
test("an abruptly exited runner is fenced and stopped by exact identity before fresh work is permitted", async (t) => {
  const stopped = [];
  const worker = {
    qualified: () => true,
    start: async (session) => receipt(session, "running"),
    fenceAndStop: async (session) => {
      stopped.push(session);
      return receipt(session, "stopped");
    },
  };
  const f = readyFixture(t, worker);
  const delivery = f.controller.start({
    repository: f.repository,
    request: "Crash recovery feature",
  });
  const script = `const {DeliveryController}=await import(process.argv[1]);const {state,policyPath,inspection,deliveryId}=JSON.parse(process.argv[2]);const worker={qualified:()=>true,start:async session=>{process.stdout.write(JSON.stringify(session));process.exit(27)},fenceAndStop:async()=>{throw Error('Unexpected stop')}};await new DeliveryController(state,{policyPath,inspect:()=>inspection},{worker,subscription:async()=>({observedAt:new Date().toISOString(),accountId:"controlled-owner",authMode:"chatgpt",exhausted:false,windows:[{id:"weekly",usedPercent:4,resetsAt:Math.floor(Date.now()/1000)+86400}]})}).run(deliveryId);`;
  const crashed = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      script,
      pathToFileURL(resolve("dist/controller.js")).href,
      JSON.stringify({
        state: f.state,
        policyPath: f.options.policyPath,
        inspection: f.options.inspect(),
        deliveryId: delivery.id,
      }),
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  assert.equal(crashed.status, 27, crashed.stderr);
  const accepted = JSON.parse(crashed.stdout);
  assert.equal(f.controller.status(delivery.id).execution.state, "dispatched");
  const recovered = await new DeliveryController(f.state, f.options, {
    worker,
  }).recover(delivery.id);
  assert.equal(recovered.execution.state, "stopped");
  assert.equal(recovered.phase, "preparing");
  assert.equal(stopped[0].workerSessionId, accepted.workerSessionId);
  assert.equal(stopped[0].sandboxId, accepted.sandboxId);
  assert.ok(stopped[0].fence > accepted.fence);
  assert.notEqual(stopped[0].runnerId, accepted.runnerId);
  assert.equal(recovered.request, "Crash recovery feature");
});

test("a hung worker observation times out to uncertainty without redispatch", async (t) => {
  const starts = [];
  const worker = {
    qualified: () => true,
    start: (session) => {
      starts.push(session);
      return new Promise((resolve) =>
        setTimeout(() => resolve(receipt(session, "running")), 40),
      );
    },
    fenceAndStop: async (session) => receipt(session, "unknown"),
  };
  const f = readyFixture(t, worker);
  f.controller = new DeliveryController(f.state, f.options, {
    worker,
    observationTimeoutMs: 1,
    subscription: healthyUsage,
  });
  const delivery = f.controller.start({
    repository: f.repository,
    request: "Bounded observation",
  });
  const result = await f.controller.run(delivery.id);
  assert.equal(result.phase, "blocked");
  assert.equal(result.blocker.code, "UNCERTAIN_SESSION");
  await assert.rejects(() => f.controller.run(delivery.id), /reconcil/i);
  assert.equal(starts.length, 1);
});

test("verified clones of one canonical repository share delivery ownership", (t) => {
  const f = readyFixture(t, { qualified: () => true });
  const first = f.controller.start({
    repository: f.repository,
    request: "Original clone feature",
  });
  const clone = join(f.root, "clone");
  mkdirSync(clone);
  const second = f.controller.start({
    repository: clone,
    request: "Other clone feature",
  });
  assert.equal(first.ownership.held, true);
  assert.equal(second.phase, "queued");
  assert.equal(second.ownership.held, false);
});

test("dispatch rechecks current onboarding and cannot reuse stale ready evidence", async (t) => {
  let starts = 0;
  const worker = {
    qualified: () => true,
    start: async (session) => {
      starts++;
      return receipt(session, "running");
    },
    fenceAndStop: async (session) => receipt(session, "stopped"),
  };
  const f = readyFixture(t, worker);
  const delivery = f.controller.start({
    repository: f.repository,
    request: "Fresh prerequisite feature",
  });
  writeFileSync(f.options.policyPath, "{}");
  await assert.rejects(
    () => f.controller.run(delivery.id),
    /onboarding|qualification/i,
  );
  assert.equal(starts, 0);
  assert.equal(f.controller.status(delivery.id).onboarding.ready, false);
  assert.equal(f.controller.status(delivery.id).ownership.held, true);
});

test("repeated admission cannot adopt a changed owner policy pin", async (t) => {
  let starts = 0;
  const worker = {
    qualified: () => true,
    start: async (session) => {
      starts++;
      return receipt(session, "running");
    },
  };
  const f = readyFixture(t, worker);
  const delivery = f.controller.start({
    repository: f.repository,
    request: "Pinned policy feature",
  });
  writeFileSync(
    f.options.policyPath,
    JSON.stringify(
      JSON.parse(readFileSync(f.options.policyPath, "utf8")),
      null,
      2,
    ),
  );
  await assert.rejects(
    () => f.controller.run(delivery.id),
    /unchanged owner policy/i,
  );
  await assert.rejects(
    () => f.controller.run(delivery.id),
    /unchanged owner policy/i,
  );
  assert.equal(starts, 0);
});

test("resuming a paused queued request acquires a safely released empty repository", async (t) => {
  const f = fixture(t);
  const first = f.controller.start({
    repository: f.repository,
    request: "Owner",
  });
  const second = f.controller.start({
    repository: f.repository,
    request: "Queued",
  });
  await f.controller.pause(second.id);
  await f.controller.cancel(first.id);
  f.controller.release(first.id);
  const resumed = f.controller.resume(second.id);
  assert.equal(resumed.phase, "blocked");
  assert.equal(resumed.ownership.held, true);
});

test("missing qualification and mismatched worker receipts cannot authorize dispatch or release", async (t) => {
  let starts = 0;
  const worker = {
    qualified: () => false,
    start: async (session) => {
      starts++;
      return receipt({ ...session, sandboxId: "unrelated-session" }, "stopped");
    },
    fenceAndStop: async (session) =>
      receipt({ ...session, workerSessionId: "unrelated-worker" }, "stopped"),
  };
  const f = readyFixture(t, worker);
  const delivery = f.controller.start({
    repository: f.repository,
    request: "Qualified identity feature",
  });
  await assert.rejects(() => f.controller.run(delivery.id), /qualification/i);
  assert.equal(starts, 0);
  worker.qualified = () => true;
  const uncertain = await f.controller.run(delivery.id);
  assert.equal(uncertain.execution.state, "uncertain");
  assert.equal(uncertain.execution.repositoryKey, "github:ajhmh/profile-page");
  const cancelled = await f.controller.cancel(delivery.id);
  assert.equal(cancelled.phase, "cancelled");
  assert.equal(cancelled.execution.state, "uncertain");
  assert.throws(() => f.controller.release(delivery.id), /reconcil/i);
});

test("explicit resume retains sandbox and worker identity with a new fenced operation", async (t) => {
  const starts = [];
  const worker = {
    qualified: () => true,
    start: async (session) => {
      starts.push(session);
      return receipt(session, "running");
    },
    fenceAndStop: async (session) => receipt(session, "stopped"),
  };
  const f = readyFixture(t, worker);
  const delivery = f.controller.start({
    repository: f.repository,
    request: "Resume retained work",
  });
  const running = await f.controller.run(delivery.id);
  await f.controller.pause(delivery.id);
  f.controller.resume(delivery.id);
  const resumed = await f.controller.run(delivery.id);
  assert.equal(resumed.execution.sandboxId, running.execution.sandboxId);
  assert.equal(
    resumed.execution.workerSessionId,
    running.execution.workerSessionId,
  );
  assert.notEqual(resumed.execution.operationId, running.execution.operationId);
  assert.equal(resumed.execution.intent, "resume");
  assert.ok(
    resumed.sessions.some(
      (session) => session.operationId === running.execution.operationId,
    ),
  );
  assert.equal(starts.length, 2);
});

import { DatabaseSync } from "node:sqlite";
test("legacy intake ledger migration preserves requests and assigns conservative ownership through public status", (t) => {
  const f = fixture(t);
  mkdirSync(f.state);
  mkdirSync(join(f.state, "artifacts"));
  // Fixture represents the published v1 ledger; observations use only controller status/list.
  const legacy = new DatabaseSync(join(f.state, "deliveries.sqlite"));
  legacy.exec(
    "CREATE TABLE deliveries(id TEXT PRIMARY KEY, document TEXT NOT NULL); PRAGMA user_version=1;",
  );
  const ids = [
    "00000000-0000-0000-0000-000000000001",
    "00000000-0000-0000-0000-000000000002",
  ];
  for (const [index, id] of ids.entries()) {
    const artifact = join(f.state, "artifacts", `${id}.json`);
    writeFileSync(
      artifact,
      JSON.stringify({
        deliveryId: id,
        request: index === 0 ? "Legacy first" : "Legacy second",
      }),
    );
    legacy.prepare("INSERT INTO deliveries VALUES (?,?)").run(
      id,
      JSON.stringify({
        id,
        repository: f.repository,
        request: index === 0 ? "Legacy first" : "Legacy second",
        phase: "blocked",
        issue: null,
        createdAt: "2026-10-07T00:00:00.000Z",
        blocker: {
          code: "DELIVERY_NOT_ENABLED",
          message: "Intake only",
          nextAction: "Complete onboarding",
        },
        evidence: [{ kind: "request", path: artifact }],
      }),
    );
  }
  legacy.close();
  const reopened = new DeliveryController(f.state);
  const first = reopened.status(ids[0]);
  const second = reopened.status(ids[1]);
  assert.equal(first.request, "Legacy first");
  assert.equal(first.ownership.held, true);
  assert.equal(first.onboarding.ready, false);
  assert.equal(second.request, "Legacy second");
  assert.equal(second.phase, "queued");
  assert.equal(second.ownership.held, false);
  assert.equal(
    readFileSync(first.evidence[0].path, "utf8").includes("Legacy first"),
    true,
  );
});

test("resuming a released paused owner queues behind the current repository owner", async (t) => {
  const f = fixture(t);
  const first = f.controller.start({
    repository: f.repository,
    request: "Released paused feature",
  });
  const second = f.controller.start({
    repository: f.repository,
    request: "Current owner",
  });
  await f.controller.pause(first.id);
  f.controller.release(first.id);
  assert.equal(f.controller.status(second.id).ownership.held, true);
  const resumed = f.controller.resume(first.id);
  assert.equal(resumed.phase, "queued");
  assert.equal(resumed.ownership.held, false);
  await f.controller.cancel(second.id);
  f.controller.release(second.id);
  assert.equal(f.controller.status(first.id).ownership.held, true);
  assert.equal(
    f.controller.status(first.id).request,
    "Released paused feature",
  );
});

test("subscription threshold requires fresh owner approval, grants one run and never overrides exhaustion", async (t) => {
  let used = 80;
  const reset = Math.floor(Date.now() / 1000) + 86400;
  let starts = 0;
  const worker = {
    qualified: () => true,
    start: async (session) => {
      starts++;
      return receipt(session, "running");
    },
    fenceAndStop: async (session) => receipt(session, "stopped"),
  };
  const subscription = async () => ({
    observedAt: new Date().toISOString(),
    accountId: "controlled-owner",
    authMode: "chatgpt",
    exhausted: false,
    windows: [{ id: "weekly", usedPercent: used, resetsAt: reset }],
  });
  const f = readyFixture(t, worker, subscription);
  const delivery = f.controller.start({
    repository: f.repository,
    request: "Usage gate feature",
  });
  await assert.rejects(
    () => f.controller.run(delivery.id),
    /usage requires owner approval/i,
  );
  assert.equal(starts, 0);
  const check = f.controller.status(delivery.id).usage;
  assert.equal(check.remainingPercent, 20);
  assert.throws(
    () => f.controller.approveUsage(delivery.id, "stale"),
    /fresh usage check/i,
  );
  f.controller.approveUsage(delivery.id, check.checkId);
  const running = await f.controller.run(delivery.id);
  assert.equal(running.phase, "implementing");
  used = 95;
  assert.equal(
    (await f.controller.pollUsage(delivery.id)).phase,
    "implementing",
  );
  used = 100;
  const stopped = await f.controller.pollUsage(delivery.id);
  assert.equal(stopped.phase, "paused");
  assert.equal(stopped.execution.state, "stopped");
  assert.equal(stopped.usage.decision, "exhausted");
  assert.throws(
    () => f.controller.approveUsage(delivery.id, stopped.usage.checkId),
    /exhaustion/i,
  );
  assert.equal(starts, 1);
});

test("missing usage requires approval and monitoring preserves uncertain shutdown without leaking provider errors", async (t) => {
  let available = true;
  const reset = Math.floor(Date.now() / 1000) + 86400;
  const subscription = async () => {
    if (!available) throw Error("synthetic-secret-provider-error");
    return {
      observedAt: new Date().toISOString(),
      accountId: "controlled-owner",
      authMode: "chatgpt",
      exhausted: false,
      windows: [{ id: "weekly", usedPercent: 4, resetsAt: reset }],
    };
  };
  const worker = {
    qualified: () => true,
    start: async (session) => receipt(session, "running"),
    fenceAndStop: async (session) => receipt(session, "unknown"),
  };
  const f = readyFixture(t, worker, subscription);
  const delivery = f.controller.start({
    repository: f.repository,
    request: "Unknown usage feature",
  });
  await f.controller.run(delivery.id);
  available = false;
  const stopped = await f.controller.pollUsage(delivery.id);
  assert.equal(stopped.execution.state, "uncertain");
  assert.equal(stopped.usage.decision, "approval-required");
  assert.equal(stopped.usage.remainingPercent, null);
  assert.equal(
    JSON.stringify(stopped).includes("synthetic-secret-provider-error"),
    false,
  );
  assert.throws(
    () => f.controller.approveUsage(delivery.id, stopped.usage.checkId),
    /stopped delivery/i,
  );
});
