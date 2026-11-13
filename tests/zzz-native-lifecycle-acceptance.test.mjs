// #274: the lifecycle controls run, against a simulated CLI that keeps each
// delivery's phase, session and validation attempts as the controller does.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  lifecycleAcceptance,
  lifecyclePassingOutcome,
  lifecycleStageNames,
  symlinkRequest,
} from "../scripts/native-lifecycle-acceptance.mjs";
import { passingOutcomes } from "../scripts/run-native-cli-delivery-acceptance.mjs";

const pins = {
  coding: { cliVersion: "2.1.311", policySha256: "c".repeat(64) },
  validation: { imageSha256: "9".repeat(64) },
};
const pinFields = {
  coding: ["cliVersion", "policySha256"],
  validation: ["imageSha256"],
};

function simulatedCli(faults = {}) {
  const deliveries = new Map();
  const calls = [];
  const ok = (d) => ({ status: 0, stdout: JSON.stringify(d), stderr: "" });
  const refuse = (error) => ({
    status: 1,
    stdout: "",
    stderr: JSON.stringify({ error }) + "\n",
  });
  const session = (state = "running") => ({
    operationId: randomUUID(),
    state,
    threadStarted: true,
  });
  let pending = [];
  const settle = (result) => {
    for (const p of pending) p(result);
    pending = [];
  };
  const commands = {
    start(args) {
      const request = args[args.indexOf("--request") + 1];
      const d = {
        id: randomUUID(),
        phase: "preparing",
        request,
        ownership: { held: true },
        blocker: { code: "DELIVERY_NOT_ENABLED" },
      };
      deliveries.set(d.id, d);
      return ok(d);
    },
    "plan-feature"(d) {
      d.feature = { outcome: "planned" };
      return ok(d);
    },
    "validate-baseline"(d) {
      d.validation = {
        attempts: [{ stage: "baseline", state: "stopped", outcome: "passed" }],
      };
      return ok(d);
    },
    "code-feature"(d) {
      // Run to the end.
      d.feature.session = {
        ...session("stopped"),
        resumeFrom: d.feature.session?.operationId,
      };
      const symlink = d.request === symlinkRequest;
      if (!symlink || faults.symlinkAdmitted) {
        d.feature.outcome = "admitted";
        d.feature.candidate = { path: "/c.json" };
      }
      d.spend = { spent: 1, interruption: null };
      return ok(d);
    },
    pause(d) {
      d.phase = "paused";
      if (!faults.pauseLeavesRunning) d.feature.session.state = "stopped";
      settle({ status: 0, signal: null });
      return ok(d);
    },
    resume(d) {
      if (d.phase === "cancelled" && !faults.resumeAfterCancel)
        return refuse("A cancelled delivery cannot be resumed.");
      d.phase = "preparing";
      return ok(d);
    },
    cancel(d) {
      d.phase = "cancelled";
      for (const a of d.validation?.attempts ?? [])
        if (a.state === "running" && !faults.cancelLeavesRunning) {
          a.state = "stopped";
          a.outcome = "cancelled";
        }
      settle({ status: 0, signal: null });
      return ok(d);
    },
    recover(d) {
      if (!faults.recoverFails) d.feature.session.state = "stopped";
      return ok(d);
    },
    release(d) {
      d.ownership.held = false;
      return ok(d);
    },
    status(d) {
      return ok(d);
    },
  };
  const target = (args) => deliveries.get(args[args.indexOf("--id") + 1]);
  return {
    calls,
    deliveries,
    cli: async (args) => {
      calls.push(args[0]);
      return args[0] === "start"
        ? commands.start(args)
        : commands[args[0]](target(args), args);
    },
    spawnCli(args) {
      calls.push("spawn:" + args[0]);
      const d = target(args);
      if (args[0] === "code-feature" && !faults.neverRuns)
        d.feature.session = session("running");
      if (args[0] === "validate-candidate")
        d.validation.attempts.push({
          operationId: randomUUID(),
          stage: "candidate",
          state: "running",
        });
      const done = new Promise((resolve) => pending.push(resolve));
      return {
        kill(signal) {
          settle({ status: null, signal });
        },
        done,
      };
    },
  };
}

function host(sim) {
  const cleaned = [];
  return {
    cleaned,
    cli: sim.cli,
    spawnCli: (args) => sim.spawnCli(args),
    pins: {
      coding: { admitted: pins.coding, fresh: async () => pins.coding },
      validation: {
        admitted: pins.validation,
        fresh: async () => pins.validation,
      },
    },
    pinFields,
    machine: "aios-test",
    codingAdmission: "/owner/coding.json",
    validationAdmission: "/owner/validation.json",
    authDirectory: "/owner/auth",
    cleanupCodingSession: async (s) => {
      cleaned.push(s.operationId);
      return { cleaned: 1 };
    },
    ownerInputs: (folder) => ({
      repository: folder + "/repository",
      policyPath: folder + "/owner/policy.json",
      attestationPath: folder + "/owner/attestation.json",
      criteria: () => folder + "/owner/criteria.json",
    }),
    root: "/tmp/lifecycle",
    request: "Add a visible contact hint.",
    codingMinutes: 10,
    budgetDollars: 5,
  };
}
let clock = 0;
const options = { sleep: async () => {}, now: () => (clock += 10) };

test("pause, resume, cancel, recovery and the symlink refusal all pass on a faithful controller", async () => {
  const sim = simulatedCli();
  const h = host(sim);
  const report = await lifecycleAcceptance(h, options);
  assert.equal(report.outcome, lifecyclePassingOutcome, report.error);
  assert.ok(passingOutcomes.includes(lifecyclePassingOutcome));
  assert.deepEqual(
    report.stages.map((s) => [s.name, s.outcome]),
    lifecycleStageNames.map((n) => [n, "passed"]),
  );
  assert.equal(report.deliveries.a.pause.session, "stopped");
  assert.equal(report.deliveries.a.afterResume.resumedThread, true);
  assert.equal(report.deliveries.a.cancel.attempt, "stopped");
  assert.match(report.deliveries.a.resumeAfterCancel.refusal, /cancelled/);
  assert.equal(report.deliveries.b.killed.signal, "SIGKILL");
  assert.equal(report.deliveries.b.recover.sameSession, true);
  assert.equal(report.deliveries.c.symlink.candidate, false);
  assert.equal(h.cleaned.length, 3);
  for (const label of ["a", "b", "c"])
    assert.equal(report.deliveries[label].released, true);
  assert.equal(report.productionEnabled, false);
});

test("each control that doesn't hold stops the run, and later stages are reported not run", async () => {
  for (const [fault, message] of [
    ["pauseLeavesRunning", /exact running session/],
    ["cancelLeavesRunning", /running validation attempt/],
    ["resumeAfterCancel", /cancelled delivery was resumed/],
    ["recoverFails", /exact session the killed controller left/],
    ["symlinkAdmitted", /symbolic link was admitted/],
    ["neverRuns", /never started running/],
  ]) {
    const sim = simulatedCli({ [fault]: true });
    const report = await lifecycleAcceptance(host(sim), options);
    assert.equal(report.outcome, "blocked", fault);
    assert.match(report.error, message, fault);
    const blocked = report.stages.findIndex((s) => s.outcome === "blocked");
    assert.ok(blocked >= 0, fault);
    assert.ok(
      report.stages.slice(blocked + 1).every((s) => s.outcome === "not-run"),
      fault,
    );
    assert.deepEqual(
      report.stages.map((s) => s.name).sort(),
      [...lifecycleStageNames].sort(),
      fault,
    );
    // Whatever was left open is cancelled on the way out.
    assert.ok(sim.calls.includes("cancel"), fault);
  }
});

test("owner records that don't name the fresh pins stop the run before any delivery", async () => {
  const sim = simulatedCli();
  const h = host(sim);
  h.pins.coding.fresh = async () => ({
    ...pins.coding,
    policySha256: "0".repeat(64),
  });
  const report = await lifecycleAcceptance(h, options);
  assert.equal(report.outcome, "blocked");
  assert.match(report.error, /coding admission does not name the fresh pins/);
  assert.equal(sim.calls.includes("start"), false);
});
