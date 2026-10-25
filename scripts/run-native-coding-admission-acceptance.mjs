#!/usr/bin/env node
// Owner-run offline acceptance of owner coding admission on a real dedicated
// VM. The delivery controller drives one coding turn through the real native
// transport, admitted only by the owner's per-host record naming its fresh
// pins. Planning, validation, onboarding facts and usage observations are
// synthetic stand-ins. It never provisions or starts the VM, opens
// credentials or authorizes inference, and it never enables production or
// claims qualification. Run it through scripts/run-native-acceptance.mjs.
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  mkdirSync,
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

const usage =
  "Usage: node scripts/run-native-coding-admission-acceptance.mjs <aios-machine> <owner-admission.json> <new-report.json> --approve-offline-native-run";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const pinFields = [
  "cliVersion",
  "cliSha256",
  "codeModeHostSha256",
  "policySha256",
  "bindingSha256",
];
const samePins = (a, b) => pinFields.every((field) => a[field] === b[field]);

/** A disposable repository with synthetic onboarding facts and policy. */
function syntheticDelivery(root) {
  const repository = join(root, "repository");
  mkdirSync(repository);
  const git = (...args) => {
    const r = spawnSync("git", ["-C", repository, ...args], {
      encoding: "utf8",
      timeout: 10000,
    });
    if (r.status !== 0) throw Error("Synthetic repository setup failed");
    return r.stdout.trim();
  };
  git("init", "-q", "-b", "main");
  writeFileSync(join(repository, "index.html"), "<h1>Contact</h1>\n");
  git("add", "index.html");
  git(
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=/nonexistent",
    "-c",
    "user.name=Acceptance",
    "-c",
    "user.email=acceptance@example.invalid",
    "commit",
    "-q",
    "-m",
    "base",
  );
  const revision = git("rev-parse", "HEAD");
  const contract = {
    version: 1,
    mutablePaths: ["index.html"],
    environment: {
      imageSha256: "1".repeat(64),
      networkPolicySha256: "2".repeat(64),
      registries: ["https://registry.npmjs.org"],
      caches: [],
      browser: false,
      database: false,
      synthetic: true,
    },
    checks: ["format", "lint", "type", "coverage", "build", "acceptance"]
      .map((kind) => ({
        id: kind,
        kind,
        scope: "local",
        stages:
          kind === "acceptance" ? ["candidate"] : ["baseline", "candidate"],
        command: ["npm", "run", kind],
        publisher: "isolated-checker",
        timeoutMs: 1000,
      }))
      .concat(
        [
          ["pr-ci", "build", "pr", "ci"],
          ["main-e2e", "e2e", "main", "e2e"],
        ].map(([id, kind, scope, workflow]) => ({
          id,
          kind,
          scope,
          stages: ["candidate"],
          command: ["workflow", workflow],
          publisher: "trusted-ci",
          workflow: ".github/workflows/ci.yml@trusted",
          timeoutMs: 120000,
        })),
      ),
  };
  const facts = {
    repository: "AJHMH/acceptance-page",
    defaultBranch: "main",
    factoryCommit: "a".repeat(40),
    approver: "acceptance-owner",
    appLogin: "factory[bot]",
    publicationLogin: "acceptance-owner",
    requiredChecks: ["pr-ci"],
    validation: ["isolated-node"],
    validationContract: contract,
  };
  const policyPath = join(root, "owner-policy.json");
  writeFileSync(policyPath, JSON.stringify(facts));
  const options = {
    policyPath,
    inspect: () => ({
      ...facts,
      localRepository: facts.repository,
      localDefaultBranch: "main",
      appRepositoryAccess: true,
      eligibleApprovers: [facts.approver],
      protectionsEnforced: true,
      trustedCheckPublishers: true,
      publicationAccess: true,
      localSignature: { commit: revision, valid: true, login: facts.approver },
      githubSignature: { commit: revision, valid: true, login: facts.approver },
    }),
  };
  const planner = {
    async plan() {
      return {
        criteria: ["Contact page displays a visible hint."],
        verification: ["Check the visible hint in the isolated page."],
        ambiguity: null,
      };
    },
  };
  // Validation stand-in: reports success without executing anything.
  const validation = {
    mode: "controlled",
    bindingSha256: "3".repeat(64),
    async inspect() {
      return {
        mode: this.mode,
        bindingSha256: this.bindingSha256,
        environment: contract.environment,
      };
    },
    async execute(request) {
      if (!request.mayDispatch()) throw Error("Fenced");
      return {
        checkId: request.check.id,
        status: "success",
        publisher: request.check.publisher,
        treeSha256: request.treeSha256,
        environmentSha256: request.environmentSha256,
        artifacts: [],
      };
    },
    async stop(request) {
      return {
        operationId: request.operationId,
        fence: request.fence,
        stopped: true,
        remainingProcesses: 0,
        treeSha256: request.treeSha256,
      };
    },
  };
  // Usage stand-in: a fresh, healthy model-only observation; no account.
  const subscription = async () => {
    const at = Date.now();
    return {
      observedAt: new Date(at).toISOString(),
      accountId: sha256("aios-native-coding-admission-acceptance"),
      authMode: "chatgpt",
      windows: [
        {
          id: "primary",
          usedPercent: 10,
          resetsAt: Math.floor(at / 1000) + 3600,
        },
      ],
      exhausted: false,
    };
  };
  return { repository, options, planner, validation, subscription };
}

/** Drive one controller coding turn through `transport` under `admission`;
 * `persist` receives the report after every stage. */
export async function admissionAcceptance(transport, admission, options = {}) {
  const persist = options.persist ?? (() => {});
  const { DeliveryController } = await import("../dist/controller.js");
  const { PinnedCodingRuntime } = await import("../dist/feature-candidate.js");
  const report = {
    scope: "native-coding-offline-admission-acceptance",
    productionEnabled: false,
    qualified: false,
    inferenceAuthorized: false,
    synthetic: ["planning", "validation", "onboarding", "usage"],
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
  let session, controller, deliveryId;
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
          );
        } catch {
          refused = true;
        }
        check(refused, `A changed ${field} was admitted`);
      }
      return new PinnedCodingRuntime(report.pins, transport, admission);
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
          subscription: synthetic.subscription,
        },
      );
      // Offline, Codex retries the provider until the turn allowance ends.
      const started = controller.start({
        repository: synthetic.repository,
        request: "Add a visible contact hint.",
        codingMinutes: 1,
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
  const { NativePodmanCodingTransport } = await import(
    "../dist/podman-coding.js"
  );
  const { ownerCodingAdmission } = await import("../dist/coding-admission.js");
  // The coding authority this VM's management state already belongs to.
  const authority = sha256("issue04-native-offline-lifecycle-v1:" + machine);
  const transport = new NativePodmanCodingTransport(machine, authority);
  if (transport.mode !== "live" || transport.productionEnabled !== false)
    throw Error("Expected the live transport with production disabled");
  const admission = ownerCodingAdmission(admissionPath);
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
