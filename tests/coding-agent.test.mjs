import assert from "node:assert/strict";
import { test } from "node:test";
import { codexAgent } from "../dist/coding-agent.js";
import {
  codingTurn,
  lockedCodingArgv,
  recordedProvider,
  sessionProvider,
} from "../dist/feature-candidate.js";
import { assessSubscription } from "../dist/subscription.js";

const thread = "11111111-2222-4333-8444-555555555555";

test("the Codex agent is the existing locked argv and turn contract", () => {
  assert.equal(codexAgent.provider, "codex");
  assert.equal(codexAgent.argv, lockedCodingArgv);
  assert.equal(codexAgent.turn, codingTurn);
  assert.ok(Object.isFrozen(codexAgent));
});

test("the Codex agent binds only a valid thread.started event", () => {
  const started = { type: "thread.started", thread_id: thread };
  assert.equal(codexAgent.bindsThread(started), true);
  assert.equal(codexAgent.boundThread(started), thread);
  const malformed = { type: "thread.started", thread_id: "x" };
  // A malformed binding still claims to bind, so the runtime refuses it.
  assert.equal(codexAgent.bindsThread(malformed), true);
  assert.equal(codexAgent.boundThread(malformed), undefined);
  for (const event of [null, "x", { type: "turn.started" }]) {
    assert.equal(codexAgent.bindsThread(event), false);
    assert.equal(codexAgent.boundThread(event), undefined);
  }
});

test("a session without a provider ran Codex, and Codex records none", () => {
  const session = {
    operationId: "o",
    fence: 1,
    state: "stopped",
    intent: "start",
  };
  assert.equal(sessionProvider(session), "codex");
  assert.equal(sessionProvider({ ...session, provider: "codex" }), "codex");
  assert.deepEqual(recordedProvider("codex"), {});
  assert.deepEqual(recordedProvider("claude-code"), {
    provider: "claude-code",
  });
});

test("usage is assessed only for an accepted auth mode", () => {
  const now = Date.now();
  const observation = {
    observedAt: new Date(now).toISOString(),
    accountId: "account",
    authMode: "chatgpt",
    windows: [
      {
        id: "primary",
        usedPercent: 10,
        resetsAt: Math.floor(now / 1000) + 3600,
      },
    ],
    exhausted: false,
  };
  assert.equal(assessSubscription(observation, now).decision, "ready");
  const refused = assessSubscription(observation, now, []);
  assert.equal(refused.decision, "approval-required");
  assert.equal(refused.accountId, undefined);
  assert.equal(
    assessSubscription({ ...observation, authMode: "other" }, now).decision,
    "approval-required",
  );
});
