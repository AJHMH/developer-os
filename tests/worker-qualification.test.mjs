import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  boundaryProbe,
  boundaryProbeNames,
  codingBoundaryProbeNames,
} from "../dist/worker-probes.js";
import { sessionsLeft } from "./helpers/guest-backed-sessions.mjs";
import { guestFixture } from "./helpers/native-coding-fixture.mjs";
import {
  claudeCoding,
  passingOutcome,
  probeCheck,
  stageNames,
  workerQualification,
} from "../scripts/run-native-worker-qualification.mjs";

const image = "c".repeat(64);
const codingPins = {
  cliVersion: "0.161.0",
  cliSha256: "1".repeat(64),
  codeModeHostSha256: "6".repeat(64),
  policySha256: "2".repeat(64),
  bindingSha256: "3".repeat(64),
};
const validationPins = {
  imageSha256: image,
  policySha256: "4".repeat(64),
  bindingSha256: "5".repeat(64),
};
const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

/** Admits only its exact pins, as the pinned runtimes do. */
function runtime(expected) {
  return class {
    constructor(pins) {
      if (JSON.stringify(pins) !== JSON.stringify(expected))
        throw Error("Pins changed");
    }
  };
}

/** Fake transports with real-shaped lifecycle; `faults` breaks one property. */
function workers(faults = {}) {
  const effects = [];
  let codingState = "idle",
    observations = 0;
  const coding = {
    transport: {
      async inspect() {
        return { ...codingPins };
      },
      async run(request) {
        effects.push("coding-run");
        await tick();
        codingState = "running";
        while (request.checkpoint()) await tick();
        codingState = "stopped";
        throw Error("Native coding run stopped by its gate");
      },
      async observeSession() {
        // The guest refuses to observe a session it has not yet recorded, or
        // one it has removed.
        if (
          codingState === "idle" ||
          codingState === "removed" ||
          (faults.lateRecord && observations++ < 3)
        )
          throw Error("Native coding observe-session observation unavailable");
        return {
          phase: codingState === "running" ? "running" : "stopped",
          running: codingState === "running",
          remainingProcesses:
            codingState === "running" ? 2 : faults.survivor ? 1 : 0,
          processesGone: codingState !== "running" && !faults.survivor,
        };
      },
      async probeBoundary(_session, path) {
        effects.push("coding-probe:" + path);
        return {
          probes: boundaryProbeNames.map((name) => ({
            name,
            outcome: faults.codingFails === name ? "failed" : "passed",
          })),
          processes: 3,
          pins: { ...codingPins },
        };
      },
      async stop() {
        effects.push("coding-stop");
        codingState = "stopped";
        return { stopped: true, remainingProcesses: 0 };
      },
      async cleanupSupersededLineage(session) {
        effects.push("coding-lineage-cleanup");
        assert.equal(session.state, "stopped");
        if (faults.noThread || faults.cleanupKept)
          throw Error("Native coding cleanup-superseded observation");
        codingState = "removed";
        return { cleaned: 1 };
      },
      async cleanupAbandonedSessions(apply) {
        effects.push("coding-sweep");
        assert.equal(apply, true);
        if (!faults.cleanupKept) codingState = "removed";
        return { removed: faults.cleanupKept ? 0 : 1 };
      },
    },
    admission: { pins: () => faults.codingRecord ?? { ...codingPins } },
    Runtime: faults.admitsChangedPins
      ? class {}
      : faults.admitsMissingPins
        ? class {
            constructor(pins) {
              // Checks values it is given, but not that every pin is there.
              for (const [key, value] of Object.entries(pins))
                if (codingPins[key] !== value) throw Error("Pins changed");
            }
          }
        : runtime(codingPins),
  };
  const stopped = new Set();
  const changed = new Set();
  const validation = {
    transport: {
      async inspect() {
        return { ...validationPins };
      },
      async run(request) {
        if (stopped.has(request.operationId) && !faults.lateCheckRuns)
          throw Error("Native validation attempt fenced");
        effects.push("validation-run:" + request.check.id);
        const result = (exitCode, timedOut = false) => ({
          operationId: request.operationId,
          fence: request.fence,
          checkId: request.check.id,
          exitCode,
          timedOut,
          pins: { ...validationPins },
        });
        if (request.check.id.startsWith("probe-"))
          return result(
            faults.validationFails === request.check.id.slice(6) ? 1 : 0,
          );
        if (request.check.id === "deadline-descendants")
          return result(137, !faults.noDeadline);
        if (request.check.id === "changes-the-tree") {
          changed.add(request.operationId);
          return result(0);
        }
        // A long check: running until its attempt is stopped.
        for (let i = 0; ; i++) {
          if (!request.mayDispatch()) throw Error("Native validation stopped");
          if (stopped.has(request.operationId)) return result(137);
          await tick();
        }
      },
      async stop(attempt) {
        effects.push("validation-stop");
        stopped.add(attempt.operationId);
        return {
          ...attempt,
          stopped: true,
          remainingProcesses: 0,
          treeSha256:
            changed.has(attempt.operationId) && !faults.changedTreeHidden
              ? "f".repeat(64)
              : request0Tree,
        };
      },
    },
    admission: {
      pins: () => faults.validationRecord ?? { ...validationPins },
    },
    Runtime: runtime(validationPins),
  };
  return { coding, validation, effects };
}
// The tree every request names; an unchanged attempt reports it back.
let request0Tree;

const ran = (report) => report.stages.filter((s) => s.outcome !== "not-run");

async function qualify(faults, codingWorker = {}) {
  const workerSet = workers(faults);
  const { validation, effects } = workerSet;
  const coding = { ...workerSet.coding, ...codingWorker };
  const original = validation.transport.run;
  validation.transport.run = (request) => {
    request0Tree = request.treeSha256;
    return original(request);
  };
  const report = await workerQualification(
    {
      coding,
      validation,
      imageSha256: image,
      probes: { script: boundaryProbe, names: boundaryProbeNames },
    },
    { pause: tick },
  );
  return { report, effects };
}

test("a qualification where every probe and control holds passes", async () => {
  const { report, effects } = await qualify();
  assert.equal(report.outcome, passingOutcome);
  assert.equal(report.productionEnabled, false);
  assert.equal(report.qualified, false);
  assert.ok(report.stages.every((s) => s.outcome === "passed"));
  assert.deepEqual(
    report.coding.probes.map((p) => p.name),
    [...boundaryProbeNames],
  );
  assert.deepEqual(
    report.validation.probes.map((p) => p.outcome),
    boundaryProbeNames.map(() => "passed"),
  );
  assert.deepEqual(report.coding.stopped, {
    phase: "stopped",
    remainingProcesses: 0,
    processesGone: true,
  });
  assert.equal(report.validation.deadline.timedOut, true);
  assert.equal(report.validation.lateCheckFenced, true);
  assert.equal(report.validation.changedTree.reportedTested, false);
  assert.ok(effects.includes("coding-probe:index.html"));
  assert.equal(report.coding.cleanup, "lineage");
  assert.equal(effects.at(-1), "coding-lineage-cleanup");
});

test("a coding session with no recorded thread is swept instead", async () => {
  const { report, effects } = await qualify({ noThread: true });
  assert.equal(report.outcome, passingOutcome);
  assert.equal(report.coding.cleanup, "sweep");
  assert.deepEqual(effects.slice(-2), [
    "coding-lineage-cleanup",
    "coding-sweep",
  ]);
});

test("a coding session that outlives its cleanup blocks the qualification", async () => {
  const { report } = await qualify({ cleanupKept: true });
  assert.equal(report.outcome, "blocked");
  assert.equal(ran(report).at(-1).name, "coding-session-cleanup");
  assert.match(ran(report).at(-1).error, /was not removed/);
});

for (const [faults, name] of [
  [{ codingFails: "network" }, "coding:network"],
  [{ validationFails: "owner-home" }, "validation:owner-home"],
])
  test(`a failed probe (${name}) fails the qualification and is retained`, async () => {
    const { report } = await qualify(faults);
    assert.equal(report.outcome, "failed");
    assert.deepEqual(report.failedProbes, [name]);
    // Every check still ran, so the whole result is evidence; the session
    // stays in the VM for diagnosis.
    assert.deepEqual(
      report.stages.map((s) => s.outcome),
      stageNames.map((stage) =>
        stage === "coding-session-cleanup" ? "not-run" : "passed",
      ),
    );
  });

for (const [name, faults, stage] of [
  [
    "a coding record naming other pins",
    { codingRecord: { ...codingPins, bindingSha256: "9".repeat(64) } },
    "owner-records-name-fresh-pins",
  ],
  [
    "a validation record naming other pins",
    { validationRecord: { ...validationPins, policySha256: "9".repeat(64) } },
    "owner-records-name-fresh-pins",
  ],
  [
    "a runtime admitting a changed pin",
    { admitsChangedPins: true },
    "changed-pins-refused",
  ],
  [
    "a runtime admitting a missing pin",
    { admitsMissingPins: true },
    "changed-pins-refused",
  ],
])
  test(`${name} blocks before any worker runs`, async () => {
    const { report, effects } = await qualify(faults);
    assert.equal(report.outcome, "blocked");
    assert.equal(ran(report).at(-1).name, stage);
    assert.deepEqual(effects, []);
  });

for (const [name, faults, stage] of [
  [
    "a coding descendant surviving the stop",
    { survivor: true },
    "coding-exact-stop-removes-descendants",
  ],
  [
    "a check the guest deadline did not end",
    { noDeadline: true },
    "validation-deadline-kills-descendants",
  ],
  [
    "a check running after its attempt stopped",
    { lateCheckRuns: true },
    "validation-stop-mid-check-and-fence",
  ],
  [
    "a changed tree reported as tested",
    { changedTreeHidden: true },
    "validation-changed-tree-never-tested",
  ],
])
  test(`${name} blocks the qualification`, async () => {
    const { report } = await qualify(faults);
    assert.equal(report.outcome, "blocked");
    assert.equal(ran(report).at(-1).name, stage);
    assert.equal(ran(report).at(-1).outcome, "blocked");
  });

test("a session observed before its record exists is waited for, not refused", async () => {
  const { report } = await qualify({ lateRecord: true });
  assert.equal(report.outcome, passingOutcome);
});

test("a blocked report names every stage that never ran", async () => {
  const { report } = await qualify({ admitsChangedPins: true });
  assert.deepEqual(
    report.stages.map((s) => s.name),
    [...stageNames],
  );
  assert.deepEqual(
    report.stages.slice(4).map((s) => s.outcome),
    stageNames.slice(4).map(() => "not-run"),
  );
});

// The check's shell runs inside the Linux worker.

test("a validation probe check passes only on its own probe's verdict", () => {
  const { command } = probeCheck(boundaryProbe, "network");
  assert.ok(command.length <= 32);
  assert.ok(
    command.every((a) => a.length <= 2000 && !/[\u0000-\u001f]/.test(a)),
  );
  const run = (verdicts) =>
    spawnSync("/bin/sh", [
      "-c",
      command[2],
      command[3],
      `printf '%s\\n' ${verdicts}`,
      ...command.slice(5),
    ]).status;
  assert.equal(run("passed-tools passed-network"), 0);
  assert.equal(run("passed-tools failed-network"), 1);
  assert.equal(run("passed-tools passed-network-extra"), 1);
});

test("the qualification runs only with explicit, well-formed arguments", () => {
  const record = "/r.json";
  for (const args of [
    [],
    [
      "not-a-machine",
      record,
      record,
      image,
      "/report.json",
      "--approve-offline-native-run",
    ],
    [
      "aios-test",
      record,
      record,
      "short",
      "/report.json",
      "--approve-offline-native-run",
    ],
    ["aios-test", record, record, image, "/report.json", "--approve"],
    [
      "aios-test",
      record,
      record,
      image,
      "/report.json",
      "--approve-offline-native-run",
      "extra",
    ],
  ]) {
    const result = spawnSync(
      process.execPath,
      ["scripts/run-native-worker-qualification.mjs", ...args],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1, args.join(" "));
    assert.match(result.stderr, /owner-validation-admission\.json/);
  }
});

for (const [name, threadId, cleanup] of [
  ["with a recorded thread", "12345678-1234-4234-8234-123456789abc", "lineage"],
  ["without a recorded thread", undefined, "sweep"],
])
  test(`a passing qualification leaves no coding session in the guest, ${name}`, async (t) => {
    const fixture = guestFixture(t, {
      keepRunning: true,
      probeOutput:
        codingBoundaryProbeNames.map((n) => `passed-${n}`).join("\n") + "\n",
      ...(threadId ? { threadId } : {}),
    });
    const pins = await fixture.transport.inspect({
      operationId: "12345678-1234-4234-8234-123456789abd",
      fence: 1,
      state: "running",
      intent: "start",
    });
    const { validation } = workers();
    const original = validation.transport.run;
    validation.transport.run = (request) => {
      request0Tree = request.treeSha256;
      return original(request);
    };
    const report = await workerQualification(
      {
        coding: {
          transport: fixture.transport,
          admission: { pins: () => ({ ...pins }) },
          Runtime: runtime(pins),
        },
        validation,
        imageSha256: image,
        probes: { script: boundaryProbe, names: boundaryProbeNames },
      },
      { pause: tick },
    );
    assert.equal(
      report.outcome,
      passingOutcome,
      JSON.stringify(report.stages.find((s) => s.outcome === "blocked")),
    );
    assert.equal(report.coding.cleanup, cleanup);
    assert.ok(
      fixture.read().commands.some((args) => args[1] === "rm"),
      "the session had a container to remove",
    );
    assert.deepEqual(sessionsLeft(fixture), { containers: [], folders: [] });
  });

// Claude Code's coding worker (ADR 0008): its own pins, argv and branch, and
// a routed live session whose relay leads to a held, answer-free stand-in.
const { MessagesGateway } = await import("../dist/messages-gateway.js");
const { claudeCodeArgv } = await import("../dist/coding-agent.js");
const { claudeCodingPinFields } = await import("../dist/feature-candidate.js");
const { pinnedModelPrices } = await import("../dist/spend-budget.js");
const claudeWorker = () =>
  claudeCoding({
    MessagesGateway,
    claudeCodeArgv,
    claudeCodingPinFields,
    model: pinnedModelPrices.model,
  });

test("a Claude Code qualification runs a routed session with Claude's argv, branch and pins", async () => {
  const worker = claudeWorker();
  const seen = {};
  const route = worker.route;
  worker.route = () => {
    const made = route();
    const release = made.release;
    seen.route = made;
    made.release = () => ((seen.released = true), release());
    return made;
  };
  const base = workers().coding;
  const run = base.transport.run;
  base.transport.run = (request, output, gateway) => {
    seen.request = request;
    seen.gateway = gateway;
    return run(request, output);
  };
  const { report } = await qualify(
    {},
    { ...worker, transport: base.transport },
  );
  assert.equal(report.outcome, passingOutcome);
  assert.equal(report.coding.mode, "routed");
  assert.deepEqual(seen.request.argv, [
    ...claudeCodeArgv(undefined),
    "Offline qualification only. Do not call any tool or change any file.",
  ]);
  assert.equal(seen.request.branch, "aios/issue04-worker-qualification");
  assert.deepEqual(seen.request.modelRoute, seen.route.modelRoute);
  assert.match(seen.request.modelRoute.capability, /^[a-f0-9]{64}$/);
  // The relay's capability is never the gateway's own.
  assert.equal(seen.gateway, seen.route.gateway);
  assert.notEqual(seen.gateway.capability, seen.request.modelRoute.capability);
  assert.equal(seen.released, true);
  const { gateway, ...counts } = report.coding.routedRequests;
  assert.deepEqual(counts, {
    requests: 0,
    keepalives: 0,
    finalAnswered: false,
    charged: 0,
  });
  // The gateway's own counts and refusal names, never request content.
  assert.equal(gateway.requests, 0);
  assert.deepEqual(gateway.refusals, {});
});

test("a Claude Code qualification checks every Claude pin, and only those", async () => {
  // A record that differs only in a pin Claude Code does not have still names
  // the fresh pins.
  const { report } = await qualify(
    { codingRecord: { ...codingPins, codeModeHostSha256: "9".repeat(64) } },
    claudeWorker(),
  );
  assert.equal(report.outcome, passingOutcome);
  for (const field of claudeCodingPinFields) {
    const { report: changed } = await qualify(
      { codingRecord: { ...codingPins, [field]: "9".repeat(64) } },
      claudeWorker(),
    );
    assert.equal(changed.outcome, "blocked", field);
    assert.equal(ran(changed).at(-1).name, "owner-records-name-fresh-pins");
  }
});

test("the Claude Code stand-in answers at once: keep-alives until released, then a final message", async () => {
  const made = claudeWorker().route();
  const ask = async (messages) => {
    let text = "";
    for await (const chunk of await made.gateway.respond(
      made.modelRoute.deliveryId,
      made.gateway.capability,
      JSON.stringify({
        model: pinnedModelPrices.model,
        messages,
        max_tokens: 16,
        stream: true,
      }),
    ))
      text += Buffer.from(chunk).toString();
    const events = text
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)));
    assert.equal(events[0].message.model, pinnedModelPrices.model);
    return {
      block: events.find((e) => e.type === "content_block_start")
        ?.content_block,
      input: events.find((e) => e.delta?.type === "input_json_delta")?.delta
        .partial_json,
      stop: events.find((e) => e.type === "message_delta").delta.stop_reason,
    };
  };
  const first = await ask([{ role: "user", content: "go" }]);
  assert.equal(first.block.name, "Bash");
  assert.deepEqual(JSON.parse(first.input), {
    command: "sleep 5",
    description: "Wait",
  });
  assert.equal(first.stop, "tool_use");
  const result = (id) => [
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: id, content: "" }],
    },
  ];
  const second = await ask(result(first.block.id));
  assert.equal(second.block.name, "Bash");
  made.release();
  const last = await ask(result(second.block.id));
  assert.equal(last.block.type, "text");
  assert.equal(last.stop, "end_turn");
  assert.deepEqual(made.effects, {
    requests: 3,
    keepalives: 2,
    finalAnswered: true,
    charged: 3,
  });
  // The turn's own stop revokes the grant, as the transport does.
  assert.equal(made.gateway.observation.revoked, false);
  // Each route is fresh: its own delivery, capability and key.
  const other = claudeWorker().route();
  assert.notEqual(other.modelRoute.deliveryId, made.modelRoute.deliveryId);
  assert.notEqual(other.modelRoute.capability, made.modelRoute.capability);
});

test("a qualification waits on the real clock when it is given no pause", async () => {
  const { coding, validation } = workers();
  const original = validation.transport.run;
  validation.transport.run = (request) => {
    request0Tree = request.treeSha256;
    return original(request);
  };
  const started = Date.now();
  const report = await workerQualification({
    coding,
    validation,
    imageSha256: image,
    probes: { script: boundaryProbe, names: boundaryProbeNames },
  });
  assert.equal(report.outcome, passingOutcome);
  // The coding session is not yet recorded on the first look, so the run
  // waits a real second before it looks again.
  assert.ok(Date.now() - started >= 900);
});
