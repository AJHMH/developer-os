// Slice 4b lapse revocation of routed turns. Split from
// zz-usage-coding-session.test.mjs to keep Windows shard 7 under its time
// limit; the name sorts after every other test file, so no other file
// changes shard.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { failedTurn, firstThread } from "./helpers/coding-turns.mjs";
import {
  observeAccount,
  routedCoding,
  interruptions,
} from "./helpers/routed-coding.mjs";

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
  // Windows reports no POSIX permission bits (any writable file is 0o666).
  if (process.platform !== "win32")
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
