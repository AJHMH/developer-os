import assert from "node:assert/strict";
import { test } from "node:test";
import {
  claudeGuest,
  claudeManagementPolicySha256,
  codexGuest,
  managementPolicySha256,
} from "../dist/podman-coding.js";
import {
  claudeCodeArgv,
  claudeCodeTurn,
  claudeEventSummary,
} from "../dist/coding-agent.js";
import { hostTargets } from "../dist/host-target.js";
import {
  realMkdirSync,
  realReadFileSync,
  realWriteFileSync,
  guestFixture,
  launchRequest,
  session,
} from "./helpers/native-coding-fixture.mjs";

// The Claude Code guest (ADR 0008), offline, against the external Linux and
// Podman simulator. The routed guest is in worker-native-claude-route.test.mjs.
const sessionId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const resumedOperation = "22345678-1234-4234-8234-123456789abc";
const branch = "aios/feature-12345678-1234-4234-8234-123456789abc";
const claudeFixture = (t, engine = {}) =>
  guestFixture(t, { threadId: sessionId, ...engine }, undefined, claudeGuest);
const start = (transport, overrides = {}) =>
  launchRequest(transport, {
    argv: [...claudeCodeArgv(undefined), "Change the title"],
    branch,
    ...overrides,
  });
const resume = (transport, overrides = {}) =>
  launchRequest(transport, {
    operationId: resumedOperation,
    fence: 2,
    intent: "resume",
    threadId: sessionId,
    resumeFrom: { ...session, state: "stopped" },
    argv: [...claudeCodeArgv(sessionId), "Continue the title"],
    branch,
    ...overrides,
  });
const home = (read) =>
  read().container.Mounts.find((m) => m.Destination === "/session").Source;
const events = (output) =>
  Buffer.concat(output)
    .toString()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));

test("the Codex guest program is unchanged, and Claude Code's is its own", () => {
  // The digest the Codex owner coding admission pins today.
  assert.equal(
    managementPolicySha256,
    "89f2db6033e05941ec94dbb11e0215a1161d469429b85af47ba8fff5442c6a1c",
  );
  assert.equal(codexGuest.policySha256, managementPolicySha256);
  assert.equal(claudeGuest.policySha256, claudeManagementPolicySha256);
  assert.notEqual(claudeManagementPolicySha256, managementPolicySha256);
  assert.equal(claudeGuest.provider, "claude");
  assert.ok(!claudeGuest.program.includes("codex-0.161.0"));
  assert.ok(!claudeGuest.program.includes("CODEX_HOME"));
  assert.ok(
    claudeGuest.program.includes(
      `aios-offline-v1/claude-${hostTargets.darwin.claudeCode.version}'`,
    ),
  );
});

test("an offline Claude Code turn runs the pinned binary and only a summary leaves the guest", async (t) => {
  const { transport, read } = claudeFixture(t);
  const pins = await transport.inspect(session);
  assert.deepEqual(Object.keys(pins), [
    "cliVersion",
    "cliSha256",
    "policySha256",
    "bindingSha256",
  ]);
  assert.equal(pins.cliVersion, "2.1.311");
  assert.equal(pins.cliSha256, hostTargets.darwin.claudeCode.sha256);
  assert.equal(pins.policySha256, claudeManagementPolicySha256);
  const output = [];
  const result = await transport.run(await start(transport), (bytes) =>
    output.push(bytes),
  );
  assert.equal(result.exitCode, 1);
  const text = Buffer.concat(output).toString();
  for (const secret of [
    "secret-candidate-text",
    "secret-tool-input",
    "secret-result",
    "/workspace",
  ])
    assert.ok(!text.includes(secret), secret);
  const summarized = events(output);
  assert.deepEqual(summarized, [
    { type: "system", subtype: "init", session_id: sessionId },
    {
      type: "assistant",
      session_id: sessionId,
      parent_tool_use_id: null,
      message: {
        role: "assistant",
        content: [{ type: "text" }, { type: "tool_use" }],
      },
    },
    {
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      num_turns: 1,
      session_id: sessionId,
    },
  ]);
  assert.deepEqual(
    claudeCodeTurn({ exitCode: result.exitCode, events: summarized }),
    { threadId: sessionId, completed: false },
  );
  const worker = read().container;
  assert.deepEqual(worker.Config.Cmd.slice(4), [
    ...claudeCodeArgv(undefined),
    "Change the title",
  ]);
  assert.match(worker.Config.Cmd[2], /exec \/claude "\$@"$/);
  assert.deepEqual(worker.Mounts.map((m) => [m.Destination, m.RW]).sort(), [
    ["/claude", false],
    ["/session", true],
    ["/workspace", true],
  ]);
  assert.ok(worker.Config.Env.includes("CLAUDE_CONFIG_DIR=/session"));
  assert.ok(
    worker.Config.Env.includes("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1"),
  );
  assert.ok(!worker.Config.Env.some((e) => e.startsWith("CODEX_HOME=")));
  // Claude Code's Bash tool needs bash: the worker runs the pinned official
  // bash image, with its entrypoint cleared and SHELL naming its bash.
  assert.ok(worker.Config.Env.includes("SHELL=/usr/local/bin/bash"));
  const create = read().commands.find((args) => args[1] === "create");
  assert.ok(create.includes(hostTargets.darwin.claudeCode.template));
  assert.ok(!create.includes(hostTargets.darwin.offlineTemplate));
  assert.ok(create.includes("--entrypoint="));
  assert.deepEqual(worker.Config.Entrypoint, [""]);
  assert.equal(worker.HostConfig.NetworkMode, "none");
  const collected = await transport.collect({ ...session, state: "stopped" });
  assert.equal(collected.files[0].bytes.toString(), "after\n");
});

test("the guest's summary matches claudeEventSummary and drops what is not an event", async (t) => {
  const raw = [
    { type: "system", subtype: "init", session_id: sessionId, cwd: "/x" },
    {
      type: "user",
      session_id: sessionId,
      message: { role: "user", content: "plain prompt" },
    },
    { type: "assistant", session_id: sessionId, message: "not an object" },
    {
      type: "assistant",
      session_id: sessionId,
      parent_tool_use_id: "toolu_9",
      message: { content: [5, { type: "thinking", thinking: "x" }, {}] },
    },
    { type: "stream_event", event: { delta: "partial" } },
    { type: "system", subtype: "api_retry", attempt: 2 },
    { subtype: "orphan" },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      num_turns: 3,
      session_id: sessionId,
      total_cost_usd: 1.5,
    },
  ];
  const { transport } = claudeFixture(t, {
    claudeLogs: [
      raw[0],
      "not json",
      "[1,2]",
      '{"type":"system","value":NaN}',
      ...raw.slice(1),
    ],
    // A partial final line is not evidence.
    claudeTail: '{"type":"result"',
  });
  const output = [];
  await transport.run(await start(transport), (bytes) => output.push(bytes));
  // As it crosses the wire: JSON has no undefined members.
  assert.deepEqual(
    events(output),
    raw.map((event) => JSON.parse(JSON.stringify(claudeEventSummary(event)))),
  );
});

test("a resume carries the conversation over and drops what Claude Code regenerates", async (t) => {
  const { transport, read } = claudeFixture(t);
  await transport.run(await start(transport), () => {});
  const original = home(read);
  realMkdirSync(`${original}/projects/-workspace`, { recursive: true });
  realWriteFileSync(
    `${original}/projects/-workspace/${sessionId}.jsonl`,
    "conversation",
  );
  realWriteFileSync(`${original}/.claude.json`, "{}");
  realMkdirSync(`${original}/shell-snapshots`, { recursive: true });
  realWriteFileSync(`${original}/shell-snapshots/snapshot-bash.sh`, "planted");
  // Claude Code's own built-in plugin state (plugins/store on the real CLI),
  // and anything a turn added beside it, never reach the next turn.
  realMkdirSync(`${original}/plugins/store`, { recursive: true });
  realWriteFileSync(`${original}/plugins/store/builtin.json`, "{}");
  realMkdirSync(`${original}/plugins/cache/planted`, { recursive: true });
  const output = [];
  await transport.run(await resume(transport), (bytes) => output.push(bytes));
  assert.equal(events(output)[0].session_id, sessionId);
  const resumed = home(read);
  assert.notEqual(resumed, original);
  assert.equal(
    realReadFileSync(
      `${resumed}/projects/-workspace/${sessionId}.jsonl`,
      "utf8",
    ),
    "conversation",
  );
  assert.equal(realReadFileSync(`${resumed}/.claude.json`, "utf8"), "{}");
  assert.throws(() =>
    realReadFileSync(`${resumed}/shell-snapshots/snapshot-bash.sh`),
  );
  assert.throws(() =>
    realReadFileSync(`${resumed}/plugins/store/builtin.json`),
  );
  assert.deepEqual(read().container.Config.Cmd.slice(4), [
    ...claudeCodeArgv(sessionId),
    "Continue the title",
  ]);
});

for (const planted of [
  "settings.json",
  "CLAUDE.md",
  "agents",
  "hooks",
  ".mcp.json",
])
  test(`a resume refuses a retained home that would configure the next turn: ${planted}`, async (t) => {
    const { transport, read } = claudeFixture(t);
    await transport.run(await start(transport), () => {});
    const original = home(read);
    if (planted.includes("."))
      realWriteFileSync(`${original}/${planted}`, "{}");
    else realMkdirSync(`${original}/${planted}`);
    await assert.rejects(transport.run(await resume(transport), () => {}));
    assert.equal(
      read().commands.filter((args) => args[1] === "create").length,
      1,
    );
  });

test("the Claude Code guest refuses what is not exactly its launch", async (t) => {
  const { transport, read } = claudeFixture(t);
  const refused = async (overrides, gateway, pattern) =>
    assert.rejects(
      transport.run(await start(transport, overrides), () => {}, gateway),
      pattern,
    );
  // A model route without its gateway.
  await refused(
    {
      modelRoute: {
        deliveryId: "12345678-1234-4234-8234-123456789abc",
        capability: "f".repeat(64),
        decisionSha256: "d".repeat(64),
      },
    },
    undefined,
    /Unsupported native coding launch/,
  );
  // Codex's argv, or another branch namespace.
  await refused(
    {
      argv: [
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--sandbox",
        "workspace-write",
        "Change the title",
      ],
    },
    undefined,
    /Unsupported native coding launch/,
  );
  await refused({ branch: "other/feature-x" }, undefined, /Unsupported/);
  await refused(
    { argv: [...claudeCodeArgv(undefined), "--add-dir=/"] },
    undefined,
    /Unsupported/,
  );
  assert.equal(
    read().commands.filter((args) => args[1] === "create").length,
    0,
  );
  // A Codex-era branch still codes under Claude Code.
  await transport.run(
    await start(transport, { branch: "codex/feature-x" }),
    () => {},
  );
});

for (const [name, claudeLogs] of [
  [
    "a second init",
    [
      { type: "system", subtype: "init", session_id: sessionId },
      { type: "system", subtype: "init", session_id: sessionId },
    ],
  ],
  [
    "a session that is not a UUID",
    [{ type: "system", subtype: "init", session_id: "not-a-uuid" }],
  ],
  [
    "a summary over the stream bound",
    [
      { type: "system", subtype: "init", session_id: sessionId },
      ...Array.from({ length: 700 }, () => ({
        type: "assistant",
        session_id: sessionId,
        message: { role: "assistant", content: [{ type: "text", text: "x" }] },
      })),
    ],
  ],
])
  test(`the guest refuses ${name}`, async (t) => {
    const { transport, read } = claudeFixture(t, { claudeLogs });
    await assert.rejects(transport.run(await start(transport), () => {}));
    // The worker is still stopped.
    assert.equal(read().container.State.Running, false);
  });

test("the Claude Code guest runs only the pinned bash image with its exact environment", async (t) => {
  assert.match(
    hostTargets.darwin.claudeCode.template,
    /^docker\.io\/library\/bash@sha256:[a-f0-9]{64}$/,
  );
  assert.equal(
    claudeGuest.template({
      ...hostTargets.darwin,
      platform: "darwin",
      arch: "arm64",
    }),
    hostTargets.darwin.claudeCode.template,
  );
  // Codex keeps the shared Alpine template.
  assert.equal(
    codexGuest.template(hostTargets.darwin),
    hostTargets.darwin.offlineTemplate,
  );
  // An image whose environment is not exactly the pinned one is refused
  // before any worker exists.
  const { transport, read } = claudeFixture(t, { imageEnvDrift: true });
  await assert.rejects(
    async () => transport.run(await start(transport), () => {}),
    /inspect observation unavailable/,
  );
  assert.equal(
    (read().commands ?? []).filter((args) => args[1] === "create").length,
    0,
  );
});

for (const entrypoint of [null, [], ["docker-entrypoint.sh"], ["/bin/sh"]])
  test(`a Claude Code worker whose entrypoint is ${JSON.stringify(entrypoint)} never starts`, async (t) => {
    // Only the cleared entrypoint, as Podman records --entrypoint=: the bash
    // image's own entrypoint never runs before the worker's command.
    const { transport, read } = claudeFixture(t, { entrypoint });
    await assert.rejects(transport.run(await start(transport), () => {}));
    assert.equal(
      read().commands.filter((args) => args[1] === "start").length,
      0,
    );
  });
