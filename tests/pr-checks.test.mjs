import assert from "node:assert/strict";
import { test } from "node:test";
import { monitored } from "./helpers/pr-checks-fixture.mjs";

test("exact-head trusted PR checks advance only to independent review and survive restart", async (t) => {
  const f = await monitored(t);
  const d = await f.controller.monitorPRChecks(f.delivery.id);
  assert.equal(d.phase, "waiting-review");
  assert.equal(d.prChecks.runs[0].outcome, "passed");
  assert.equal(d.prChecks.runs[0].attempts[0].head, d.publication.commit);
  assert.equal(
    f.reopenChecks().status(f.delivery.id).prChecks.runs[0].outcome,
    "passed",
  );
  assert.deepEqual(f.reruns, []);
});

test("a passing retry preserves failure and blocks unexplained intermittency", async (t) => {
  const f = await monitored(t),
    snapshot = f.snapshot;
  const failure = { ...snapshot().checks[0], status: "failure" };
  f.snapshot = () => ({ ...snapshot(), checks: [failure] });
  await f.controller.monitorPRChecks(f.delivery.id);
  await f.controller.rerunPRCheck(f.delivery.id, "pr-ci");
  assert.equal(f.reruns.length, 1);
  await assert.rejects(
    f.controller.rerunPRCheck(f.delivery.id, "pr-ci"),
    /rerun blocked/,
  );
  f.time += 5000;
  f.snapshot = () => ({
    ...snapshot(),
    checks: [
      failure,
      {
        ...snapshot().checks[0],
        attempt: 2,
        startedAt: 105000,
        completedAt: 105000,
      },
    ],
  });
  const d = await f.reopenChecks().monitorPRChecks(f.delivery.id);
  assert.equal(d.prChecks.runs[0].outcome, "flaky");
  assert.equal(d.prChecks.runs[0].attempts.length, 2);
});

test("owner exceptions and flake policy apply only to trusted evidence", async (t) => {
  const f = await monitored(t, (p) => {
      const c = p.validationContract.checks.find((c) => c.scope === "pr");
      c.exception = { statuses: ["skipped"], reason: "Owner exception" };
      c.flake = {
        allowDiagnosticPass: true,
        reason: "Owner-approved intermittent service",
      };
    }),
    snapshot = f.snapshot;
  f.snapshot = () => ({
    ...snapshot(),
    checks: [{ ...snapshot().checks[0], status: "skipped" }],
  });
  assert.equal(
    (await f.controller.monitorPRChecks(f.delivery.id)).prChecks.runs[0]
      .outcome,
    "passed",
  );
  f.time += 5000;
  f.snapshot = () => ({
    ...snapshot(),
    checks: [
      { ...snapshot().checks[0], status: "skipped" },
      {
        ...snapshot().checks[0],
        runId: 2,
        status: "failure",
        startedAt: 105000,
        completedAt: 105000,
      },
      {
        ...snapshot().checks[0],
        runId: 2,
        attempt: 2,
        startedAt: 105000,
        completedAt: 105000,
      },
    ],
  });
  assert.equal(
    (await f.controller.monitorPRChecks(f.delivery.id)).prChecks.runs[0]
      .outcome,
    "passed",
  );
  f.time += 5000;
  f.snapshot = () => ({
    ...snapshot(),
    checks: [
      { ...snapshot().checks[0], status: "skipped", publisher: "spoof" },
    ],
  });
  assert.notEqual(
    (await f.controller.monitorPRChecks(f.delivery.id)).prChecks.runs[0]
      .outcome,
    "passed",
  );
});

test("unknown rerun acceptance survives restart and late dispatch remains fenced", async (t) => {
  const f = await monitored(t),
    snapshot = f.snapshot;
  f.snapshot = () => ({
    ...snapshot(),
    checks: [{ ...snapshot().checks[0], status: "failure" }],
  });
  let late;
  f.checks.rerun = async (r) => {
    late = r;
    throw Error("secret=never-store-this");
  };
  await f.controller.rerunPRCheck(f.delivery.id, "pr-ci");
  assert.equal(late.mayDispatch(), false);
  assert.throws(() => f.controller.release(f.delivery.id), /Reconcile/);
  await assert.rejects(
    f.reopenChecks().rerunPRCheck(f.delivery.id, "pr-ci"),
    /blocked/,
  );
  await f.controller.cancel(f.delivery.id);
  f.time += 5000;
  const failed = f.snapshot;
  f.snapshot = () => ({
    ...failed(),
    reruns: [{ operationId: late.operationId, state: "accepted" }],
  });
  const d = await f.reopenChecks().recover(f.delivery.id);
  assert.equal(d.phase, "cancelled");
  assert.equal(d.prChecks.runs[0].diagnostic.state, "accepted");
  assert.equal(d.prChecks.runs[0].canRepair, false);
  assert.equal(JSON.stringify(d).includes("never-store-this"), false);
});

test("new remote head and incomplete history invalidate previously passing evidence", async (t) => {
  const f = await monitored(t),
    snapshot = f.snapshot;
  await f.controller.monitorPRChecks(f.delivery.id);
  f.time += 5000;
  f.snapshot = () => ({ ...snapshot(), head: "b".repeat(40) });
  assert.equal(
    (await f.controller.monitorPRChecks(f.delivery.id)).prChecks.runs[0]
      .outcome,
    "stale",
  );
  await assert.rejects(f.controller.repairPRChecks(f.delivery.id), /PR repair/);
  f.time += 5000;
  f.snapshot = () => ({ ...snapshot(), complete: false });
  assert.equal(
    (await f.controller.monitorPRChecks(f.delivery.id)).prChecks.runs[0]
      .outcome,
    "unavailable",
  );
});

test("timed-out diagnostic recovery resolves acceptance without reopening checks or writes", async (t) => {
  const f = await monitored(t),
    snapshot = f.snapshot;
  let operation;
  f.snapshot = () => ({
    ...snapshot(),
    checks: [{ ...snapshot().checks[0], status: "failure" }],
  });
  f.checks.rerun = async (r) => {
    operation = r.operationId;
    throw Error("lost");
  };
  await f.controller.rerunPRCheck(f.delivery.id, "pr-ci");
  f.time = 220000;
  assert.equal(
    (await f.controller.monitorPRChecks(f.delivery.id)).prChecks.runs[0]
      .outcome,
    "timeout",
  );
  const failed = f.snapshot;
  f.snapshot = () => ({
    ...failed(),
    reruns: [{ operationId: operation, state: "accepted" }],
  });
  f.time += 5000;
  const d = await f.reopenChecks().recover(f.delivery.id);
  assert.equal(d.prChecks.runs[0].outcome, "timeout");
  assert.equal(d.prChecks.runs[0].diagnostic.state, "accepted");
  assert.equal(f.controller.release(f.delivery.id).ownership.held, false);
});

test("runtime drift fences diagnostic dispatch and observation admission", async (t) => {
  const f = await monitored(t),
    snapshot = f.snapshot;
  f.snapshot = () => ({
    ...snapshot(),
    checks: [{ ...snapshot().checks[0], status: "failure" }],
  });
  let allowed;
  f.checks.rerun = async (r) => {
    f.checks.bindingSha256 = "8".repeat(64);
    allowed = r.mayDispatch();
    return { operationId: r.operationId, accepted: false };
  };
  await f.controller.rerunPRCheck(f.delivery.id, "pr-ci");
  assert.equal(allowed, false);
  f.checks.bindingSha256 = "9".repeat(64);
  f.time += 5000;
  f.snapshot = snapshot;
  f.checks.observe = async () => {
    f.checks.bindingSha256 = "8".repeat(64);
    return snapshot();
  };
  const d = await f.controller.monitorPRChecks(f.delivery.id);
  assert.equal(d.prChecks.runs[0].outcome, "unavailable");
});

test("a stale concurrent observation cannot overwrite newer failure evidence", async (t) => {
  const f = await monitored(t),
    good = f.snapshot();
  const entered = Promise.withResolvers(),
    response = Promise.withResolvers();
  t.after(() => response.resolve(good));
  f.checks.observe = async () => {
    entered.resolve();
    return response.promise;
  };
  const first = f.controller.monitorPRChecks(f.delivery.id);
  await Promise.race([
    entered.promise,
    first.then(() => {
      throw Error("observation never entered");
    }),
  ]);
  f.time += 5000;
  f.checks.observe = async () => ({
    ...good,
    checks: [{ ...good.checks[0], status: "failure" }],
  });
  await f.reopenChecks().monitorPRChecks(f.delivery.id);
  response.resolve(good);
  await first;
  assert.equal(
    f.controller.status(f.delivery.id).prChecks.runs[0].outcome,
    "failed",
  );
});

test("CLI refuses hosted monitoring without a trusted adapter and missing workflow declarations block", async (t) => {
  const f = await monitored(t, (p) => {
    delete p.validationContract.checks.find((c) => c.scope === "pr").workflow;
  });
  await assert.rejects(
    f.controller.monitorPRChecks(f.delivery.id),
    /monitoring requires/,
  );
  assert.equal(f.reads, 0);
  const { spawnSync } = await import("node:child_process");
  const r = spawnSync(
    process.execPath,
    [
      "dist/cli.js",
      "monitor-pr-checks",
      "--id",
      f.delivery.id,
      "--state-dir",
      f.state,
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /native monitoring remains disabled/);
});
