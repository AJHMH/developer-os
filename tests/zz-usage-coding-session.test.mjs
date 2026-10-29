// Coding usage authority, monitoring and restart approval. Split from
// zz-feature-coding-session.test.mjs so these slower controller tests run on
// another Windows test shard; the mediation link and routed sessions are in
// zz-usage-turn-routing.test.mjs, lapse revocation in
// zz-usage-turn-lapse.test.mjs.
import { planAndValidate } from "./helpers/validation-fixture.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { DeliveryController } from "../dist/controller.js";
import { codingFixture } from "./helpers/feature-fixture.mjs";
import { failedTurn, firstThread } from "./helpers/coding-turns.mjs";
import { authorizedCoding, interruptions } from "./helpers/routed-coding.mjs";

for (const [name, arrange, approvable] of [
  // Unknown usage still needs an explicit owner approval, as for workers.
  [
    "no usage observation",
    (f) => (f.subscription = async () => undefined),
    true,
  ],
  ["an exhausted subscription", (f) => (f.usedPercent = 100), false],
])
  test(`coding refuses with ${name} and dispatches nothing`, async (t) => {
    const { f, dispatched } = await authorizedCoding(t);
    arrange(f);
    await assert.rejects(f.controller.codeFeature(f.delivery.id), /usage/i);
    assert.deepEqual(dispatched, []);
    const usage = f.controller.status(f.delivery.id).usage;
    if (approvable) {
      // An unknown account is never model-only authority, even when approved.
      f.controller.approveUsage(f.delivery.id, usage.checkId);
      await assert.rejects(f.controller.codeFeature(f.delivery.id), /usage/i);
      assert.deepEqual(dispatched, []);
    } else
      assert.throws(
        () => f.controller.approveUsage(f.delivery.id, usage.checkId),
        /exhaustion cannot be overridden/,
      );
  });

test("a low allowance needs owner approval, bound to exactly one coding operation", async (t) => {
  const { f, dispatched } = await authorizedCoding(t);
  // A failed first turn leaves a resumable session, so only usage can refuse.
  f.runtime.execute = async (request) => {
    dispatched.push(request.operationId);
    return failedTurn(request);
  };
  f.usedPercent = 85;
  await assert.rejects(f.controller.codeFeature(f.delivery.id), /usage/i);
  assert.deepEqual(dispatched, []);
  const pending = f.controller.status(f.delivery.id).usage;
  assert.equal(pending.decision, "approval-required");
  f.controller.approveUsage(f.delivery.id, pending.checkId);
  const first = await f.controller.codeFeature(f.delivery.id);
  assert.equal(dispatched.length, 1);
  assert.equal(first.usage.approval.operationId, dispatched[0]);
  // The consumed approval cannot authorize another coding operation.
  await assert.rejects(f.controller.codeFeature(f.delivery.id), /usage/i);
  assert.equal(dispatched.length, 1);
  const renewed = f.controller.status(f.delivery.id).usage;
  f.controller.approveUsage(f.delivery.id, renewed.checkId);
  const resumed = await f.controller.codeFeature(f.delivery.id);
  assert.equal(dispatched.length, 2);
  assert.equal(resumed.feature.session.intent, "resume");
  assert.equal(resumed.usage.approval.operationId, dispatched[1]);
});

test("an authorization that goes stale before dispatch is refused at the recheck", async (t) => {
  const { f } = await authorizedCoding(t);
  let permitted;
  f.runtime.execute = async (request) => {
    f.now += 61_000;
    permitted = request.mayDispatch();
    throw Error("synthetic refusal after the dispatch recheck");
  };
  await f.controller.codeFeature(f.delivery.id);
  assert.equal(permitted, false);
});

test("a resumed coding turn refuses usage from a different account than its first launch", async (t) => {
  const { f, dispatched } = await authorizedCoding(t);
  f.runtime.execute = async (request) => {
    dispatched.push(request.operationId);
    return failedTurn(request);
  };
  await f.controller.codeFeature(f.delivery.id);
  assert.equal(dispatched.length, 1);
  const healthy = f.subscription;
  f.subscription = async (at) => ({
    ...(await healthy(at)),
    accountId: "account-2",
  });
  await assert.rejects(f.controller.codeFeature(f.delivery.id), /account/i);
  assert.equal(dispatched.length, 1);
});

// A coding turn held open after its thread starts, until its worker is
// stopped; usage is re-observed every few milliseconds while it runs.
async function monitoredTurn(t, duringTurn) {
  const f = codingFixture(t),
    normal = f.runtime.execute.bind(f.runtime),
    stop = f.runtime.stop.bind(f.runtime),
    dispatched = [];
  let release = () => {};
  f.runtime.stop = async (request) => {
    release();
    return stop(request);
  };
  f.runtime.execute = async (request) => {
    dispatched.push(request);
    if (dispatched.length > 1) return normal(request);
    request.onEvent({ type: "thread.started", thread_id: firstThread });
    await duringTurn(f);
    return new Promise((_, reject) => {
      release = () => reject(Error("synthetic worker stopped"));
    });
  };
  f.controller = new DeliveryController(f.state, f.options, {
    featurePlanner: f.criteria,
    featureRuntime: f.runtime,
    subscription: () => f.subscription(),
    validationRuntime: f.validation,
    clock: () => f.now,
    codingUsagePollMs: 5,
  });
  await planAndValidate(f);
  const stopped = await f.controller.codeFeature(f.delivery.id);
  return { f, stopped, dispatched };
}

for (const [name, change] of [
  ["exhaustion", (f) => (f.usedPercent = 100)],
  ["a lost usage observation", (f) => (f.subscription = async () => undefined)],
  [
    "an account change",
    (f) => {
      const healthy = f.subscription;
      f.subscription = async (at) => ({
        ...(await healthy(at)),
        accountId: "account-2",
      });
    },
  ],
])
  test(
    `${name} during a coding turn stops it and preserves the resumable thread`,
    { timeout: 10_000 },
    async (t) => {
      let restore;
      const { f, stopped, dispatched } = await monitoredTurn(t, async (f) => {
        const { usedPercent, subscription } = f;
        restore = () => {
          f.usedPercent = usedPercent;
          f.subscription = subscription;
        };
        change(f);
      });
      assert.equal(stopped.feature.session.state, "stopped");
      assert.equal(stopped.feature.session.threadId, firstThread);
      assert.deepEqual(
        stopped.feature.usageInterruptions.map((i) => i.operationId),
        [dispatched[0].operationId],
      );
      await assert.rejects(
        f.controller.codeFeature(f.delivery.id),
        /usage|account/i,
      );
      assert.equal(
        dispatched.length,
        1,
        "no continuation without fresh authority",
      );
      restore();
      await assert.rejects(
        f.controller.codeFeature(f.delivery.id),
        /restart approval/,
      );
      assert.equal(dispatched.length, 1, "fresh usage alone never restarts");
      f.controller.approveCodingRestart(f.delivery.id);
      const resumed = await f.controller.codeFeature(f.delivery.id);
      assert.equal(resumed.feature.session.intent, "resume");
      assert.equal(dispatched[1].threadId, firstThread);
      assert.deepEqual(
        resumed.feature.restartApprovals.map(
          ({ interruptedOperationId, operationId }) => ({
            interruptedOperationId,
            operationId,
          }),
        ),
        [
          {
            interruptedOperationId: dispatched[0].operationId,
            operationId: dispatched[1].operationId,
          },
        ],
        "the approval is recorded and consumed by exactly one re-dispatch",
      );
    },
  );

test("a restart approval never overrides exhaustion and survives a refused re-dispatch", async (t) => {
  const { f, dispatched } = await monitoredTurn(t, async (f) => {
    f.usedPercent = 100;
  });
  const approved = f.controller.approveCodingRestart(f.delivery.id);
  assert.equal(approved.feature.restartApprovals.length, 1);
  assert.equal(approved.feature.restartApprovals[0].operationId, undefined);
  assert.equal(
    approved.feature.restartApprovals[0].accountId,
    approved.feature.usageAccountId,
  );
  await assert.rejects(f.controller.codeFeature(f.delivery.id), /usage/i);
  assert.equal(dispatched.length, 1);
  assert.equal(
    f.controller.status(f.delivery.id).feature.restartApprovals[0].operationId,
    undefined,
    "a refused re-dispatch consumes nothing",
  );
  assert.throws(
    () => f.controller.approveCodingRestart(f.delivery.id),
    /restart/,
    "one pending approval per interruption",
  );
  f.usedPercent = 10;
  await f.controller.codeFeature(f.delivery.id);
  assert.equal(dispatched.length, 2);
});

test("each usage interruption needs its own restart approval", async (t) => {
  let interrupt = true;
  const { f, dispatched } = await monitoredTurn(t, async (f) => {
    f.usedPercent = 100;
  });
  f.usedPercent = 10;
  f.controller.approveCodingRestart(f.delivery.id);
  // The restarted turn completes, then usage lapses again before collection.
  const normal = f.runtime.execute.bind(f.runtime);
  f.runtime.execute = async (request) => {
    const result = await normal(request);
    if (interrupt) f.usedPercent = 100;
    return result;
  };
  const second = await f.controller.codeFeature(f.delivery.id);
  assert.equal(second.feature.usageInterruptions.length, 2);
  interrupt = false;
  f.usedPercent = 10;
  await assert.rejects(
    f.controller.codeFeature(f.delivery.id),
    /restart approval/,
  );
  f.controller.approveCodingRestart(f.delivery.id);
  const third = await f.controller.codeFeature(f.delivery.id);
  assert.equal(third.feature.outcome, "admitted");
  assert.equal(third.feature.restartApprovals.length, 2);
  assert.equal(dispatched.length, 3);
});

test("a usage interruption is durable before the worker is stopped and survives a new controller", async (t) => {
  let seenAtStop;
  const { f } = await monitoredTurn(t, async (f) => {
    const stop = f.runtime.stop;
    f.runtime.stop = async (request) => {
      seenAtStop = f.controller.status(f.delivery.id).feature
        .usageInterruptions;
      return stop(request);
    };
    f.usedPercent = 100;
  });
  assert.equal(seenAtStop?.length, 1, "recorded before the stop");
  f.usedPercent = 10;
  const fresh = new DeliveryController(f.state, f.options, {
    featurePlanner: f.criteria,
    featureRuntime: f.runtime,
    subscription: () => f.subscription(),
    validationRuntime: f.validation,
    clock: () => f.now,
  });
  await assert.rejects(fresh.codeFeature(f.delivery.id), /restart approval/);
  fresh.approveCodingRestart(f.delivery.id);
  assert.equal(
    f.controller.status(f.delivery.id).feature.restartApprovals.length,
    1,
    "the approval is durable evidence",
  );
});

test("a restart refused before dispatch leaves its approval for the next attempt", async (t) => {
  const { f, dispatched } = await monitoredTurn(t, async (f) => {
    f.usedPercent = 100;
  });
  f.usedPercent = 10;
  f.controller.approveCodingRestart(f.delivery.id);
  const normal = f.runtime.execute.bind(f.runtime);
  f.runtime.execute = async () => {
    throw Error("synthetic refusal before dispatch");
  };
  // The refused resume never started, so the guest returns its home.
  f.runtime.recover = async (session) => ({
    operationId: session.operationId,
    fence: session.fence,
    recovered: true,
  });
  const refused = await f.controller.codeFeature(f.delivery.id);
  const [approval] = refused.feature.restartApprovals;
  assert.equal(approval.operationId, refused.feature.session.operationId);
  assert.equal(approval.dispatched, undefined, "nothing was dispatched");
  f.runtime.execute = async (request) => {
    assert.equal(request.mayDispatch(), true);
    return normal(request);
  };
  const restarted = await f.controller.codeFeature(f.delivery.id);
  assert.equal(restarted.feature.restartApprovals.length, 1);
  assert.equal(restarted.feature.restartApprovals[0].dispatched, true);
  assert.equal(
    restarted.feature.restartApprovals[0].operationId,
    restarted.feature.session.operationId,
  );
  assert.equal(dispatched.length, 2, "only the first turn and the restart ran");
});

test("a restart that reaches dispatch spends its approval even if the turn then fails", async (t) => {
  const { f } = await monitoredTurn(t, async (f) => {
    f.usedPercent = 100;
  });
  f.usedPercent = 10;
  f.controller.approveCodingRestart(f.delivery.id);
  f.runtime.execute = async (request) => {
    assert.equal(request.mayDispatch(), true);
    throw Error("synthetic failure after dispatch");
  };
  f.runtime.recover = async (session) => ({
    operationId: session.operationId,
    fence: session.fence,
    recovered: true,
  });
  const failed = await f.controller.codeFeature(f.delivery.id);
  assert.equal(failed.feature.restartApprovals[0].dispatched, true);
  assert.throws(
    () => f.controller.approveCodingRestart(f.delivery.id),
    /restart/,
    "the interruption has been restarted past",
  );
});

test("a coding restart approval needs an owned delivery stopped by a usage interruption", async (t) => {
  const f = codingFixture(t);
  await planAndValidate(f);
  assert.throws(
    () => f.controller.approveCodingRestart(f.delivery.id),
    /restart/,
    "nothing was interrupted",
  );
  const { f: g } = await monitoredTurn(t, async (g) => {
    g.usedPercent = 100;
  });
  await g.controller.release(g.delivery.id);
  assert.throws(
    () => g.controller.approveCodingRestart(g.delivery.id),
    /restart/,
    "a released delivery is not owned",
  );
  const { f: h } = await monitoredTurn(t, async (h) => {
    h.usedPercent = 100;
  });
  await h.controller.cancel(h.delivery.id);
  assert.throws(
    () => h.controller.approveCodingRestart(h.delivery.id),
    /restart/,
    "a cancelled delivery never restarts",
  );
});

test("monitoring keeps a healthy, approved coding turn running across polls", async (t) => {
  const f = codingFixture(t),
    normal = f.runtime.execute.bind(f.runtime);
  let polls = 0;
  const healthy = f.subscription;
  f.subscription = async (at) => {
    polls += 1;
    return healthy(at);
  };
  let during = 0;
  f.runtime.execute = async (request) => {
    const start = polls;
    await new Promise((resolve) => setTimeout(resolve, 60));
    during = polls - start;
    return normal(request);
  };
  f.controller = new DeliveryController(f.state, f.options, {
    featurePlanner: f.criteria,
    featureRuntime: f.runtime,
    subscription: () => f.subscription(),
    validationRuntime: f.validation,
    clock: () => f.now,
    codingUsagePollMs: 5,
  });
  await planAndValidate(f);
  f.usedPercent = 85;
  await assert.rejects(f.controller.codeFeature(f.delivery.id), /usage/i);
  f.controller.approveUsage(
    f.delivery.id,
    f.controller.status(f.delivery.id).usage.checkId,
  );
  const result = await f.controller.codeFeature(f.delivery.id);
  assert.equal(result.feature.outcome, "admitted");
  assert.ok(during >= 2, "usage was re-observed while the turn ran");
  assert.equal(result.feature.usageInterruptions, undefined);
});

test("the coding usage poll interval must be a bounded whole number of milliseconds", (t) => {
  const f = codingFixture(t);
  for (const codingUsagePollMs of [0, 1.5, 60_001, Number.NaN])
    assert.throws(
      () => new DeliveryController(f.state, f.options, { codingUsagePollMs }),
      /usage poll interval/,
    );
  for (const codingUsagePollMs of [1, 60_000])
    new DeliveryController(f.state, f.options, { codingUsagePollMs });
});

test("a turn that completes after usage was exhausted is stopped, not admitted", async (t) => {
  const f = codingFixture(t),
    normal = f.runtime.execute.bind(f.runtime);
  let operationId;
  f.runtime.execute = async (request) => {
    operationId = request.operationId;
    const result = await normal(request);
    f.usedPercent = 100;
    return result;
  };
  await planAndValidate(f);
  const stopped = await f.controller.codeFeature(f.delivery.id);
  assert.notEqual(stopped.feature.outcome, "admitted");
  assert.equal(stopped.feature.candidate, undefined);
  assert.deepEqual(interruptions(stopped), [
    { operationId, reason: "exhausted" },
  ]);
  assert.equal(stopped.feature.session.threadId, firstThread, "work preserved");
  assert.deepEqual(
    stopped.evidence.filter((e) => e.kind === "interrupted-turn"),
    [
      {
        kind: "interrupted-turn",
        path: join(f.state, "artifacts", `interrupted-${operationId}.json`),
      },
    ],
    "the completed work is kept as evidence only",
  );
});

test("a slow usage observation is never polled concurrently during a coding turn", async (t) => {
  const f = codingFixture(t),
    normal = f.runtime.execute.bind(f.runtime),
    healthy = f.subscription;
  let active = 0,
    most = 0,
    running = false;
  // Count only reads that start during the turn; dispatch's own read may
  // still be finishing as the turn begins.
  f.subscription = async (at) => {
    const during = running;
    if (during) most = Math.max(most, ++active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    if (during) active -= 1;
    return healthy(at);
  };
  f.runtime.execute = async (request) => {
    running = true;
    await new Promise((resolve) => setTimeout(resolve, 80));
    running = false;
    return normal(request);
  };
  f.controller = new DeliveryController(f.state, f.options, {
    featurePlanner: f.criteria,
    featureRuntime: f.runtime,
    subscription: () => f.subscription(),
    validationRuntime: f.validation,
    clock: () => f.now,
    codingUsagePollMs: 2,
  });
  await planAndValidate(f);
  await f.controller.codeFeature(f.delivery.id);
  assert.equal(most, 1, "one usage poll at a time");
});
