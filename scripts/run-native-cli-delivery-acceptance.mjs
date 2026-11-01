#!/usr/bin/env node
// Owner-run offline acceptance of one delivery through the real CLI on a real
// dedicated VM (ADR 0004 slice 6). Every step is a `dist/cli.js` process with
// only the owner inputs the CLI names: `start`, `plan-feature`,
// `validate-baseline` and `code-feature` on the owner-admitted coding and
// validation runtimes, then `validate-candidate`. The repository, owner
// policy, onboarding attestation and criteria file are synthetic and written
// here, private and outside every repository. The coding turn is offline: with
// no model access it never completes, so it proves the delivery mechanics (an
// exact launch and stop) and admits no candidate; `validate-candidate` must
// refuse. It never provisions or starts the VM, loads images, opens
// credentials or authorizes inference, and it never enables production or
// claims qualification. It reads usage through the owner's codex executable,
// as every coding turn does. Run it through scripts/run-native-acceptance.mjs.
import { spawn, spawnSync } from "node:child_process";
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
import { ownWindowsPaths } from "./windows-owner.mjs";
import { acceptanceContract } from "./run-native-validation-admission-acceptance.mjs";

const usage =
  "Usage: node scripts/run-native-cli-delivery-acceptance.mjs <aios-machine> <owner-coding-admission.json> <owner-validation-admission.json> <pinned-codex-executable> <new-report.json> --approve-offline-native-run";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const passingOutcome = "observed-offline-cli-delivery-acceptance";
export const request = "Add a visible contact hint.";
/** Enough for an offline turn to launch, fail and stop. */
export const codingMinutes = 5;
/** Every stage, in order. */
export const stageNames = Object.freeze([
  "owner-records-name-fresh-pins",
  "owner-inputs",
  "cli-start",
  "cli-plan-feature",
  "cli-validate-baseline",
  "cli-code-feature",
  "cli-candidate-refused",
  "host-checkout-unchanged",
]);

const pinFields = {
  coding: [
    "cliVersion",
    "cliSha256",
    "codeModeHostSha256",
    "policySha256",
    "bindingSha256",
  ],
  validation: ["imageSha256", "policySha256", "bindingSha256"],
};

/** The synthetic owner inputs under the private `root`: a disposable
 * repository with the local hints the CLI reads, an owner policy validating
 * under `environment`, the attestation of every fact the CLI cannot observe,
 * and `criteria(id)`, which writes the criteria file for a started delivery. */
export function ownerInputs(root, environment) {
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
  // The only facts the CLI observes: the origin and its default branch.
  git(
    "remote",
    "add",
    "origin",
    "https://github.com/AJHMH/acceptance-page.git",
  );
  git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  const owner = join(root, "owner");
  mkdirSync(owner, { mode: 0o700 });
  const policy = {
    repository: "AJHMH/acceptance-page",
    defaultBranch: "main",
    factoryCommit: "a".repeat(40),
    approver: "acceptance-owner",
    appLogin: "factory[bot]",
    publicationLogin: "acceptance-owner",
    requiredChecks: ["pr-ci"],
    validation: ["isolated-offline"],
    validationContract: acceptanceContract(environment),
  };
  const policyPath = join(owner, "owner-policy.json"),
    attestationPath = join(owner, "onboarding-attestation.json"),
    criteriaPath = join(owner, "criteria.json");
  const write = (path, value) =>
    writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
  write(policyPath, policy);
  const signature = { commit: revision, valid: true, login: policy.approver };
  write(attestationPath, {
    scope: "aios-onboarding-attestation-v1",
    policySha256: sha256(readFileSync(policyPath)),
    attestedAt: new Date(Date.now() - 60_000).toISOString(),
    facts: {
      repository: policy.repository,
      defaultBranch: policy.defaultBranch,
      factoryCommit: policy.factoryCommit,
      appLogin: policy.appLogin,
      appRepositoryAccess: true,
      eligibleApprovers: [policy.approver],
      protectionsEnforced: true,
      requiredChecks: policy.requiredChecks,
      trustedCheckPublishers: true,
      publicationLogin: policy.publicationLogin,
      publicationAccess: true,
      localSignature: signature,
      githubSignature: signature,
      validation: policy.validation,
    },
  });
  // One owner setup for the records, as the CLI's private-file checks need.
  ownWindowsPaths([owner, policyPath, attestationPath]);
  return {
    repository,
    revision,
    git,
    policyPath,
    attestationPath,
    criteria(deliveryId) {
      write(criteriaPath, {
        scope: "aios-feature-criteria-v1",
        deliveryId,
        request,
        criteria: ["The contact page shows a visible hint."],
        verification: ["Check the visible hint in the isolated page."],
        ambiguity: null,
      });
      ownWindowsPaths([criteriaPath]);
      return criteriaPath;
    },
  };
}

/** A new folder under `parent` that only its owner, SYSTEM and Administrators
 * can use. The CLI refuses owner records and decision state that anyone else
 * can reach, and a Windows temp folder can grant other accounts access by
 * inheritance; elsewhere a new temp folder is already private. */
export async function privateRoot(prefix, parent = tmpdir()) {
  const root = realpathSync(mkdtempSync(join(parent, prefix)));
  if (process.platform === "win32")
    try {
      const { initializeWindowsAuthDirectory } = await import(
        "../dist/windows-auth-store.js"
      );
      initializeWindowsAuthDirectory(root);
    } catch (error) {
      rmSync(root, { recursive: true, force: true });
      throw error;
    }
  return root;
}

/** One CLI process: its parsed result, or its bounded refusal as an error. */
export function cliRunner(state) {
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  return (args) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [cli, ...args, "--state-dir", state],
        { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
      );
      const out = [],
        err = [];
      child.stdout.on("data", (chunk) => out.push(chunk));
      child.stderr.on("data", (chunk) => err.push(chunk));
      child.once("error", reject);
      child.once("close", (status) =>
        resolve({
          status,
          stdout: Buffer.concat(out).toString("utf8"),
          stderr: Buffer.concat(err).toString("utf8"),
        }),
      );
    });
}

/** Run the delivery through `cli` (one CLI process per call, from
 * `cliRunner`) on `machine`, with the owner's admission records, `codex` for
 * usage and the validation image `imageSha256`. `pins` holds, for coding and
 * validation, the record's `admitted` pins and `fresh()`, the VM's own; a
 * record that does not name them stops the run before any CLI step. `persist`
 * receives the report after every stage. */
export async function cliDeliveryAcceptance(
  {
    cli,
    pins,
    machine,
    codingAdmission,
    validationAdmission,
    codex,
    imageSha256,
  },
  options = {},
) {
  const persist = options.persist ?? (() => {});
  const interrupted = options.interrupted ?? (() => false);
  const { offlineValidationEnvironment } = await import(
    "../dist/native-validation.js"
  );
  const report = {
    scope: "native-cli-offline-delivery-acceptance",
    productionEnabled: false,
    qualified: false,
    inferenceAuthorized: false,
    synthetic: ["repository", "owner-policy", "attestation", "criteria"],
    outcome: "running",
    stages: [],
  };
  const check = (condition, message) => {
    if (!condition) throw Error(message);
  };
  const bounded = (text) => String(text).slice(0, 300);
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
      entry.error = bounded(error?.message);
      throw error;
    } finally {
      entry.finishedMs = elapsed();
      persist(report);
    }
  }
  // A refusal is the CLI's own bounded message, never its environment: the
  // last stderr line that is its JSON error. Node may warn before or after
  // it (on Windows, about SQLite and a deprecation).
  const refusal = (result) => {
    for (const line of result.stderr.split("\n").reverse())
      try {
        const error = JSON.parse(line).error;
        if (typeof error === "string") return bounded(error);
      } catch {}
    return `The CLI exited with ${result.status}`;
  };
  async function run(...args) {
    const result = await cli(args);
    if (result.status !== 0) throw Error(refusal(result));
    return JSON.parse(result.stdout);
  }

  const root = await privateRoot("aios-cli-delivery-acceptance-");
  let inputs, id, last;
  const vm = ["--podman-machine", machine];
  const validation = [...vm, "--validation-admission", validationAdmission];
  try {
    await stage("owner-records-name-fresh-pins", async () => {
      report.freshPins = {
        coding: await pins.coding.fresh(),
        validation: await pins.validation.fresh(),
      };
      for (const kind of ["coding", "validation"])
        check(
          pinFields[kind].every(
            (field) =>
              pins[kind].admitted[field] === report.freshPins[kind][field],
          ),
          `The owner ${kind} admission does not name the fresh pins`,
        );
    });
    inputs = await stage("owner-inputs", () =>
      ownerInputs(root, offlineValidationEnvironment(imageSha256)),
    );
    const owner = [
      "--owner-policy",
      inputs.policyPath,
      "--onboarding-attestation",
      inputs.attestationPath,
    ];
    last = await stage("cli-start", async () => {
      const started = await run(
        "start",
        "--repo",
        inputs.repository,
        "--request",
        request,
        ...owner,
        "--coding-minutes",
        String(codingMinutes),
      );
      check(uuid.test(started.id ?? ""), "The CLI started no delivery");
      check(
        started.onboarding?.ready === true &&
          started.onboarding.attestation?.source === "owner-attested",
        "Onboarding is not ready from the local hints and the attestation",
      );
      return started;
    });
    id = last.id;
    report.deliveryId = id;
    last = await stage("cli-plan-feature", async () => {
      const planned = await run(
        "plan-feature",
        "--id",
        id,
        "--feature-criteria",
        inputs.criteria(id),
      );
      check(
        planned.feature?.outcome === "planned" &&
          planned.feature.criteria.length === 1,
        "The owner's criteria were not planned",
      );
      return planned;
    });
    last = await stage("cli-validate-baseline", async () => {
      const validated = await run(
        "validate-baseline",
        "--id",
        id,
        ...owner,
        ...validation,
      );
      const attempt = validated.validation?.attempts.at(-1);
      report.baseline = attempt && {
        stage: attempt.stage,
        state: attempt.state,
        outcome: attempt.outcome,
        bindingSha256: attempt.bindingSha256,
        results: attempt.results.map((r) => ({
          checkId: r.checkId,
          status: r.status,
        })),
      };
      check(
        attempt?.stage === "baseline" &&
          attempt.state === "stopped" &&
          attempt.outcome === "passed",
        "The baseline did not pass on the admitted validation runtime",
      );
      return validated;
    });
    last = await stage("cli-code-feature", async () => {
      const coded = await run(
        "code-feature",
        "--id",
        id,
        ...owner,
        ...validation,
        "--coding-admission",
        codingAdmission,
        "--codex-executable",
        codex,
        "--coding-minutes",
        String(codingMinutes),
      );
      const feature = coded.feature,
        session = feature?.session;
      report.coding = {
        outcome: feature?.outcome ?? null,
        state: session?.state ?? null,
        threadStarted: session?.threadStarted === true,
        routed: Boolean(session?.route),
        candidate: Boolean(feature?.candidate),
        branch: feature?.branch ?? null,
        blocker: coded.blocker?.code ?? null,
      };
      check(
        session?.state === "stopped",
        "The coding session was not stopped exactly",
      );
      check(
        report.coding.threadStarted && uuid.test(session.threadId ?? ""),
        "The offline turn reported no thread",
      );
      check(!report.coding.routed, "The offline turn was routed");
      check(
        ["failed", "exhausted"].includes(feature.outcome) &&
          !report.coding.candidate,
        "An offline turn admitted a candidate",
      );
      check(
        coded.blocker?.code === "DELIVERY_NOT_ENABLED",
        "Production delivery is not disabled",
      );
      return coded;
    });
    await stage("cli-candidate-refused", async () => {
      const attempts = last.validation.attempts.length;
      const result = await cli([
        "validate-candidate",
        "--id",
        id,
        ...owner,
        ...validation,
      ]);
      report.candidateRefusal = result.status === 0 ? null : refusal(result);
      check(
        result.status !== 0,
        "Candidate validation ran without a candidate",
      );
      last = await run("status", "--id", id);
      check(
        last.validation.attempts.length === attempts,
        "A refused candidate validation left an attempt",
      );
    });
    await stage("host-checkout-unchanged", () => {
      check(
        inputs.git("branch", "--show-current") === "main" &&
          inputs.git("rev-parse", "HEAD") === inputs.revision &&
          inputs.git("status", "--porcelain") === "",
        "The host checkout changed",
      );
      check(
        inputs.git("rev-parse", `refs/heads/${last.feature.branch}`) ===
          inputs.revision,
        "The feature branch is not at the baseline revision",
      );
    });
    report.outcome = passingOutcome;
  } catch (error) {
    report.error = bounded(error?.message);
    report.outcome = "blocked";
  } finally {
    // An unsettled session or attempt is stopped by its exact identity.
    if (id)
      try {
        let current = await run("status", "--id", id);
        const open = (d) =>
          (d.feature?.session && d.feature.session.state !== "stopped") ||
          d.validation?.attempts.some((a) => a.state !== "stopped");
        if (open(current))
          current = await stage("final-exact-stop", async () => {
            await cli([
              "cancel",
              "--id",
              id,
              ...vm,
              "--coding-admission",
              codingAdmission,
              "--validation-admission",
              validationAdmission,
            ]);
            const after = await run("status", "--id", id);
            check(!open(after), "Exact stop is uncertain");
            return after;
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
        "cli",
        "cli-commands",
        "controller",
        "onboarding",
        "feature-criteria",
      ].map((name) => [
        name,
        sha256(readFileSync(new URL(`../dist/${name}.js`, import.meta.url))),
      ]),
    ),
  };
}

async function main() {
  const [
    machine,
    codingAdmission,
    validationAdmission,
    codex,
    reportPath,
    approval,
    ...extra
  ] = process.argv.slice(2);
  if (
    !/^aios-[a-z0-9-]+$/.test(machine ?? "") ||
    !codingAdmission ||
    !validationAdmission ||
    !codex ||
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
  const { ownerValidationAdmission } = await import(
    "../dist/native-validation.js"
  );
  const { ownerCodingAdmission } = await import("../dist/coding-admission.js");
  const { hostTarget } = await import("../dist/host-target.js");
  // Usage is read only through the pinned native codex; any other executable
  // reads as unknown usage, which coding refuses.
  const pinned = hostTarget(process.platform, process.arch)?.nativeCodexSha256;
  if (!pinned || sha256(readFileSync(codex)) !== pinned)
    throw Error(
      `The codex executable is not the pinned native codex 0.161.0 (SHA-256 ${pinned ?? "unknown for this host"})`,
    );
  // Both records must admit pins before any worker effect; the CLI re-reads
  // them at each step.
  const codingPins = ownerCodingAdmission(codingAdmission).pins();
  const validationPins = ownerValidationAdmission(validationAdmission).pins();
  const { imageSha256 } = validationPins;
  const { NativePodmanCodingTransport } = await import(
    "../dist/podman-coding.js"
  );
  const { NativePodmanValidationTransport } = await import(
    "../dist/podman-validation.js"
  );
  const { nativeCodingAuthority } = await import(
    "../dist/native-coding-runtime.js"
  );
  const { nativeValidationAuthority } = await import(
    "../dist/native-validation-runtime.js"
  );
  // The VM's own pins, read without starting any session or check.
  const pins = {
    coding: {
      admitted: codingPins,
      fresh: () =>
        new NativePodmanCodingTransport(
          machine,
          nativeCodingAuthority(machine),
        ).inspect({
          operationId: randomUUID(),
          fence: 1,
          state: "running",
          intent: "start",
        }),
    },
    validation: {
      admitted: validationPins,
      fresh: () =>
        new NativePodmanValidationTransport(
          machine,
          nativeValidationAuthority(machine),
          imageSha256,
        ).inspect(),
    },
  };
  // Refuse overwriting retained evidence before any worker effect.
  closeSync(openSync(reportPath, "wx", 0o600));
  const state = await privateRoot("aios-cli-delivery-state-");
  const context = {
    host: { platform: platform(), arch: arch(), release: release(), machine },
    imageSha256,
    ...source,
  };
  // A signal never abandons a step: the CLI process ends its own effects,
  // then any open session is stopped before the run reports interrupted.
  let interrupted = false;
  const interrupt = () => (interrupted = true);
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  const report = await cliDeliveryAcceptance(
    {
      cli: cliRunner(state),
      pins,
      machine,
      codingAdmission,
      validationAdmission,
      codex,
      imageSha256,
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
      state,
      // Fresh pins, so the owner can write or check the records.
      ...(report.outcome === passingOutcome
        ? {}
        : { freshPins: report.freshPins ?? null }),
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
