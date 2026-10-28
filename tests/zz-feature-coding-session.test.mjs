// Coding sessions: explicit resume, recovery and reconciliation, retired
// lineage cleanup, usage authority, monitoring, restart approval and the
// mediation account link. Split from feature-candidate.test.mjs so these
// slower controller tests run on another Windows test shard. The `zz-` prefix
// sorts it near the end, so few other files change shard.
import { planAndValidate } from "./helpers/validation-fixture.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DeliveryController } from "../dist/controller.js";
import { lockedCodingArgv } from "../dist/feature-candidate.js";
import { generalSessionLimits } from "../dist/general-session-gateway.js";
import { codingFixture } from "./helpers/feature-fixture.mjs";
import { mediatedCoding } from "./helpers/mediation-fixture.mjs";

const firstThread = "11111111-1111-4111-8111-111111111111";
// A turn that starts its CLI thread and then fails leaves a stopped,
// resumable session that owns that thread.
const failedTurn = async (request) => ({
  operationId: request.operationId,
  fence: request.fence,
  exitCode: 1,
  events: [
    { type: "thread.started", thread_id: firstThread },
    { type: "turn.started" },
    { type: "turn.failed", error: { message: "synthetic failure" } },
  ],
});
// Preparation fails before the CLI starts, so no thread is ever observed.
const unlaunchedTurn = async () => {
  throw Error("synthetic preparation failure");
};
const named = ({ operationId, fence, intent }) => ({
  operationId,
  fence,
  state: "stopped",
  intent,
});
async function resumable(t) {
  const f = codingFixture(t),
    normal = f.runtime.execute.bind(f.runtime),
    requests = [],
    recoveries = [];
  let turn = failedTurn;
  f.runtime.execute = async (request) => {
    // Record only the launch data; callbacks and file bytes are not compared.
    const { operationId, fence, intent, threadId, resumeFrom } = request;
    requests.push(
      structuredClone({ operationId, fence, intent, threadId, resumeFrom }),
    );
    return turn === "normal" ? normal(request) : turn(request);
  };
  f.runtime.recover = async (session, resumeFrom) => {
    recoveries.push(structuredClone({ session, resumeFrom }));
    return {
      operationId: session.operationId,
      fence: session.fence,
      recovered: true,
    };
  };
  await planAndValidate(f);
  const first = await f.controller.codeFeature(f.delivery.id);
  assert.equal(first.feature.session.state, "stopped");
  assert.equal(first.feature.session.threadId, firstThread);
  return {
    f,
    requests,
    recoveries,
    origin: first.feature.session,
    next: (behavior) => (turn = behavior),
  };
}

// Advance the fixture repository's main by one ordinary commit that leaves
// the feature's mutable page unchanged.
function moveMain(f) {
  writeFileSync(join(f.repository, "notes.txt"), "Main moved.\n");
  f.git("add", "notes.txt");
  f.git(
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=/nonexistent",
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "main moved",
  );
  return f.git("rev-parse", "HEAD");
}

test("after main moves, a revalidated baseline lets coding resume the conversation onto the new base", async (t) => {
  const { f, origin, next } = await resumable(t);
  const from = f.git("rev-parse", "HEAD");
  const to = moveMain(f);
  await assert.rejects(
    f.controller.codeFeature(f.delivery.id),
    /baseline/i,
    "the new main must be validated first",
  );
  const launches = [];
  const normal = f.runtime.execute;
  f.runtime.execute = async (request) => {
    launches.push(
      structuredClone({
        sourceRevision: request.sourceRevision,
        baseMove: request.baseMove,
        threadId: request.threadId,
        prompt: JSON.parse(request.argv.at(-1)),
      }),
    );
    return normal(request);
  };
  await f.controller.validateBaseline(f.delivery.id);
  next("normal");
  const resumed = await f.controller.codeFeature(f.delivery.id);
  assert.equal(resumed.feature.outcome, "admitted");
  assert.equal(resumed.feature.session.intent, "resume");
  assert.deepEqual(launches, [
    {
      sourceRevision: to,
      baseMove: { from, to },
      threadId: origin.threadId,
      prompt: { ...launches[0].prompt, baseMove: { from, to } },
    },
  ]);
  assert.deepEqual(
    resumed.feature.baseMoves.map(({ operationId, from: a, to: b }) => ({
      operationId,
      from: a,
      to: b,
    })),
    [{ operationId: resumed.feature.session.operationId, from, to }],
    "the move is recorded",
  );
});

// A commit object only the feature branch holds, on top of `parent`.
function ownCommit(f, parent) {
  return f.git(
    "-c",
    "commit.gpgsign=false",
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit-tree",
    f.git("rev-parse", parent + "^{tree}"),
    "-p",
    parent,
    "-m",
    "feature-only",
  );
}

for (const [name, arrange] of [
  [
    "has its own commits",
    (f, branch) => {
      f.git("update-ref", branch, ownCommit(f, f.git("rev-parse", "HEAD")));
      moveMain(f);
    },
  ],
  [
    "is ahead of a main that moved backwards",
    async (f, branch, next) => {
      const from = f.git("rev-parse", "HEAD");
      moveMain(f);
      await f.controller.validateBaseline(f.delivery.id);
      // The resume onto the new main fails, so no candidate exists.
      next(failedTurn);
      await f.controller.codeFeature(f.delivery.id);
      assert.notEqual(f.git("rev-parse", branch), from, "the branch followed");
      f.git("reset", "--hard", from);
    },
  ],
])
  test(`a feature branch that ${name} is never moved and nothing is dispatched`, async (t) => {
    const { f, next, requests } = await resumable(t);
    const branch = "refs/heads/codex/feature-" + f.delivery.id;
    await arrange(f, branch, next);
    const before = f.git("rev-parse", branch),
      dispatched = requests.length,
      moves = f.controller.status(f.delivery.id).feature.baseMoves;
    await f.controller.validateBaseline(f.delivery.id);
    next("normal");
    await assert.rejects(
      f.controller.codeFeature(f.delivery.id),
      /feature branch/,
    );
    assert.equal(f.git("rev-parse", branch), before, "the branch is unchanged");
    assert.equal(requests.length, dispatched, "nothing was dispatched");
    assert.deepEqual(
      f.controller.status(f.delivery.id).feature.baseMoves,
      moves,
      "no move is recorded",
    );
  });

test("a fresh start on a moved main builds from the new main and names no move", async (t) => {
  const f = codingFixture(t);
  const normal = f.runtime.execute.bind(f.runtime);
  const launches = [];
  f.runtime.execute = async (request) => {
    launches.push(
      structuredClone({
        intent: request.intent,
        sourceRevision: request.sourceRevision,
        baseMove: request.baseMove,
      }),
    );
    return launches.length === 1 ? unlaunchedTurn(request) : normal(request);
  };
  await planAndValidate(f);
  await f.controller.codeFeature(f.delivery.id);
  const to = moveMain(f);
  await f.controller.validateBaseline(f.delivery.id);
  const fresh = await f.controller.codeFeature(f.delivery.id);
  assert.equal(fresh.feature.outcome, "admitted");
  assert.deepEqual(launches[1], {
    intent: "start",
    sourceRevision: to,
    baseMove: undefined,
  });
  assert.equal(fresh.feature.baseMoves, undefined);
});

test("a resume on an unchanged base names no base move", async (t) => {
  const { f, next } = await resumable(t);
  let launched;
  const normal = f.runtime.execute;
  f.runtime.execute = async (request) => {
    launched = request;
    return normal(request);
  };
  next("normal");
  const resumed = await f.controller.codeFeature(f.delivery.id);
  assert.equal(launched.baseMove, undefined);
  assert.equal(JSON.parse(launched.argv.at(-1)).baseMove, undefined);
  assert.equal(resumed.feature.baseMoves, undefined);
});

test("a recovered resume onto a moved base still names its predecessor's revision", async (t) => {
  const { f, next, requests } = await resumable(t);
  const from = f.git("rev-parse", "HEAD");
  const to = moveMain(f);
  await f.controller.validateBaseline(f.delivery.id);
  next(unlaunchedTurn);
  const recovered = await f.controller.codeFeature(f.delivery.id);
  assert.equal(recovered.feature.session.resumeRecovery, "recovered");
  let launched;
  const normal = f.runtime.execute;
  f.runtime.execute = async (request) => {
    launched = request;
    return normal(request);
  };
  next("normal");
  await f.controller.codeFeature(f.delivery.id);
  assert.deepEqual(launched.baseMove, { from, to });
  assert.equal(requests.length, 3);
});

test("a baseline after coding is refused unless main moved, and never after admission", async (t) => {
  const { f, next } = await resumable(t);
  await assert.rejects(
    f.controller.validateBaseline(f.delivery.id),
    /Baseline must precede coding/,
    "main has not moved",
  );
  next("normal");
  await f.controller.codeFeature(f.delivery.id);
  moveMain(f);
  await assert.rejects(
    f.controller.validateBaseline(f.delivery.id),
    /Baseline must precede coding/,
    "an admitted candidate refreshes through repair, not a new baseline",
  );
});

test("a resumed coding turn names its exact stopped predecessor session", async (t) => {
  const { f, requests, origin, next } = await resumable(t);
  assert.equal(requests[0].resumeFrom, undefined);
  next("normal");
  const resumed = await f.controller.codeFeature(f.delivery.id);
  assert.equal(resumed.feature.outcome, "admitted");
  assert.equal(requests[1].intent, "resume");
  assert.equal(requests[1].threadId, firstThread);
  assert.deepEqual(requests[1].resumeFrom, named(origin));
  assert.deepEqual(
    new DeliveryController(f.state).status(f.delivery.id).feature.session
      .resumeFrom,
    named(origin),
  );
});

test("a resume that never started its thread returns the home and resumes from the original predecessor", async (t) => {
  const { f, requests, recoveries, origin, next } = await resumable(t);
  next(unlaunchedTurn);
  const interrupted = await f.controller.codeFeature(f.delivery.id);
  const successor = requests[1];
  assert.equal(interrupted.blocker.code, "DELIVERY_NOT_ENABLED");
  assert.deepEqual(recoveries, [
    {
      session: {
        operationId: successor.operationId,
        fence: successor.fence,
        state: "stopped",
        intent: "resume",
        threadId: firstThread,
        resumeFrom: named(origin),
      },
      resumeFrom: named(origin),
    },
  ]);
  next("normal");
  const resumed = await f.controller.codeFeature(f.delivery.id);
  assert.equal(resumed.feature.outcome, "admitted");
  assert.deepEqual(requests[2].resumeFrom, named(origin));
  assert.equal(requests[2].threadId, firstThread);
});

test("a resume whose thread started but failed keeps that successor as the next predecessor", async (t) => {
  const { f, requests, recoveries, next } = await resumable(t);
  await f.controller.codeFeature(f.delivery.id);
  const successor = requests[1];
  next("normal");
  await f.controller.codeFeature(f.delivery.id);
  assert.deepEqual(recoveries, []);
  assert.deepEqual(requests[2].resumeFrom, named(successor));
});

for (const failure of ["refused", "unsupported"])
  test(`an unverified resume recovery (${failure}) blocks coding until recovery succeeds`, async (t) => {
    const { f, requests, recoveries, origin, next } = await resumable(t),
      recover = f.runtime.recover;
    if (failure === "refused")
      f.runtime.recover = async () => {
        throw Error("Native resume recovery is uncertain");
      };
    else delete f.runtime.recover;
    next(unlaunchedTurn);
    const blocked = await f.controller.codeFeature(f.delivery.id);
    assert.equal(blocked.blocker.code, "UNCERTAIN_SESSION");
    next("normal");
    await assert.rejects(f.controller.codeFeature(f.delivery.id));
    assert.equal(requests.length, 2, "no further dispatch while blocked");
    f.runtime.recover = recover;
    const recovered = await f.controller.recover(f.delivery.id);
    assert.equal(recovered.blocker.code, "DELIVERY_NOT_ENABLED");
    assert.equal(recoveries.length, 1);
    const resumed = await f.controller.codeFeature(f.delivery.id);
    assert.equal(resumed.feature.outcome, "admitted");
    assert.deepEqual(requests[2].resumeFrom, named(origin));
  });

// A controller over the same durable state, as after a restart.
const controllerFor = (f, featureRuntime = f.runtime) =>
  new DeliveryController(f.state, f.options, {
    featurePlanner: f.criteria,
    validationRuntime: f.validation,
    featureRuntime,
    subscription: () => f.subscription(),
    clock: () => f.now,
  });
// A controlled transport that streams the turn `run` returns as CLI JSON.
function turnTransport(f, run) {
  return {
    mode: "controlled",
    async inspect() {
      return { ...f.runtime.pins };
    },
    async run(request, output) {
      const result = await run(request);
      output(
        Buffer.from(
          result.events.map((e) => JSON.stringify(e)).join("\n") + "\n",
        ),
      );
      return {
        operationId: request.operationId,
        fence: request.fence,
        exitCode: result.exitCode,
        pins: { ...f.runtime.pins },
      };
    },
    stop: (request) => f.runtime.stop(request),
    collect: (request) => f.runtime.collect(request),
  };
}
// Lose the controller mid-resume: its turn stays pending until settled, so
// only the restarted controller acts on the delivery.
async function loseResume({ f, next }) {
  let release;
  next(
    () =>
      new Promise((_, reject) => {
        release = () => reject(Error("synthetic controller loss"));
      }),
  );
  const lost = f.controller.codeFeature(f.delivery.id);
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  return {
    restarted: controllerFor(f),
    settle: async () => {
      release();
      await lost;
    },
  };
}

// The pinned adapter over a controlled transport: the first turn fails after
// its thread starts; the resume fails during preparation, before any output.
async function pinnedResume(t, receipt) {
  const f = codingFixture(t);
  const { PinnedCodingRuntime } = await import("../dist/feature-candidate.js");
  const runs = [],
    recoveries = [];
  const transport = turnTransport(f, async (request) => {
    runs.push(structuredClone(request.resumeFrom));
    if (runs.length > 1) throw Error("synthetic preparation failure");
    return failedTurn(request);
  });
  if (receipt)
    transport.recoverInterruptedResume = async (session, resumeFrom) => {
      recoveries.push(structuredClone({ session, resumeFrom }));
      return receipt(session, f.runtime.pins);
    };
  f.controller = controllerFor(
    f,
    new PinnedCodingRuntime(f.runtime.pins, transport),
  );
  await planAndValidate(f);
  const origin = (await f.controller.codeFeature(f.delivery.id)).feature
    .session;
  const interrupted = await f.controller.codeFeature(f.delivery.id);
  return { origin, interrupted, runs, recoveries };
}

test("the pinned adapter forwards the named predecessor and recovers its stranded home", async (t) => {
  const { origin, interrupted, runs, recoveries } = await pinnedResume(
    t,
    (session, pins) => ({
      operationId: session.operationId,
      fence: session.fence,
      recovered: true,
      pins: { ...pins },
    }),
  );
  assert.deepEqual(runs, [undefined, named(origin)]);
  assert.equal(recoveries.length, 1);
  assert.deepEqual(recoveries[0].resumeFrom, named(origin));
  assert.equal(interrupted.feature.session.state, "stopped");
  assert.equal(interrupted.blocker.code, "DELIVERY_NOT_ENABLED");
});

for (const [name, receipt] of [
  ["unsupported transport", undefined],
  [
    "changed pins",
    (session, pins) => ({
      operationId: session.operationId,
      fence: session.fence,
      recovered: true,
      pins: { ...pins, cliSha256: "f".repeat(64) },
    }),
  ],
  [
    "another operation",
    (session, pins) => ({
      operationId: session.resumeFrom.operationId,
      fence: session.fence,
      recovered: true,
      pins: { ...pins },
    }),
  ],
])
  test(`the pinned adapter treats resume recovery with ${name} as unverified`, async (t) => {
    const { interrupted } = await pinnedResume(t, receipt);
    assert.equal(interrupted.blocker.code, "UNCERTAIN_SESSION");
  });

test("a resume interrupted by controller loss is recovered by the public recover action", async (t) => {
  const resume = await resumable(t);
  const { f, requests, recoveries, origin, next } = resume;
  const { restarted, settle } = await loseResume(resume);
  try {
    const recovered = await restarted.recover(f.delivery.id);
    assert.equal(recovered.feature.session.state, "stopped");
    assert.equal(recoveries.length, 1);
  } finally {
    await settle();
  }
  next("normal");
  const resumed = await restarted.codeFeature(f.delivery.id);
  assert.equal(resumed.feature.outcome, "admitted");
  assert.deepEqual(requests[2].resumeFrom, named(origin));
});

test("a recovery receipt for another operation leaves the resume unverified", async (t) => {
  const { f, next } = await resumable(t);
  f.runtime.recover = async (session, resumeFrom) => ({
    operationId: resumeFrom.operationId,
    fence: session.fence,
    recovered: true,
  });
  next(unlaunchedTurn);
  const blocked = await f.controller.codeFeature(f.delivery.id);
  assert.equal(blocked.blocker.code, "UNCERTAIN_SESSION");
});

test("the pinned adapter refuses a predecessor changed during pin inspection", async (t) => {
  const f = codingFixture(t);
  const { PinnedCodingRuntime } = await import("../dist/feature-candidate.js");
  let dispatches = 0;
  const transport = {
    ...turnTransport(f, async (request) => {
      dispatches += 1;
      return failedTurn(request);
    }),
    async inspect(request) {
      if (request.resumeFrom) request.resumeFrom.fence += 1;
      return { ...f.runtime.pins };
    },
  };
  f.controller = controllerFor(
    f,
    new PinnedCodingRuntime(f.runtime.pins, transport),
  );
  await planAndValidate(f);
  await f.controller.codeFeature(f.delivery.id);
  await f.controller.codeFeature(f.delivery.id);
  assert.equal(dispatches, 1, "a changed predecessor never dispatches");
});

test("the pinned adapter refuses a base move changed during pin inspection and passes an unchanged one", async (t) => {
  const f = codingFixture(t);
  const { PinnedCodingRuntime } = await import("../dist/feature-candidate.js");
  const dispatched = [];
  let tamper = true;
  const transport = {
    ...turnTransport(f, async (request) => {
      dispatched.push(structuredClone(request.baseMove));
      return failedTurn(request);
    }),
    async inspect(request) {
      if (tamper && request.baseMove) request.baseMove.from = "f".repeat(40);
      return { ...f.runtime.pins };
    },
    // The refused resume never launched, so its home is returned.
    async recoverInterruptedResume(session) {
      return {
        operationId: session.operationId,
        fence: session.fence,
        recovered: true,
        pins: { ...f.runtime.pins },
      };
    },
  };
  f.controller = controllerFor(
    f,
    new PinnedCodingRuntime(f.runtime.pins, transport),
  );
  await planAndValidate(f);
  const from = f.git("rev-parse", "HEAD");
  await f.controller.codeFeature(f.delivery.id);
  const to = moveMain(f);
  await f.controller.validateBaseline(f.delivery.id);
  await f.controller.codeFeature(f.delivery.id);
  assert.equal(dispatched.length, 1, "a changed base move never dispatches");
  tamper = false;
  await f.controller.codeFeature(f.delivery.id);
  assert.deepEqual(dispatched.at(-1), { from, to });
});

test("a paused, lost resume blocks resumption and release until its home is recovered", async (t) => {
  const resume = await resumable(t);
  const { f, requests, recoveries, origin, next } = resume;
  const { restarted, settle } = await loseResume(resume);
  try {
    const paused = await restarted.pause(f.delivery.id);
    assert.equal(paused.blocker.code, "UNCERTAIN_SESSION");
    // The stopped successor may hold the predecessor's home: not quiescent.
    assert.throws(() => restarted.resume(f.delivery.id), /Recover/);
    assert.throws(() => restarted.release(f.delivery.id), /shutdown/);
    assert.equal(recoveries.length, 0);
    const recovered = await restarted.recover(f.delivery.id);
    assert.equal(recoveries.length, 1);
    assert.equal(recovered.blocker.code, "DELIVERY_NOT_ENABLED");
    await restarted.resume(f.delivery.id);
    next("normal");
    const resumed = await restarted.codeFeature(f.delivery.id);
    assert.equal(resumed.feature.outcome, "admitted");
    assert.deepEqual(requests[2].resumeFrom, named(origin));
  } finally {
    await settle();
  }
});

// A launched resume the controller never saw start: recovery is refused, so
// the guest's own thread record decides through reconciliation.
async function unobservedLaunch(t, outcome) {
  const resume = await resumable(t),
    reconciles = [];
  resume.f.runtime.recover = async () => {
    throw Error("Native resume recovery is uncertain");
  };
  resume.f.runtime.reconcile = async (session, resumeFrom, retire) => {
    reconciles.push(structuredClone({ session, resumeFrom, retire }));
    return {
      operationId: session.operationId,
      fence: session.fence,
      outcome: outcome(retire),
    };
  };
  resume.next(unlaunchedTurn);
  const settled = await resume.f.controller.codeFeature(resume.f.delivery.id);
  return { ...resume, reconciles, settled, successor: resume.requests[1] };
}

test("a launched resume whose thread the guest recorded is adopted as the next predecessor", async (t) => {
  const { f, requests, reconciles, settled, successor, next } =
    await unobservedLaunch(t, () => "adopted");
  assert.equal(settled.blocker.code, "DELIVERY_NOT_ENABLED");
  assert.deepEqual(
    reconciles.map((r) => r.retire),
    [false],
  );
  next("normal");
  const resumed = await f.controller.codeFeature(f.delivery.id);
  assert.equal(resumed.feature.outcome, "admitted");
  assert.deepEqual(requests[2].resumeFrom, named(successor));
});

test("an unresolved launched resume stays blocked until the owner retires it, then coding starts fresh", async (t) => {
  const { f, requests, reconciles, settled, successor, next } =
    await unobservedLaunch(t, (retire) => (retire ? "retired" : "unresolved"));
  assert.equal(settled.blocker.code, "UNCERTAIN_SESSION");
  assert.match(settled.blocker.nextAction, /retire/i);
  next("normal");
  await assert.rejects(f.controller.codeFeature(f.delivery.id));
  assert.equal(
    (await f.controller.recover(f.delivery.id)).blocker.code,
    "UNCERTAIN_SESSION",
  );
  const retired = await f.controller.retireResume(f.delivery.id);
  assert.equal(retired.blocker.code, "DELIVERY_NOT_ENABLED");
  assert.deepEqual(
    retired.feature.retirements.map((r) => r.operationId),
    [successor.operationId],
    "the owner decision is recorded",
  );
  assert.deepEqual(
    reconciles.map((r) => r.retire),
    [false, false, true],
  );
  const fresh = await f.controller.codeFeature(f.delivery.id);
  assert.equal(fresh.feature.outcome, "admitted");
  assert.equal(requests[2].intent, "start");
  assert.equal(requests[2].threadId, undefined);
  assert.equal(requests[2].resumeFrom, undefined);
});

// A retired lineage, with a controlled cleanup that answers `receipt`.
async function retiredLineage(
  t,
  receipt = (session) => ({
    operationId: session.operationId,
    fence: session.fence,
    cleaned: 2,
  }),
) {
  const lineage = await unobservedLaunch(t, (retire) =>
    retire ? "retired" : "unresolved",
  );
  const cleanups = [];
  lineage.f.runtime.cleanup = async (session) => {
    cleanups.push(structuredClone(session));
    return receipt(session);
  };
  await lineage.f.controller.retireResume(lineage.f.delivery.id);
  return { ...lineage, cleanups };
}

test("the owner cleans up a retired resume lineage once and the evidence records it", async (t) => {
  const { f, successor, cleanups, next } = await retiredLineage(t);
  const cleaned = await f.controller.cleanupRetiredLineage(
    f.delivery.id,
    successor.operationId,
  );
  assert.deepEqual(cleanups, [
    {
      ...named(successor),
      threadId: successor.threadId,
      resumeFrom: successor.resumeFrom,
    },
  ]);
  const [retirement] = cleaned.feature.retirements;
  assert.equal(retirement.cleaned, 2);
  assert.ok(Date.parse(retirement.cleanedAt));
  await assert.rejects(
    f.controller.cleanupRetiredLineage(f.delivery.id, successor.operationId),
    /retired/,
    "a lineage is cleaned up once",
  );
  assert.equal(cleanups.length, 1);
  next("normal");
  const fresh = await f.controller.codeFeature(f.delivery.id);
  assert.equal(fresh.feature.outcome, "admitted", "fresh coding continues");
});

for (const [name, receipt] of [
  [
    "another operation",
    (session) => ({
      operationId: randomUUID(),
      fence: session.fence,
      cleaned: 2,
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
  test(`a retired lineage cleanup with ${name} records nothing and can be retried`, async (t) => {
    const { f, successor, cleanups } = await retiredLineage(t, receipt);
    await assert.rejects(
      f.controller.cleanupRetiredLineage(f.delivery.id, successor.operationId),
      /cleanup/i,
    );
    const [retirement] = f.controller.status(f.delivery.id).feature.retirements;
    assert.equal(retirement.cleanedAt, undefined);
    f.runtime.cleanup = async (session) => ({
      operationId: session.operationId,
      fence: session.fence,
      cleaned: 2,
    });
    const retried = await f.controller.cleanupRetiredLineage(
      f.delivery.id,
      successor.operationId,
    );
    assert.equal(retried.feature.retirements[0].cleaned, 2);
    assert.equal(cleanups.length, 1);
  });

test("retired lineage cleanup needs an owned delivery, a retired operation and a cleanup runtime", async (t) => {
  const { f, successor, cleanups } = await retiredLineage(t);
  await assert.rejects(
    f.controller.cleanupRetiredLineage(f.delivery.id, randomUUID()),
    /retired/,
    "only a recorded retirement",
  );
  await assert.rejects(
    f.controller.cleanupRetiredLineage(
      f.delivery.id,
      f.controller.status(f.delivery.id).feature.retirements[0].session
        .resumeFrom.operationId,
    ),
    /retired/,
    "a predecessor is cleaned through its retired successor",
  );
  const cleanup = f.runtime.cleanup;
  delete f.runtime.cleanup;
  await assert.rejects(
    f.controller.cleanupRetiredLineage(f.delivery.id, successor.operationId),
    /retired/,
    "a runtime without cleanup",
  );
  f.runtime.cleanup = cleanup;
  f.controller.release(f.delivery.id);
  await assert.rejects(
    f.controller.cleanupRetiredLineage(f.delivery.id, successor.operationId),
    /retired/,
    "a released delivery",
  );
  assert.equal(cleanups.length, 0);
});

test("the pinned adapter trusts a lineage cleanup receipt only for the exact session and pins", async (t) => {
  const f = codingFixture(t);
  const { PinnedCodingRuntime } = await import("../dist/feature-candidate.js");
  const retired = {
    operationId: randomUUID(),
    fence: 2,
    state: "stopped",
    intent: "resume",
    threadId: firstThread,
    resumeFrom: {
      operationId: randomUUID(),
      fence: 1,
      state: "stopped",
      intent: "start",
    },
  };
  const exact = (session) => ({
    operationId: session.operationId,
    fence: session.fence,
    cleaned: 2,
    pins: { ...f.runtime.pins },
  });
  const requests = [];
  const runtime = (receipt) =>
    new PinnedCodingRuntime(f.runtime.pins, {
      mode: "controlled",
      async inspect() {
        return { ...f.runtime.pins };
      },
      async cleanupRetiredLineage(session) {
        requests.push(session);
        return receipt(session);
      },
    });
  assert.deepEqual(await runtime(exact).cleanup(retired), {
    operationId: retired.operationId,
    fence: retired.fence,
    cleaned: 2,
  });
  assert.deepEqual(requests[0], retired, "the exact retired binding");
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
    await assert.rejects(runtime(receipt).cleanup(retired), /cleanup/);
  await assert.rejects(
    new PinnedCodingRuntime(f.runtime.pins, {
      mode: "controlled",
      async inspect() {
        return { ...f.runtime.pins };
      },
    }).cleanup(retired),
    /unsupported/,
  );
});

test("retiring a resume refuses when no interrupted resume needs it", async (t) => {
  const { f } = await resumable(t);
  await assert.rejects(f.controller.retireResume(f.delivery.id));
});

for (const [name, pinsChanged, code] of [
  ["exact pins", false, "DELIVERY_NOT_ENABLED"],
  ["changed pins", true, "UNCERTAIN_SESSION"],
])
  test(`the pinned adapter trusts a reconciliation receipt only with ${name}`, async (t) => {
    const f = codingFixture(t);
    const { PinnedCodingRuntime } = await import(
      "../dist/feature-candidate.js"
    );
    let runs = 0;
    const transport = turnTransport(f, async (request) => {
      if ((runs += 1) > 1) throw Error("synthetic stream loss");
      return failedTurn(request);
    });
    transport.recoverInterruptedResume = async () => {
      throw Error("Native resume recovery is uncertain");
    };
    transport.reconcileInterruptedResume = async (session) => ({
      operationId: session.operationId,
      fence: session.fence,
      outcome: "adopted",
      pins: pinsChanged
        ? { ...f.runtime.pins, cliSha256: "f".repeat(64) }
        : { ...f.runtime.pins },
    });
    f.controller = controllerFor(
      f,
      new PinnedCodingRuntime(f.runtime.pins, transport),
    );
    await planAndValidate(f);
    await f.controller.codeFeature(f.delivery.id);
    const settled = await f.controller.codeFeature(f.delivery.id);
    assert.equal(settled.blocker.code, code);
  });

test("a reconciliation receipt for another operation leaves the resume unverified", async (t) => {
  const resume = await resumable(t);
  resume.f.runtime.recover = async () => {
    throw Error("Native resume recovery is uncertain");
  };
  resume.f.runtime.reconcile = async (session) => ({
    operationId: session.resumeFrom.operationId,
    fence: session.fence,
    outcome: "adopted",
  });
  resume.next(unlaunchedTurn);
  const settled = await resume.f.controller.codeFeature(resume.f.delivery.id);
  assert.equal(settled.blocker.code, "UNCERTAIN_SESSION");
});

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
  assert.deepEqual(
    stopped.feature.usageInterruptions.map((i) => i.operationId),
    [operationId],
  );
  assert.equal(stopped.feature.session.threadId, firstThread, "work preserved");
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
async function routedCoding(t, turn = failedTurn) {
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
