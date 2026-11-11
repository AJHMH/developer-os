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
// tarball, the guest installs it offline, and a check requires it. The
// project's own postinstall script probes its isolation during the install,
// and a second check requires its marker. That needs
// an owner-loaded image with node and npm. With --with-database <image-id> it
// also validates a third synthetic repository whose E2E checks each get a
// disposable PostgreSQL from that owner-loaded image: one creates a table,
// the next finds a fresh database without it, and a third still has no
// outside network. It never provisions or starts the
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
  "Usage: node scripts/run-native-validation-admission-acceptance.mjs <aios-machine> <owner-validation-admission.json> <image-id> <new-report.json> --approve-offline-native-run [--with-npm-dependencies] [--with-database <postgres-image-id>]";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

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

/** The project's own `postinstall` script, which `npm ci` runs inside the
 * install container (#265). It writes its marker into `node_modules`, the only
 * part of an install that becomes the layer, and only when it finds no
 * network, a read-only root, no engine socket and the unprivileged user. */
export const installScriptProbe = [
  "node",
  "-e",
  JSON.stringify(
    [
      'const fs = require("fs");',
      "(async () => {",
      "  let reached = false;",
      '  try { await fetch("http://example.com", { signal: AbortSignal.timeout(3000) }); reached = true; } catch {}',
      "  let wrote = false;",
      '  try { fs.writeFileSync("/etc/aios-install-probe", "x"); wrote = true; } catch {}',
      '  const sockets = ["/run/podman", "/var/run/docker.sock"].some((p) => fs.existsSync(p));',
      "  if (reached || wrote || sockets || process.getuid() !== 65534) process.exit(1);",
      '  fs.writeFileSync("node_modules/.aios-install-probe", "isolated");',
      "})();",
    ].join(" "),
  ),
].join(" ");

/** A check's command that runs `sql` on its database over the PostgreSQL
 * wire protocol, from node alone, and passes only when the query succeeds and,
 * with `want`, its first value is exactly that text. */
export function postgresQuery(sql, want) {
  const script = [
    'const net = require("net");',
    "const [sql, want] = process.argv.slice(1);",
    "const fail = () => process.exit(1);",
    'const text = (t) => Buffer.from(t + "\\0");',
    "const frame = (type, body) => { const head = Buffer.alloc(type ? 5 : 4); if (type) head.write(type); head.writeInt32BE(body.length + 4, type ? 1 : 0); return Buffer.concat([head, body]); };",
    "const socket = net.connect({ host: process.env.PGHOST, port: Number(process.env.PGPORT) });",
    'socket.setTimeout(10000, fail); socket.on("error", fail);',
    'socket.write(frame("", Buffer.concat([Buffer.from([0, 3, 0, 0]), text("user"), text(process.env.PGUSER), text("database"), text(process.env.PGDATABASE), Buffer.from([0])])));',
    "let pending = Buffer.alloc(0), queried = false, value;",
    'socket.on("data", (data) => {',
    "  pending = Buffer.concat([pending, data]);",
    "  while (pending.length >= 5 && pending.length >= pending.readInt32BE(1) + 1) {",
    "    const type = String.fromCharCode(pending[0]), body = pending.subarray(5, pending.readInt32BE(1) + 1);",
    "    pending = pending.subarray(body.length + 5);",
    '    if (type === "E" || (type === "R" && body.readInt32BE(0) !== 0)) fail();',
    '    if (type === "D" && value === undefined) { const size = body.readInt32BE(2); value = size < 0 ? null : body.subarray(6, 6 + size).toString(); }',
    '    if (type === "Z" && !queried) { queried = true; socket.write(frame("Q", text(sql))); }',
    '    else if (type === "Z") process.exit(want === undefined || value === want ? 0 : 1);',
    "  }",
    "});",
  ].join(" ");
  return ["node", "-e", script, sql, ...(want === undefined ? [] : [want])];
}

/** The E2E checks the database stage runs, each on a fresh database. */
export const databaseChecks = Object.freeze({
  database: postgresQuery("CREATE TABLE aios_marker (id int)"),
  // A later check's database is new: the earlier check's table is gone.
  "database-fresh": postgresQuery(
    "SELECT to_regclass('aios_marker') IS NULL",
    "t",
  ),
  // Sharing its database's network namespace adds only that loopback.
  "database-offline": [
    "sh",
    "-c",
    "! wget -q -T 5 -O /dev/null http://example.com",
  ],
});

/** The manifest and lockfile of a project depending on exactly `dependency`,
 * whose own install script probes its isolation. */
export function npmProject({ name, version, integrity }) {
  const root = { name: "acceptance-page", version: "1.0.0" };
  return {
    "package.json": {
      ...root,
      scripts: { postinstall: installScriptProbe },
      dependencies: { [name]: version },
    },
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

/** The owner contract the acceptances validate under: `environment`, the
 * probe checks, with `dependency` a check requiring it, with a database the
 * E2E database checks, a passing candidate acceptance check and the trusted
 * CI checks the policy names. */
export function acceptanceContract(environment, dependency) {
  return {
    version: 1,
    mutablePaths: ["index.html"],
    environment,
    checks: Object.entries(probes)
      .map(([kind, command]) => [kind, kind, command])
      .concat(
        environment.database
          ? Object.entries(databaseChecks).map(([id, command]) => [
              id,
              "e2e",
              command,
            ])
          : [],
      )
      .concat(
        dependency
          ? [
              [
                "dependencies",
                "build",
                ["node", "-e", `require(${JSON.stringify(dependency.name)})`],
              ],
              // The install script ran, and found itself isolated.
              [
                "install-scripts",
                "build",
                [
                  "sh",
                  "-c",
                  'test "$(cat node_modules/.aios-install-probe)" = isolated',
                ],
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
}

/** A disposable repository whose owner contract declares `environment` and
 * the probe checks; with `dependency`, also its npm project and a check that
 * requires the package. */
function syntheticDelivery(root, environment, dependency) {
  const repository = join(
    root,
    dependency
      ? "npm-repository"
      : environment.database
        ? "database-repository"
        : "repository",
  );
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
  const contract = acceptanceContract(environment, dependency);
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
  const policyPath = join(repository + "-owner-policy.json");
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
      forcePushBlocked: true,
      signedCommitsRequired: true,
      everyPullRequestReviewRequired: false,
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
 * to pin), also validate an npm project installed offline in the guest. With
 * `options.database`, also validate E2E checks that each get a disposable
 * database from the record's database image. */
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
    sameValidationPins,
    validationPinKeys,
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
        sameValidationPins(admission.pins(), report.pins) &&
          Boolean(report.pins.databaseImageSha256) ===
            Boolean(options.database),
        "The owner validation admission does not name the fresh pins",
      ),
    );
    runtime = await stage("admitted-runtime", () => {
      for (const field of validationPinKeys(report.pins)) {
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
          // The probes, the require check and the install-script check.
          installed.results.length === Object.keys(probes).length + 2 &&
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
    if (options.database) {
      const tested = await stage("controller-database-validation", async () => {
        const synthetic = syntheticDelivery(root, {
          ...offlineValidationEnvironment(imageSha256),
          database: true,
        });
        const controller = new DeliveryController(
          join(root, "database-state"),
          synthetic.options,
          {
            featurePlanner: synthetic.planner,
            validationRuntime: new PinnedValidationRuntime(
              report.pins,
              transport,
              admission,
              { database: true },
            ),
          },
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
      report.database = {
        imageSha256: report.pins.databaseImageSha256,
        outcome: tested.outcome,
        state: tested.state,
        results: tested.results.map((r) => ({
          checkId: r.checkId,
          status: r.status,
        })),
        treeSha256: tested.treeSha256,
        environmentSha256: tested.environmentSha256,
      };
      await stage("controller-recorded-database-checks", () => {
        check(tested.state === "stopped", "Database attempt is not stopped");
        check(
          tested.results.length ===
            Object.keys(probes).length + Object.keys(databaseChecks).length &&
            tested.results.every((r) => r.status === "success"),
          "A database check did not pass",
        );
        // Only the E2E checks ran with a database, each from the admitted image.
        check(
          tested.results.every(
            (r) =>
              r.checkId in databaseChecks ===
              r.artifacts.some(
                (a) =>
                  a.name === "postgres-image" &&
                  a.sha256 === report.pins.databaseImageSha256,
              ),
          ),
          "The E2E checks did not each get the admitted database",
        );
        check(tested.outcome === "passed", "Database validation did not pass");
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

/** The optional flags: `--with-npm-dependencies` and `--with-database
 * <image-id>`, each at most once, or null when anything else is passed. */
export function acceptanceFlags(extra) {
  const flags = { dependencies: false, databaseImageSha256: undefined };
  for (let i = 0; i < extra.length; i++)
    if (extra[i] === "--with-npm-dependencies" && !flags.dependencies)
      flags.dependencies = true;
    else if (
      extra[i] === "--with-database" &&
      !flags.databaseImageSha256 &&
      /^[a-f0-9]{64}$/.test(extra[i + 1] ?? "")
    )
      flags.databaseImageSha256 = extra[++i];
    else return null;
  return flags;
}

async function main() {
  const [machine, admissionPath, imageSha256, reportPath, approval, ...extra] =
    process.argv.slice(2);
  const flags = acceptanceFlags(extra);
  if (
    !/^aios-[a-z0-9-]+$/.test(machine ?? "") ||
    !admissionPath ||
    !/^[a-f0-9]{64}$/.test(imageSha256 ?? "") ||
    !reportPath ||
    approval !== "--approve-offline-native-run" ||
    !flags
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
    flags.databaseImageSha256
      ? { databaseImageSha256: flags.databaseImageSha256 }
      : {},
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
    ...(flags.dependencies
      ? { dependencies: { reader: httpsRegistryReader() } }
      : {}),
    ...(flags.databaseImageSha256 ? { database: true } : {}),
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
