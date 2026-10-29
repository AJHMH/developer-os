// The mediation account link and routed general sessions (slice 4a). Split
// from zz-usage-coding-session.test.mjs to keep Windows shard 7 under its
// time limit; the name sorts after every other test file, so no other file
// changes shard.
import assert from "node:assert/strict";
import { test } from "node:test";
import { unlinkSync } from "node:fs";
import { lockedCodingArgv } from "../dist/feature-candidate.js";
import { generalSessionLimits } from "../dist/general-session-gateway.js";
import { mediatedCoding } from "./helpers/mediation-fixture.mjs";
import { failedTurn } from "./helpers/coding-turns.mjs";
import {
  authorizedCoding,
  mediatedAccount,
  observeAccount,
  routedCoding,
} from "./helpers/routed-coding.mjs";

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

test("a mediated turn is routed through the configured general session", async (t) => {
  const { f, launches, sessions } = await routedCoding(t);
  await f.controller.codeFeature(f.delivery.id);
  assert.equal(launches.length, 1);
  assert.equal(sessions.length, 1);
  const [{ request, gateway }] = launches,
    [{ turn }] = sessions;
  assert.equal(gateway, sessions[0].gateway, "the factory's gateway");
  const { capability, ...named } = request.modelRoute;
  assert.deepEqual(named, {
    deliveryId: f.delivery.id,
    decisionSha256: turn.decisionSha256,
  });
  // The relay's own capability, never the gateway's (ADR 0002).
  assert.match(capability, /^[a-f0-9]{64}$/);
  assert.notEqual(capability, gateway.capability);
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
