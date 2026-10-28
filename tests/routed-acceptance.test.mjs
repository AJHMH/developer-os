import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { lockedCodingArgv } from "../dist/feature-candidate.js";
import { GeneralSessionRefusal } from "../dist/general-session-gateway.js";
import { codingBoundaryProbeNames } from "../dist/worker-probes.js";
import {
  passingOutcome,
  routedAcceptance,
  stageNames,
} from "../scripts/run-native-routed-acceptance.mjs";
import { fakeProvider, maxKeepalives } from "../scripts/routed-provider.mjs";

const pins = {
  cliVersion: "0.161.0",
  cliSha256: "1".repeat(64),
  codeModeHostSha256: "6".repeat(64),
  policySha256: "2".repeat(64),
  bindingSha256: "3".repeat(64),
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 1));
const AsyncFunction = (async () => {}).constructor;
/** The captured launch request: its tools and opening messages, and the
 * request fields Codex 0.161.0 sends. */
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
async function runScript(script, files, faults) {
  const out = [];
  const tools = {
    async apply_patch(patch) {
      const added = /^\*\*\* Add File: (.+)\n((?:\+.*\n)*)/m.exec(patch);
      if (!added || faults.toolsFail) return "apply_patch failed";
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
      if (/^sleep \d+$/.test(cmd)) {
        await tick();
        return { output: "", exit_code: 0 };
      }
      return { output: "", exit_code: 127 };
    },
  };
  await new AsyncFunction("tools", "text", script)(tools, (value) =>
    out.push(String(value)),
  );
  return out;
}

/** A fake VM whose Codex speaks the captured request shape to the real
 * gateway it is given; `faults` breaks one property. */
function vm(faults = {}) {
  const effects = [];
  const sessions = new Map();
  const threads = new Map();
  const state = (session) => sessions.get(session.operationId);
  const transport = {
    async inspect() {
      return { ...pins, ...(faults.pins ?? {}) };
    },
    async run(request, stdout, gateway) {
      assert.ok(request.modelRoute && gateway, "a routed turn has a gateway");
      assert.notEqual(gateway.capability, request.modelRoute.capability);
      assert.deepEqual(
        request.argv.slice(0, -1),
        lockedCodingArgv(request.threadId, request.modelRoute),
      );
      effects.push("run:" + request.intent);
      // Each session's workspace is fresh from its admitted files; only
      // Codex's home moves to a resume.
      const files = new Map(
        request.files.map((f) => [f.path, Buffer.from(f.bytes)]),
      );
      const session = {
        phase: "running",
        files,
        processes: 2,
        probed: false,
      };
      sessions.set(request.operationId, session);
      const thread =
        request.threadId && !faults.newThread ? request.threadId : randomUUID();
      if (!faults.noThread)
        stdout(
          Buffer.from(
            JSON.stringify({ type: "thread.started", thread_id: thread }) +
              "\n",
          ),
        );
      const history = threads.get(request.threadId) ?? [...opening];
      history.push({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: request.argv.at(-1) }],
      });
      let exitCode = 1;
      try {
        if (faults.endsAtOnce) return { exitCode: 0 };
        if (faults.slowStart) for (let i = 0; i < 10; i++) await tick();
        if (faults.refusedOnce)
          // A request naming another delivery is refused; Codex retries.
          await gateway
            .respond(randomUUID(), gateway.capability, "{}")
            .catch(() => {});
        for (let n = 0; n < 200; n++) {
          if (!request.checkpoint())
            throw Error("Native coding run stopped by its gate");
          const body = {
            ...captured,
            input: [
              ...history,
              ...(faults.hostedTool ? [{ type: "web_search_call" }] : []),
            ],
          };
          let items;
          try {
            items = await itemsOf(
              await gateway.respond(
                request.modelRoute.deliveryId,
                gateway.capability,
                JSON.stringify(body),
              ),
            );
          } catch (error) {
            assert.ok(error instanceof GeneralSessionRefusal);
            return { exitCode };
          }
          const call = items.find((i) => i.type === "custom_tool_call");
          if (!call) {
            history.push(...items);
            exitCode = faults.exitsNonZero ? 2 : 0;
            break;
          }
          assert.equal(call.name, "exec");
          const output = await runScript(call.input, files, faults);
          history.push(
            ...items.map((i) =>
              i.type === "reasoning" ? { ...i, content: null } : i,
            ),
            {
              type: "custom_tool_call_output",
              call_id: call.call_id,
              output: output.map((text) => ({ type: "input_text", text })),
            },
            ...(faults.strayItem
              ? [{ type: "message", role: "user", content: "stray" }]
              : []),
          );
          await tick();
        }
        threads.set(thread, history);
        return { exitCode };
      } finally {
        // As the transport does: the turn is over, then the exact stop.
        if (!faults.grantSurvives)
          gateway.revoke(faults.revokedOtherwise ? "paused" : "stopped");
        session.phase = "stopped";
        session.processes = faults.survivor ? 1 : 0;
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
      };
    },
    async probeBoundary(session, path) {
      const s = state(session);
      if (s?.phase !== "running")
        throw Error("Native coding probe-boundary observation unavailable");
      assert.ok(s.files.has(path), "the admitted file is in the workspace");
      effects.push("probe:" + path);
      // As the real probe: the admitted file must be the workspace's only
      // entry, whoever put anything else there.
      const onlyAdmitted = [...s.files.keys()].join() === path;
      // The probe takes a while; Codex keeps working meanwhile.
      for (let i = 0; i < 10; i++) await tick();
      s.processes = 3;
      return {
        probes: codingBoundaryProbeNames.map((name) => ({
          name,
          outcome:
            faults.probeFails === name ||
            (name === "only-admitted" && !onlyAdmitted)
              ? "failed"
              : "passed",
        })),
        processes: 3,
        pins: { ...pins, ...(faults.probePins ?? {}) },
      };
    },
    async collect(session) {
      const s = state(session);
      if (s?.phase !== "stopped") throw Error("Native coding collect refused");
      return {
        complete: !faults.incomplete,
        files: [...s.files]
          .filter(([path]) => !(faults.editLost && path.startsWith("routed-")))
          .map(([path, bytes]) => ({ path, bytes })),
      };
    },
    async stop(session) {
      effects.push("stop");
      if (faults.stopUncertain)
        return { stopped: false, remainingProcesses: 1 };
      const s = state(session);
      if (s) {
        s.phase = "stopped";
        s.processes = 0;
      }
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
    },
    { pause: tick, interrupted: () => faults.interrupted?.(effects) ?? false },
  );
  return { report, effects };
}

const ran = (report) => report.stages.filter((s) => s.outcome !== "not-run");

test("a routed lineage where the route, tools, probe and stops hold passes", async () => {
  const { report, effects } = await accept();
  assert.equal(report.outcome, passingOutcome, report.error);
  assert.equal(report.productionEnabled, false);
  assert.equal(report.qualified, false);
  assert.equal(report.inferenceAuthorized, false);
  assert.deepEqual(
    report.stages.map((s) => s.name),
    [...stageNames],
  );
  assert.ok(report.stages.every((s) => s.outcome === "passed"));
  assert.deepEqual(
    report.probes.map((p) => p.name),
    [...codingBoundaryProbeNames],
  );
  // The probe ran in the live routed launch, between model requests.
  assert.deepEqual(effects.slice(0, 2), ["run:start", "probe:canary.txt"]);
  for (const turn of [report.launch, report.resume]) {
    assert.equal(turn.exitCode, 0);
    assert.equal(turn.threads, 1);
    assert.equal(turn.provider.toolsWorked, true);
    assert.equal(turn.provider.finalAnswered, true);
    assert.equal(turn.gateway.revokedFor, "stopped");
    assert.deepEqual(turn.gateway.refusals, {});
    assert.equal(turn.gateway.providerRequests, turn.provider.requests);
    assert.equal(turn.refusedAfterStop, "revoked");
  }
  assert.equal(report.resume.provider.keepalives, 0);
  assert.equal(report.resume.provider.requests, 2);
  assert.notEqual(
    report.launch.capabilitySha256,
    report.resume.capabilitySha256,
  );
  assert.deepEqual(report.launch.collected, [
    "canary.txt",
    "routed-launch.txt",
  ]);
  assert.deepEqual(report.resume.collected, [
    "canary.txt",
    "routed-resume.txt",
  ]);
  // Counts and fixed labels only: no request or response content.
  const text = JSON.stringify(report);
  assert.doesNotMatch(text, /Begin Patch|routed launch\\n|input_text/);
});

test("the probe waits for the routed launch to run and talk to the provider", async () => {
  const { report } = await accept({ slowStart: true });
  assert.equal(report.outcome, passingOutcome, report.error);
  assert.ok(report.launch.probeAfterRequest >= 1);
  // Codex was kept between model requests while the probe ran, and
  // released once it had: well before the keep-alive cap.
  assert.ok(report.launch.provider.keepalives >= 1);
  assert.ok(report.launch.provider.keepalives < 20);
  assert.equal(
    report.launch.provider.requests,
    report.launch.provider.keepalives + 2,
  );
});

test("a failed probe fails the run, and the whole lineage is kept as evidence", async () => {
  const { report } = await accept({ probeFails: "relay-answers" });
  assert.equal(report.outcome, "failed");
  assert.deepEqual(report.failedProbes, ["relay-answers"]);
  assert.ok(report.stages.every((s) => s.outcome === "passed"));
});

for (const [name, faults, stage] of [
  [
    "a record naming other pins",
    { record: { ...pins, policySha256: "9".repeat(64) } },
    "owner-record-names-fresh-pins",
  ],
  ["tools that never ran", { toolsFail: true }, "routed-launch-tools-ran"],
  [
    "a request the gateway refuses",
    { hostedTool: true },
    "routed-launch-live-probe",
  ],
  [
    "a launch that ends before it could be probed",
    { endsAtOnce: true },
    "routed-launch-live-probe",
  ],
  [
    "pins that change during the probe",
    { probePins: { bindingSha256: "9".repeat(64) } },
    "routed-launch-live-probe",
  ],
  [
    "a request after a tool output the provider did not expect",
    { strayItem: true },
    "routed-launch-tools-ran",
  ],
  ["a refused request", { refusedOnce: true }, "routed-launch-tools-ran"],
  [
    "a launch whose Codex exits with an error",
    { exitsNonZero: true },
    "routed-launch-live-probe",
  ],
  [
    "a grant revoked for another reason",
    { revokedOtherwise: true },
    "routed-launch-grant-revoked",
  ],
  [
    "an incomplete collection",
    { incomplete: true },
    "routed-launch-output-collected",
  ],
  [
    "an edit missing from the collection",
    { editLost: true },
    "routed-launch-output-collected",
  ],
  [
    "a grant that outlives its turn",
    { grantSurvives: true },
    "routed-launch-grant-revoked",
  ],
  [
    "a descendant that survives the exact stop",
    { survivor: true },
    "routed-launch-exact-stop",
  ],
  ["a resume on a new thread", { newThread: true }, "routed-resume"],
  [
    "a launch that reports no thread",
    { noThread: true },
    "routed-launch-live-probe",
  ],
  [
    "an interruption after the probe",
    { interrupted: (effects) => effects.includes("probe:canary.txt") },
    "routed-launch-live-probe",
  ],
])
  test(`${name} blocks at ${stage}`, async () => {
    const { report, effects } = await accept(faults);
    assert.equal(report.outcome, "blocked");
    assert.equal(ran(report).at(-1).name, stage);
    assert.equal(ran(report).at(-1).outcome, "blocked");
    if (stage === "owner-record-names-fresh-pins")
      assert.ok(!effects.some((e) => e.startsWith("run:")));
  });

test("a blocked report names every stage that never ran", async () => {
  const { report } = await accept({ toolsFail: true });
  assert.deepEqual(
    report.stages.map((s) => s.name),
    [...stageNames],
  );
  const at = stageNames.indexOf("routed-launch-tools-ran");
  assert.deepEqual(
    report.stages.slice(at + 1).map((s) => s.outcome),
    stageNames.slice(at + 1).map(() => "not-run"),
  );
});

test("every attempted session is stopped, and an uncertain stop is reported", async () => {
  const { report, effects } = await accept({ stopUncertain: true });
  assert.equal(report.outcome, "uncertain");
  assert.ok(effects.includes("stop"));
});

test("the fake provider keeps the turn alive until released, then edits, then ends it", async () => {
  let released = false;
  const fake = fakeProvider("launch", () => released);
  const answer = (input) =>
    itemsOf(
      fake.provider(
        "synthetic-token",
        JSON.stringify({ ...captured, input }),
        new AbortController().signal,
      ),
    );
  const history = [...opening];
  const files = new Map();
  /** Run the answer's script and add the exchange to the history. */
  async function follow(items) {
    assert.deepEqual(
      items.map((i) => i.type),
      ["reasoning", "custom_tool_call"],
    );
    const call = items[1];
    assert.equal(call.name, "exec");
    const output = await runScript(call.input, files, {});
    history.push(...items, {
      type: "custom_tool_call_output",
      call_id: call.call_id,
      output: output.map((text) => ({ type: "input_text", text })),
    });
    return { call, output };
  }
  // Until released, only keep-alive scripts: the workspace stays as admitted.
  const waiting = await follow(await answer(history));
  assert.deepEqual(waiting.output, ["AIOS-ROUTED-WAIT"]);
  assert.equal(files.size, 0);
  released = true;
  const work = await follow(await answer(history));
  assert.deepEqual(work.output, ["AIOS-ROUTED-OK-launch"]);
  assert.equal(files.get("routed-launch.txt").toString(), "routed launch\n");
  // The script's source never contains its own marker.
  assert.doesNotMatch(work.call.input, /AIOS-ROUTED-OK/);
  const last = await answer(history);
  assert.deepEqual(
    last.map((i) => i.type),
    ["message"],
  );
  assert.deepEqual(fake.observation, {
    requests: 3,
    keepalives: 1,
    toolsWorked: true,
    finalAnswered: true,
    unexpected: 0,
  });
});

test("the fake provider stops keeping the turn alive at its cap", async () => {
  const fake = fakeProvider("launch", () => false);
  const history = [...opening];
  let call;
  for (let n = 0; n <= maxKeepalives; n++) {
    [, call] = await itemsOf(
      fake.provider(
        "synthetic-token",
        JSON.stringify({ ...captured, input: history }),
        new AbortController().signal,
      ),
    );
    history.push(call, {
      type: "custom_tool_call_output",
      call_id: call.call_id,
      output: [],
    });
  }
  assert.equal(fake.observation.keepalives, maxKeepalives);
  assert.match(call.input, /apply_patch/);
});

test("the fake provider credits only the work script's own output", async () => {
  const fake = fakeProvider("launch", () => true);
  const answer = (input) =>
    itemsOf(
      fake.provider(
        "synthetic-token",
        JSON.stringify({ ...captured, input }),
        new AbortController().signal,
      ),
    );
  const history = [...opening];
  const [, call] = await answer(history);
  // The marker under another call's ID is not the work script's output.
  history.push({
    type: "custom_tool_call_output",
    call_id: call.call_id + "-other",
    output: [{ type: "input_text", text: "AIOS-ROUTED-OK-launch" }],
  });
  await answer(history);
  assert.equal(fake.observation.toolsWorked, false);
});

test("the fake provider does not count a failed script as tools that worked", async () => {
  const fake = fakeProvider("resume", () => true);
  const answer = (input) =>
    itemsOf(
      fake.provider(
        "synthetic-token",
        JSON.stringify({ ...captured, input }),
        new AbortController().signal,
      ),
    );
  const history = [...opening];
  const [, call] = await answer(history);
  const output = await runScript(call.input, new Map(), { toolsFail: true });
  history.push({
    type: "custom_tool_call_output",
    call_id: call.call_id,
    output: output.map((text) => ({ type: "input_text", text })),
  });
  await answer(history);
  assert.equal(fake.observation.toolsWorked, false);
});

test("the routed acceptance runs only with explicit, well-formed arguments", () => {
  for (const args of [
    [],
    [
      "not-a-machine",
      "/r.json",
      "/report.json",
      "--approve-offline-native-run",
    ],
    ["aios-test", "/r.json", "/report.json", "--approve"],
    [
      "aios-test",
      "/r.json",
      "/report.json",
      "--approve-offline-native-run",
      "extra",
    ],
  ]) {
    const result = spawnSync(
      process.execPath,
      ["scripts/run-native-routed-acceptance.mjs", ...args],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1, args.join(" "));
    assert.match(result.stderr, /owner-coding-admission\.json/);
  }
});
