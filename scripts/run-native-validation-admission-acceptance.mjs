#!/usr/bin/env node
// Owner-run offline acceptance of owner validation admission on a real
// dedicated VM. The delivery controller validates unchanged main of a
// synthetic repository through the real native validation transport, admitted
// only by the owner's per-host record naming its fresh pins. Each check is a
// small shell probe run in the owner-loaded image: the tree is present, there
// is no network, the root filesystem is read-only and the user is
// unprivileged. Planning, onboarding facts and usage are synthetic. With
// --with-npm-dependencies it also validates a second synthetic repository whose
// lockfile pins one small registry package: the host fetches and verifies the
// tarball, the guest installs it offline, and a check requires it. That needs
// an owner-loaded image with node and npm. It never provisions or starts the
// VM, loads images, opens credentials or authorizes inference, and it never
// enables production or claims qualification. Run it through
// scripts/run-native-acceptance.mjs.
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
  "Usage: node scripts/run-native-validation-admission-acceptance.mjs <aios-machine> <owner-validation-admission.json> <image-id> <new-report.json> --approve-offline-native-run [--with-npm-dependencies]";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const pinFields = ["imageSha256", "policySha256", "bindingSha256"];
const samePins = (a, b) => pinFields.every((field) => a[field] === b[field]);

/** Probes run as checks; each passes only when isolation holds. */
export const probes = Object.freeze({
  format: ["sh", "-c", "test -f index.html && grep -q Contact index.html"],
  lint: ["sh", "-c", "! wget -q -T 5 -O /dev/null http://example.com"],
  type: ["sh", "-c", "! touch /etc/aios-validation-probe"],
  coverage: ["sh", "-c", 'test "$(id -u)" = 65534'],
  build: [
    "sh",
    "-c",
    "test ! -e /run/podman && test ! -e /var/run/docker.sock",
  ],
});

/** The registry package the dependency stage installs: small, with no
 * dependencies and no install scripts. */
export const dependencyPackage = Object.freeze({
  name: "is-number",
  version: "7.0.0",
  integrity:
    "sha512-41Cifkg6e8TylSpdtTpeLVMqvSBEVzTttHvERD741+pnZ8ANv0004MRL43QKPDlK9cGvNp6NZWZUBlbGXYxxng==",
});

/** The manifest and lockfile of a project depending on exactly `dependency`. */
function npmProject({ name, version, integrity }) {
  const root = { name: "acceptance-page", version: "1.0.0" };
  return {
    "package.json": { ...root, dependencies: { [name]: version } },
    "package-lock.json": {
      ...root,
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": { ...root, dependencies: { [name]: version } },
        [`node_modules/${name}`]: {
          version,
          resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,
          integrity,
        },
      },
    },
  };
}

/** A disposable repository whose owner contract declares `environment` and
 * the probe checks; with `dependency`, also its npm project and a check that
 * requires the package. */
function syntheticDelivery(root, environment, dependency) {
  const repository = join(root, dependency ? "npm-repository" : "repository");
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
  if (dependency)
    for (const [path, value] of Object.entries(npmProject(dependency))) {
      writeFileSync(
        join(repository, path),
        JSON.stringify(value, null, 2) + "\n",
      );
      git("add", path);
    }
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
    environment,
    checks: Object.entries(probes)
      .map(([kind, command]) => [kind, kind, command])
      .concat(
        dependency
          ? [
              [
                "dependencies",
                "build",
                ["node", "-e", `require(${JSON.stringify(dependency.name)})`],
              ],
            ]
          : [],
      )
      .map(([id, kind, command]) => ({
        id,
        kind,
        scope: "local",
        stages: ["baseline", "candidate"],
        command,
        publisher: "isolated-checker",
        timeoutMs: 60000,
      }))
      .concat([
        {
          id: "acceptance",
          kind: "acceptance",
          scope: "local",
          stages: ["candidate"],
          command: ["sh", "-c", "true"],
          publisher: "isolated-checker",
          timeoutMs: 60000,
        },
        ...[
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
      ]),
  };
  const facts = {
    repository: "AJHMH/acceptance-page",
    defaultBranch: "main",
    factoryCommit: "a".repeat(40),
    approver: "acceptance-owner",
    appLogin: "factory[bot]",
    publicationLogin: "acceptance-owner",
    requiredChecks: ["pr-ci"],
    validation: ["isolated-offline"],
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
  return { repository, options, planner };
}

/** Validate one synthetic baseline through `transport` under `admission`;
 * `persist` receives the report after every stage. With
 * `options.dependencies` (a registry `reader`, and optionally the `dependency`
 * to pin), also validate an npm project installed offline in the guest. */
export async function validationAcceptance(
  transport,
  admission,
  imageSha256,
  options = {},
) {
  const persist = options.persist ?? (() => {});
  const { DeliveryController } = await import("../dist/controller.js");
  const {
    PinnedValidationRuntime,
    offlineValidationEnvironment,
    preparedNpmValidationEnvironment,
  } = await import("../dist/native-validation.js");
  const report = {
    scope: "native-validation-offline-admission-acceptance",
    productionEnabled: false,
    qualified: false,
    inferenceAuthorized: false,
    synthetic: ["planning", "onboarding"],
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
    mkdtempSync(join(tmpdir(), "aios-validation-admission-acceptance-")),
  );
  let runtime;
  // Every controller and delivery the run started, so an unsettled attempt
  // is stopped.
  const deliveries = [];
  try {
    report.pins = await stage("fresh-pins", () => transport.inspect());
    await stage("owner-record-names-fresh-pins", () =>
      check(
        samePins(admission.pins(), report.pins),
        "The owner validation admission does not name the fresh pins",
      ),
    );
    runtime = await stage("admitted-runtime", () => {
      for (const field of pinFields) {
        let refused = false;
        try {
          new PinnedValidationRuntime(
            { ...report.pins, [field]: "0".repeat(64) },
            transport,
            admission,
          );
        } catch {
          refused = true;
        }
        check(refused, `A changed ${field} was admitted`);
      }
      return new PinnedValidationRuntime(report.pins, transport, admission);
    });
    const attempt = await stage("controller-baseline-validation", async () => {
      const synthetic = syntheticDelivery(
        root,
        offlineValidationEnvironment(imageSha256),
      );
      const controller = new DeliveryController(
        join(root, "state"),
        synthetic.options,
        { featurePlanner: synthetic.planner, validationRuntime: runtime },
      );
      const started = controller.start({
        repository: synthetic.repository,
        request: "Add a visible contact hint.",
      });
      deliveries.push([controller, started.id]);
      await controller.planFeature(started.id);
      await controller.validateBaseline(started.id);
      return controller.status(started.id).validation.attempts.at(-1);
    });
    report.validation = {
      outcome: attempt.outcome,
      state: attempt.state,
      results: attempt.results.map((r) => ({
        checkId: r.checkId,
        status: r.status,
      })),
      treeSha256: attempt.treeSha256,
      environmentSha256: attempt.environmentSha256,
      bindingSha256: attempt.bindingSha256,
    };
    await stage("controller-recorded-passed-baseline", () => {
      check(attempt.state === "stopped", "Validation attempt is not stopped");
      check(
        attempt.results.length === Object.keys(probes).length &&
          attempt.results.every((r) => r.status === "success"),
        "An isolation probe did not pass",
      );
      check(attempt.outcome === "passed", "Baseline validation did not pass");
    });
    if (options.dependencies) {
      const dependency = options.dependencies.dependency ?? dependencyPackage;
      const installed = await stage(
        "controller-dependency-validation",
        async () => {
          const synthetic = syntheticDelivery(
            root,
            preparedNpmValidationEnvironment(imageSha256),
            dependency,
          );
          const npm = new DeliveryController(
            join(root, "npm-state"),
            synthetic.options,
            {
              featurePlanner: synthetic.planner,
              validationRuntime: new PinnedValidationRuntime(
                report.pins,
                transport,
                admission,
                { reader: options.dependencies.reader },
              ),
            },
          );
          const started = npm.start({
            repository: synthetic.repository,
            request: "Add a visible contact hint.",
          });
          deliveries.push([npm, started.id]);
          await npm.planFeature(started.id);
          await npm.validateBaseline(started.id);
          return npm.status(started.id).validation.attempts.at(-1);
        },
      );
      const artifact = (name) =>
        installed.results[0]?.artifacts.find((a) => a.name === name)?.sha256 ??
        null;
      report.dependencies = {
        package: `${dependency.name}@${dependency.version}`,
        outcome: installed.outcome,
        state: installed.state,
        results: installed.results.map((r) => ({
          checkId: r.checkId,
          status: r.status,
        })),
        planSha256: artifact("npm-cache-plan"),
        layerSha256: artifact("npm-dependency-layer"),
        treeSha256: installed.treeSha256,
        environmentSha256: installed.environmentSha256,
      };
      await stage("controller-recorded-installed-dependencies", () => {
        check(
          installed.state === "stopped",
          "Dependency attempt is not stopped",
        );
        check(
          installed.results.length === Object.keys(probes).length + 1 &&
            installed.results.every((r) => r.status === "success"),
          "A dependency check did not pass",
        );
        // Every check ran on the one layer installed from the one plan.
        check(
          report.dependencies.layerSha256 &&
            installed.results.every(
              (r) =>
                r.artifacts.find((a) => a.name === "npm-cache-plan")?.sha256 ===
                  report.dependencies.planSha256 &&
                r.artifacts.find((a) => a.name === "npm-dependency-layer")
                  ?.sha256 === report.dependencies.layerSha256,
            ),
          "The checks did not share one installed layer",
        );
        check(
          installed.outcome === "passed",
          "Dependency validation did not pass",
        );
      });
    }
    report.outcome = "observed-offline-validation-admission-acceptance";
  } catch (error) {
    report.error = String(error?.message).slice(0, 300);
    report.outcome = "blocked";
  } finally {
    // An unsettled attempt is stopped by its exact identity.
    for (const [owner, id] of deliveries)
      try {
        const open = owner
          .status(id)
          .validation?.attempts.find((a) => a.state !== "stopped");
        if (open)
          await stage("final-exact-attempt-stop", async () => {
            const stopped = await transport.stop({
              operationId: open.operationId,
              fence: open.fence,
            });
            check(
              stopped.stopped === true && stopped.remainingProcesses === 0,
              "Exact-attempt stop is uncertain",
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
        "podman-validation",
        "native-validation",
        "native-management",
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
  const [machine, admissionPath, imageSha256, reportPath, approval, ...extra] =
    process.argv.slice(2);
  const withDependencies =
    extra.length === 1 && extra[0] === "--with-npm-dependencies";
  if (
    !/^aios-[a-z0-9-]+$/.test(machine ?? "") ||
    !admissionPath ||
    !/^[a-f0-9]{64}$/.test(imageSha256 ?? "") ||
    !reportPath ||
    approval !== "--approve-offline-native-run" ||
    (extra.length && !withDependencies)
  ) {
    console.error(usage);
    process.exitCode = 1;
    return;
  }
  // The build must be what this source compiles to, before anything from it
  // runs or any evidence, record or VM is touched.
  const source = sourceEvidence(fileURLToPath(new URL("..", import.meta.url)));
  const { NativePodmanValidationTransport } = await import(
    "../dist/podman-validation.js"
  );
  const { ownerValidationAdmission } = await import(
    "../dist/native-validation.js"
  );
  const { httpsRegistryReader } = await import("../dist/dependency-cache.js");
  // A validation authority of its own, separate from coding's.
  const authority = sha256("issue04-native-offline-validation-v1:" + machine);
  const transport = new NativePodmanValidationTransport(
    machine,
    authority,
    imageSha256,
  );
  if (transport.mode !== "live" || transport.productionEnabled !== false)
    throw Error("Expected the live transport with production disabled");
  const admission = ownerValidationAdmission(admissionPath);
  // Refuse overwriting retained evidence before any worker effect.
  closeSync(openSync(reportPath, "wx", 0o600));
  const context = {
    host: { platform: platform(), arch: arch(), release: release(), machine },
    authority,
    imageSha256,
    ...source,
  };
  // A signal never abandons a check: it ends within its timeout, then the
  // exact attempt is stopped before the run reports interrupted.
  let interrupted = false;
  const interrupt = () => (interrupted = true);
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  const report = await validationAcceptance(transport, admission, imageSha256, {
    ...(withDependencies
      ? { dependencies: { reader: httpsRegistryReader() } }
      : {}),
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
      ...(report.outcome === "observed-offline-validation-admission-acceptance"
        ? {}
        : { freshPins: report.pins ?? null }),
    }),
  );
  if (report.outcome !== "observed-offline-validation-admission-acceptance")
    process.exitCode = 1;
}

// Compare real paths, so a symlinked checkout still runs.
const invoked = process.argv[1] && realpathSync(process.argv[1]);
if (invoked && import.meta.url === pathToFileURL(invoked).href)
  main().catch((error) => {
    console.error(String(error?.message).slice(0, 300));
    process.exitCode = 1;
  });
