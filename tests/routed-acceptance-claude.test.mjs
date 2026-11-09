import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { claudeCodeArgv, claudeCodeTools } from "../dist/coding-agent.js";
import { MessagesRefusal } from "../dist/messages-gateway.js";
import { pinnedModelPrices } from "../dist/spend-budget.js";
import { claudeCodingBoundaryProbeNames } from "../dist/worker-probes.js";
import {
  passingOutcome,
  routedAcceptance,
  stageNames,
} from "../scripts/run-native-routed-acceptance.mjs";
import {
  fakeMessagesProvider,
  maxKeepalives,
} from "../scripts/routed-provider.mjs";

// The routed acceptance for Claude Code (ADR 0008): each turn's Messages
// requests reach a real MessagesGateway, whose fake provider calls Claude
// Code's own Write and Bash tools.
const pins = {
  cliVersion: "2.1.311",
  cliSha256: "1".repeat(64),
  policySha256: "2".repeat(64),
  bindingSha256: "3".repeat(64),
};
const model = pinnedModelPrices.model;
const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

/** The content blocks a provider answer carries, as Claude Code assembles
 * them from the stream. */
async function blocksOf(stream) {
  let text = "";
  for await (const chunk of stream) text += Buffer.from(chunk).toString();
  const blocks = [];
  let stopReason;
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const event = JSON.parse(line.slice(6));
    if (event.type === "content_block_start")
      blocks[event.index] = { ...event.content_block };
    else if (event.type === "content_block_delta") {
      const block = blocks[event.index];
      if (event.delta.type === "input_json_delta")
        block.json = (block.json ?? "") + event.delta.partial_json;
      else block.text += event.delta.text;
    } else if (event.type === "content_block_stop") {
      const block = blocks[event.index];
      if (block.json !== undefined) {
        block.input = JSON.parse(block.json);
        delete block.json;
      }
    } else if (event.type === "message_delta")
      stopReason = event.delta.stop_reason;
  }
  return { blocks, stopReason };
}

/** Runs one tool call over `files`, as Claude Code's tools would. */
async function runTool(block, files, faults) {
  if (faults.toolsFail) return { content: "Tool failed", is_error: true };
  if (block.name === "Write") {
    const path = block.input.file_path.replace(/^\/workspace\//, "");
    files.set(path, Buffer.from(block.input.content));
    return {
      content: `File created successfully at: ${block.input.file_path}`,
    };
  }
  if (block.name === "Bash") {
    const read = /^cat \/workspace\/(.+)$/.exec(block.input.command);
    if (read) return { content: files.get(read[1])?.toString() ?? "" };
    if (/^sleep \d+$/.test(block.input.command)) {
      await tick();
      return { content: "" };
    }
  }
  return { content: "Unknown tool", is_error: true };
}

/** A fake VM whose Claude Code sends Messages requests to the real gateway it
 * is given; `faults` breaks one property. */
function vm(faults = {}) {
  const effects = [];
  const sessions = new Map();
  const histories = new Map();
  const state = (session) => sessions.get(session.operationId);
  const tools = claudeCodeTools.map((name) => ({
    name,
    description: name,
    input_schema: { type: "object", properties: {} },
  }));
  const transport = {
    async inspect() {
      return { ...pins };
    },
    async run(request, stdout, gateway) {
      assert.ok(request.modelRoute && gateway, "a routed turn has a gateway");
      assert.notEqual(gateway.capability, request.modelRoute.capability);
      assert.deepEqual(
        request.argv.slice(0, -1),
        claudeCodeArgv(request.threadId),
      );
      assert.match(request.branch, /^aios\//);
      effects.push("run:" + request.intent);
      const files = new Map(
        request.files.map((f) => [f.path, Buffer.from(f.bytes)]),
      );
      const session = { phase: "running", files, processes: 2 };
      sessions.set(request.operationId, session);
      const id =
        request.threadId && !faults.newThread ? request.threadId : randomUUID();
      // The guest's summary of Claude Code's init event.
      if (!faults.noInit)
        stdout(
          Buffer.from(
            JSON.stringify({
              type: "system",
              subtype: "init",
              session_id: id,
            }) + "\n",
          ),
        );
      const messages = [
        ...(histories.get(request.threadId) ?? []),
        { role: "user", content: request.argv.at(-1) },
      ];
      let exitCode = 1;
      try {
        if (faults.sideRequest)
          // A request outside the turn's steps, such as a title.
          await blocksOf(
            await gateway.respond(
              request.modelRoute.deliveryId,
              gateway.capability,
              JSON.stringify({
                model,
                messages: [{ role: "user", content: "Title?" }],
                max_tokens: 32,
                stream: true,
              }),
            ),
          );
        for (let n = 0; n < 200; n++) {
          if (!request.checkpoint())
            throw Error("Native coding run stopped by its gate");
          let answer;
          try {
            answer = await blocksOf(
              await gateway.respond(
                request.modelRoute.deliveryId,
                gateway.capability,
                JSON.stringify({
                  model,
                  system: [{ type: "text", text: "Claude Code" }],
                  messages,
                  tools,
                  max_tokens: 32000,
                  stream: true,
                }),
              ),
            );
          } catch (error) {
            assert.ok(error instanceof MessagesRefusal, String(error));
            return { exitCode };
          }
          messages.push({ role: "assistant", content: answer.blocks });
          if (answer.stopReason !== "tool_use") {
            exitCode = faults.exitsNonZero ? 2 : 0;
            break;
          }
          const results = [];
          for (const block of answer.blocks.filter(
            (b) => b.type === "tool_use",
          ))
            results.push({
              type: "tool_result",
              tool_use_id: block.id,
              ...(await runTool(block, files, faults)),
            });
          messages.push({ role: "user", content: results });
          // As Claude Code 2.1.309 does: its environment follows the results.
          if (!faults.noTrailingSystem)
            messages.push({ role: "system", content: "# Environment" });
          await tick();
        }
        histories.set(id, messages);
        return { exitCode };
      } finally {
        gateway.revoke("stopped");
        session.phase = "stopped";
        session.processes = 0;
      }
    },
    async observeSession(session) {
      const s = state(session);
      if (!s)
        throw Error("Native coding observe-session observation unavailable");
      return {
        phase: s.phase,
        running: s.phase === "running",
        remainingProcesses: s.processes,
        processesGone: s.processes === 0,
        pins: { ...pins },
      };
    },
    async probeBoundary(session, path) {
      const s = state(session);
      if (s?.phase !== "running")
        throw Error("Native coding probe-boundary observation unavailable");
      effects.push("probe:" + path);
      const onlyAdmitted = [...s.files.keys()].join() === path;
      for (let i = 0; i < 10; i++) await tick();
      return {
        probes: claudeCodingBoundaryProbeNames.map((name) => ({
          name,
          outcome:
            name === "only-admitted" && !onlyAdmitted ? "failed" : "passed",
        })),
        processes: 3,
        pins: { ...pins },
      };
    },
    async collect(session) {
      const s = state(session);
      return {
        complete: true,
        files: [...s.files].map(([path, bytes]) => ({ path, bytes })),
      };
    },
    async cleanupSupersededLineage() {
      effects.push("cleanup");
      return { cleaned: 2 };
    },
    async stop(session) {
      const s = state(session);
      if (s) s.phase = "stopped";
      return { stopped: true, remainingProcesses: 0 };
    },
  };
  return { transport, effects };
}

async function accept(faults = {}) {
  const { transport, effects } = vm(faults);
  const report = await routedAcceptance(
    {
      transport,
      admission: { pins: () => faults.record ?? { ...pins } },
      agent: "claude",
    },
    { pause: tick },
  );
  return { report, effects };
}

test("a routed Claude Code lineage, its tools, probe and stops through the MessagesGateway passes", async () => {
  const { report, effects } = await accept();
  assert.equal(report.outcome, passingOutcome, report.error);
  assert.equal(report.agent, "claude");
  assert.ok(report.stages.every((s) => s.outcome === "passed"));
  assert.deepEqual(
    report.stages.map((s) => s.name),
    [...stageNames],
  );
  assert.deepEqual(
    report.probes.map((p) => p.name),
    [...claudeCodingBoundaryProbeNames],
  );
  assert.deepEqual(effects.slice(0, 2), ["run:start", "probe:canary.txt"]);
  for (const turn of [report.launch, report.resume]) {
    assert.equal(turn.exitCode, 0);
    assert.equal(turn.threads, 1);
    assert.equal(turn.provider.toolsWorked, true);
    assert.equal(turn.provider.finalAnswered, true);
    assert.equal(turn.provider.unexpected, 0);
    assert.equal(turn.gateway.revokedFor, "stopped");
    assert.deepEqual(turn.gateway.refusals, {});
    assert.equal(turn.refusedAfterStop, "revoked");
  }
  // The resume: Write, Bash, then the final answer, with no keep-alive.
  assert.equal(report.resume.provider.keepalives, 0);
  assert.equal(report.resume.provider.requests, 3);
  assert.deepEqual(report.launch.collected, [
    "canary.txt",
    "routed-launch.txt",
  ]);
  assert.deepEqual(report.resume.collected, [
    "canary.txt",
    "routed-resume.txt",
  ]);
  const text = JSON.stringify(report);
  assert.doesNotMatch(text, /routed launch\\n|sk-ant-|tool_use/);
});

for (const [name, faults, stage] of [
  ["tools that fail", { toolsFail: true }, "routed-launch-tools-ran"],
  ["a resume that starts a new session", { newThread: true }, "routed-resume"],
  ["a turn with no init event", { noInit: true }, "routed-launch-live-probe"],
  [
    "a record naming other Claude pins",
    { record: { ...pins, policySha256: "9".repeat(64) } },
    "owner-record-names-fresh-pins",
  ],
])
  test(`a Claude Code lineage with ${name} blocks at ${stage}`, async () => {
    const { report } = await accept(faults);
    assert.equal(report.outcome, "blocked");
    assert.equal(
      report.stages.filter((s) => s.outcome !== "not-run").at(-1).name,
      stage,
    );
  });

test("a request outside the turn's steps is counted, and fails the tools stage", async () => {
  const { report } = await accept({ sideRequest: true });
  assert.equal(report.launch.provider.unexpected, 1);
  assert.equal(report.outcome, "blocked");
});

test("the fake Messages provider keeps the turn alive until released, writes, reads back, then ends it", async () => {
  let released = false;
  const fake = fakeMessagesProvider("t", () => released, model);
  const ask = async (messages) => {
    let text = "";
    for await (const chunk of fake.provider(
      "unused",
      JSON.stringify({ messages }),
    ))
      text += Buffer.from(chunk).toString();
    const events = text
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => JSON.parse(l.slice(6)));
    assert.equal(events[0].message.model, model);
    const starts = events.filter((e) => e.type === "content_block_start");
    const input = events
      .filter((e) => e.delta?.type === "input_json_delta")
      .map((e) => JSON.parse(e.delta.partial_json));
    return {
      tool: starts[0]?.content_block,
      input: input[0],
      stop: events.find((e) => e.type === "message_delta").delta.stop_reason,
    };
  };
  const result = (id, content, extra = {}) => [
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: id, content, ...extra }],
    },
  ];
  const wait = await ask([{ role: "user", content: "go" }]);
  assert.equal(wait.tool.name, "Bash");
  assert.equal(wait.input.command, "sleep 5");
  released = true;
  const write = await ask(result(wait.tool.id, ""));
  assert.equal(write.tool.name, "Write");
  assert.deepEqual(write.input, {
    file_path: "/workspace/routed-t.txt",
    content: "routed t\n",
  });
  const read = await ask(result(write.tool.id, "ok"));
  assert.equal(read.tool.name, "Bash");
  assert.equal(read.input.command, "cat /workspace/routed-t.txt");
  const done = await ask(
    result(read.tool.id, [{ type: "text", text: "routed t\n" }]),
  );
  assert.equal(done.stop, "end_turn");
  assert.equal(fake.observation.toolsWorked, true);
  assert.equal(fake.observation.finalAnswered, true);
  assert.equal(fake.observation.keepalives, 1);
  assert.equal(fake.observation.unexpected, 0);
});

test("the fake Messages provider credits only a successful read of the work file", async () => {
  for (const [content, extra] of [
    ["something else", {}],
    ["routed t\n", { is_error: true }],
  ]) {
    const fake = fakeMessagesProvider("t", () => true, model);
    const ids = [];
    const send = async (messages) => {
      let text = "";
      for await (const chunk of fake.provider(
        "unused",
        JSON.stringify({ messages }),
      ))
        text += Buffer.from(chunk).toString();
      const start = text
        .split("\n")
        .filter((l) => l.startsWith("data: "))
        .map((l) => JSON.parse(l.slice(6)))
        .find((e) => e.type === "content_block_start");
      ids.push(start.content_block.id);
    };
    await send([{ role: "user", content: "go" }]);
    await send([
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: ids[0], content: "ok" }],
      },
    ]);
    await send([
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: ids[1], content, ...extra },
        ],
      },
    ]);
    assert.equal(fake.observation.toolsWorked, false);
    assert.equal(fake.observation.finalAnswered, true);
  }
});

test("the fake Messages provider stops keeping the turn alive at its cap", async () => {
  const fake = fakeMessagesProvider("t", () => false, model);
  let id;
  for (let i = 0; i <= maxKeepalives; i++) {
    const messages = id
      ? [
          {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: id, content: "" }],
          },
        ]
      : [{ role: "user", content: "go" }];
    let text = "";
    for await (const chunk of fake.provider(
      "unused",
      JSON.stringify({ messages }),
    ))
      text += Buffer.from(chunk).toString();
    id = /"id":"(toolu_[^"]+)"/.exec(text)[1];
  }
  assert.equal(fake.observation.keepalives, maxKeepalives);
  assert.match(id, new RegExp(`_${maxKeepalives}$`));
});

test("the fake Messages provider finds tool results before a trailing system message", async () => {
  const fake = fakeMessagesProvider("t", () => true, model);
  const ids = [];
  const send = async (messages) => {
    let text = "";
    for await (const chunk of fake.provider(
      "unused",
      JSON.stringify({ messages }),
    ))
      text += Buffer.from(chunk).toString();
    const start = text
      .split("\n")
      .filter((l) => l.startsWith("data: "))
      .map((l) => JSON.parse(l.slice(6)))
      .find((e) => e.type === "content_block_start");
    ids.push(start.content_block.id);
  };
  const turn = (id, content) => [
    { role: "user", content: "go" },
    { role: "system", content: "# Environment" },
    {
      role: "assistant",
      content: [{ type: "tool_use", id, name: "Bash", input: {} }],
    },
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: id, content }],
    },
    { role: "system", content: "# Environment" },
  ];
  await send([
    { role: "user", content: "go" },
    { role: "system", content: "x" },
  ]);
  await send(turn(ids[0], "ok"));
  await send(turn(ids[1], [{ type: "text", text: "routed t\n" }]));
  assert.equal(fake.observation.unexpected, 0);
  assert.equal(fake.observation.toolsWorked, true);
  assert.equal(fake.observation.finalAnswered, true);
  // A result from before the last assistant turn does not count.
  const stale = fakeMessagesProvider("t", () => true, model);
  for await (const _ of stale.provider(
    "unused",
    JSON.stringify({
      messages: [
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "x", content: "" }],
        },
        { role: "assistant", content: [{ type: "text", text: "hi" }] },
        { role: "system", content: "x" },
      ],
    }),
  ));
  for await (const _ of stale.provider(
    "unused",
    JSON.stringify({
      messages: [
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "x", content: "" }],
        },
        { role: "assistant", content: [{ type: "text", text: "hi" }] },
        { role: "system", content: "x" },
      ],
    }),
  ));
  assert.equal(stale.observation.unexpected, 1);
});

test("a lineage passes whether or not Claude Code sends a trailing system message", async () => {
  const { report } = await accept({ noTrailingSystem: true });
  assert.equal(report.outcome, passingOutcome, report.error);
});

test("the coding admission acceptance meters one controller turn on Claude Code", async () => {
  const { admissionAcceptance } = await import(
    "../scripts/run-native-coding-admission-acceptance.mjs"
  );
  const { transport, effects } = vm();
  // The live transport contract: every receipt names its exact session and
  // pins, and a stop is trusted only after an independent census.
  const exact = (session, receipt) => ({
    operationId: session.operationId,
    fence: session.fence,
    ...receipt,
    pins: { ...pins },
  });
  const live = {
    ...transport,
    mode: "live",
    run: async (request, stdout, gateway) =>
      exact(request, await transport.run(request, stdout, gateway)),
    stop: async (session) => exact(session, await transport.stop(session)),
    observeSession: async (session) =>
      exact(session, {
        ...(await transport.observeSession(session)),
        timers: {
          lease: { loadState: "not-found", activeState: "inactive" },
          deadline: { loadState: "not-found", activeState: "inactive" },
        },
      }),
    cleanupSupersededLineage: async (session) => exact(session, { cleaned: 1 }),
  };
  const report = await admissionAcceptance(
    live,
    { pins: () => ({ ...pins }) },
    { agent: "claude" },
  );
  assert.equal(
    report.outcome,
    "observed-offline-admission-acceptance",
    report.error,
  );
  assert.equal(report.agent, "claude");
  assert.deepEqual(report.synthetic, [
    "planning",
    "validation",
    "onboarding",
    "model-provider",
  ]);
  assert.ok(report.stages.some((s) => s.name === "controller-metered-turn"));
  assert.ok(report.spend.spent > 0);
  assert.equal(report.delivery.sessionState, "stopped");
  assert.deepEqual(effects.slice(0, 1), ["run:start"]);
});
