import assert from "node:assert/strict";
import { test } from "node:test";
import {
  recordedProvider,
  sessionProvider,
} from "../dist/feature-candidate.js";

test("a session without a provider ran Codex, and Codex records none", () => {
  const session = {
    operationId: "o",
    fence: 1,
    state: "stopped",
    intent: "start",
  };
  assert.equal(sessionProvider(session), "codex");
  assert.equal(sessionProvider({ ...session, provider: "claude" }), "claude");
  assert.deepEqual(recordedProvider("codex"), {});
  assert.deepEqual(recordedProvider("claude"), { provider: "claude" });
});
