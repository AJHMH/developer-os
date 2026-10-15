import assert from "node:assert/strict";
import { test } from "node:test";
import { monitored } from "./helpers/pr-checks-fixture.mjs";

test("missing checks poll at a bounded rate and retain the declared deadline across restart", async (t) => {
  const f = await monitored(t);
  const snapshot = f.snapshot;
  f.snapshot = () => ({ ...snapshot(), checks: [] });
  await f.controller.monitorPRChecks(f.delivery.id);
  f.time += 1000;
  await f.reopenChecks().monitorPRChecks(f.delivery.id);
  assert.equal(f.reads, 1);
  f.time = 220000;
  const d = await f.reopenChecks().monitorPRChecks(f.delivery.id);
  assert.equal(d.prChecks.runs[0].outcome, "timeout");
  assert.equal(f.reads, 1);
  assert.equal(d.phase, "blocked");
});

test("default CI deadline, unavailable clock and observations all fail closed", async (t) => {
  const f = await monitored(t, (p) => {
    delete p.validationContract.checks.find((c) => c.scope === "pr").timeoutMs;
  });
  f.checks.observe = async () => {
    throw Error("private provider output");
  };
  const d = await f.controller.monitorPRChecks(f.delivery.id);
  assert.equal(d.prChecks.runs[0].checks[0].timeoutMs, 3600000);
  assert.equal(d.prChecks.runs[0].outcome, "unavailable");
  f.time = NaN;
  assert.equal(
    (await f.reopenChecks().monitorPRChecks(f.delivery.id)).prChecks.runs[0]
      .outcome,
    "timeout",
  );
});

test("malformed pending timestamp cannot persist untrusted response fields", async (t) => {
  const f = await monitored(t),
    snapshot = f.snapshot;
  f.snapshot = () => ({
    ...snapshot(),
    checks: [
      {
        ...snapshot().checks[0],
        status: "pending",
        completedAt: { secret: "timestamp-canary" },
      },
    ],
  });
  const d = await f.controller.monitorPRChecks(f.delivery.id);
  assert.equal(JSON.stringify(d).includes("timestamp-canary"), false);
  assert.notEqual(d.prChecks.runs[0].outcome, "passed");
});

test("declared long CI deadlines survive downtime beyond the default hour", async (t) => {
  const f = await monitored(t, (p) => {
      p.validationContract.checks.find((c) => c.scope === "pr").timeoutMs =
        7200000;
    }),
    snapshot = f.snapshot;
  f.snapshot = () => ({ ...snapshot(), checks: [] });
  await f.controller.monitorPRChecks(f.delivery.id);
  f.time += 5400000;
  const d = await f.reopenChecks().monitorPRChecks(f.delivery.id);
  assert.equal(d.prChecks.runs[0].outcome, "incomplete");
  assert.equal(d.prChecks.runs[0].startedAt, 100000);
  assert.equal(d.repair, undefined);
});

test("terminal checks completing after the declared deadline cannot pass", async (t) => {
  const f = await monitored(t),
    snapshot = f.snapshot;
  f.checks.observe = async () => {
    f.time = 220001;
    const s = snapshot();
    s.checks[0].completedAt = f.time;
    return s;
  };
  assert.equal(
    (await f.controller.monitorPRChecks(f.delivery.id)).prChecks.runs[0]
      .outcome,
    "timeout",
  );
});

test("reopening during timeout reconciliation cannot erase the durable timeout verdict", async (t) => {
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
  await f.controller.monitorPRChecks(f.delivery.id);
  f.time += 5000;
  const entered = Promise.withResolvers(),
    response = Promise.withResolvers();
  const answer = {
    ...f.snapshot(),
    reruns: [{ operationId: operation, state: "accepted" }],
  };
  t.after(() => response.resolve(answer));
  f.checks.observe = async () => {
    entered.resolve();
    return response.promise;
  };
  const first = f.controller.monitorPRChecks(f.delivery.id);
  await Promise.race([
    entered.promise,
    first.then(() => {
      throw Error("no reconciliation");
    }),
  ]);
  const persisted = f.reopenChecks().status(f.delivery.id).prChecks
    .runs[0].outcome;
  f.time += 5000;
  f.checks.observe = async () => answer;
  await f.reopenChecks().monitorPRChecks(f.delivery.id);
  response.resolve(answer);
  await first;
  assert.equal(persisted, "timeout");
  assert.equal(
    f.controller.status(f.delivery.id).prChecks.runs[0].outcome,
    "timeout",
  );
});
