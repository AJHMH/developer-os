// Coding usage authority, monitoring, restart approval, the mediation
// account link, routed general sessions and lapse revocation. Split from
// zz-feature-coding-session.test.mjs so these slower controller tests run on
// another Windows test shard. The name sorts after every other test file, so
// no other file changes shard.
import { planAndValidate } from "./helpers/validation-fixture.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DeliveryController } from "../dist/controller.js";
import { lockedCodingArgv } from "../dist/feature-candidate.js";
import { generalSessionLimits } from "../dist/general-session-gateway.js";
import { codingFixture } from "./helpers/feature-fixture.mjs";
import { mediatedCoding } from "./helpers/mediation-fixture.mjs";
import { failedTurn, firstThread } from "./helpers/coding-turns.mjs";

// Coding records every dispatch attempt; a launch never reaches the runtime
// without fresh model-only usage authority bound to its exact operation.
async function authorizedCoding(t) {
  const f = codingFixture(t),
    normal = f.runtime.execute.bind(f.runtime),
    dispatched = [];
  f.runtime.execute = async (request) => {
    dispatched.push(request.operationId);
    return normal(request);
  };
  await planAndValidate(f);
  return { f, dispatched };
}

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

const mediatedAccount = "c".repeat(64);
// Usage observations from the given account, at each controller's clock.
function observeAccount(f, accountId) {
  const healthy = f.subscription;
  f.subscription = async (at) => ({ ...(await healthy(at)), accountId });
}

test("coding usage must come from the qualified mediation account", async (t) => {
  const { f, dispatched } = await authorizedCoding(t);
  await mediatedCoding(f, t, mediatedAccount);
  await assert.rejects(f.controller.codeFeature(f.delivery.id), /mediation/i);
  assert.deepEqual(dispatched, []);
  observeAccount(f, mediatedAccount);
  const coded = await f.controller.codeFeature(f.delivery.id);
  assert.equal(coded.feature.outcome, "admitted");
  assert.equal(dispatched.length, 1);
});

test("a mediation-linked feature refuses coding after its decision is withdrawn", async (t) => {
  const { f, dispatched } = await authorizedCoding(t);
  f.runtime.execute = async (request) => {
    dispatched.push(request.operationId);
    return failedTurn(request);
  };
  const mediation = await mediatedCoding(f, t, mediatedAccount);
  observeAccount(f, mediatedAccount);
  await f.controller.codeFeature(f.delivery.id);
  assert.equal(dispatched.length, 1);
  await mediation.withdraw();
  await assert.rejects(f.controller.codeFeature(f.delivery.id), /mediation/i);
  assert.equal(dispatched.length, 1, "no turn without the linked decision");
});

test("a mediation-linked feature re-qualifies before coding and refuses regressed evidence", async (t) => {
  const { f, dispatched } = await authorizedCoding(t);
  f.runtime.execute = async (request) => {
    dispatched.push(request.operationId);
    return failedTurn(request);
  };
  const mediation = await mediatedCoding(f, t, mediatedAccount);
  observeAccount(f, mediatedAccount);
  await f.controller.codeFeature(f.delivery.id);
  mediation.regress();
  await assert.rejects(f.controller.codeFeature(f.delivery.id), /mediation/i);
  assert.equal(dispatched.length, 1, "no turn on stale mediation evidence");
});

test("coding accepts the endorsed usage account, never the mediation credential account", async (t) => {
  const { f, dispatched } = await authorizedCoding(t);
  await mediatedCoding(f, t, mediatedAccount);
  // The vault credential account is a different identity space from usage.
  observeAccount(f, "a".repeat(64));
  await assert.rejects(f.controller.codeFeature(f.delivery.id), /mediation/i);
  assert.deepEqual(dispatched, []);
  observeAccount(f, mediatedAccount);
  assert.equal(
    (await f.controller.codeFeature(f.delivery.id)).feature.outcome,
    "admitted",
  );
});

test("a missing usage observation never authorizes mediated coding, even when approved", async (t) => {
  const { f, dispatched } = await authorizedCoding(t);
  await mediatedCoding(f, t, mediatedAccount);
  f.subscription = async () => undefined;
  await assert.rejects(f.controller.codeFeature(f.delivery.id), /usage/i);
  f.controller.approveUsage(
    f.delivery.id,
    f.controller.status(f.delivery.id).usage.checkId,
  );
  await assert.rejects(f.controller.codeFeature(f.delivery.id), /usage/i);
  assert.deepEqual(dispatched, []);
});

// Slice 4a: with a general-session factory, a mediated turn is routed. The
// factory's gateway serves the turn on the host, and its authority callback
// re-observes usage and re-qualifies the decision at each model request.
function generalSessions() {
  const sessions = [];
  const factory = (turn, authority) => {
    const gateway = {
      capability: randomUUID().replaceAll("-", "").repeat(2),
      respond: async () => {
        throw Error("unused");
      },
      revoke: (reason) => gateway.revoked.push(reason),
      revoked: [],
    };
    sessions.push({ turn, authority, gateway });
    return gateway;
  };
  return { sessions, factory };
}
async function routedCoding(t, turn = failedTurn, coordination = {}) {
  const { f, dispatched } = await authorizedCoding(t);
  const launches = [];
  f.runtime.execute = async (request, gateway) => {
    dispatched.push(request.operationId);
    launches.push({ request, gateway });
    return turn(request, gateway);
  };
  const { sessions, factory } = generalSessions();
  const mediation = await mediatedCoding(f, t, mediatedAccount, {
    generalSessions: factory,
    ...coordination,
  });
  observeAccount(f, mediatedAccount);
  return { f, dispatched, launches, sessions, mediation };
}

test("a mediated turn is routed through the configured general session", async (t) => {
  const { f, launches, sessions } = await routedCoding(t);
  await f.controller.codeFeature(f.delivery.id);
  assert.equal(launches.length, 1);
  assert.equal(sessions.length, 1);
  const [{ request, gateway }] = launches,
    [{ turn }] = sessions;
  assert.equal(gateway, sessions[0].gateway, "the factory's gateway");
  assert.deepEqual(request.modelRoute, {
    deliveryId: f.delivery.id,
    decisionSha256: turn.decisionSha256,
    capability: gateway.capability,
  });
  assert.match(turn.decisionSha256, /^[a-f0-9]{64}$/);
  assert.equal(turn.deliveryId, f.delivery.id);
  assert.equal(turn.sessionId, request.operationId);
  assert.equal(turn.accountId, "a".repeat(64), "the credential account");
  assert.ok(turn.expiresAt > f.now);
  assert.deepEqual(
    request.argv.slice(0, -1),
    lockedCodingArgv(undefined, request.modelRoute),
  );
});

test("a mediated turn without a general-session factory stays offline", async (t) => {
  const { f, dispatched } = await authorizedCoding(t);
  let seen;
  f.runtime.execute = async (request, gateway) => {
    dispatched.push(request.operationId);
    seen = { route: request.modelRoute, gateway, argv: request.argv };
    return failedTurn(request);
  };
  await mediatedCoding(f, t, mediatedAccount);
  observeAccount(f, mediatedAccount);
  await f.controller.codeFeature(f.delivery.id);
  assert.equal(seen.route, undefined);
  assert.equal(seen.gateway, undefined);
  assert.deepEqual(seen.argv.slice(0, -1), lockedCodingArgv(undefined));
});

for (const [authority, arrange] of [
  ["permitted", () => {}],
  ["exhausted", (f) => (f.usedPercent = 100)],
  // Below 20% remaining needs an owner approval this turn does not hold.
  ["approval-required", (f) => (f.usedPercent = 85)],
  ["unknown", (f) => (f.subscription = async () => undefined)],
  ["account", (f) => observeAccount(f, "d".repeat(64))],
  // The owner's protected record is re-read at each request; nothing re-probes.
  ["withdrawn", (f, mediation) => unlinkSync(mediation.recordPath)],
])
  test(`each model request's authority is "${authority}" from a fresh observation and the decision record`, async (t) => {
    let seen, coding;
    coding = await routedCoding(t, async (request) => {
      await arrange(coding.f, coding.mediation);
      seen = await coding.sessions[0].authority();
      return failedTurn(request);
    });
    await coding.f.controller.codeFeature(coding.f.delivery.id);
    assert.equal(seen, authority);
  });

test("usage that lapses after coding is prepared is seen before the turn is dispatched", async (t) => {
  const { f, dispatched } = await routedCoding(t);
  const healthy = f.subscription;
  // Exhausted once the feature branch exists, i.e. after preparation.
  f.subscription = async (at) => {
    const prepared =
      f.git("branch", "--list", `codex/feature-${f.delivery.id}`).trim() !== "";
    if (prepared) f.usedPercent = 100;
    return healthy(at);
  };
  await f.controller.codeFeature(f.delivery.id).catch(() => {});
  assert.deepEqual(dispatched, [], "no turn on usage that lapsed");
});

test("a model request re-reads the decision without re-probing or rewriting qualification", async (t) => {
  let seen, coding;
  coding = await routedCoding(t, async (request) => {
    // A worker probe that would now fail is not consulted mid-turn.
    coding.mediation.regress();
    seen = await coding.sessions[0].authority();
    return failedTurn(request);
  });
  const before = coding.f.controller.status(coding.f.delivery.id).qualification;
  await coding.f.controller.codeFeature(coding.f.delivery.id);
  assert.equal(seen, "permitted");
  assert.deepEqual(
    coding.f.controller.status(coding.f.delivery.id).qualification
      .subscriptionMediation.mechanismDecision,
    before.subscriptionMediation.mechanismDecision,
  );
});

test("a turn's general session never outlives the gateway's session limit", async (t) => {
  const { f, sessions } = await routedCoding(t);
  await f.controller.codeFeature(f.delivery.id, { codingMinutes: 1440 });
  assert.ok(
    sessions[0].turn.expiresAt <= f.now + generalSessionLimits.sessionMs,
  );
});

test("a general session that cannot open stops the prepared session and dispatches nothing", async (t) => {
  const { f, dispatched } = await authorizedCoding(t);
  await mediatedCoding(f, t, mediatedAccount, {
    generalSessions: () => {
      throw Error("synthetic gateway refusal");
    },
  });
  observeAccount(f, mediatedAccount);
  await f.controller.codeFeature(f.delivery.id).catch(() => {});
  assert.deepEqual(dispatched, []);
  assert.notEqual(
    f.controller.status(f.delivery.id).feature.session.state,
    "running",
  );
});

test("a usage read that loses delivery authority mid-request is unknown authority", async (t) => {
  let seen, coding;
  coding = await routedCoding(t, async (request) => {
    const { f } = coding,
      healthy = f.subscription;
    // The delivery is paused while this request's usage read is in flight.
    f.subscription = async (at) => {
      f.subscription = healthy;
      await f.controller.pause(f.delivery.id);
      return healthy(at);
    };
    seen = await coding.sessions[0].authority();
    return failedTurn(request);
  });
  await coding.f.controller.codeFeature(coding.f.delivery.id).catch(() => {});
  assert.equal(seen, "unknown");
});

// Slice 4b (decisions F and G): a lapse or withdrawal ends a routed turn at
// once. The grant is revoked with the reason, the checkpoint fails so the
// native poll loop exits, the session is stopped with the reason recorded,
// and the workspace is kept as evidence only.
const lapses = [
  ["exhausted", (f) => (f.usedPercent = 100)],
  ["approval-required", (f) => (f.usedPercent = 85)],
  ["unknown", (f) => (f.subscription = async () => undefined)],
  ["account", (f) => observeAccount(f, "d".repeat(64))],
  ["withdrawn", (f, mediation) => unlinkSync(mediation.recordPath)],
];
// Wait, boundedly, until the controller revokes the turn's general session.
async function untilRevoked(gateway) {
  for (let i = 0; i < 400 && gateway.revoked.length === 0; i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
}
// A routed turn that starts its thread and then has a request refused.
async function lapsedTurn(t, arrange) {
  let during, coding;
  coding = await routedCoding(t, async (request, gateway) => {
    request.onEvent({ type: "thread.started", thread_id: firstThread });
    await arrange(coding.f, coding.mediation);
    await coding.sessions[0].authority();
    during = {
      revoked: [...gateway.revoked],
      checkpoint: request.checkpoint(),
    };
    return failedTurn(request);
  });
  await coding.f.controller.codeFeature(coding.f.delivery.id).catch(() => {});
  return {
    ...coding,
    during,
    stopped: coding.f.controller.status(coding.f.delivery.id),
  };
}
const lapse = (reason) => lapses.find(([name]) => name === reason)[1];
const interruptions = (delivery) =>
  delivery.feature.usageInterruptions.map(({ operationId, reason }) => ({
    operationId,
    reason,
  }));

for (const [reason, arrange] of lapses)
  test(`a request refused as "${reason}" ends the turn at once and records why`, async (t) => {
    const { during, sessions, stopped, dispatched } = await lapsedTurn(
      t,
      arrange,
    );
    assert.deepEqual(during, { revoked: [reason], checkpoint: false });
    assert.deepEqual(sessions[0].gateway.revoked, [reason], "revoked once");
    assert.equal(stopped.feature.session.state, "stopped");
    assert.equal(stopped.feature.session.threadId, firstThread);
    assert.deepEqual(interruptions(stopped), [
      { operationId: dispatched[0], reason },
    ]);
  });

test("a turn that ends without a lapse revokes its general session as stopped", async (t) => {
  const { f, sessions } = await routedCoding(t);
  const stopped = await f.controller.codeFeature(f.delivery.id);
  assert.deepEqual(sessions[0].gateway.revoked, ["stopped"]);
  assert.equal(stopped.feature.usageInterruptions, undefined);
});

test("a turn paused by the owner revokes its general session as paused", async (t) => {
  let coding;
  coding = await routedCoding(t, async (request) => {
    await coding.f.controller.pause(coding.f.delivery.id);
    return failedTurn(request);
  });
  await coding.f.controller.codeFeature(coding.f.delivery.id).catch(() => {});
  assert.deepEqual(coding.sessions[0].gateway.revoked, ["paused"]);
});

test("a lapse seen by the usage monitor revokes the general session with its reason", async (t) => {
  let coding;
  coding = await routedCoding(
    t,
    async (request, gateway) => {
      request.onEvent({ type: "thread.started", thread_id: firstThread });
      coding.f.usedPercent = 100;
      await untilRevoked(gateway);
      return failedTurn(request);
    },
    { codingUsagePollMs: 5 },
  );
  const { f } = coding;
  await f.controller.codeFeature(f.delivery.id).catch(() => {});
  assert.deepEqual(coding.sessions[0].gateway.revoked, ["exhausted"]);
  assert.deepEqual(interruptions(f.controller.status(f.delivery.id)), [
    { operationId: coding.dispatched[0], reason: "exhausted" },
  ]);
});

test("an interrupted turn's workspace is kept as evidence, never as a candidate", async (t) => {
  const { f, stopped, dispatched } = await lapsedTurn(t, lapse("exhausted"));
  const path = join(f.state, "artifacts", `interrupted-${dispatched[0]}.json`);
  assert.deepEqual(
    stopped.evidence.filter((e) => e.kind === "interrupted-turn"),
    [{ kind: "interrupted-turn", path }],
  );
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(
    JSON.parse(readFileSync(path, "utf8")).map((file) => file.path),
    ["index.html"],
  );
  assert.equal(stopped.feature.candidate, undefined);
  assert.notEqual(stopped.feature.outcome, "admitted");
});

test("an interrupted workspace that cannot be collected leaves the interruption and no evidence", async (t) => {
  let coding;
  coding = await routedCoding(t, async (request) => {
    coding.f.runtime.collect = async () => {
      throw Error("synthetic collection failure");
    };
    request.onEvent({ type: "thread.started", thread_id: firstThread });
    coding.f.usedPercent = 100;
    await coding.sessions[0].authority();
    return failedTurn(request);
  });
  await coding.f.controller.codeFeature(coding.f.delivery.id).catch(() => {});
  const stopped = coding.f.controller.status(coding.f.delivery.id);
  assert.equal(
    stopped.evidence.some((e) => e.kind === "interrupted-turn"),
    false,
  );
  assert.deepEqual(interruptions(stopped), [
    { operationId: coding.dispatched[0], reason: "exhausted" },
  ]);
  assert.equal(stopped.feature.session.state, "stopped");
});

test("a usage poll that loses delivery authority interrupts the turn without recording a lapse", async (t) => {
  let coding;
  coding = await routedCoding(
    t,
    async (request, gateway) => {
      const { f } = coding,
        healthy = f.subscription;
      request.onEvent({ type: "thread.started", thread_id: firstThread });
      // The delivery is paused while the monitor's usage read is in flight.
      f.subscription = async (at) => {
        f.subscription = healthy;
        await f.controller.pause(f.delivery.id);
        return healthy(at);
      };
      await untilRevoked(gateway);
      return failedTurn(request);
    },
    { codingUsagePollMs: 5 },
  );
  const { f } = coding;
  await f.controller.codeFeature(f.delivery.id).catch(() => {});
  assert.deepEqual(coding.sessions[0].gateway.revoked, ["paused"]);
  assert.equal(
    f.controller.status(f.delivery.id).feature.usageInterruptions,
    undefined,
  );
});

test("a turn whose pins change revokes its general session as pin-changed", async (t) => {
  let coding;
  coding = await routedCoding(t, async (request) => {
    coding.f.runtime.pins = { ...coding.f.runtime.pins, cliVersion: "0.0.0" };
    return failedTurn(request);
  });
  await coding.f.controller.codeFeature(coding.f.delivery.id).catch(() => {});
  assert.deepEqual(coding.sessions[0].gateway.revoked, ["pin-changed"]);
});

test("a withdrawal seen by the usage monitor ends the turn between requests", async (t) => {
  let coding;
  coding = await routedCoding(
    t,
    async (request, gateway) => {
      request.onEvent({ type: "thread.started", thread_id: firstThread });
      unlinkSync(coding.mediation.recordPath);
      await untilRevoked(gateway);
      return failedTurn(request);
    },
    { codingUsagePollMs: 5 },
  );
  const { f } = coding;
  await f.controller.codeFeature(f.delivery.id).catch(() => {});
  assert.deepEqual(coding.sessions[0].gateway.revoked, ["withdrawn"]);
  assert.deepEqual(interruptions(f.controller.status(f.delivery.id)), [
    { operationId: coding.dispatched[0], reason: "withdrawn" },
  ]);
});

test("a turn that completes after its decision was withdrawn is kept as evidence, not admitted", async (t) => {
  let coding;
  coding = await routedCoding(t, async (request) => {
    request.onEvent({ type: "thread.started", thread_id: firstThread });
    unlinkSync(coding.mediation.recordPath);
    return {
      operationId: request.operationId,
      fence: request.fence,
      exitCode: 0,
      events: [
        { type: "thread.started", thread_id: firstThread },
        { type: "turn.started" },
        {
          type: "turn.completed",
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ],
    };
  });
  const { f } = coding;
  const stopped = await f.controller.codeFeature(f.delivery.id);
  assert.equal(stopped.feature.candidate, undefined);
  assert.notEqual(stopped.feature.outcome, "admitted");
  assert.deepEqual(interruptions(stopped), [
    { operationId: coding.dispatched[0], reason: "withdrawn" },
  ]);
  assert.ok(stopped.evidence.some((e) => e.kind === "interrupted-turn"));
});

test("a withdrawal needs the same owner restart approval as a usage lapse", async (t) => {
  const { f } = await lapsedTurn(t, lapse("withdrawn"));
  const approved = f.controller.approveCodingRestart(f.delivery.id);
  assert.equal(approved.feature.restartApprovals.length, 1);
});

test("after a lapse and its evidence, the owner's restart resumes the same thread", async (t) => {
  const { f, stopped } = await lapsedTurn(t, lapse("exhausted"));
  assert.ok(stopped.evidence.some((e) => e.kind === "interrupted-turn"));
  f.usedPercent = 10;
  f.controller.approveCodingRestart(f.delivery.id);
  const resumed = await f.controller.codeFeature(f.delivery.id);
  assert.equal(resumed.feature.session.intent, "resume");
  assert.equal(resumed.feature.session.threadId, firstThread);
});
