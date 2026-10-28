// Slice 4c: the plan's usage scenarios driven by the synthetic usage reader
// (owner decision C), and coding restart after a lapse. Each session records
// its route on the host; a restart resumes only under the same route, and
// otherwise starts a new lineage, superseding the old one (the consequence
// of owner decision A). The name sorts after every other test file, so no
// other file changes shard.
import assert from "node:assert/strict";
import { test } from "node:test";
import { unlinkSync } from "node:fs";
import { failedTurn, firstThread } from "./helpers/coding-turns.mjs";
import { mediatedCoding } from "./helpers/mediation-fixture.mjs";
import {
  authorizedCoding,
  generalSessions,
  mediatedAccount,
  observeAccount,
  routedCoding,
} from "./helpers/routed-coding.mjs";
import { syntheticUsage } from "./helpers/synthetic-usage.mjs";

const secondThread = "22222222-2222-4222-8222-222222222222";

// A turn that starts its thread (a resume keeps its own, and each new lineage
// gets the next one), runs `during`, then fails, leaving it resumable.
function threadedTurn(during = async () => {}) {
  const fresh = [firstThread, secondThread];
  let coding;
  const turn = async (request) => {
    const thread = request.threadId ?? fresh.shift();
    request.onEvent({ type: "thread.started", thread_id: thread });
    await during(coding, request);
    const failed = await failedTurn(request);
    failed.events[0].thread_id = thread;
    return failed;
  };
  return { turn, bind: (c) => (coding = c) };
}

// A routed coding fixture whose usage comes from the synthetic reader.
async function scripted(t, during) {
  const { turn, bind } = threadedTurn(during);
  const coding = bind(await routedCoding(t, turn));
  coding.usage = syntheticUsage(coding.f, mediatedAccount);
  return coding;
}

// A lapse during the first turn only: `arrange` changes authority, and the
// turn's next model request observes it.
const firstTurnLapse = (arrange) => async (coding) => {
  if (coding.dispatched.length > 1) return;
  await arrange(coding);
  await coding.sessions.at(-1).authority();
};

// The owner withdraws the decision, then qualifies a new one with the same
// general-session factory.
async function requalify(t, coding) {
  await new Promise((resolve) => setTimeout(resolve, 5));
  coding.mediation = await mediatedCoding(coding.f, t, mediatedAccount, {
    generalSessions: coding.factory,
  });
}

test("synthetic low usage needs owner approval before a routed turn", async (t) => {
  const { f, usage, dispatched, sessions } = await scripted(t);
  usage.state = "low";
  await assert.rejects(f.controller.codeFeature(f.delivery.id), /usage/i);
  assert.deepEqual(dispatched, []);
  const pending = f.controller.status(f.delivery.id).usage;
  assert.equal(pending.decision, "approval-required");
  f.controller.approveUsage(f.delivery.id, pending.checkId);
  await f.controller.codeFeature(f.delivery.id);
  assert.equal(dispatched.length, 1);
  assert.equal(sessions.length, 1, "the approved turn was routed");
  assert.ok(usage.observations > 0);
});

test("synthetic unknown usage never authorizes a routed turn, even when approved", async (t) => {
  const { f, usage, dispatched } = await scripted(t);
  usage.state = "unknown";
  await assert.rejects(f.controller.codeFeature(f.delivery.id), /usage/i);
  f.controller.approveUsage(
    f.delivery.id,
    f.controller.status(f.delivery.id).usage.checkId,
  );
  await assert.rejects(f.controller.codeFeature(f.delivery.id), /usage/i);
  assert.deepEqual(dispatched, []);
});

test("synthetic exhaustion mid-turn ends it, and a restart needs a fresh approval then resumes under the same route", async (t) => {
  const coding = await scripted(
    t,
    firstTurnLapse((c) => (c.usage.state = "exhausted")),
  );
  const { f, usage, dispatched, sessions, launches } = coding;
  const stopped = await f.controller.codeFeature(f.delivery.id);
  assert.deepEqual(sessions[0].gateway.revoked, ["exhausted"]);
  assert.deepEqual(
    stopped.feature.usageInterruptions.map((i) => i.reason),
    ["exhausted"],
  );
  usage.state = "healthy";
  await assert.rejects(
    f.controller.codeFeature(f.delivery.id),
    /restart approval/,
  );
  assert.equal(dispatched.length, 1, "fresh usage alone never restarts");
  f.controller.approveCodingRestart(f.delivery.id);
  const resumed = await f.controller.codeFeature(f.delivery.id);
  assert.equal(resumed.feature.session.intent, "resume");
  assert.equal(launches[1].request.threadId, firstThread);
  assert.deepEqual(
    resumed.feature.session.route,
    stopped.feature.session.route,
  );
  assert.equal(resumed.feature.supersededLineages, undefined);
});

test("a decision withdrawn mid-turn ends the routed turn", async (t) => {
  const { f, sessions } = await scripted(
    t,
    firstTurnLapse((c) => unlinkSync(c.mediation.recordPath)),
  );
  const stopped = await f.controller.codeFeature(f.delivery.id);
  assert.deepEqual(sessions[0].gateway.revoked, ["withdrawn"]);
  assert.deepEqual(
    stopped.feature.usageInterruptions.map((i) => i.reason),
    ["withdrawn"],
  );
  assert.equal(stopped.feature.session.threadId, firstThread);
});

test("each session records its route on the host, and an offline turn records none", async (t) => {
  const { f, sessions } = await scripted(t);
  const routed = await f.controller.codeFeature(f.delivery.id);
  assert.deepEqual(routed.feature.session.route, {
    deliveryId: f.delivery.id,
    decisionSha256: sessions[0].turn.decisionSha256,
  });
  const { f: g } = await authorizedCoding(t);
  const offline = await g.controller.codeFeature(g.delivery.id);
  assert.equal(offline.feature.session.route, undefined);
});

test("a restart under a re-qualified new decision starts a new lineage and supersedes the old one", async (t) => {
  const coding = await scripted(
    t,
    firstTurnLapse((c) => unlinkSync(c.mediation.recordPath)),
  );
  const { f, dispatched, launches, sessions } = coding;
  const withdrawn = await f.controller.codeFeature(f.delivery.id);
  const old = withdrawn.feature.session;
  await requalify(t, coding);
  await assert.rejects(
    f.controller.codeFeature(f.delivery.id),
    /restart approval/,
  );
  f.controller.approveCodingRestart(f.delivery.id);
  const restarted = await f.controller.codeFeature(f.delivery.id);
  const session = restarted.feature.session;
  assert.equal(session.intent, "start");
  assert.equal(session.resumeFrom, undefined);
  assert.equal(launches[1].request.threadId, undefined, "a fresh thread");
  assert.equal(session.threadId, secondThread);
  assert.notEqual(
    session.route.decisionSha256,
    old.route.decisionSha256,
    "the new decision",
  );
  assert.equal(sessions[1].turn.decisionSha256, session.route.decisionSha256);
  const [superseded, ...others] = restarted.feature.supersededLineages;
  assert.deepEqual(others, []);
  assert.equal(superseded.operationId, dispatched[0]);
  assert.equal(superseded.threadId, firstThread);
  assert.deepEqual(superseded.route, old.route);
  assert.equal(superseded.by, dispatched[1]);
  assert.equal(superseded.session.operationId, dispatched[0]);
  assert.ok(Date.parse(superseded.at));
  assert.equal(restarted.feature.restartApprovals[0].dispatched, true);

  // The new lineage is the one that resumes next; the old is never resumed.
  const resumed = await f.controller.codeFeature(f.delivery.id);
  assert.equal(resumed.feature.session.intent, "resume");
  assert.equal(launches[2].request.threadId, secondThread);
  assert.equal(resumed.feature.session.resumeFrom.operationId, dispatched[1]);
  assert.equal(resumed.feature.supersededLineages.length, 1);
});

test("a routed session is superseded when the feature's coding becomes offline", async (t) => {
  const { f, dispatched, launches } = await scripted(t);
  const routed = await f.controller.codeFeature(f.delivery.id);
  assert.ok(routed.feature.session.route);
  // The same decision, with no general-session factory: coding is offline.
  await mediatedCoding(f, t, mediatedAccount);
  const offline = await f.controller.codeFeature(f.delivery.id);
  assert.equal(offline.feature.session.intent, "start");
  assert.equal(offline.feature.session.route, undefined);
  assert.equal(launches[1].request.threadId, undefined);
  assert.deepEqual(
    offline.feature.supersededLineages.map(({ operationId, route }) => ({
      operationId,
      route,
    })),
    [{ operationId: dispatched[0], route: routed.feature.session.route }],
  );
});

test("an offline session is superseded when the feature's coding becomes routed", async (t) => {
  const { f, dispatched } = await authorizedCoding(t);
  const { turn } = threadedTurn();
  const recorded = [];
  f.runtime.execute = async (request, gateway) => {
    dispatched.push(request.operationId);
    recorded.push({ request, gateway });
    return turn(request);
  };
  await mediatedCoding(f, t, mediatedAccount);
  observeAccount(f, mediatedAccount);
  const offline = await f.controller.codeFeature(f.delivery.id);
  assert.equal(offline.feature.session.route, undefined);
  assert.equal(offline.feature.session.threadId, firstThread);
  const { factory } = generalSessions();
  await mediatedCoding(f, t, mediatedAccount, { generalSessions: factory });
  const routed = await f.controller.codeFeature(f.delivery.id);
  assert.equal(routed.feature.session.intent, "start");
  assert.equal(recorded[1].request.threadId, undefined);
  assert.ok(routed.feature.session.route);
  assert.deepEqual(
    routed.feature.supersededLineages.map(
      ({ operationId, threadId, route }) => ({
        operationId,
        threadId,
        route,
      }),
    ),
    [{ operationId: dispatched[0], threadId: firstThread, route: undefined }],
  );
});
