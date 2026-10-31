// Slice 4d: the owner-run usage canary against a simulated VM, through the
// real controller and gateway. The name sorts after every other test file,
// so no other file changes shard.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { GeneralSessionRefusal } from "../dist/general-session-gateway.js";
import {
  passingOutcome,
  stageNames,
  usageCanary,
} from "../scripts/run-native-usage-canary.mjs";

const pins = {
  cliVersion: "0.161.0",
  cliSha256: "1".repeat(64),
  codeModeHostSha256: "6".repeat(64),
  policySha256: "2".repeat(64),
  bindingSha256: "3".repeat(64),
};
const sha256 = (v) => createHash("sha256").update(v).digest("hex");
const tick = () => new Promise((resolve) => setTimeout(resolve, 1));
const AsyncFunction = (async () => {}).constructor;
const captured = JSON.parse(
  readFileSync(
    new URL("./fixtures/codex-0.161.0-launch-request.json", import.meta.url),
    "utf8",
  ),
);
const opening = captured.input.filter(
  (item) => item.type === "additional_tools" || item.type === "message",
);

/** The SSE items a provider answer carries, in order. */
async function itemsOf(stream) {
  let text = "";
  for await (const chunk of stream) text += Buffer.from(chunk).toString();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)))
    .filter((event) => event.type === "response.output_item.done")
    .map((event) => event.item);
}

/** Runs a code-mode script against tools over `files`, as the code-mode
 * host would, and returns its text output. */
async function runScript(script, files) {
  const out = [];
  const tools = {
    async apply_patch(patch) {
      const added = /^\*\*\* Add File: (.+)\n((?:\+.*\n)*)/m.exec(patch);
      files.set(
        added[1],
        Buffer.from(
          added[2]
            .split("\n")
            .filter(Boolean)
            .map((line) => line.slice(1) + "\n")
            .join(""),
        ),
      );
      return "Success. Updated the following files:\nA " + added[1];
    },
    async exec_command({ cmd }) {
      const read = /^cat \/workspace\/(.+)$/.exec(cmd);
      if (read)
        return { output: files.get(read[1])?.toString() ?? "", exit_code: 0 };
      await tick();
      return { output: "", exit_code: 0 };
    },
  };
  await new AsyncFunction("tools", "text", script)(tools, (value) =>
    out.push(String(value)),
  );
  return out;
}

/** A fake VM whose Codex speaks the captured request shape to the real
 * gateway it is given, retrying refused requests until its gate stops it,
 * as Codex and the native poll loop do; `faults` breaks one property. */
function vm(faults = {}) {
  const sessions = new Map(),
    threads = new Map(),
    effects = [];
  const line = (event) => Buffer.from(JSON.stringify(event) + "\n");
  const transport = {
    mode: "live",
    async inspect() {
      return { ...pins };
    },
    async run(request, stdout, gateway) {
      if (!request.mayDispatch()) throw Error("Dispatch refused");
      assert.ok(request.modelRoute && gateway, "a routed turn has a gateway");
      // As the native transport: the relay's capability is its own.
      if (gateway.capability === request.modelRoute.capability)
        throw Error("Unsupported native coding launch");
      effects.push("run:" + request.intent);
      const files = new Map(
        request.files.map((f) => [f.path, Buffer.from(f.bytes)]),
      );
      const before = new Map(request.files.map((f) => [f.path, f.bytes]));
      const session = { phase: "running", files, before, processes: 2 };
      sessions.set(request.operationId, session);
      const thread = request.threadId ?? randomUUID();
      stdout(line({ type: "thread.started", thread_id: thread }));
      stdout(line({ type: "turn.started" }));
      const history = threads.get(request.threadId) ?? [...opening];
      threads.set(thread, history);
      history.push({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: request.argv.at(-1) }],
      });
      const done = (exitCode) => ({
        operationId: request.operationId,
        fence: request.fence,
        exitCode,
        pins: { ...pins },
      });
      try {
        for (let n = 0; n < 500; n++) {
          if (!request.checkpoint() || session.phase !== "running")
            throw Error("Native coding run stopped by its gate");
          let items;
          try {
            items = await itemsOf(
              await gateway.respond(
                request.modelRoute.deliveryId,
                gateway.capability,
                JSON.stringify({ ...captured, input: history }),
              ),
            );
          } catch (error) {
            assert.ok(error instanceof GeneralSessionRefusal);
            // Codex retries a refused request.
            await tick();
            continue;
          }
          const call = items.find((i) => i.type === "custom_tool_call");
          if (!call) {
            history.push(...items);
            stdout(
              line({
                type: "turn.completed",
                usage: { input_tokens: 1, output_tokens: 1 },
              }),
            );
            return done(0);
          }
          const output = await runScript(call.input, files);
          history.push(
            ...items.map((i) =>
              i.type === "reasoning" ? { ...i, content: null } : i,
            ),
            {
              type: "custom_tool_call_output",
              call_id: call.call_id,
              output: output.map((text) => ({ type: "input_text", text })),
            },
          );
          await tick();
        }
        return done(1);
      } finally {
        gateway.revoke("stopped");
        session.phase = "stopped";
        session.processes = faults.survivor ? 1 : 0;
      }
    },
    async observeSession(session) {
      const s = sessions.get(session.operationId);
      if (!s) throw Error("Native coding observe-session unavailable");
      return {
        operationId: session.operationId,
        fence: session.fence,
        phase: s.phase,
        running: s.phase === "running",
        remainingProcesses: s.processes,
        processesGone: s.processes === 0,
        timers: {
          lease: { loadState: "not-found", activeState: "inactive" },
          deadline: { loadState: "not-found", activeState: "inactive" },
        },
        pins: { ...pins },
      };
    },
    async stop(session) {
      effects.push("stop");
      const s = sessions.get(session.operationId);
      if (s) {
        s.phase = "stopped";
        s.processes = faults.survivor ? 1 : 0;
      }
      return {
        operationId: session.operationId,
        fence: session.fence,
        stopped: !faults.survivor,
        remainingProcesses: faults.survivor ? 1 : 0,
      };
    },
    async collect(session) {
      const s = sessions.get(session.operationId);
      if (s?.phase !== "stopped") throw Error("Native coding collect refused");
      return {
        operationId: session.operationId,
        fence: session.fence,
        complete: true,
        files: [...s.files].map(([path, bytes]) => ({
          path,
          bytes,
          ordinary: true,
          links: 1,
          ...(s.before.has(path)
            ? { beforeSha256: sha256(s.before.get(path)) }
            : {}),
          afterSha256: sha256(bytes),
        })),
      };
    },
  };
  return { transport, effects };
}

async function canary(faults = {}, admitted = pins) {
  const { transport, effects } = vm(faults);
  const report = await usageCanary(
    { transport, admission: { pins: () => ({ ...admitted }) } },
    { interrupted: () => faults.interrupted?.(effects) ?? false },
  );
  return { report, effects };
}

test("the usage canary passes when the controller enforces every usage control on the routed turns", async () => {
  const { report, effects } = await canary();
  assert.equal(
    report.outcome,
    passingOutcome,
    JSON.stringify(report.stages.find((s) => s.outcome === "blocked")),
  );
  assert.equal(report.productionEnabled, false);
  assert.equal(report.qualified, false);
  assert.equal(report.inferenceAuthorized, false);
  assert.deepEqual(
    report.stages.map((s) => s.name),
    [...stageNames],
  );
  assert.ok(report.stages.every((s) => s.outcome === "passed"));
  // Three routed turns, and nothing dispatched while usage refused.
  assert.deepEqual(
    effects.filter((e) => e.startsWith("run:")),
    ["run:start", "run:resume", "run:start"],
  );
  const [launch, resume, lineage] = report.turns;
  assert.equal(launch.interruption.reason, "exhausted");
  assert.equal(resume.interruption.reason, "withdrawn");
  assert.equal(lineage.interruption, undefined);
  assert.notEqual(lineage.route.decisionSha256, launch.route.decisionSha256);
  assert.deepEqual(resume.route, launch.route);
  assert.ok(report.finalStops.every((s) => s.stopped));
});

test(
  "the canary keeps its state private when the temp folder lets others read it",
  { skip: process.platform !== "win32" },
  async (t) => {
    // As on an owner PC whose temp folder grants a sandbox group access:
    // here the built-in Users group, inherited by everything created inside.
    const loose = mkdtempSync(join(tmpdir(), "aios-loose-temp-"));
    t.after(() => rmSync(loose, { recursive: true, force: true }));
    const granted = spawnSync(
      "icacls",
      [loose, "/grant", "*S-1-5-32-545:(OI)(CI)(RX)"],
      { encoding: "utf8" },
    );
    assert.equal(granted.status, 0, granted.stderr);
    const saved = { TEMP: process.env.TEMP, TMP: process.env.TMP };
    t.after(() => Object.assign(process.env, saved));
    Object.assign(process.env, { TEMP: loose, TMP: loose });
    const { report } = await canary();
    assert.equal(
      report.outcome,
      passingOutcome,
      JSON.stringify(report.stages.find((s) => s.outcome === "blocked")),
    );
  },
);

test("a canary whose owner record names other pins is blocked before any turn", async () => {
  const { report, effects } = await canary(
    {},
    {
      ...pins,
      policySha256: "f".repeat(64),
    },
  );
  assert.equal(report.outcome, "blocked");
  assert.equal(
    report.stages.find((s) => s.name === "owner-record-names-fresh-pins")
      .outcome,
    "blocked",
  );
  assert.deepEqual(
    effects.filter((e) => e.startsWith("run:")),
    [],
  );
});

test("a session that survives its exact stop blocks the canary and leaves it uncertain", async () => {
  const { report } = await canary({ survivor: true });
  assert.equal(report.outcome, "uncertain");
  assert.equal(
    report.stages.find((s) => s.name === "routed-launch-exhausted-mid-turn")
      .outcome,
    "blocked",
  );
  assert.ok(report.finalStops.some((s) => !s.stopped));
});

test("an interrupted canary stops at its stage and stops every session", async () => {
  const { report } = await canary({
    interrupted: (effects) => effects.includes("run:resume"),
  });
  assert.equal(report.outcome, "blocked");
  assert.equal(report.error, "Interrupted");
  assert.ok(report.finalStops.length >= 2);
  assert.ok(report.finalStops.every((s) => s.stopped));
});
