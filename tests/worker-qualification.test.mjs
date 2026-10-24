import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { boundaryProbe, boundaryProbeNames } from "../dist/worker-probes.js";
import {
  passingOutcome,
  probeCheck,
  stageNames,
  workerQualification,
} from "../scripts/run-native-worker-qualification.mjs";

const image = "c".repeat(64);
const codingPins = {
  cliVersion: "0.161.0",
  cliSha256: "1".repeat(64),
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
        // The guest refuses to observe a session it has not yet recorded.
        if (codingState === "idle" || (faults.lateRecord && observations++ < 3))
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

async function qualify(faults) {
  const { coding, validation, effects } = workers(faults);
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
});

for (const [faults, name] of [
  [{ codingFails: "network" }, "coding:network"],
  [{ validationFails: "owner-home" }, "validation:owner-home"],
])
  test(`a failed probe (${name}) fails the qualification and is retained`, async () => {
    const { report } = await qualify(faults);
    assert.equal(report.outcome, "failed");
    assert.deepEqual(report.failedProbes, [name]);
    // Every stage still ran, so the whole result is evidence.
    assert.ok(report.stages.every((s) => s.outcome === "passed"));
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
