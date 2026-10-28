// Coding sessions: explicit resume, recovery and reconciliation, and retired
// lineage cleanup. Split from feature-candidate.test.mjs so these slower
// controller tests run on another Windows test shard. The `zz-` prefix sorts
// it near the end, so few other files change shard. Usage authority,
// monitoring, restart approval, mediation and routed sessions are in
// zz-usage-coding-session.test.mjs.
import { planAndValidate } from "./helpers/validation-fixture.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { DeliveryController } from "../dist/controller.js";
import { codingFixture } from "./helpers/feature-fixture.mjs";
import { failedTurn, firstThread } from "./helpers/coding-turns.mjs";

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
