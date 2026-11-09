#!/usr/bin/env node
// Owner-run offline acceptance of owner coding admission on a real dedicated
// VM. The delivery controller drives one coding turn through the real native
// transport, admitted only by the owner's per-host record naming its fresh
// pins. Planning, validation and onboarding facts are synthetic stand-ins.
// On Codex, so are the usage observations. On Claude Code (ADR 0008) the turn
// is metered through a real Messages gateway against the delivery's real
// spend budget, and only the model provider is a stand-in. A passing run then removes its session; a blocked one
// keeps it for diagnosis. It never provisions or starts the VM, opens
// credentials or authorizes inference, and it never enables production or
// claims qualification. Run it through scripts/run-native-acceptance.mjs.
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
import { syntheticDelivery } from "./synthetic-delivery.mjs";

const usage =
  "Usage: node scripts/run-native-coding-admission-acceptance.mjs <aios-machine> <owner-admission.json> <new-report.json> --approve-offline-native-run";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

/** Drive one controller coding turn through `transport` under `admission`;
 * `persist` receives the report after every stage. `agent: "claude"` runs a
 * metered Claude Code turn. */
export async function admissionAcceptance(transport, admission, options = {}) {
  const persist = options.persist ?? (() => {});
  const claude = options.agent === "claude";
  const { DeliveryController } = await import("../dist/controller.js");
  const {
    PinnedCodingRuntime,
    claudeAgent,
    claudeCodingPinFields,
    codexAgent,
    codingPinFields,
  } = await import("../dist/feature-candidate.js");
  const pinFields = claude ? claudeCodingPinFields : codingPinFields;
  const samePins = (a, b) => pinFields.every((field) => a[field] === b[field]);
  const agent = claude ? claudeAgent : codexAgent;
  const report = {
    scope: "native-coding-offline-admission-acceptance",
    agent: agent.provider,
    productionEnabled: false,
    qualified: false,
    inferenceAuthorized: false,
    synthetic: [
      "planning",
      "validation",
      "onboarding",
      claude ? "model-provider" : "usage",
    ],
    outcome: "running",
    stages: [],
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
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "aios-coding-admission-acceptance-")),
  );
  // The controller and delivery, so a failed turn can still be settled.
  let session, controller, deliveryId, provider;
  try {
    report.pins = await stage("fresh-pins", () =>
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
    const runtime = await stage("admitted-runtime", () => {
      for (const field of pinFields.slice(1)) {
        let refused = false;
        try {
          new PinnedCodingRuntime(
            { ...report.pins, [field]: "0".repeat(64) },
            transport,
            admission,
            agent,
          );
        } catch {
          refused = true;
        }
        check(refused, `A changed ${field} was admitted`);
      }
      return new PinnedCodingRuntime(report.pins, transport, admission, agent);
    });
    const delivery = await stage("controller-coding-turn", async () => {
      const synthetic = syntheticDelivery(root);
      controller = new DeliveryController(
        join(root, "state"),
        synthetic.options,
        {
          featurePlanner: synthetic.planner,
          featureRuntime: runtime,
          validationRuntime: synthetic.validation,
          ...(claude
            ? { messagesSessions: await meteredStandIn((p) => (provider = p)) }
            : { subscription: synthetic.subscription }),
        },
      );
      // Offline, Codex retries the provider until the turn allowance ends.
      // Claude Code's metered turn ends when the stand-in's work is done.
      const started = controller.start({
        repository: synthetic.repository,
        request: "Add a visible contact hint.",
        codingMinutes: claude ? 5 : 1,
      });
      deliveryId = started.id;
      await controller.planFeature(started.id);
      await controller.validateBaseline(started.id);
      const coded = await controller.codeFeature(started.id);
      session = coded.feature?.session;
      return coded;
    });
    report.delivery = {
      phase: delivery.phase,
      blocker: delivery.blocker.code,
      outcome: delivery.feature?.outcome ?? null,
      sessionState: session?.state ?? null,
      threadStarted: session?.threadStarted === true,
      candidate: Boolean(delivery.feature?.candidate),
    };
    await stage("controller-recorded-stopped-thread", () => {
      check(uuid.test(session?.threadId ?? ""), "No coding thread recorded");
      check(session.state === "stopped", "Coding session is not stopped");
      check(
        delivery.blocker.code !== "UNCERTAIN_SESSION",
        "Coding session is uncertain",
      );
    });
    if (claude)
      await stage("controller-metered-turn", () => {
        const observed = provider.observation;
        check(
          observed.unexpected === 0,
          "The provider saw an unexpected request",
        );
        check(observed.toolsWorked, "Claude Code's tools did not run");
        check(observed.finalAnswered, "The turn did not reach its answer");
        check(
          delivery.spend?.spent > 0,
          "The turn's requests were not charged",
        );
        check(!delivery.spend.reserved, "A request was left reserved");
        check(!delivery.spend.interruption, "The budget interrupted the turn");
        report.spend = {
          requests: observed.requests,
          charges: delivery.spend.charges,
          spent: delivery.spend.spent,
        };
      });
    await stage("session-cleanup", async () => {
      const receipt = await transport.cleanupSupersededLineage(session);
      check(receipt.cleaned === 1, "Expected one cleaned session");
    });
    report.outcome = "observed-offline-admission-acceptance";
  } catch (error) {
    report.error = String(error?.message).slice(0, 300);
    report.outcome = "blocked";
  } finally {
    // A turn that failed after dispatch still left a persisted session.
    if (!session && controller && deliveryId)
      try {
        session = controller.status(deliveryId).feature?.session;
      } catch {}
    // An unsettled session is stopped by its exact identity.
    if (session && session.state !== "stopped")
      try {
        await stage("final-exact-session-stop", async () => {
          const stopped = await transport.stop({
            ...session,
            state: "uncertain",
          });
          check(
            stopped.stopped === true && stopped.remainingProcesses === 0,
            "Exact-session stop is uncertain",
          );
        });
      } catch {
        report.outcome = "uncertain";
      }
    rmSync(root, { recursive: true, force: true });
    persist(report);
  }
  return report;
}

/** Real Messages gateways for metered turns, with a stand-in provider that
 * calls Claude Code's own Write and Bash tools and a synthetic key. */
async function meteredStandIn(observe) {
  const { MessagesGateway } = await import("../dist/messages-gateway.js");
  const { messagesSession } = await import("../dist/messages-sessions.js");
  const { pinnedModelPrices } = await import("../dist/spend-budget.js");
  const { fakeMessagesProvider } = await import("./routed-provider.mjs");
  return (turn, budget) => {
    const fake = fakeMessagesProvider(
      "admission",
      () => true,
      pinnedModelPrices.model,
    );
    observe(fake);
    return messagesSession(
      new MessagesGateway(
        { ...turn, maxRequests: 64 },
        () => "synthetic-admission-key",
        budget,
        fake.provider,
      ),
    );
  };
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
    buildSha256: Object.fromEntries(
      [
        "podman-coding",
        "feature-candidate",
        "coding-admission",
        "controller",
        "messages-gateway",
      ].map((name) => [
        name,
        sha256(readFileSync(new URL(`../dist/${name}.js`, import.meta.url))),
      ]),
    ),
  };
}

async function main() {
  const [machine, admissionPath, reportPath, approval, ...extra] =
    process.argv.slice(2);
  if (
    !/^aios-[a-z0-9-]+$/.test(machine ?? "") ||
    !admissionPath ||
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
  const { nativeCodingAuthority, ownerCodingWorker } = await import(
    "../dist/native-coding-runtime.js"
  );
  // The coding authority this VM's management state already belongs to, and
  // the worker the owner's record names.
  const authority = nativeCodingAuthority(machine);
  const { agent, transport, admission } = ownerCodingWorker(
    machine,
    admissionPath,
  );
  if (transport.mode !== "live" || transport.productionEnabled !== false)
    throw Error("Expected the live transport with production disabled");
  // Refuse overwriting retained evidence before any worker effect.
  closeSync(openSync(reportPath, "wx", 0o600));
  const context = {
    host: { platform: platform(), arch: arch(), release: release(), machine },
    authority,
    ...source,
  };
  // A signal never abandons the worker: the turn ends within its allowance,
  // then the exact session is settled before the run reports interrupted.
  let interrupted = false;
  const interrupt = () => (interrupted = true);
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  const report = await admissionAcceptance(transport, admission, {
    agent,
    persist: (r) =>
      writeFileSync(
        reportPath,
        JSON.stringify({ ...context, ...r, interrupted }, null, 2),
      ),
  });
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
  if (interrupted) {
    report.outcome = "interrupted";
    writeFileSync(
      reportPath,
      JSON.stringify({ ...context, ...report, interrupted }, null, 2),
    );
  }
  console.log(
    JSON.stringify({
      outcome: report.outcome,
      reportPath,
      // Fresh pins, so the owner can write or check the record.
      ...(report.outcome === "observed-offline-admission-acceptance"
        ? {}
        : { freshPins: report.pins ?? null }),
    }),
  );
  if (report.outcome !== "observed-offline-admission-acceptance")
    process.exitCode = 1;
}

// Compare real paths, so a symlinked checkout still runs.
const invoked = process.argv[1] && realpathSync(process.argv[1]);
if (invoked && import.meta.url === pathToFileURL(invoked).href)
  main().catch((error) => {
    console.error(String(error?.message).slice(0, 300));
    process.exitCode = 1;
  });
