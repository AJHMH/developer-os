// Slice 4c: the plan's usage scenarios driven by the synthetic usage reader
// (owner decision C), and coding restart after a lapse. Each session records
// its route on the host; a restart resumes only under the same route, and
// otherwise starts a new lineage, superseding the old one (the consequence
// of owner decision A). The name sorts after every other test file, so no
// other file changes shard.
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { unlinkSync } from "node:fs";
import { codexAgent } from "../dist/coding-agent.js";
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
  // The same route, but a fresh relay capability that is never a gateway's.
  const [launched, resumedWith] = launches.map((l) => l.request.modelRoute);
  assert.notEqual(resumedWith.capability, launched.capability);
  for (const { capability } of [launched, resumedWith])
    assert.ok(sessions.every((s) => s.gateway.capability !== capability));
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

// The owner's guest cleanup of a superseded lineage, with a controlled
// cleanup that answers `receipt`.
async function supersededLineage(
  t,
  receipt = (session) => ({
    operationId: session.operationId,
    fence: session.fence,
    cleaned: 1,
  }),
) {
  const coding = await scripted(t);
  const { f } = coding;
  await f.controller.codeFeature(f.delivery.id);
  await mediatedCoding(f, t, mediatedAccount);
  const restarted = await f.controller.codeFeature(f.delivery.id);
  const [superseded] = restarted.feature.supersededLineages;
  const cleanups = [];
  f.runtime.cleanupSuperseded = async (session) => {
    cleanups.push(structuredClone(session));
    return receipt(session);
  };
  return { ...coding, superseded, cleanups };
}

test("the owner cleans up a superseded lineage in the guest once, and the evidence records it", async (t) => {
  const { f, superseded, cleanups, launches } = await supersededLineage(t);
  const cleaned = await f.controller.cleanupSupersededLineage(
    f.delivery.id,
    superseded.operationId,
  );
  assert.deepEqual(cleanups, [superseded.session], "the recorded binding");
  const [entry] = cleaned.feature.supersededLineages;
  assert.equal(entry.cleaned, 1);
  assert.ok(Date.parse(entry.cleanedAt));
  await assert.rejects(
    f.controller.cleanupSupersededLineage(
      f.delivery.id,
      superseded.operationId,
    ),
    /superseded/,
    "a lineage is cleaned up once",
  );
  assert.equal(cleanups.length, 1);
  const next = await f.controller.codeFeature(f.delivery.id);
  assert.equal(
    next.feature.session.intent,
    "resume",
    "the new lineage goes on",
  );
  assert.notEqual(
    launches.at(-1).request.resumeFrom.operationId,
    superseded.operationId,
  );
});

for (const [name, receipt] of [
  [
    "another operation",
    (session) => ({
      operationId: randomUUID(),
      fence: session.fence,
      cleaned: 1,
    }),
  ],
  ["nothing cleaned", (session) => ({ ...session, cleaned: 0 })],
  [
    "a failed cleanup",
    () => {
      throw Error("Native lineage cleanup is uncertain");
    },
  ],
])
  test(`a superseded lineage cleanup with ${name} records nothing and can be retried`, async (t) => {
    const { f, superseded } = await supersededLineage(t, receipt);
    await assert.rejects(
      f.controller.cleanupSupersededLineage(
        f.delivery.id,
        superseded.operationId,
      ),
      /cleanup/i,
    );
    const [entry] = f.controller.status(f.delivery.id).feature
      .supersededLineages;
    assert.equal(entry.cleanedAt, undefined);
    f.runtime.cleanupSuperseded = async (session) => ({
      operationId: session.operationId,
      fence: session.fence,
      cleaned: 1,
    });
    const retried = await f.controller.cleanupSupersededLineage(
      f.delivery.id,
      superseded.operationId,
    );
    assert.equal(retried.feature.supersededLineages[0].cleaned, 1);
  });

test("superseded lineage cleanup needs an owned delivery, a recorded lineage and a cleanup runtime", async (t) => {
  const { f, superseded, cleanups } = await supersededLineage(t);
  for (const operationId of [
    randomUUID(),
    f.controller.status(f.delivery.id).feature.session.operationId,
  ])
    await assert.rejects(
      f.controller.cleanupSupersededLineage(f.delivery.id, operationId),
      /superseded/,
      "only a recorded superseded lineage, never the current one",
    );
  const cleanup = f.runtime.cleanupSuperseded;
  delete f.runtime.cleanupSuperseded;
  await assert.rejects(
    f.controller.cleanupSupersededLineage(
      f.delivery.id,
      superseded.operationId,
    ),
    /superseded/,
    "a runtime without cleanup",
  );
  f.runtime.cleanupSuperseded = cleanup;
  f.controller.release(f.delivery.id);
  await assert.rejects(
    f.controller.cleanupSupersededLineage(
      f.delivery.id,
      superseded.operationId,
    ),
    /superseded/,
    "a released delivery",
  );
  assert.equal(cleanups.length, 0);
});

test("the pinned adapter trusts a superseded cleanup receipt only for the exact session and pins", async (t) => {
  const { f } = await scripted(t);
  const { PinnedCodingRuntime } = await import("../dist/feature-candidate.js");
  const head = {
    operationId: randomUUID(),
    fence: 1,
    state: "stopped",
    intent: "start",
  };
  const exact = (session) => ({
    operationId: session.operationId,
    fence: session.fence,
    cleaned: 1,
    pins: { ...f.runtime.pins },
  });
  const requests = [];
  const runtime = (receipt, cleanup = true) =>
    new PinnedCodingRuntime(f.runtime.pins, {
      mode: "controlled",
      async inspect() {
        return { ...f.runtime.pins };
      },
      ...(cleanup
        ? {
            async cleanupSupersededLineage(session) {
              requests.push(session);
              return receipt(session);
            },
          }
        : {}),
    });
  assert.deepEqual(await runtime(exact).cleanupSuperseded(head), {
    operationId: head.operationId,
    fence: head.fence,
    cleaned: 1,
  });
  assert.deepEqual(requests[0], head, "the exact superseded binding");
  for (const receipt of [
    (s) => ({ ...exact(s), fence: 3 }),
    (s) => ({ ...exact(s), operationId: randomUUID() }),
    (s) => ({ ...exact(s), cleaned: 0 }),
    (s) => ({ ...exact(s), cleaned: 1.5 }),
    (s) => ({
      ...exact(s),
      pins: { ...f.runtime.pins, cliSha256: "f".repeat(64) },
    }),
  ])
    await assert.rejects(runtime(receipt).cleanupSuperseded(head), /cleanup/);
  await assert.rejects(
    runtime(exact, false).cleanupSuperseded(head),
    /unsupported/,
  );
});

test("a session is superseded when the feature's coding provider changes (ADR 0003)", async (t) => {
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
  const codex = await f.controller.codeFeature(f.delivery.id);
  // Codex sessions record no provider, so their evidence is unchanged.
  assert.equal("provider" in codex.feature.session, false);
  assert.equal(codex.feature.session.threadId, firstThread);
  f.runtime.agent = { ...codexAgent, provider: "claude-code" };
  const other = await f.controller.codeFeature(f.delivery.id);
  assert.equal(other.feature.session.intent, "start");
  assert.equal(other.feature.session.provider, "claude-code");
  assert.equal(recorded[1].request.threadId, undefined);
  assert.deepEqual(
    other.feature.supersededLineages.map(
      ({ operationId, threadId, provider }) => ({
        operationId,
        threadId,
        provider,
      }),
    ),
    [
      {
        operationId: dispatched[0],
        threadId: firstThread,
        provider: undefined,
      },
    ],
  );
  // The same provider again resumes its own lineage.
  const resumed = await f.controller.codeFeature(f.delivery.id);
  assert.equal(resumed.feature.session.intent, "resume");
  assert.equal(resumed.feature.session.provider, "claude-code");
  assert.equal(resumed.feature.supersededLineages.length, 1);
  // Only the runtime of the lineage's own provider cleans it up.
  const cleanups = [];
  f.runtime.cleanupSuperseded = async (session) => {
    cleanups.push(session);
    return {
      operationId: session.operationId,
      fence: session.fence,
      cleaned: 1,
    };
  };
  const [lineage] = resumed.feature.supersededLineages;
  await assert.rejects(
    f.controller.cleanupSupersededLineage(f.delivery.id, lineage.operationId),
    /superseded/,
  );
  assert.equal(cleanups.length, 0);
  f.runtime.agent = codexAgent;
  const cleaned = await f.controller.cleanupSupersededLineage(
    f.delivery.id,
    lineage.operationId,
  );
  assert.equal(cleaned.feature.supersededLineages[0].cleaned, 1);
  assert.deepEqual(cleanups, [lineage.session]);
});
