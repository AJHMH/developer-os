#!/usr/bin/env node
// Owner-run credentialed qualification of a routed coding session on a real
// dedicated VM (Issue 04 plan, slice 5). It spends subscription usage: at
// most two provider turns, a launch and its explicit resume (owner decision
// B), each with a 3-minute allowance and a fixed trivial prompt. It never
// provisions or starts the VM, never enables production and never claims
// qualification. Run `prepare` first; then run it through
// scripts/run-native-acceptance.mjs with the owner's one-shot approval.
//
// The turns are driven on the transport directly, as in the routed
// acceptance (owner decision, 29 October): the real native transport, the
// real `GeneralSessionGateway` with the real provider, the owner's vault
// account and a real usage observation at every model request. The
// controller's mediation decision is not involved; the usage canary covers
// it offline.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { arch, platform, release } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { freshBuild } from "./fresh-build.mjs";

const usage = [
  "Usage: node scripts/run-native-credentialed-qualification.mjs prepare <aios-machine> <owner-coding-admission.json> <account-id> <private-state-dir>",
  "       node scripts/run-native-credentialed-qualification.mjs <aios-machine> <owner-coding-admission.json> <auth-dir> <account-id> <pinned-codex-executable> <private-state-dir> <new-report.json> --approve-run <run-id> --approve-turns 2",
].join("\n");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const passingOutcome = "observed-credentialed-qualification";
/** Owner decision B: a launch and its resume, and nothing more. */
export const approvedTurns = 2;
const allowanceMs = 180_000;
/** A trivial turn makes a few model requests; this bounds a runaway one. */
const maxRequests = 8;
const planMs = 60 * 60_000;
const codingPinFields = [
  "cliVersion",
  "cliSha256",
  "codeModeHostSha256",
  "policySha256",
  "bindingSha256",
];
const same = (a, b) => codingPinFields.every((field) => a[field] === b[field]);
const pinsSha256 = (pins) =>
  sha256(JSON.stringify(codingPinFields.map((field) => pins[field])));
const admittedFile = "canary.txt";
const admittedBytes = Buffer.from("AIOS credentialed canary\n");
const files = () => [
  { path: admittedFile, bytes: Buffer.from(admittedBytes), executable: false },
];
const inputSha256 = sha256(
  JSON.stringify([
    { path: admittedFile, sha256: sha256(admittedBytes), executable: false },
  ]),
);
/** The fixed prompt: one tool call, then a one-line answer. */
export const prompt = (tag) =>
  `AIOS credentialed qualification, ${tag}. Run \`cat /workspace/${admittedFile}\` once with exec_command, then reply with exactly the line it printed and nothing else.`;
/** Every stage, in order. */
export const stageNames = Object.freeze([
  "coding-fresh-pins",
  "owner-record-names-fresh-pins",
  "account-eligible",
  "usage-before",
  "routed-launch-live-probe",
  "routed-launch-answered",
  "routed-launch-grant-revoked",
  "routed-launch-exact-stop",
  "routed-launch-output-collected",
  "routed-resume-exhausted-mid-turn",
  "routed-resume-workspace-preserved",
  "credential-not-visible",
  "restart-refused-without-fresh-approval",
  "usage-after",
]);

/** Only complete JSON lines count; a partial final line is not evidence. */
function eventsIn(bytes) {
  return bytes
    .toString("utf8")
    .split("\n")
    .slice(0, -1)
    .flatMap((line) => {
      try {
        const event = JSON.parse(line);
        return event && typeof event === "object" ? [event] : [];
      } catch {
        return [];
      }
    });
}

/** Fresh usage authority for one model request: anything but a fresh,
 * measured, healthy window of the same usage account refuses. Low usage is
 * refused rather than approved mid-run (owner decision C is met strictly, as
 * H does for unknown usage); the owner reruns once usage recovers. */
export function usageAuthority(report, expectedAccount) {
  if (report.decision === "exhausted") return "exhausted";
  if (report.remainingPercent === null) return "unknown";
  if (expectedAccount && report.accountId !== expectedAccount) return "account";
  return report.decision === "ready" ? "permitted" : "approval-required";
}
/** Counts and fixed labels from a usage report, never windows or email. */
const usageSummary = (report) => ({
  decision: report.decision,
  remainingPercent: report.remainingPercent,
  accountIdSha256: report.accountId ? sha256(report.accountId) : null,
  checkedAt: report.checkedAt,
});

/** Run the credentialed lineage against `transport` under the owner's coding
 * `admission`, the owner's `account` (a function returning the vault's
 * `GatewayAccount`, read at each request), its `accountId` and `hostId`, the
 * owner's `observeUsage` (a fresh assessed usage report) and the real
 * `provider`. `persist` receives the report after every stage. */
export async function credentialedQualification(
  { transport, admission, account, accountId, hostId, observeUsage, provider },
  options = {},
) {
  const persist = options.persist ?? (() => {});
  const interrupted = options.interrupted ?? (() => false);
  const { GeneralSessionGateway, GeneralSessionRefusal } = await import(
    "../dist/general-session-gateway.js"
  );
  const { lockedCodingArgv } = await import("../dist/feature-candidate.js");
  const { accountEligibility, subscriptionAccountId } = await import(
    "../dist/subscription-account.js"
  );
  const { codingBoundaryProbeNames } = await import("../dist/worker-probes.js");
  const { gatewayModel } = await import("../dist/inference-contract.js");
  const report = {
    scope: "native-coding-credentialed-qualification",
    productionEnabled: false,
    qualified: false,
    inferenceAuthorized: true,
    approvedTurns,
    // Decision D: the gateway refuses any other model.
    model: gatewayModel,
    outcome: "running",
    stages: [],
  };
  const check = (condition, message) => {
    if (!condition) throw Error(message);
  };
  // Errors are bounded, and never carry the credential even if an adapter
  // echoed it.
  const bounded = (error) => {
    let text = String(error?.message).slice(0, 300);
    try {
      const token = account().accessToken;
      if (token) text = text.split(token).join("<credential>");
    } catch {}
    return text;
  };
  const origin = performance.now(),
    elapsed = () => Math.round(performance.now() - origin);
  async function stage(name, action) {
    const entry = { name, outcome: "running", startedMs: elapsed() };
    report.stages.push(entry);
    persist(report);
    try {
      const result = await action();
      check(!interrupted(), "Interrupted");
      entry.outcome = "passed";
      return result;
    } catch (error) {
      entry.outcome = "blocked";
      entry.error = bounded(error);
      throw error;
    } finally {
      entry.finishedMs = elapsed();
      persist(report);
    }
  }

  const deliveryId = randomUUID();
  const decisionSha256 = sha256(
    "aios-native-credentialed-qualification:" + deliveryId,
  );
  const sourceRevision = sha256("aios-native-credentialed-qualification").slice(
    0,
    40,
  );
  const attempted = [];
  // Every byte a turn's session sent to the host, and every collected file,
  // searched for the credential at the end.
  const seen = [];
  let usageAccount,
    nextFence = 0;
  const session = (intent) => ({
    operationId: randomUUID(),
    fence: (nextFence += 1),
    state: "running",
    intent,
  });
  const stopped = (s) => ({ ...s, state: "stopped" });
  async function observe() {
    const assessed = await observeUsage();
    return { assessed, authority: usageAuthority(assessed, usageAccount) };
  }

  /** Start one routed turn under the approval. `standIn(n)` may replace the
   * authority of the turn's `n`th model request with a synthetic lapse;
   * `beforeFirst` runs while the first request waits. */
  function startTurn(s, tag, { threadId, resumeFrom, standIn, beforeFirst }) {
    // Counted before any effect: the approval names the turns, not a budget.
    check(
      attempted.length < approvedTurns,
      `The run approval allows exactly ${approvedTurns} turns`,
    );
    attempted.push(s);
    const route = {
      deliveryId,
      decisionSha256,
      capability: randomBytes(32).toString("hex"),
    };
    const turn = (report[tag] = {
      fence: s.fence,
      capabilitySha256: sha256(route.capability),
      authority: [],
    });
    let lapsed;
    const gateway = new GeneralSessionGateway(
      {
        deliveryId,
        sessionId: s.operationId,
        accountId,
        hostId,
        expiresAt: Date.now() + allowanceMs + 60_000,
        maxRequests,
      },
      account,
      async () => {
        const n = turn.authority.length + 1;
        if (n === 1 && beforeFirst) await beforeFirst();
        const { assessed, authority } = await observe();
        const decided =
          (interrupted() && "withdrawn") || standIn?.(n) || authority;
        turn.authority.push({ ...usageSummary(assessed), authority, decided });
        if (decided !== "permitted") lapsed ??= decided;
        return decided;
      },
      provider,
    );
    let output = Buffer.alloc(0);
    const live = () => !interrupted() && !lapsed;
    const running = transport
      .run(
        {
          ...s,
          ...(threadId ? { threadId, resumeFrom } : {}),
          pins: report.pins,
          argv: [...lockedCodingArgv(threadId, route), prompt(tag)],
          branch: "codex/issue04-native-credentialed-qualification",
          sourceRevision,
          files: files(),
          inputSha256,
          modelRoute: route,
          allowanceMs,
          mayDispatch: live,
          checkpoint: live,
          onEvent: live,
        },
        (chunk) => {
          output = Buffer.concat([output, chunk]);
          check(output.length <= 262144, "Turn output exceeded its bound");
        },
        gateway,
      )
      .then(
        (result) => ({ result }),
        (error) => ({ error }),
      );
    let recorded;
    const finish = () => (recorded ??= record());
    async function record() {
      const end = await running;
      seen.push(output);
      const events = eventsIn(output);
      Object.assign(turn, {
        exitCode: end.result?.exitCode ?? null,
        ended: end.error ? bounded(end.error) : null,
        outputBytes: output.length,
        threads: events
          .filter((e) => e.type === "thread.started")
          .map((e) => e.thread_id),
        completed: events.some((e) => e.type === "turn.completed"),
        lapsed: lapsed ?? null,
        gateway: gateway.observation,
      });
      // A grant used after its turn's stop is refused.
      try {
        await gateway.respond(deliveryId, gateway.capability, "{}");
        turn.refusedAfterStop = null;
      } catch (error) {
        turn.refusedAfterStop =
          error instanceof GeneralSessionRefusal ? error.reason : "error";
      }
      return turn;
    }
    return { finish };
  }
  async function exactStop(s, turn) {
    const observed = await transport.observeSession(stopped(s));
    turn.stopped = {
      phase: observed.phase,
      remainingProcesses: observed.remainingProcesses,
      processesGone: observed.processesGone,
    };
    check(
      observed.phase === "stopped" &&
        observed.remainingProcesses === 0 &&
        observed.processesGone === true,
      "A routed session's process survived its exact stop",
    );
  }
  async function collected(s, tag) {
    const collection = await transport.collect(stopped(s));
    for (const file of collection.files) seen.push(Buffer.from(file.bytes));
    report[tag].collected = collection.files.map((f) => f.path).sort();
    check(
      collection.complete === true &&
        Buffer.compare(
          collection.files.find((f) => f.path === admittedFile)?.bytes ??
            Buffer.alloc(0),
          admittedBytes,
        ) === 0,
      "The routed turn's workspace was not collected intact",
    );
  }
  async function halt(s) {
    const result = await transport.stop({ ...s, state: "uncertain" });
    check(
      result.stopped === true && result.remainingProcesses === 0,
      "Exact-session stop is uncertain",
    );
  }

  try {
    const a1 = session("start");
    report.pins = await stage("coding-fresh-pins", () => transport.inspect(a1));
    await stage("owner-record-names-fresh-pins", () =>
      check(
        same(admission.pins(), report.pins),
        "The owner coding admission does not name the fresh pins",
      ),
    );
    await stage("account-eligible", () => {
      const current = account();
      check(
        subscriptionAccountId(current) === accountId &&
          current.hostId === hostId &&
          accountEligibility(current, Date.now(), Date.now() + allowanceMs)
            .eligible,
        "The owner's account is not eligible for the run",
      );
    });
    await stage("usage-before", async () => {
      const { assessed, authority } = await observe();
      report.usageBefore = usageSummary(assessed);
      check(
        authority === "permitted",
        `Usage does not permit the run: ${authority}`,
      );
      usageAccount = assessed.accountId;
    });
    const threadId = await stage("routed-launch-live-probe", async () => {
      const launch = startTurn(a1, "launch", {
        // The probe runs in the live session while its first model request
        // waits, so the workspace is exactly as admitted.
        beforeFirst: async () => {
          const result = await transport.probeBoundary(a1, admittedFile);
          check(
            same(result.pins, report.pins),
            "The coding pins changed during the probe",
          );
          report.probes = result.probes;
        },
      });
      const turn = await launch.finish();
      check(report.probes, "The routed session never made a model request");
      check(
        !turn.ended && turn.exitCode === 0,
        "The routed launch ended unexpectedly: " +
          (turn.ended ?? turn.exitCode),
      );
      check(
        turn.threads.length === 1 && uuid.test(turn.threads[0]),
        "The routed launch reported no single thread",
      );
      return turn.threads[0];
    });
    await stage("routed-launch-answered", () =>
      check(
        report.launch.completed &&
          report.launch.gateway.completed >= 1 &&
          report.launch.gateway.providerStatuses.length === 0 &&
          Object.keys(report.launch.gateway.refusals).length === 0,
        "The provider did not answer the launch through the route",
      ),
    );
    await stage("routed-launch-grant-revoked", () =>
      check(
        report.launch.gateway.revokedFor === "stopped" &&
          report.launch.refusedAfterStop === "revoked",
        "The grant outlived its turn",
      ),
    );
    await stage("routed-launch-exact-stop", () => exactStop(a1, report.launch));
    await stage("routed-launch-output-collected", () =>
      collected(a1, "launch"),
    );
    const a2 = session("resume");
    await stage("routed-resume-exhausted-mid-turn", async () => {
      const resume = startTurn(a2, "resume", {
        threadId,
        resumeFrom: stopped(a1),
        // A synthetic exhaustion stand-in at the gate: the first request is
        // live, the second finds usage exhausted.
        standIn: (n) => (n >= 2 ? "exhausted" : undefined),
      });
      const turn = await resume.finish();
      check(
        JSON.stringify(turn.threads) === JSON.stringify([threadId]),
        "The routed resume did not continue the thread",
      );
      check(
        turn.capabilitySha256 !== report.launch.capabilitySha256,
        "The resume reused the launch's relay capability",
      );
      check(
        turn.gateway.completed >= 1,
        "The resume's first model request was not answered",
      );
      check(
        turn.lapsed === "exhausted" &&
          turn.gateway.revokedFor === "exhausted" &&
          turn.gateway.providerRequests === turn.gateway.completed &&
          turn.refusedAfterStop === "revoked" &&
          !turn.completed,
        "The exhaustion stand-in did not end the resume at its next request",
      );
      await exactStop(a2, turn);
    });
    await stage("routed-resume-workspace-preserved", () =>
      collected(a2, "resume"),
    );
    await stage("credential-not-visible", () => {
      const token = Buffer.from(account().accessToken);
      check(token.length >= 16, "The account has no credential to look for");
      check(
        seen.every((bytes) => !bytes.includes(token)),
        "The credential reached the worker",
      );
      report.searchedBytes = seen.reduce((n, b) => n + b.length, 0);
    });
    // Healthy usage alone never restarts the lapsed thread: the one-shot
    // approval is spent, and only a fresh one from the owner allows more.
    await stage("restart-refused-without-fresh-approval", () => {
      const before = attempted.length;
      let refused = false;
      try {
        startTurn(session("resume"), "restart", {
          threadId,
          resumeFrom: stopped(a2),
        });
      } catch {
        refused = true;
      }
      check(
        refused && attempted.length === before && !report.restart,
        "A restart was not refused under the spent approval",
      );
    });
    await stage("usage-after", async () => {
      report.usageAfter = usageSummary((await observe()).assessed);
    });
    // Every boundary probe, the endpoint and npm-registry refusals and the
    // credential checks among them, must have run and passed.
    report.failedProbes = codingBoundaryProbeNames.filter(
      (name) =>
        report.probes.find((p) => p.name === name)?.outcome !== "passed",
    );
    report.outcome = report.failedProbes.length ? "failed" : passingOutcome;
  } catch (error) {
    report.error = bounded(error);
    report.outcome = "blocked";
  } finally {
    for (const name of stageNames)
      if (!report.stages.some((s) => s.name === name))
        report.stages.push({ name, outcome: "not-run" });
    // A failed launch can still have effects; stop every attempted session.
    report.finalStops = [];
    for (const s of attempted)
      try {
        await halt(s);
        report.finalStops.push({ fence: s.fence, stopped: true });
      } catch {
        report.finalStops.push({ fence: s.fence, stopped: false });
        report.outcome = "uncertain";
      }
    persist(report);
  }
  return report;
}

const planPath = (state, runId) =>
  join(state, `credentialed-qualification-${runId}.plan.json`);
const consumedPath = (state, runId) =>
  join(state, `credentialed-qualification-${runId}.consumed`);
/** A private directory the owner alone can use. */
function privateState(directory) {
  const s = lstatSync(directory);
  if (
    !s.isDirectory() ||
    s.isSymbolicLink() ||
    (process.platform !== "win32" &&
      ((s.mode & 0o077) !== 0 || s.uid !== process.getuid()))
  )
    throw Error("The state directory must be private");
  return realpathSync(directory);
}

/** The owner's plan: what the one-shot approval names. */
export function prepareRun(
  { machine, pins, accountId, stateDir },
  now = Date.now(),
) {
  const plan = {
    schema: 1,
    runId: randomUUID(),
    machine,
    accountId,
    pinsSha256: pinsSha256(pins),
    turns: approvedTurns,
    allowanceMs,
    createdAt: new Date(now).toISOString(),
    expiresAt: now + planMs,
  };
  writeFileSync(planPath(stateDir, plan.runId), JSON.stringify(plan, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
  return plan;
}

/** Check the owner's approval against its plan, and spend it once, before
 * any credential is read. */
export function consumeApproval(
  { machine, pins, accountId, stateDir, runId, turns },
  now = Date.now(),
) {
  if (!uuid.test(runId ?? "") || turns !== approvedTurns)
    throw Error("The approval must name the run and exactly 2 turns");
  const plan = JSON.parse(readFileSync(planPath(stateDir, runId), "utf8"));
  if (
    plan.schema !== 1 ||
    plan.runId !== runId ||
    plan.machine !== machine ||
    plan.accountId !== accountId ||
    plan.pinsSha256 !== pinsSha256(pins) ||
    plan.turns !== approvedTurns ||
    plan.allowanceMs !== allowanceMs ||
    !Number.isSafeInteger(plan.expiresAt) ||
    now >= plan.expiresAt
  )
    throw Error("The approval does not match a current plan");
  writeFileSync(consumedPath(stateDir, runId), "one-shot approval consumed\n", {
    flag: "wx",
    mode: 0o600,
  });
  return plan;
}

function sourceEvidence(root) {
  const git = (...args) =>
    spawnSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      timeout: 5000,
    });
  const build = freshBuild(root);
  return {
    ...build,
    sourceRevision: git("rev-parse", "HEAD").stdout.trim(),
    sourceDirty: git("status", "--porcelain").stdout.trim() !== "",
    runnerSha256: sha256(readFileSync(new URL(import.meta.url))),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const machineOk = (m) => /^aios-[a-z0-9-]+$/.test(m ?? "");
  const accountOk = (a) => /^[a-f0-9]{64}$/.test(a ?? "");
  if (args[0] === "prepare") {
    const [, machine, codingRecord, accountId, state, ...extra] = args;
    if (
      !machineOk(machine) ||
      !codingRecord ||
      !accountOk(accountId) ||
      !state ||
      extra.length
    ) {
      console.error(usage);
      process.exitCode = 1;
      return;
    }
    const { ownerCodingAdmission } = await import(
      "../dist/coding-admission.js"
    );
    const plan = prepareRun({
      machine,
      pins: ownerCodingAdmission(codingRecord).pins(),
      accountId,
      stateDir: privateState(state),
    });
    console.log(
      JSON.stringify({
        runId: plan.runId,
        turns: plan.turns,
        expiresAt: new Date(plan.expiresAt).toISOString(),
      }),
    );
    return;
  }
  const [
    machine,
    codingRecord,
    authDir,
    accountId,
    codex,
    state,
    reportPath,
    runFlag,
    runId,
    turnsFlag,
    turns,
    ...extra
  ] = args;
  if (
    !machineOk(machine) ||
    !codingRecord ||
    !authDir ||
    !accountOk(accountId) ||
    !codex ||
    !state ||
    !reportPath ||
    runFlag !== "--approve-run" ||
    turnsFlag !== "--approve-turns" ||
    extra.length
  ) {
    console.error(usage);
    process.exitCode = 1;
    return;
  }
  // The build must be what this source compiles to, before anything from it
  // runs or any evidence, record, credential or VM is touched.
  const source = sourceEvidence(fileURLToPath(new URL("..", import.meta.url)));
  const { NativePodmanCodingTransport } = await import(
    "../dist/podman-coding.js"
  );
  const { ownerCodingAdmission } = await import("../dist/coding-admission.js");
  const { codingBoundaryProbe } = await import("../dist/worker-probes.js");
  const { generalSessionGatewayVersion, generalSessionResponses } =
    await import("../dist/general-session-gateway.js");
  const { hostCredentialVault } = await import("../dist/credential-vault.js");
  const { hostRegistration, vaultAccount } = await import(
    "../dist/general-sessions.js"
  );
  const { codexSubscriptionReader } = await import("../dist/codex-usage.js");
  const { assessSubscription } = await import("../dist/subscription.js");
  const authority = sha256("issue04-native-offline-lifecycle-v1:" + machine);
  const transport = new NativePodmanCodingTransport(machine, authority);
  if (transport.mode !== "live" || transport.productionEnabled !== false)
    throw Error("Expected the live transport with production disabled");
  const admission = ownerCodingAdmission(codingRecord);
  const stateDir = privateState(state);
  const reader = codexSubscriptionReader(codex);
  // Usage first (the plan's order): usage that refuses the run leaves the
  // approval unspent and touches no credential or worker.
  const before = usageAuthority(assessSubscription(await reader()));
  if (before !== "permitted")
    throw Error(`Usage does not permit the run: ${before}`);
  // Refuse overwriting retained evidence, then spend the approval, before any
  // credential or worker effect.
  closeSync(openSync(reportPath, "wx", 0o600));
  const plan = consumeApproval({
    machine,
    pins: admission.pins(),
    accountId,
    stateDir,
    runId,
    turns: Number(turns),
  });
  const { hostId } = hostRegistration(authDir);
  const account = vaultAccount(
    hostCredentialVault(authDir, true),
    accountId,
    hostId,
  );
  const context = {
    host: { platform: platform(), arch: arch(), release: release(), machine },
    authority,
    runId: plan.runId,
    codingProbeSha256: sha256(codingBoundaryProbe),
    gatewayVersion: generalSessionGatewayVersion,
    ...source,
  };
  let interrupted = false;
  const interrupt = () => (interrupted = true);
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  const report = await credentialedQualification(
    {
      transport,
      admission,
      account,
      accountId,
      hostId,
      observeUsage: async () => assessSubscription(await reader()),
      provider: generalSessionResponses(),
    },
    {
      interrupted: () => interrupted,
      persist: (r) =>
        writeFileSync(
          reportPath,
          JSON.stringify({ ...context, ...r, interrupted }, null, 2),
        ),
    },
  );
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
  console.log(
    JSON.stringify({
      outcome: report.outcome,
      reportPath,
      ...(report.failedProbes?.length
        ? { failedProbes: report.failedProbes }
        : {}),
      ...(report.outcome === passingOutcome ? {} : { freshPins: report.pins }),
    }),
  );
  if (report.outcome !== passingOutcome) process.exitCode = 1;
}

// Compare real paths, so a symlinked checkout still runs.
const invoked = process.argv[1] && realpathSync(process.argv[1]);
if (invoked && import.meta.url === pathToFileURL(invoked).href)
  main().catch((error) => {
    console.error(String(error?.message).slice(0, 300));
    process.exitCode = 1;
  });
