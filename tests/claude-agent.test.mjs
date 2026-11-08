import assert from "node:assert/strict";
import { test } from "node:test";
import {
  claudeAgent,
  claudeCodeArgv,
  claudeCodeTools,
  claudeCodeTurn,
  claudeEventSummary,
  featureBranchName,
  featureBranchPattern,
} from "../dist/coding-agent.js";

const session = "0b5c0f3e-4a7d-4c2e-9f1a-6d8e2b3c4a5f";
const other = "1b5c0f3e-4a7d-4c2e-9f1a-6d8e2b3c4a5f";
/** A synthetic stream-json turn in Claude Code's shape, with text, tool
 * inputs and tool output that the summary must drop. */
const raw = (id = session) => [
  {
    type: "system",
    subtype: "init",
    session_id: id,
    model: "claude-opus-5-5",
    tools: [...claudeCodeTools],
    cwd: "/workspace",
  },
  {
    type: "assistant",
    session_id: id,
    parent_tool_use_id: null,
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "secret plan", signature: "sig" },
        { type: "text", text: "I will run the tests" },
        {
          type: "tool_use",
          id: "toolu_1",
          name: "Bash",
          input: { command: "npm test" },
        },
      ],
    },
  },
  {
    type: "user",
    session_id: id,
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "toolu_1", content: "ok 1" },
      ],
    },
  },
  { type: "system", subtype: "api_retry", session_id: id, attempt: 1 },
  { type: "system", subtype: "compact_boundary", session_id: id },
  {
    type: "assistant",
    session_id: id,
    message: { role: "assistant", content: [{ type: "text", text: "Done" }] },
  },
  {
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: 2,
    session_id: id,
    result: "Done",
    total_cost_usd: 0.12,
  },
];
const summaries = (events) => events.map(claudeEventSummary);
const turn = (events, exitCode = 0, expected) =>
  claudeCodeTurn({ exitCode, events: summaries(events) }, expected);

test("the locked Claude Code argv runs headless with a fixed tool set and no workspace settings", () => {
  const tools = "Bash,Read,Edit,Write,Glob,Grep";
  const base = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--model",
    "claude-opus-5-5",
    "--permission-mode",
    "dontAsk",
    "--tools",
    tools,
    "--allowedTools",
    tools,
    "--strict-mcp-config",
    "--setting-sources",
    "user",
  ];
  assert.deepEqual(claudeCodeArgv(undefined), base);
  assert.deepEqual(claudeCodeArgv(session), [...base, "--resume", session]);
  assert.deepEqual(claudeAgent.argv(session, { deliveryId: "x" }), [
    ...base,
    "--resume",
    session,
  ]);
  assert.throws(() => claudeCodeArgv("--fork-session"), /Invalid coding/);
  assert.equal(claudeAgent.provider, "claude");
});

test("a summary keeps a turn's structure and drops its content", () => {
  const kept = summaries(raw());
  const text = JSON.stringify(kept);
  for (const secret of ["secret plan", "npm test", "ok 1", "I will", "Done"])
    assert.equal(text.includes(secret), false, secret);
  assert.deepEqual(kept[0], {
    type: "system",
    subtype: "init",
    session_id: session,
  });
  assert.deepEqual(kept[1].message, {
    role: "assistant",
    content: [{ type: "thinking" }, { type: "text" }, { type: "tool_use" }],
  });
  assert.equal(kept[5].parent_tool_use_id, null);
  assert.deepEqual(kept.at(-1), {
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: 2,
    session_id: session,
  });
  assert.deepEqual(
    claudeEventSummary({
      type: "user",
      session_id: session,
      message: { role: "user", content: "plain" },
    }).message,
    { role: "user", content: [{ type: "text" }] },
  );
  assert.deepEqual(
    claudeEventSummary({ type: "assistant", message: "x" }).message,
    { role: undefined, content: null },
  );
  assert.deepEqual(
    claudeEventSummary({ type: "assistant", message: { content: [5] } }).message
      .content,
    [{ type: null }],
  );
  assert.deepEqual(claudeEventSummary({ type: "stream_event", event: {} }), {
    type: "stream_event",
    session_id: undefined,
  });
  assert.throws(() => claudeEventSummary([]), /Invalid coding frame/);
  assert.throws(() => claudeEventSummary(null), /Invalid coding frame/);
});

test("a completed turn names its session; a failed, refused or unfinished one does not complete", () => {
  assert.deepEqual(turn(raw()), { threadId: session, completed: true });
  assert.deepEqual(turn(raw(), 0, session), {
    threadId: session,
    completed: true,
  });
  assert.equal(turn(raw(), 1).completed, false);
  const failed = raw();
  failed[6] = {
    ...failed[6],
    subtype: "error_during_execution",
    is_error: true,
  };
  assert.equal(turn(failed).completed, false);
  const flagged = raw();
  flagged[6] = { ...flagged[6], is_error: true };
  assert.equal(turn(flagged).completed, false);
  const budget = raw();
  budget[6] = { ...budget[6], subtype: "error_max_budget_usd", is_error: true };
  assert.equal(turn(budget).completed, false);
  // Killed before its result: the session is still named for a resume.
  assert.deepEqual(turn(raw().slice(0, 3)), {
    threadId: session,
    completed: false,
  });
});

test("a turn is refused unless its transcript is exactly a Claude Code session", () => {
  const refuses = (events, pattern, expected) =>
    assert.throws(() => turn(events, 0, expected), pattern);
  refuses([], /Missing coding session/);
  refuses(raw().slice(1), /Invalid coding session/);
  refuses(raw(), /Invalid coding session/, other);
  refuses(raw("not-a-uuid"), /Invalid coding session/);
  const wrongSession = raw();
  wrongSession[2] = { ...wrongSession[2], session_id: other };
  refuses(wrongSession, /Invalid coding session/);
  const secondInit = raw();
  secondInit.splice(2, 0, {
    type: "system",
    subtype: "init",
    session_id: session,
  });
  refuses(secondInit, /Unsupported coding event/);
  const hook = raw();
  hook.splice(2, 0, {
    type: "system",
    subtype: "hook_response",
    session_id: session,
  });
  refuses(hook, /Unsupported coding event/);
  const partial = raw();
  partial.splice(2, 0, { type: "stream_event", session_id: session });
  refuses(partial, /Unsupported coding event/);
  const subagent = raw();
  subagent[1] = { ...subagent[1], parent_tool_use_id: "toolu_9" };
  refuses(subagent, /Unsupported coding item/);
  const role = raw();
  role[1] = { ...role[1], message: { ...role[1].message, role: "user" } };
  refuses(role, /Unsupported coding item/);
  const serverTool = raw();
  serverTool[1].message.content.push({ type: "server_tool_use" });
  refuses(serverTool, /Unsupported coding item/);
  const userToolUse = raw();
  userToolUse[2].message.content.push({ type: "tool_use" });
  refuses(userToolUse, /Unsupported coding item/);
  const noMessage = raw();
  noMessage[1] = { type: "assistant", session_id: session };
  refuses(noMessage, /Unsupported coding item/);
  const unknownResult = raw();
  unknownResult[6] = {
    ...unknownResult[6],
    subtype: "error_max_structured_output_retries",
  };
  refuses(unknownResult, /Invalid coding completion/);
  const noFlag = raw();
  delete noFlag[6].is_error;
  refuses(noFlag, /Invalid coding completion/);
  refuses([...raw(), raw()[1]], /Invalid coding ordering/);
  assert.throws(
    () => claudeCodeTurn({ exitCode: 0, events: [5] }),
    /Invalid coding ordering/,
  );
  assert.throws(
    () => claudeCodeTurn({ exitCode: 0, events: "x" }),
    /Invalid coding events/,
  );
  assert.throws(
    () => claudeCodeTurn({ exitCode: 0, events: Array(4097).fill({}) }),
    /Invalid coding events/,
  );
  assert.throws(
    () =>
      claudeCodeTurn({
        exitCode: 0,
        events: [
          {
            type: "system",
            subtype: "init",
            session_id: session,
            pad: "x".repeat(65536),
          },
        ],
      }),
    /Invalid coding events/,
  );
});

test("the init event binds the turn's session", () => {
  const init = raw()[0];
  assert.equal(claudeAgent.bindsThread(init), true);
  assert.equal(claudeAgent.boundThread(init), session);
  assert.equal(
    claudeAgent.boundThread({ ...init, session_id: "nope" }),
    undefined,
  );
  assert.equal(claudeAgent.boundThread({ ...init, session_id: 5 }), undefined);
  assert.equal(claudeAgent.bindsThread(raw()[1]), false);
  assert.equal(claudeAgent.boundThread(raw()[1]), undefined);
  assert.equal(claudeAgent.bindsThread(null), false);
  assert.equal(
    claudeAgent.bindsThread({ type: "system", subtype: "api_retry" }),
    false,
  );
});

test("new feature branches are aios/feature-<id>; Codex-era branches stay valid", () => {
  const id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  assert.equal(featureBranchName(id), `aios/feature-${id}`);
  assert.equal(featureBranchPattern.test(featureBranchName(id)), true);
  assert.equal(featureBranchPattern.test(`codex/feature-${id}`), true);
  for (const bad of [
    `main`,
    `aios/feature-`,
    `other/feature-${id}`,
    `aios/feature-${id}/x`,
  ])
    assert.equal(featureBranchPattern.test(bad), false, bad);
});
