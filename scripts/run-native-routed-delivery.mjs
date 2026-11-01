#!/usr/bin/env node
// Owner-run: the first routed live turn of one delivery through the real CLI,
// on the host's dedicated VM, in its authority state (ADR 0002, ADR 0004). It
// runs in four owner commands, so each approval is given in between:
//
//   prepare: synthetic owner inputs (as the CLI acceptance writes them),
//     `start`, `plan-feature`, `validate-baseline`, the fixed worker's
//     `qualify --adversarial`, and a planned decision inference. No credential
//     is read and nothing live is sent.
//   decide: spends the owner's approval of the decision run (one live
//     request), records the delivery's mediation decision and previews the
//     usage account to endorse.
//   route: endorses that usage account, re-qualifies until the decision
//     qualifies, and plans the routed turns.
//   code: spends the owner's approval of the routed run on a routed
//     `code-feature` turn, validates an admitted candidate, stops anything
//     left open by its exact identity and writes the report.
//
// Production stays disabled: an admitted candidate still ends at
// DELIVERY_NOT_ENABLED, and nothing is published.
import { spawn } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import {
  cliRunner,
  ownerInputs,
  privateRoot,
  request,
} from "./run-native-cli-delivery-acceptance.mjs";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
/** The coding allowance for the routed turn, in minutes. */
export const codingMinutes = 10;
export const routedOutcomes = Object.freeze({
  validated: "observed-routed-validated-candidate",
  withoutCandidate: "observed-routed-turn-without-candidate",
});
const check = (condition, message) => {
  if (!condition) throw Error(message);
};
const bounded = (text) => String(text).slice(0, 300);

function save(session) {
  writeFileSync(
    join(session.root, "session.json"),
    JSON.stringify(session, null, 2),
    { mode: 0o600 },
  );
  return session;
}
const owner = (s) => [
  "--owner-policy",
  s.policyPath,
  "--onboarding-attestation",
  s.attestationPath,
];
const validation = (h) => [
  "--podman-machine",
  h.machine,
  "--validation-admission",
  h.validationAdmission,
];
const fixedWorker = (h) => [
  "--podman-machine",
  h.machine,
  "--worker-policy",
  h.workerPolicy,
  "--codex-executable",
  h.codex,
  "--adversarial",
];
const decisionInputs = (s) => [
  "--state-dir",
  s.host.state,
  "--id",
  s.deliveryId,
  "--podman-machine",
  s.host.machine,
  "--worker-policy",
  s.host.workerPolicy,
  "--auth-directory",
  s.host.authDirectory,
  "--auth-account",
  s.host.authAccount,
];
const endorsement = (s) => [
  "--state-dir",
  s.host.state,
  "--delivery",
  s.deliveryId,
  "--codex-executable",
  s.host.codex,
];

/** Start, plan and baseline a delivery in the host's authority state,
 * qualify it on the fixed worker and plan its decision inference. `run` is
 * one CLI process; `script` one owner script process. */
export async function prepareRouted({ run, script, host, root, environment }) {
  const inputs = ownerInputs(root, environment);
  const session = {
    schema: 1,
    root,
    host,
    repository: inputs.repository,
    revision: inputs.revision,
    policyPath: inputs.policyPath,
    attestationPath: inputs.attestationPath,
  };
  const started = await run([
    "start",
    "--repo",
    inputs.repository,
    "--request",
    request,
    ...owner(session),
    "--coding-minutes",
    String(codingMinutes),
  ]);
  check(uuid.test(started.id ?? ""), "The CLI started no delivery");
  check(
    started.onboarding?.ready === true,
    "Onboarding is not ready from the local hints and the attestation",
  );
  session.deliveryId = started.id;
  save(session);
  const planned = await run([
    "plan-feature",
    "--id",
    started.id,
    "--feature-criteria",
    inputs.criteria(started.id),
  ]);
  check(
    planned.feature?.outcome === "planned",
    "The owner's criteria were not planned",
  );
  const baseline = (
    await run([
      "validate-baseline",
      "--id",
      started.id,
      ...owner(session),
      ...validation(host),
    ])
  ).validation?.attempts.at(-1);
  check(
    baseline?.stage === "baseline" &&
      baseline.state === "stopped" &&
      baseline.outcome === "passed",
    "The baseline did not pass on the admitted validation runtime",
  );
  const qualified = await run([
    "qualify",
    "--id",
    started.id,
    ...fixedWorker(host),
  ]);
  check(
    qualified.qualification?.offlineAdmission?.allowed === true &&
      qualified.qualification.subscriptionMediation?.gatewayIntegration ===
        "passed",
    "The fixed worker's gateway evidence has not passed for this delivery",
  );
  const plan = await script("record-mediation-decision", [
    "prepare",
    ...decisionInputs(session),
  ]);
  check(
    plan.status === "prepared" && uuid.test(plan.runId ?? ""),
    "No decision inference was planned",
  );
  session.decisionRunId = plan.runId;
  return save(session);
}

/** Spend the owner's approval of the prepared decision run, and preview the
 * usage account the owner then endorses. */
export async function decideRouted({ script, session, approveRun }) {
  check(
    approveRun === session.decisionRunId,
    "The approval does not name the prepared decision run",
  );
  const recorded = await script("record-mediation-decision", [
    "execute",
    ...decisionInputs(session),
    "--approve-run",
    approveRun,
    "--approve-unknown-usage",
  ]);
  check(
    recorded.status === "recorded" && recorded.runId === approveRun,
    "No decision was recorded",
  );
  const preview = await script(
    "endorse-subscription-usage",
    endorsement(session),
  );
  check(
    /^[a-f0-9]{64}$/.test(preview.usageAccountId ?? ""),
    "No usage account was observed",
  );
  session.decisionRecorded = true;
  session.usageAccountId = preview.usageAccountId;
  return save(session);
}

/** Endorse the previewed usage account, confirm the decision qualifies, and
 * plan the routed turns the owner approves next. */
export async function routeRouted({
  run,
  script,
  session,
  usageAccount,
  turns,
}) {
  check(session.decisionRecorded === true, "Record the decision first");
  await script("endorse-subscription-usage", [
    ...endorsement(session),
    "--expect",
    usageAccount,
    "--confirm",
    "true",
  ]);
  const qualified = await run([
    "qualify",
    "--id",
    session.deliveryId,
    ...fixedWorker(session.host),
  ]);
  const decision =
    qualified.qualification?.subscriptionMediation?.mechanismDecision;
  check(
    decision?.qualified === true &&
      decision.runId === session.decisionRunId &&
      decision.usageAccountId === usageAccount,
    "The endorsed decision does not qualify",
  );
  const plan = await run([
    "prepare-routed-turns",
    "--id",
    session.deliveryId,
    "--podman-machine",
    session.host.machine,
    "--coding-admission",
    session.host.codingAdmission,
    "--auth-account",
    session.host.authAccount,
    "--turns",
    String(turns),
  ]);
  check(uuid.test(plan.runId ?? ""), "No routed run was planned");
  session.routedRunId = plan.runId;
  session.routedTurns = turns;
  return save(session);
}

/** Spend the owner's approval of the routed run on one routed turn, validate
 * an admitted candidate, and stop anything left open. Returns the report,
 * also written as `report.json`; a refusal is reported, never thrown. */
export async function codeRouted({ run, session, approveRun, turns }) {
  check(
    approveRun === session.routedRunId && turns === session.routedTurns,
    "The approval does not name the prepared routed run and its turns",
  );
  const h = session.host;
  const report = {
    scope: "native-routed-delivery",
    deliveryId: session.deliveryId,
    decisionRunId: session.decisionRunId,
    routedRunId: approveRun,
    productionEnabled: false,
    synthetic: ["repository", "owner-policy", "attestation", "criteria"],
    outcome: "running",
  };
  const persist = () =>
    writeFileSync(
      join(session.root, "report.json"),
      JSON.stringify(report, null, 2),
      { mode: 0o600 },
    );
  try {
    const coded = await run([
      "code-feature",
      "--id",
      session.deliveryId,
      ...owner(session),
      ...validation(h),
      "--coding-admission",
      h.codingAdmission,
      "--codex-executable",
      h.codex,
      "--coding-minutes",
      String(codingMinutes),
      "--worker-policy",
      h.workerPolicy,
      "--adversarial",
      "--auth-directory",
      h.authDirectory,
      "--auth-account",
      h.authAccount,
      "--approve-run",
      approveRun,
      "--approve-turns",
      String(turns),
    ]);
    const feature = coded.feature,
      s = feature?.session;
    report.coding = {
      outcome: feature?.outcome ?? null,
      state: s?.state ?? null,
      threadStarted: s?.threadStarted === true,
      routed: Boolean(s?.route),
      candidate: Boolean(feature?.candidate),
      branch: feature?.branch ?? null,
      blocker: coded.blocker?.code ?? null,
    };
    check(report.coding.routed, "The turn was not routed");
    if (report.coding.candidate) {
      const attempt = (
        await run([
          "validate-candidate",
          "--id",
          session.deliveryId,
          ...owner(session),
          ...validation(h),
        ])
      ).validation?.attempts.at(-1);
      report.candidateValidation = {
        stage: attempt?.stage ?? null,
        state: attempt?.state ?? null,
        outcome: attempt?.outcome ?? null,
      };
      check(
        attempt?.stage === "candidate" &&
          attempt.state === "stopped" &&
          attempt.outcome === "passed",
        "The candidate did not pass validation",
      );
      report.outcome = routedOutcomes.validated;
    } else report.outcome = routedOutcomes.withoutCandidate;
  } catch (error) {
    report.error = bounded(error?.message);
    report.outcome = "blocked";
  } finally {
    // An unsettled session or attempt is stopped by its exact identity.
    try {
      const open = (d) =>
        (d.feature?.session && d.feature.session.state !== "stopped") ||
        d.validation?.attempts.some((a) => a.state !== "stopped");
      let current = await run(["status", "--id", session.deliveryId]);
      if (open(current)) {
        await run([
          "cancel",
          "--id",
          session.deliveryId,
          ...validation(h),
          "--coding-admission",
          h.codingAdmission,
        ]);
        current = await run(["status", "--id", session.deliveryId]);
        check(!open(current), "Exact stop is uncertain");
        report.finalStop = "stopped";
      }
    } catch {
      report.finalStop = "uncertain";
      report.outcome = "uncertain";
    }
    persist();
  }
  return report;
}

/** One owner script as a process: its JSON result, or its message as an
 * error. */
function scriptRunner() {
  return (name, args) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [fileURLToPath(new URL(`./${name}.mjs`, import.meta.url)), ...args],
        { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
      );
      const out = [],
        err = [];
      child.stdout.on("data", (chunk) => out.push(chunk));
      child.stderr.on("data", (chunk) => err.push(chunk));
      child.once("error", reject);
      child.once("close", (status) => {
        const stdout = Buffer.concat(out).toString("utf8"),
          stderr = Buffer.concat(err).toString("utf8").trim();
        if (status !== 0) {
          let message = stderr;
          try {
            message = JSON.parse(stderr.split("\n").at(-1)).error ?? stderr;
          } catch {}
          return reject(
            Error(bounded(message || `${name} exited with ${status}`)),
          );
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(Error(`${name} printed no result`));
        }
      });
    });
}
/** One CLI process: its JSON result, or the CLI's bounded refusal. */
function cliJson(state) {
  const cli = cliRunner(state);
  return async (args) => {
    const result = await cli(args);
    if (result.status !== 0) {
      for (const line of result.stderr.split("\n").reverse())
        try {
          const error = JSON.parse(line).error;
          if (typeof error === "string") throw Error(bounded(error));
        } catch (error) {
          if (error instanceof SyntaxError) continue;
          throw error;
        }
      throw Error(`The CLI exited with ${result.status}`);
    }
    return JSON.parse(result.stdout);
  };
}

const usage = `Usage (owner-run, on one host, from a fresh build of main):
  node scripts/run-native-routed-delivery.mjs prepare --state-dir STATE --podman-machine MACHINE --worker-policy PINS --coding-admission FILE --validation-admission FILE --codex-executable CODEX --auth-directory DIR --auth-account ACCOUNT
  node scripts/run-native-routed-delivery.mjs decide --session FILE --approve-run RUN --approve-unknown-usage
  node scripts/run-native-routed-delivery.mjs route --session FILE --expect-usage-account HASH --turns 1|2
  node scripts/run-native-routed-delivery.mjs code --session FILE --approve-run RUN --approve-turns 1|2`;

async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: Object.fromEntries(
      [
        "state-dir",
        "podman-machine",
        "worker-policy",
        "coding-admission",
        "validation-admission",
        "codex-executable",
        "auth-directory",
        "auth-account",
        "session",
        "approve-run",
        "expect-usage-account",
        "turns",
        "approve-turns",
      ]
        .map((name) => [name, { type: "string" }])
        .concat([["approve-unknown-usage", { type: "boolean" }]]),
    ),
  });
  const [phase] = positionals;
  const needs = {
    prepare: [
      "state-dir",
      "podman-machine",
      "worker-policy",
      "coding-admission",
      "validation-admission",
      "codex-executable",
      "auth-directory",
      "auth-account",
    ],
    decide: ["session", "approve-run"],
    route: ["session", "expect-usage-account", "turns"],
    code: ["session", "approve-run", "approve-turns"],
  }[phase];
  const turns = Number(values.turns ?? values["approve-turns"]);
  if (
    positionals.length !== 1 ||
    !needs ||
    needs.some((name) => !values[name]) ||
    Object.keys(values).some(
      (name) =>
        !needs.includes(name) &&
        !(phase === "decide" && name === "approve-unknown-usage"),
    ) ||
    (phase === "decide" && values["approve-unknown-usage"] !== true) ||
    (["route", "code"].includes(phase) && ![1, 2].includes(turns))
  )
    throw Error(usage);
  if (phase === "prepare") {
    const host = {
      state: realpathSync(values["state-dir"]),
      machine: values["podman-machine"],
      workerPolicy: realpathSync(values["worker-policy"]),
      codingAdmission: realpathSync(values["coding-admission"]),
      validationAdmission: realpathSync(values["validation-admission"]),
      codex: realpathSync(values["codex-executable"]),
      authDirectory: realpathSync(values["auth-directory"]),
      authAccount: values["auth-account"],
    };
    const { ownerValidationAdmission, offlineValidationEnvironment } =
      await import("../dist/native-validation.js");
    const { imageSha256 } = ownerValidationAdmission(
      host.validationAdmission,
    ).pins();
    const root = await privateRoot(
      "aios-routed-delivery-",
      join(host.state, ".."),
    );
    const session = await prepareRouted({
      run: cliJson(host.state),
      script: scriptRunner(),
      host,
      root,
      environment: offlineValidationEnvironment(imageSha256),
    });
    return {
      status: "prepared",
      session: join(root, "session.json"),
      deliveryId: session.deliveryId,
      decisionRunId: session.decisionRunId,
      next: "Approve the decision run: it sends one live request.",
    };
  }
  const session = JSON.parse(readFileSync(values.session, "utf8"));
  const run = cliJson(session.host.state),
    script = scriptRunner();
  if (phase === "decide") {
    const decided = await decideRouted({
      script,
      session,
      approveRun: values["approve-run"],
    });
    return {
      status: "decided",
      usageAccountId: decided.usageAccountId,
      next: "Check that this usage account is yours, then endorse it with route.",
    };
  }
  if (phase === "route") {
    const routed = await routeRouted({
      run,
      script,
      session,
      usageAccount: values["expect-usage-account"],
      turns,
    });
    return {
      status: "routed",
      routedRunId: routed.routedRunId,
      turns: routed.routedTurns,
      next: "Approve the routed run and its turns: they send live model requests.",
    };
  }
  const report = await codeRouted({
    run,
    session,
    approveRun: values["approve-run"],
    turns,
  });
  if (!Object.values(routedOutcomes).includes(report.outcome))
    process.exitCode = 1;
  return { ...report, report: join(session.root, "report.json") };
}

// Compare real paths, so a symlinked checkout still runs.
const invoked = process.argv[1] && realpathSync(process.argv[1]);
if (invoked && import.meta.url === pathToFileURL(invoked).href)
  main(process.argv.slice(2)).then(
    (result) => console.log(JSON.stringify(result)),
    (error) => {
      console.error(
        JSON.stringify({
          status: "refused",
          error: bounded(error?.message),
          productionEnabled: false,
        }),
      );
      process.exitCode = 1;
    },
  );
