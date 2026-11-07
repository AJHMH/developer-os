// The owner-run routed delivery, with every CLI and script process
// simulated. The name sorts after every other test file, so no other file
// changes shard.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { offlineValidationEnvironment } from "../dist/native-validation.js";
import { privateRoot } from "../scripts/run-native-cli-delivery-acceptance.mjs";
import {
  codeRouted,
  decideRouted,
  planRepairRouted,
  prepareRouted,
  repairOutcomes,
  repairRouted,
  routeRouted,
  routedOutcomes,
} from "../scripts/run-native-routed-delivery.mjs";

const usageAccount = "c".repeat(64);
const host = {
  state: "/owner/state",
  machine: "aios-test",
  workerPolicy: "/owner/fixed-worker-pins.json",
  codingAdmission: "/owner/coding-admission.json",
  validationAdmission: "/owner/validation-admission.json",
  codex: "/owner/codex",
  authDirectory: "/owner/auth",
  authAccount: "a".repeat(64),
};
const option = (args, name) => args[args.indexOf(name) + 1];

/** A simulated host: the CLI's delivery, and the two owner scripts. `log`
 * holds every call; `fail` names a call to refuse. */
function simulated(changes = {}) {
  const id = randomUUID(),
    decisionRun = randomUUID(),
    routedRun = randomUUID();
  const log = [];
  const delivery = {
    id,
    onboarding: { ready: true, attestation: { source: "owner-attested" } },
    validation: { attempts: [] },
    qualification: {},
  };
  let endorsed = false;
  const refuse = (message) => {
    throw Error(message);
  };
  const host = {
    id,
    decisionRun,
    routedRun,
    log,
    delivery,
    podmanDesktop: () => false,
    async run(args) {
      log.push(["cli", ...args]);
      const [command] = args;
      if (changes.fail === command) refuse(`The CLI refused ${command}`);
      if (command === "start") return structuredClone(delivery);
      if (command === "plan-feature") {
        delivery.feature = { outcome: "planned", criteria: ["hint"] };
        return structuredClone(delivery);
      }
      if (command === "validate-baseline" || command === "validate-candidate") {
        const stage =
          command === "validate-baseline" ? "baseline" : "candidate";
        delivery.validation.attempts.push({
          operationId: randomUUID(),
          stage,
          state: "stopped",
          outcome: changes[`${stage}Outcome`] ?? "passed",
          treeSha256:
            stage === "candidate" && !changes.otherTree
              ? delivery.feature.candidate.sha256
              : "b".repeat(64),
          results: [],
        });
        return structuredClone(delivery);
      }
      if (command === "qualify") {
        delivery.qualification = {
          offlineAdmission: { allowed: true },
          subscriptionMediation: {
            gatewayIntegration: changes.gateway ?? "passed",
            ...(endorsed && changes.decision !== false
              ? {
                  mechanismDecision: {
                    qualified: true,
                    runId: decisionRun,
                    usageAccountId: usageAccount,
                  },
                }
              : {}),
          },
        };
        return structuredClone(delivery);
      }
      if (command === "prepare-routed-turns")
        return { runId: routedRun, turns: Number(option(args, "--turns")) };
      if (command === "code-feature") {
        delivery.feature = {
          ...delivery.feature,
          outcome: changes.codingOutcome ?? "completed",
          session: {
            operationId: randomUUID(),
            state: changes.sessionState ?? "stopped",
            threadStarted: true,
            route: { deliveryId: id },
          },
          ...(changes.codingOutcome && changes.codingOutcome !== "completed"
            ? {}
            : { candidate: { sha256: "d".repeat(64) } }),
          branch: "aios/feature",
        };
        return {
          ...structuredClone(delivery),
          blocker: { code: "DELIVERY_NOT_ENABLED" },
        };
      }
      if (command === "repair-feature") {
        // Like finishRepair: the attempt keeps whatever coding session the
        // feature holds, which is the coding turn's when no repair turn ran.
        const outcome = changes.repairOutcome ?? "passed",
          coded = changes.repairCoded !== false,
          revalidated = coded && ["passed", "failed"].includes(outcome);
        if (coded)
          delivery.feature.session = {
            operationId: randomUUID(),
            state: "stopped",
            ...(changes.repairRouted === false
              ? {}
              : { route: { deliveryId: id } }),
          };
        const attempt = {
          state: changes.repairState ?? "stopped",
          outcome: coded ? outcome : "failed",
          codingSession: structuredClone(delivery.feature.session),
        };
        if (revalidated) {
          attempt.validationOperationId = randomUUID();
          delivery.validation.attempts.push({
            operationId: attempt.validationOperationId,
            stage: "candidate",
            state: "stopped",
            outcome,
            treeSha256: delivery.feature.candidate.sha256,
            results: [],
          });
        }
        delivery.repair = {
          attempts: [...(delivery.repair?.attempts ?? []), attempt],
        };
        return {
          ...structuredClone(delivery),
          blocker: { code: "DELIVERY_NOT_ENABLED" },
        };
      }
      if (command === "cancel") {
        if (delivery.repair)
          for (const attempt of delivery.repair.attempts)
            attempt.state = "stopped";
        delivery.feature.session.state = "stopped";
        return structuredClone(delivery);
      }
      if (command === "status") return structuredClone(delivery);
      refuse(`Unexpected CLI command ${command}`);
    },
    async script(name, args) {
      log.push([name, ...args]);
      if (changes.fail === `${name} ${args[0] ?? ""}`.trim())
        refuse(`${name} refused`);
      if (name === "record-mediation-decision" && args[0] === "prepare")
        return { status: "prepared", runId: decisionRun };
      if (name === "record-mediation-decision" && args[0] === "execute")
        return { status: "recorded", runId: option(args, "--approve-run") };
      if (name === "endorse-subscription-usage") {
        if (args.includes("--confirm")) {
          if (option(args, "--expect") !== usageAccount)
            refuse(
              "Usage endorsement refused: the observed usage account is not the expected one.",
            );
          endorsed = true;
        }
        return { usageAccountId: usageAccount, written: endorsed };
      }
      refuse(`Unexpected script ${name}`);
    },
  };
  return host;
}

async function prepared(t, changes) {
  const root = await privateRoot("aios-routed-run-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sim = simulated(changes);
  const session = await prepareRouted({
    ...sim,
    host,
    root,
    environment: offlineValidationEnvironment("e".repeat(64)),
  });
  return { root, sim, session };
}
const commands = (sim, name) =>
  sim.log.filter(([tool, command]) => tool === name || command === name);

test("prepare starts, plans and baselines a delivery, qualifies the fixed worker and plans one decision inference", async (t) => {
  const { root, sim, session } = await prepared(t);
  assert.equal(session.deliveryId, sim.id);
  assert.equal(session.decisionRunId, sim.decisionRun);
  assert.deepEqual(
    sim.log.map(([tool, command]) =>
      tool === "cli" ? command : `${tool} ${command}`,
    ),
    [
      "start",
      "plan-feature",
      "validate-baseline",
      "qualify",
      "record-mediation-decision prepare",
    ],
  );
  const [qualify] = commands(sim, "qualify");
  assert.equal(option(qualify, "--worker-policy"), host.workerPolicy);
  assert.ok(qualify.includes("--adversarial"));
  assert.equal(option(qualify, "--codex-executable"), host.codex);
  // The session holds what later phases need, privately.
  const path = join(root, "session.json");
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), session);
  if (process.platform !== "win32")
    assert.equal(statSync(path).mode & 0o777, 0o600);
  // No live request or approval is spent while preparing.
  assert.equal(commands(sim, "record-mediation-decision").length, 1);
});

test("prepare stops before planning an inference when the fixed worker's gateway evidence has not passed", async (t) => {
  const root = await privateRoot("aios-routed-run-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sim = simulated({ gateway: "not-run" });
  await assert.rejects(
    prepareRouted({
      ...sim,
      host,
      root,
      environment: offlineValidationEnvironment("e".repeat(64)),
    }),
    /fixed worker's gateway evidence/,
  );
  assert.equal(commands(sim, "record-mediation-decision").length, 0);
});

test("the owner's approvals pass through unchanged, each phase checks the last, and a candidate is validated", async (t) => {
  const { root, sim, session } = await prepared(t);
  // The decision run is the one prepare planned.
  await assert.rejects(
    decideRouted({ ...sim, session, approveRun: randomUUID() }),
    /prepared decision run/,
  );
  const decided = await decideRouted({
    ...sim,
    session,
    approveRun: sim.decisionRun,
  });
  assert.equal(decided.usageAccountId, usageAccount);
  const [execute] = commands(sim, "record-mediation-decision").slice(-1);
  assert.equal(option(execute, "--approve-run"), sim.decisionRun);
  assert.ok(execute.includes("--approve-unknown-usage"));
  await assert.rejects(
    routeRouted({
      ...sim,
      session: decided,
      usageAccount: "f".repeat(64),
      turns: 1,
    }),
    /not the expected one/,
  );
  const routed = await routeRouted({
    ...sim,
    session: decided,
    usageAccount,
    turns: 1,
  });
  assert.equal(routed.routedRunId, sim.routedRun);
  assert.equal(routed.routedTurns, 1);
  await assert.rejects(
    codeRouted({
      ...sim,
      session: routed,
      approveRun: sim.routedRun,
      turns: 2,
    }),
    /prepared routed run/,
  );
  const report = await codeRouted({
    ...sim,
    session: routed,
    approveRun: sim.routedRun,
    turns: 1,
  });
  assert.equal(report.outcome, routedOutcomes.validated);
  assert.equal(report.coding.routed, true);
  assert.equal(report.candidateValidation.outcome, "passed");
  const [code] = commands(sim, "code-feature");
  for (const [name, value] of [
    ["--approve-run", sim.routedRun],
    ["--approve-turns", "1"],
    ["--worker-policy", host.workerPolicy],
    ["--auth-directory", host.authDirectory],
    ["--auth-account", host.authAccount],
    ["--coding-admission", host.codingAdmission],
    ["--validation-admission", host.validationAdmission],
    ["--codex-executable", host.codex],
  ])
    assert.equal(option(code, name), value, name);
  assert.ok(code.includes("--adversarial"));
  assert.deepEqual(
    JSON.parse(readFileSync(join(root, "report.json"), "utf8")),
    report,
  );
});

test("decide resumes at the usage preview when this run's decision is already recorded", async (t) => {
  const { sim, session } = await prepared(t);
  const decided = await decideRouted({
    ...sim,
    session,
    approveRun: sim.decisionRun,
    recorded: () => ({ runId: sim.decisionRun, deliveryId: sim.id }),
  });
  assert.equal(decided.decisionRecorded, true);
  assert.equal(decided.usageAccountId, usageAccount);
  assert.deepEqual(
    commands(sim, "record-mediation-decision").map(([, phase]) => phase),
    ["prepare"],
  );
});

test("decide spends its approval when the recorded decision is another run's", async (t) => {
  for (const record of [
    { runId: randomUUID() },
    { runId: "", deliveryId: "" },
    undefined,
  ]) {
    const { sim, session } = await prepared(t);
    await decideRouted({
      ...sim,
      session,
      approveRun: sim.decisionRun,
      recorded: () => record && { deliveryId: sim.id, ...record },
    });
    assert.deepEqual(
      commands(sim, "record-mediation-decision").map(([, phase]) => phase),
      ["prepare", "execute"],
    );
  }
});

test("route stops when the endorsed decision does not qualify", async (t) => {
  const { sim, session } = await prepared(t, { decision: false });
  const decided = await decideRouted({
    ...sim,
    session,
    approveRun: sim.decisionRun,
  });
  await assert.rejects(
    routeRouted({ ...sim, session: decided, usageAccount, turns: 1 }),
    /decision does not qualify/,
  );
  assert.equal(commands(sim, "prepare-routed-turns").length, 0);
});

test("a routed turn without a candidate is reported, and anything left open is stopped by its exact identity", async (t) => {
  const { sim, session } = await prepared(t, {
    codingOutcome: "exhausted",
    sessionState: "running",
  });
  const decided = await decideRouted({
    ...sim,
    session,
    approveRun: sim.decisionRun,
  });
  const routed = await routeRouted({
    ...sim,
    session: decided,
    usageAccount,
    turns: 1,
  });
  const report = await codeRouted({
    ...sim,
    session: routed,
    approveRun: sim.routedRun,
    turns: 1,
  });
  assert.equal(report.outcome, routedOutcomes.withoutCandidate);
  assert.equal(report.coding.candidate, false);
  assert.equal(commands(sim, "validate-candidate").length, 0);
  const [cancel] = commands(sim, "cancel");
  assert.equal(option(cancel, "--id"), sim.id);
  assert.equal(option(cancel, "--coding-admission"), host.codingAdmission);
  assert.equal(report.finalStop, "stopped");
});

test("a refused routed turn is reported as blocked, never as a pass", async (t) => {
  const { sim, session } = await prepared(t, { fail: "code-feature" });
  const decided = await decideRouted({
    ...sim,
    session,
    approveRun: sim.decisionRun,
  });
  const routed = await routeRouted({
    ...sim,
    session: decided,
    usageAccount,
    turns: 1,
  });
  const report = await codeRouted({
    ...sim,
    session: routed,
    approveRun: sim.routedRun,
    turns: 1,
  });
  assert.equal(report.outcome, "blocked");
  assert.match(report.error, /The CLI refused code-feature/);
});

test("the owner's commands name every input, and each phase only its own approvals", () => {
  const script = fileURLToPath(
    new URL("../scripts/run-native-routed-delivery.mjs", import.meta.url),
  );
  const run = randomUUID();
  for (const args of [
    [],
    ["prepare", "--state-dir", "/owner/state"],
    ["decide", "--session", "/owner/session.json", "--approve-run", run],
    ["decide", "--session", "/owner/session.json", "--approve-unknown-usage"],
    [
      "route",
      "--session",
      "/owner/session.json",
      "--expect-usage-account",
      usageAccount,
      "--turns",
      "3",
    ],
    ["code", "--session", "/owner/session.json", "--approve-run", run],
    [
      "code",
      "--session",
      "/owner/session.json",
      "--approve-run",
      run,
      "--approve-turns",
      "1",
      "--approve-unknown-usage",
    ],
    ["publish", "--session", "/owner/session.json"],
    ["plan-repair"],
    ["plan-repair", "--session", "/owner/session.json", "--turns", "1"],
    ["repair", "--session", "/owner/session.json"],
    // A repair is one turn; its approval names the run only.
    [
      "repair",
      "--session",
      "/owner/session.json",
      "--approve-run",
      run,
      "--approve-turns",
      "1",
    ],
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
    });
    assert.equal(result.status, 1, args.join(" "));
    assert.match(JSON.parse(result.stderr).error, /^Usage/, args.join(" "));
  }
});

// The repair evidence (Issue 04 plan, slice 1): after a routed candidate fails
// validation, one routed repair turn under a fresh, one-turn approval.
async function failedCandidate(t, changes = {}) {
  const { root, sim, session } = await prepared(t, {
    candidateOutcome: "failed",
    ...changes,
  });
  const decided = await decideRouted({
    ...sim,
    session,
    approveRun: sim.decisionRun,
  });
  const routed = await routeRouted({
    ...sim,
    session: decided,
    usageAccount,
    turns: 1,
  });
  const coded = await codeRouted({
    ...sim,
    session: routed,
    approveRun: sim.routedRun,
    turns: 1,
  });
  assert.equal(coded.candidateValidation.outcome, "failed");
  return { root, sim, session: routed };
}

// Plans the repair of a failed candidate, then spends its approval on it.
async function repaired(t, changes) {
  const { root, sim, session } = await failedCandidate(t, changes);
  const planned = await planRepairRouted({ ...sim, session });
  const report = await repairRouted({
    ...sim,
    session: planned,
    approveRun: planned.repairRunId,
  });
  return { root, sim, planned, report };
}

test("plan-repair plans one fresh routed turn only after the candidate failed validation", async (t) => {
  const { sim, session } = await failedCandidate(t);
  const planned = await planRepairRouted({ ...sim, session });
  assert.equal(planned.repairRunId, sim.routedRun);
  const [plan] = commands(sim, "prepare-routed-turns").slice(-1);
  assert.equal(option(plan, "--turns"), "1");
  assert.equal(option(plan, "--id"), sim.id);
  assert.equal(option(plan, "--coding-admission"), host.codingAdmission);
  assert.equal(option(plan, "--auth-account"), host.authAccount);
  // Planning sends nothing live.
  assert.equal(commands(sim, "repair-feature").length, 0);
});

test("plan-repair refuses a candidate that passed, or a delivery without one", async (t) => {
  const passed = await prepared(t);
  const decided = await decideRouted({
    ...passed.sim,
    session: passed.session,
    approveRun: passed.sim.decisionRun,
  });
  const routed = await routeRouted({
    ...passed.sim,
    session: decided,
    usageAccount,
    turns: 1,
  });
  await assert.rejects(
    planRepairRouted({ ...passed.sim, session: routed }),
    /candidate that failed validation/,
  );
  await codeRouted({
    ...passed.sim,
    session: routed,
    approveRun: passed.sim.routedRun,
    turns: 1,
  });
  await assert.rejects(
    planRepairRouted({ ...passed.sim, session: routed }),
    /candidate that failed validation/,
  );
  assert.equal(commands(passed.sim, "prepare-routed-turns").length, 1);
});

test("a routed repair turn spends the fresh approval and its revalidation is reported", async (t) => {
  const { root, sim, session } = await failedCandidate(t);
  const planned = await planRepairRouted({ ...sim, session });
  await assert.rejects(
    repairRouted({ ...sim, session: planned, approveRun: randomUUID() }),
    /prepared repair run/,
  );
  const report = await repairRouted({
    ...sim,
    session: planned,
    approveRun: planned.repairRunId,
  });
  assert.equal(report.outcome, repairOutcomes.validated);
  assert.equal(report.repair.routed, true);
  assert.equal(report.repair.outcome, "passed");
  assert.equal(report.candidateValidation.outcome, "passed");
  assert.equal(report.productionEnabled, false);
  const [repair] = commands(sim, "repair-feature");
  for (const [name, value] of [
    ["--id", sim.id],
    ["--approve-run", planned.repairRunId],
    ["--approve-turns", "1"],
    ["--worker-policy", host.workerPolicy],
    ["--auth-directory", host.authDirectory],
    ["--auth-account", host.authAccount],
    ["--coding-admission", host.codingAdmission],
    ["--validation-admission", host.validationAdmission],
    ["--codex-executable", host.codex],
  ])
    assert.equal(option(repair, name), value, name);
  assert.ok(repair.includes("--adversarial"));
  assert.equal(repair.includes("--coding-minutes"), false);
  assert.deepEqual(
    JSON.parse(readFileSync(join(root, "repair-report.json"), "utf8")),
    report,
  );
  // The code phase's report is kept.
  assert.equal(
    JSON.parse(readFileSync(join(root, "report.json"), "utf8"))
      .candidateValidation.outcome,
    "failed",
  );
});

test("a routed repair that still fails validation is reported as observed, not as a pass", async (t) => {
  const { sim, report } = await repaired(t, {
    repairOutcome: "failed",
  });
  assert.equal(report.outcome, repairOutcomes.stillFailing);
  assert.equal(report.candidateValidation.outcome, "failed");
});

test("an unrouted or refused repair is blocked, and anything left open is stopped", async (t) => {
  for (const [changes, error] of [
    [{ repairRouted: false }, /repair turn was not routed/],
    [{ fail: "repair-feature" }, /The CLI refused repair-feature/],
  ]) {
    const { sim, report } = await repaired(t, changes);
    assert.equal(report.outcome, "blocked");
    assert.match(report.error, error);
  }
  const { sim, report } = await repaired(t, { repairState: "running" });
  assert.equal(report.finalStop, "stopped");
  assert.equal(option(commands(sim, "cancel").at(-1), "--id"), sim.id);
});

test("a repair attempt without a new coded turn is blocked, never reported as still failing", async (t) => {
  for (const [changes, error] of [
    [{ repairCoded: false }, /No repair turn was coded/],
    [{ repairOutcome: "interrupted" }, /repair did not revalidate/],
    [{ repairOutcome: "exhausted" }, /repair did not revalidate/],
  ]) {
    const { sim, report } = await repaired(t, changes);
    assert.equal(report.outcome, "blocked", JSON.stringify(changes));
    assert.match(report.error, error);
  }
});

test("plan-repair refuses a candidate repair-feature would refuse", async (t) => {
  // The failed validation is of another tree than the candidate's.
  const other = await failedCandidate(t, { otherTree: true });
  await assert.rejects(
    planRepairRouted({ ...other.sim, session: other.session }),
    /candidate that failed validation/,
  );
  // The candidate's coding turn was not routed.
  const unrouted = await failedCandidate(t);
  delete unrouted.sim.delivery.feature.session.route;
  await assert.rejects(
    planRepairRouted({ ...unrouted.sim, session: unrouted.session }),
    /candidate that failed validation/,
  );
  // An attempt is still open.
  const open = await failedCandidate(t);
  open.sim.delivery.validation.attempts.at(-1).state = "running";
  await assert.rejects(
    planRepairRouted({ ...open.sim, session: open.session }),
    /candidate that failed validation/,
  );
  for (const { sim } of [other, unrouted, open])
    assert.equal(commands(sim, "prepare-routed-turns").length, 1);
});
