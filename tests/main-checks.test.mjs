import assert from "node:assert/strict";
import { test } from "node:test";
import { DeliveryController } from "../dist/controller.js";
import { mergeFixture } from "./helpers/merge-fixture.mjs";

async function merged(t, configurePolicy) {
  const f = await mergeFixture(t, configurePolicy);
  await f.controller.mergeFeature(f.delivery.id);
  f.mainSnapshot = () => {
    const a = f.controller.status(f.delivery.id).merge.attempts.at(-1);
    return {
      repository: a.repository,
      number: a.number,
      head: a.head,
      base: a.base,
      mergeCommit: a.mergeCommit,
      mainRevision: a.mainRevision,
      reachable: true,
      complete: true,
      checks: [
        {
          checkId: "main-e2e",
          publisher: "trusted-ci",
          workflow: ".github/workflows/ci.yml@trusted",
          head: a.mainRevision,
          runId: 2,
          attempt: 1,
          status: "success",
          startedAt: f.time,
          completedAt: f.time,
        },
      ],
    };
  };
  const initial = f.mainSnapshot();
  f.mainSnapshot = () => structuredClone(initial);
  f.mainRuntime = {
    mode: "controlled",
    bindingSha256: "6".repeat(64),
    async observe() {
      return f.mainSnapshot();
    },
  };
  f.reopenMain = () =>
    new DeliveryController(f.state, f.options, {
      mainChecksRuntime: f.mainRuntime,
      clock: () => f.time,
      observationTimeoutMs: 100,
    });
  f.controller = f.reopenMain();
  return f;
}

test("merged delivery requires trusted main E2E before main verification, without completing delivery", async (t) => {
  const f = await merged(t);
  assert.equal(f.controller.status(f.delivery.id).phase, "merged");
  const d = await f.controller.monitorMainChecks(f.delivery.id);
  assert.equal(d.phase, "main-verified");
  assert.equal(d.mainChecks.runs.at(-1).outcome, "passed");
  assert.equal(d.mainChecks.runs.at(-1).revision, "c".repeat(40));
  assert.equal(f.merges.length, 1);
  assert.deepEqual(f.events, ["sign", "push", "pr"]);
});

test("unavailable main observation reaches its persisted deadline across restart", async (t) => {
  const f = await merged(t);
  f.mainRuntime.observe = async () => {
    throw Error("offline");
  };
  await f.controller.monitorMainChecks(f.delivery.id);
  f.time += 120000;
  f.controller = f.reopenMain();
  const d = await f.controller.recover(f.delivery.id);
  assert.equal(d.mainChecks.outcome, "timeout");
  assert.equal(d.phase, "blocked");
  assert.match(d.blocker.nextAction, /new signed PR/);
});

test("returning main revisions retain failures rather than laundering a rerun into green", async (t) => {
  const f = await merged(t),
    original = f.mainSnapshot;
  const failed = original();
  failed.checks[0].status = "failure";
  f.mainSnapshot = () => structuredClone(failed);
  let d = await f.controller.monitorMainChecks(f.delivery.id);
  assert.equal(d.phase, "blocked");
  assert.match(d.blocker.nextAction, /main-e2e/);
  assert.match(d.blocker.nextAction, /new signed PR/);
  f.time += 5000;
  const advanced = original();
  advanced.mainRevision = "d".repeat(40);
  advanced.checks = [];
  f.mainSnapshot = () => structuredClone(advanced);
  d = await f.controller.monitorMainChecks(f.delivery.id);
  assert.equal(d.phase, "verifying-main");
  f.time += 5000;
  const retry = original();
  retry.checks[0].attempt = 2;
  retry.checks.unshift(failed.checks[0]);
  f.mainSnapshot = () => structuredClone(retry);
  d = await f.controller.monitorMainChecks(f.delivery.id);
  assert.equal(d.mainChecks.outcome, "flaky");
  f.time += 5000;
  retry.checks.shift();
  d = await f.controller.monitorMainChecks(f.delivery.id);
  assert.equal(d.mainChecks.outcome, "incomplete");
  assert.equal(
    d.mainChecks.runs.filter((r) => r.revision === "c".repeat(40)).length,
    1,
  );
  assert.equal(f.merges.length, 1);
  assert.deepEqual(f.events, ["sign", "push", "pr"]);
});

test("changed observation binding revokes previously verified main", async (t) => {
  const f = await merged(t);
  await f.controller.monitorMainChecks(f.delivery.id);
  f.mainRuntime.bindingSha256 = "5".repeat(64);
  f.time += 5000;
  await assert.rejects(f.controller.monitorMainChecks(f.delivery.id));
  assert.equal(f.controller.status(f.delivery.id).phase, "blocked");
  assert.equal(
    f.controller.status(f.delivery.id).mainChecks.outcome,
    "unavailable",
  );
});

test("main advancement discards green authority and uses the original wait deadline", async (t) => {
  const f = await merged(t),
    original = f.mainSnapshot;
  await f.controller.monitorMainChecks(f.delivery.id);
  f.time += 5000;
  const advanced = original();
  advanced.mainRevision = "d".repeat(40);
  f.mainSnapshot = () => structuredClone(advanced);
  let d = await f.controller.monitorMainChecks(f.delivery.id);
  assert.equal(d.mainChecks.outcome, "incomplete"); // Checks still name the old main.
  assert.notEqual(d.phase, "main-verified");
  advanced.checks[0].head = advanced.mainRevision;
  f.time += 5000;
  d = await f.controller.monitorMainChecks(f.delivery.id);
  assert.equal(d.phase, "main-verified");
  assert.equal(d.mainChecks.revision, "d".repeat(40));
  advanced.mainRevision = "e".repeat(40);
  advanced.checks = [];
  f.time = 220000;
  f.controller = f.reopenMain();
  d = await f.controller.recover(f.delivery.id);
  assert.equal(d.mainChecks.outcome, "timeout");
  assert.equal(d.mainChecks.startedAt, 100000);
});

test("missing, untrusted, partial and incorrectly linked main evidence cannot authorize progression", async (t) => {
  const f = await merged(t),
    original = f.mainSnapshot;
  for (const mutate of [
    (o) => (o.checks = []),
    (o) => (o.checks[0].publisher = "untrusted"),
    (o) => (o.checks[0].workflow = "untrusted"),
    (o) => (o.checks[0].head = "a".repeat(40)),
    (o) => (o.complete = false),
    (o) => (o.reachable = false),
    (o) => (o.mergeCommit = "d".repeat(40)),
    (o) => (o.repository = "other/repo"),
    (o) => (o.number = 9),
    (o) => (o.head = "f".repeat(40)),
    (o) => (o.base = "other"),
    (o) => (o.mainRevision = "invalid"),
    (o) => (o.checks[0].status = "skipped"),
    (o) => (o.checks[0].status = "neutral"),
    (o) => (o.checks[0].completedAt = f.time + 100000),
    (o) => o.checks.push(o.checks[0]),
  ]) {
    const value = original();
    mutate(value);
    f.mainSnapshot = () => structuredClone(value);
    f.time += 5000;
    const d = await f.controller.monitorMainChecks(f.delivery.id);
    assert.notEqual(d.phase, "main-verified");
    assert.notEqual(d.mainChecks.outcome, "passed");
  }
  assert.equal(f.merges.length, 1);
  assert.deepEqual(f.events, ["sign", "push", "pr"]);
});

test("interrupted observations recover and late responses cannot overwrite newer verified main", async (t) => {
  const f = await merged(t),
    original = f.mainSnapshot;
  let resolve, entered;
  const started = new Promise((r) => (entered = r));
  f.mainRuntime.observe = () => {
    entered();
    return new Promise((r) => (resolve = r));
  };
  const old = f.controller.monitorMainChecks(f.delivery.id);
  await started;
  assert.equal(f.controller.status(f.delivery.id).phase, "verifying-main");
  f.mainRuntime.observe = async () => original();
  f.controller = f.reopenMain();
  const d = await f.controller.recover(f.delivery.id);
  assert.equal(d.phase, "main-verified");
  const failure = original();
  failure.checks[0].status = "failure";
  resolve(failure);
  await old;
  assert.equal(f.controller.status(f.delivery.id).phase, "main-verified");
  assert.equal(
    f.controller.status(f.delivery.id).mainChecks.runs[0].attempts[0].status,
    "success",
  );
});

test("pause and cancel during main observation retain evidence without progressing", async (t) => {
  const f = await merged(t),
    original = f.mainSnapshot;
  let resolve, entered;
  let started = new Promise((r) => (entered = r));
  f.mainRuntime.observe = () => {
    entered();
    return new Promise((r) => (resolve = r));
  };
  let pending = f.controller.monitorMainChecks(f.delivery.id);
  await started;
  await f.controller.pause(f.delivery.id);
  resolve(original());
  await pending;
  assert.equal(f.controller.status(f.delivery.id).phase, "paused");
  assert.notEqual(
    f.controller.status(f.delivery.id).mainChecks.outcome,
    "passed",
  );
  f.controller.resume(f.delivery.id);
  f.time += 5000;
  started = new Promise((r) => (entered = r));
  pending = f.controller.monitorMainChecks(f.delivery.id);
  await started;
  await f.controller.cancel(f.delivery.id);
  resolve(original());
  await pending;
  assert.equal(f.controller.status(f.delivery.id).phase, "cancelled");
  assert.notEqual(
    f.controller.status(f.delivery.id).mainChecks.outcome,
    "passed",
  );
});

test("default main wait is one hour and neither restart nor clock rollback renews it", async (t) => {
  const f = await merged(t, (policy) => {
    delete policy.validationContract.checks.find((c) => c.scope === "main")
      .timeoutMs;
  });
  f.mainSnapshot = () => undefined;
  await f.controller.monitorMainChecks(f.delivery.id);
  f.time += 3599999;
  f.controller = f.reopenMain();
  let d = await f.controller.recover(f.delivery.id);
  assert.notEqual(d.mainChecks.outcome, "timeout");
  f.time += 1;
  d = await f.controller.monitorMainChecks(f.delivery.id);
  assert.equal(d.mainChecks.outcome, "timeout");
  f.time = 100000;
  assert.equal(
    (await f.controller.monitorMainChecks(f.delivery.id)).mainChecks.outcome,
    "timeout",
  );
});

test("CLI and undeclared main workflows refuse monitoring without authority", async (t) => {
  const f = await merged(t, (p) => {
    delete p.validationContract.checks.find((c) => c.scope === "main").workflow;
  });
  let reads = 0;
  f.mainRuntime.observe = async () => {
    reads++;
    return f.mainSnapshot();
  };
  await assert.rejects(
    f.controller.monitorMainChecks(f.delivery.id),
    /Main monitoring requires/,
  );
  assert.equal(reads, 0);
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(
    process.execPath,
    [
      "dist/cli.js",
      "monitor-main-checks",
      "--id",
      f.delivery.id,
      "--state-dir",
      f.state,
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Main monitoring requires/);
});

test("shorter declared main deadlines apply even while observations are unavailable", async (t) => {
  const f = await merged(t, (p) => {
    const c = p.validationContract.checks.find((c) => c.scope === "main");
    p.validationContract.checks.push({
      ...c,
      id: "main-fast",
      timeoutMs: 10000,
    });
  });
  f.mainRuntime.observe = async () => {
    throw Error("offline");
  };
  await f.controller.monitorMainChecks(f.delivery.id);
  f.time += 10000;
  const d = await f.controller.monitorMainChecks(f.delivery.id);
  assert.equal(d.mainChecks.outcome, "timeout");
});

test("binding errors and clock rollback cannot erase a terminal main timeout", async (t) => {
  const f = await merged(t);
  f.mainRuntime.observe = async () => undefined;
  await f.controller.monitorMainChecks(f.delivery.id);
  f.time = 220000;
  await f.controller.monitorMainChecks(f.delivery.id);
  f.mainRuntime.bindingSha256 = "5".repeat(64);
  await assert.rejects(f.controller.monitorMainChecks(f.delivery.id));
  f.mainRuntime.bindingSha256 = "6".repeat(64);
  f.time = 105000;
  f.mainRuntime.observe = async () => f.mainSnapshot();
  const d = await f.controller.monitorMainChecks(f.delivery.id);
  assert.equal(d.mainChecks.outcome, "timeout");
  assert.equal(d.phase, "blocked");
});

test("a timely short check leaves the longer check its full allowance during an observation", async (t) => {
  const f = await merged(t, (p) => {
    const c = p.validationContract.checks.find((c) => c.scope === "main");
    p.validationContract.checks.push({
      ...c,
      id: "main-fast",
      timeoutMs: 10000,
    });
  });
  const pending = f.mainSnapshot();
  pending.checks[0].status = "pending";
  delete pending.checks[0].completedAt;
  pending.checks.push({ ...pending.checks[0], checkId: "main-fast", runId: 3 });
  f.mainSnapshot = () => structuredClone(pending);
  await f.controller.monitorMainChecks(f.delivery.id);
  f.time = 105000;
  f.mainRuntime.observe = async () => {
    f.time = 110001;
    const o = structuredClone(pending);
    o.checks[1].status = "success";
    o.checks[1].completedAt = 109000;
    return o;
  };
  const d = await f.controller.monitorMainChecks(f.delivery.id);
  assert.equal(d.mainChecks.outcome, "incomplete");
  assert.equal(d.phase, "verifying-main");
});

test("pause retains a clock-rollback timeout discovered by an in-flight observation", async (t) => {
  const f = await merged(t);
  let resolve, entered;
  const started = new Promise((r) => (entered = r));
  f.mainRuntime.observe = () => {
    entered();
    return new Promise((r) => (resolve = r));
  };
  const pending = f.controller.monitorMainChecks(f.delivery.id);
  await started;
  await f.controller.pause(f.delivery.id);
  f.time = 99000;
  resolve(f.mainSnapshot());
  await pending;
  assert.equal(f.controller.status(f.delivery.id).phase, "paused");
  assert.equal(
    f.controller.status(f.delivery.id).mainChecks.outcome,
    "timeout",
  );
  f.time = 105000;
  f.controller.resume(f.delivery.id);
  f.mainRuntime.observe = async () => f.mainSnapshot();
  const d = await f.controller.monitorMainChecks(f.delivery.id);
  assert.equal(d.mainChecks.outcome, "timeout");
  assert.notEqual(d.phase, "main-verified");
});
