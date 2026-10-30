#!/usr/bin/env node
// Owner-run offline usage canary on a real dedicated VM (Issue 04 slice 4d,
// owner decision C). The delivery controller drives routed coding turns
// through the real native transport and a real `GeneralSessionGateway`,
// whose only provider is the fake one on the host. Planning, validation,
// onboarding, the worker probe, the mediation decision and usage are
// synthetic stand-ins. One lineage shows, natively:
// - unknown usage is refused, even when approved, and low usage needs the
//   owner's approval;
// - exhaustion mid-launch ends the turn at once and keeps its workspace as
//   evidence; a restart is refused without the owner's restart approval;
// - an approved restart resumes the thread, and a decision withdrawn
//   mid-resume ends it;
// - after a new decision, an approved restart starts a new lineage that
//   completes, superseding the old one.
// It never provisions or starts the VM, opens credentials or authorizes
// inference, and it never enables production or claims qualification. Run it
// through scripts/run-native-acceptance.mjs.
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { arch, platform, release, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { freshBuild } from "./fresh-build.mjs";
import { fakeProvider, maxKeepalives } from "./routed-provider.mjs";
import { syntheticDelivery } from "./synthetic-delivery.mjs";
import { syntheticMediation } from "./synthetic-mediation.mjs";
import { syntheticUsage } from "./synthetic-usage.mjs";

const usage =
  "Usage: node scripts/run-native-usage-canary.mjs <aios-machine> <owner-coding-admission.json> <new-report.json> --approve-offline-native-run";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const passingOutcome = "observed-offline-usage-canary";
const pinFields = [
  "cliVersion",
  "cliSha256",
  "codeModeHostSha256",
  "policySha256",
  "bindingSha256",
];
const samePins = (a, b) => pinFields.every((field) => a[field] === b[field]);
/** Every stage, in order. */
export const stageNames = Object.freeze([
  "coding-fresh-pins",
  "owner-record-names-fresh-pins",
  "admitted-runtime",
  "synthetic-decision-qualified",
  "unknown-usage-refused-even-approved",
  "low-usage-needs-approval",
  "routed-launch-exhausted-mid-turn",
  "restart-refused-without-approval",
  "routed-resume-withdrawn-mid-turn",
  "new-decision-new-lineage",
]);

/** Run the canary against `transport` under the owner's coding `admission`,
 * and return the report; `persist` receives it after every stage. */
export async function usageCanary({ transport, admission }, options = {}) {
  const persist = options.persist ?? (() => {});
  const interrupted = options.interrupted ?? (() => false);
  const { DeliveryController } = await import("../dist/controller.js");
  const { PinnedCodingRuntime } = await import("../dist/feature-candidate.js");
  const { GeneralSessionGateway } = await import(
    "../dist/general-session-gateway.js"
  );
  const {
    requiredSubscriptionScopes,
    subscriptionAccountId,
    subscriptionIssuer,
  } = await import("../dist/subscription-account.js");
  const { initializeWindowsAuthDirectory } = await import(
    "../dist/windows-auth-store.js"
  );
  const report = {
    scope: "native-coding-offline-usage-canary",
    productionEnabled: false,
    qualified: false,
    inferenceAuthorized: false,
    synthetic: [
      "planning",
      "validation",
      "onboarding",
      "worker-probe",
      "mediation-decision",
      "usage",
      "provider",
    ],
    outcome: "running",
    stages: [],
    turns: [],
  };
  const check = (condition, message) => {
    if (!condition) throw Error(message);
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
      // Adapter errors are bounded; no guest output or environment is kept.
      entry.error = String(error?.message).slice(0, 300);
      throw error;
    } finally {
      entry.finishedMs = elapsed();
      persist(report);
    }
  }

  // Synthetic and host-only: the fake provider never uses the token.
  const hostId = `urn:uuid:${randomUUID()}`;
  const account = () => ({
    issuer: subscriptionIssuer,
    clientId: "aios-usage-canary",
    subject: "synthetic",
    hostId,
    planUsageAuthorized: true,
    scopes: [...requiredSubscriptionScopes],
    expiresAt: Date.now() + 40 * 60_000,
    accessToken: "aios-usage-canary-synthetic",
  });
  const reader = syntheticUsage(sha256("aios-native-usage-canary:usage"));
  // The next routed turn's provider: its tag, when it may do its work, and a
  // hook on each request it answers.
  let next;
  const gateways = [];
  const generalSessions = (turn, authority) => {
    const plan = next,
      fake = fakeProvider(plan.tag, plan.released);
    const gateway = new GeneralSessionGateway(
      {
        deliveryId: turn.deliveryId,
        sessionId: turn.sessionId,
        accountId: turn.accountId,
        hostId,
        expiresAt: turn.expiresAt,
        maxRequests: maxKeepalives + 8,
      },
      account,
      authority,
      async function* (token, body) {
        plan.answering?.(fake.observation.requests);
        yield* fake.provider(token, body);
      },
    );
    gateways.push({ ...plan, gateway, fake, turn });
    return gateway;
  };

  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-usage-canary-")));
  // The controller trusts a decision record only in state that no one else
  // can read. A Windows temp folder can grant others access by inheritance,
  // so the canary's root keeps only its owner, SYSTEM and Administrators.
  if (process.platform === "win32")
    try {
      initializeWindowsAuthDirectory(root);
    } catch (error) {
      rmSync(root, { recursive: true, force: true });
      throw error;
    }
  let controller, deliveryId, mediation;
  // Every session a turn recorded, so each can be stopped at the end.
  const sessions = [];
  const delivery = () => controller.status(deliveryId);
  // One turn: its recorded session, its gateway and provider, and a summary.
  async function turn(tag, plan) {
    const before = gateways.length;
    next = { tag, ...plan };
    let refused;
    const coded = await controller
      .codeFeature(deliveryId)
      .catch((error) => (refused = error));
    const after = delivery(),
      session = after.feature?.session;
    if (session && !sessions.some((s) => s.operationId === session.operationId))
      sessions.push(session);
    const routed = gateways[before];
    check(!refused && coded, "The turn was refused: " + refused?.message);
    check(
      routed && gateways.length === before + 1,
      "The turn was not routed through one general session",
    );
    const observed = await transport.observeSession({
      ...session,
      state: "stopped",
    });
    const summary = {
      tag,
      intent: session.intent,
      fence: session.fence,
      threadStarted: uuid.test(session.threadId ?? ""),
      state: session.state,
      route: session.route ?? null,
      provider: { ...routed.fake.observation },
      gateway: routed.gateway.observation,
      stopped: {
        phase: observed.phase,
        remainingProcesses: observed.remainingProcesses,
        processesGone: observed.processesGone,
      },
      interruption: after.feature.usageInterruptions?.find(
        (i) => i.operationId === session.operationId,
      ),
      // The paths the kept workspace holds, or null without evidence.
      evidence: keptPaths(after, session),
      candidate: Boolean(after.feature.candidate),
    };
    report.turns.push(summary);
    check(
      session.state === "stopped" &&
        observed.phase === "stopped" &&
        observed.remainingProcesses === 0 &&
        observed.processesGone === true,
      "A routed session's process survived its exact stop",
    );
    return { session, summary, after };
  }
  function keptPaths(after, session) {
    const kept = after.evidence.find(
      (e) =>
        e.kind === "interrupted-turn" &&
        e.path.endsWith(`interrupted-${session.operationId}.json`),
    );
    try {
      return kept
        ? JSON.parse(readFileSync(kept.path, "utf8"))
            .map((file) => file.path)
            .slice(0, 16)
        : null;
    } catch {
      return null;
    }
  }
  // A turn ended at once by a lapse: the gateway refused the next model
  // request, so the provider answered only the two before it; the grant was
  // revoked with the reason, the interruption recorded, and the workspace
  // kept as evidence only.
  function lapsed({ summary }, reason) {
    check(
      summary.gateway.revokedFor === reason &&
        summary.interruption?.reason === reason,
      `The turn was not ended as ${reason}`,
    );
    // The controller revokes inside the authority callback, so the gateway
    // counts that refusal as `revoked` rather than `authority`.
    const refused = summary.gateway.refusals;
    check(
      (refused.authority ?? 0) + (refused.revoked ?? 0) >= 1 &&
        summary.provider.requests === 2,
      "The lapse was not enforced at the next model request",
    );
    check(summary.threadStarted, "The interrupted turn kept no thread");
    check(
      summary.evidence?.includes("index.html") && !summary.candidate,
      "The interrupted workspace was not kept as evidence only",
    );
  }
  // Coding is refused before any turn is routed.
  async function refusedBeforeDispatch(pattern) {
    const before = gateways.length;
    let refused;
    await controller.codeFeature(deliveryId).catch((error) => {
      refused = error;
    });
    check(
      pattern.test(String(refused?.message)),
      "Coding was not refused as expected",
    );
    check(gateways.length === before, "A refused turn was routed");
  }

  try {
    report.pins = await stage("coding-fresh-pins", () =>
      transport.inspect({
        operationId: randomUUID(),
        fence: 1,
        state: "running",
        intent: "start",
      }),
    );
    await stage("owner-record-names-fresh-pins", () =>
      check(
        samePins(admission.pins(), report.pins),
        "The owner coding admission does not name the fresh pins",
      ),
    );
    const runtime = await stage(
      "admitted-runtime",
      () => new PinnedCodingRuntime(report.pins, transport, admission),
    );
    await stage("synthetic-decision-qualified", async () => {
      const synthetic = syntheticDelivery(root);
      let probe;
      controller = new DeliveryController(
        join(root, "state"),
        synthetic.options,
        {
          featurePlanner: synthetic.planner,
          featureRuntime: runtime,
          validationRuntime: synthetic.validation,
          subscription: () => reader.observe(),
          worker: { probe: async () => structuredClone(probe) },
          generalSessions,
        },
      );
      const started = controller.start({
        repository: synthetic.repository,
        request: "Add a visible contact hint.",
        codingMinutes: 10,
      });
      deliveryId = started.id;
      await controller.planFeature(deliveryId);
      await controller.validateBaseline(deliveryId);
      mediation = await syntheticMediation({
        state: realpathSync(join(root, "state")),
        deliveryId,
        repository: synthetic.repository,
        accountId: subscriptionAccountId(account()),
        usageAccountId: sha256("aios-native-usage-canary:usage"),
      });
      probe = mediation.probe;
      const qualified = await controller.qualify(deliveryId);
      check(
        qualified.qualification?.subscriptionMediation?.mechanismDecision
          ?.qualified === true,
        "The synthetic mediation decision did not qualify",
      );
    });
    await stage("unknown-usage-refused-even-approved", async () => {
      reader.state = "unknown";
      await refusedBeforeDispatch(/usage/i);
      controller.approveUsage(deliveryId, delivery().usage.checkId);
      // Refused as unmeasured, not as needing approval (decision H).
      await refusedBeforeDispatch(/known model-only account/);
    });
    await stage("low-usage-needs-approval", async () => {
      reader.state = "low";
      await refusedBeforeDispatch(/usage/i);
      const pending = delivery().usage;
      check(
        pending.decision === "approval-required",
        "Low usage did not need the owner's approval",
      );
      // The approval binds the launch below.
      controller.approveUsage(deliveryId, pending.checkId);
    });
    const launch = await stage("routed-launch-exhausted-mid-turn", async () => {
      const ended = await turn("launch", {
        released: () => false,
        // Usage is exhausted once the turn has started; its next model
        // request is refused.
        answering: (n) => {
          if (n === 1) reader.state = "exhausted";
        },
      });
      check(ended.session.intent === "start", "The launch did not start");
      lapsed(ended, "exhausted");
      return ended;
    });
    await stage("restart-refused-without-approval", async () => {
      reader.state = "healthy";
      await refusedBeforeDispatch(/restart approval/);
    });
    const resume = await stage("routed-resume-withdrawn-mid-turn", async () => {
      controller.approveCodingRestart(deliveryId);
      const ended = await turn("resume", {
        released: () => false,
        answering: (n) => {
          if (n === 1) mediation.withdraw();
        },
      });
      check(
        ended.session.intent === "resume" &&
          ended.session.threadId === launch.session.threadId &&
          ended.session.resumeFrom?.operationId === launch.session.operationId,
        "The approved restart did not resume the launch's thread",
      );
      check(
        JSON.stringify(ended.session.route) ===
          JSON.stringify(launch.session.route),
        "The resume changed its route",
      );
      lapsed(ended, "withdrawn");
      return ended;
    });
    await stage("new-decision-new-lineage", async () => {
      mediation.write();
      controller.approveCodingRestart(deliveryId);
      const ended = await turn("lineage", { released: () => true });
      const { session, summary, after } = ended;
      check(
        session.intent === "start" &&
          !session.resumeFrom &&
          summary.threadStarted &&
          session.threadId !== launch.session.threadId,
        "The new decision did not start a new lineage",
      );
      check(
        session.route?.decisionSha256 !== launch.session.route?.decisionSha256,
        "The new lineage did not name the new decision",
      );
      const superseded = after.feature.supersededLineages ?? [];
      check(
        superseded.length === 1 &&
          superseded[0].operationId === resume.session.operationId &&
          superseded[0].threadId === launch.session.threadId &&
          superseded[0].by === session.operationId,
        "The old lineage was not superseded",
      );
      check(
        summary.provider.toolsWorked &&
          summary.provider.finalAnswered &&
          summary.provider.unexpected === 0 &&
          Object.keys(summary.gateway.refusals).length === 0,
        "The code-mode tools did not run through the route",
      );
      check(
        summary.gateway.revokedFor === "stopped" && !summary.interruption,
        "The new lineage's turn did not end normally",
      );
      // Observed from the controller, not asserted: the decision authorizes
      // no inference, and delivery stays disabled.
      const decision =
        after.qualification?.subscriptionMediation?.mechanismDecision;
      report.delivery = {
        blocker: after.blocker.code,
        inferenceAuthorized: decision?.inferenceAuthorized ?? null,
      };
      check(
        decision?.inferenceAuthorized === false &&
          after.blocker.code !== undefined &&
          after.phase !== "completed",
        "The canary's delivery was not kept disabled",
      );
    });
    report.outcome = passingOutcome;
  } catch (error) {
    report.error = String(error?.message).slice(0, 300);
    report.outcome = "blocked";
  } finally {
    for (const name of stageNames)
      if (!report.stages.some((s) => s.name === name))
        report.stages.push({ name, outcome: "not-run" });
    // A turn that failed can still have effects; stop every session.
    if (controller && deliveryId)
      try {
        const current = delivery().feature?.session;
        if (
          current &&
          !sessions.some((s) => s.operationId === current.operationId)
        )
          sessions.push(current);
      } catch {}
    report.finalStops = [];
    for (const s of sessions)
      try {
        const result = await transport.stop({ ...s, state: "uncertain" });
        check(
          result.stopped === true && result.remainingProcesses === 0,
          "Exact-session stop is uncertain",
        );
        report.finalStops.push({ fence: s.fence, stopped: true });
      } catch {
        report.finalStops.push({ fence: s.fence, stopped: false });
        report.outcome = "uncertain";
      }
    mediation?.remove();
    rmSync(root, { recursive: true, force: true });
    persist(report);
  }
  return report;
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
  const [machine, codingRecord, reportPath, approval, ...extra] =
    process.argv.slice(2);
  if (
    !/^aios-[a-z0-9-]+$/.test(machine ?? "") ||
    !codingRecord ||
    !reportPath ||
    approval !== "--approve-offline-native-run" ||
    extra.length
  ) {
    console.error(usage);
    process.exitCode = 1;
    return;
  }
  // The build must be what this source compiles to, before anything from it
  // runs or any evidence, record or VM is touched.
  const source = sourceEvidence(fileURLToPath(new URL("..", import.meta.url)));
  const { NativePodmanCodingTransport } = await import(
    "../dist/podman-coding.js"
  );
  const { ownerCodingAdmission } = await import("../dist/coding-admission.js");
  const { generalSessionGatewayVersion } = await import(
    "../dist/general-session-gateway.js"
  );
  // The coding authority this VM's management state and the owner record
  // already belong to, as in the admission acceptance.
  const authority = sha256("issue04-native-offline-lifecycle-v1:" + machine);
  const transport = new NativePodmanCodingTransport(machine, authority);
  if (transport.mode !== "live" || transport.productionEnabled !== false)
    throw Error("Expected the live transport with production disabled");
  const admission = ownerCodingAdmission(codingRecord);
  // Refuse overwriting retained evidence before any worker effect.
  closeSync(openSync(reportPath, "wx", 0o600));
  const context = {
    host: { platform: platform(), arch: arch(), release: release(), machine },
    authority,
    gatewayVersion: generalSessionGatewayVersion,
    ...source,
  };
  let interrupted = false;
  const interrupt = () => (interrupted = true);
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  const report = await usageCanary(
    { transport, admission },
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
      // Fresh pins, so the owner can write or check the record.
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
