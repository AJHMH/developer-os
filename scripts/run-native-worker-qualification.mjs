#!/usr/bin/env node
// Owner-run offline adversarial qualification of the general workers on a
// real dedicated VM, under the owner's coding and validation admission records.
// It never provisions or starts the VM, loads images, opens credentials or
// authorizes inference, and it never enables production. A passing report is
// evidence for the owner to judge, not a qualification decision. Run it
// through scripts/run-native-acceptance.mjs.
//
// For each worker it shows:
// - a changed pin refuses admission (criterion 1);
// - the fixed boundary probe inside the worker's own container: admitted file
//   visible; no Git metadata, owner home, guest-private state, engine or
//   management sockets, credentials, host shares or network; read-only root;
//   unprivileged; escapes refused (criteria 2 and 3);
// - lifecycle under the public transports (criterion 5): coding, a detached
//   descendant removed by the exact session stop; validation, descendants
//   killed at the guest deadline, a stop mid-check, a fenced late check and a
//   changed tree never reported as the tested one.
// Every attempt is retained in the report, failed ones included (criterion 6).
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { arch, platform, release } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { freshBuild } from "./fresh-build.mjs";

const usage =
  "Usage: node scripts/run-native-worker-qualification.mjs <aios-machine> <owner-coding-admission.json> <owner-validation-admission.json> <image-id> <new-report.json> --approve-offline-native-run";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const passingOutcome = "observed-offline-worker-qualification";
const codingPinFields = [
  "cliVersion",
  "cliSha256",
  "codeModeHostSha256",
  "policySha256",
  "bindingSha256",
];
const validationPinFields = ["imageSha256", "policySha256", "bindingSha256"];
const same = (fields, a, b) => fields.every((field) => a[field] === b[field]);
const prompt =
  "Offline qualification only. Do not call any tool or change any file.";
const admittedFile = "index.html";
const admittedBytes = Buffer.from("<h1>Contact</h1>\n");
const files = () => [
  { path: admittedFile, bytes: Buffer.from(admittedBytes), executable: false },
];
const inputSha256 = sha256(
  JSON.stringify([
    { path: admittedFile, sha256: sha256(admittedBytes), executable: false },
  ]),
);
const treeSha256 = sha256("aios-native-worker-qualification:tree");
/** The validation guest's own state, which exists before any check runs. The
 * check cannot be told where the guest keeps it, only that it must not see it. */
export const validationPrivatePath =
  "/var/home/core/.local/state/aios-validation-v1";
const runGateRefusal = /^Native coding run stopped by its gate/;
/** Every stage, in order. */
export const stageNames = Object.freeze([
  "coding-fresh-pins",
  "validation-fresh-pins",
  "owner-records-name-fresh-pins",
  "changed-pins-refused",
  "coding-live-boundary-probe",
  "coding-exact-stop-removes-descendants",
  "validation-boundary-probe",
  "validation-deadline-kills-descendants",
  "validation-stop-mid-check-and-fence",
  "validation-changed-tree-never-tested",
]);

/** One validation check that passes only when probe `name` passed. */
export function probeCheck(boundaryProbe, name) {
  return {
    id: `probe-${name}`,
    command: [
      "/bin/sh",
      "-c",
      '/bin/sh -c "$1" -- "$2" "$3" | grep -qx "passed-$4"',
      "boundary-probe",
      boundaryProbe,
      `/workspace/${admittedFile}`,
      validationPrivatePath,
      name,
    ],
    timeoutMs: 30000,
  };
}

/** Run the qualification and return the report; `persist` receives it after
 * every stage. The workers are `{ transport, admission, Runtime }` pairs. */
export async function workerQualification(
  { coding, validation, imageSha256, probes },
  options = {},
) {
  const persist = options.persist ?? (() => {});
  const interrupted = options.interrupted ?? (() => false);
  const pause =
    options.pause ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const report = {
    scope: "native-worker-offline-qualification",
    productionEnabled: false,
    qualified: false,
    inferenceAuthorized: false,
    outcome: "running",
    stages: [],
    pins: {},
    coding: {},
    validation: {},
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
  /** Each changed or missing pin must be refused before any transport effect. */
  function refusesChangedPins(Runtime, fields, pins, transport, admission) {
    for (const field of fields)
      for (const [kind, changed] of [
        ["changed", { ...pins, [field]: pins[field].replace(/./g, "0") }],
        [
          "missing",
          Object.fromEntries(
            Object.entries(pins).filter(([key]) => key !== field),
          ),
        ],
      ]) {
        let refused = false;
        try {
          new Runtime(changed, transport, admission);
        } catch {
          refused = true;
        }
        check(refused, `A ${kind} ${field} was admitted`);
      }
    new Runtime(pins, transport, admission);
  }
  const codingSession = {
    operationId: randomUUID(),
    fence: 1,
    state: "running",
    intent: "start",
  };
  let codingLaunched = false;
  try {
    // Criterion 1 for both workers, before any worker runs.
    report.pins.coding = await stage("coding-fresh-pins", () =>
      coding.transport.inspect(codingSession),
    );
    report.pins.validation = await stage("validation-fresh-pins", () =>
      validation.transport.inspect(),
    );
    await stage("owner-records-name-fresh-pins", () => {
      check(
        same(codingPinFields, coding.admission.pins(), report.pins.coding),
        "The owner coding admission does not name the fresh pins",
      );
      check(
        report.pins.validation.imageSha256 === imageSha256 &&
          same(
            validationPinFields,
            validation.admission.pins(),
            report.pins.validation,
          ),
        "The owner validation admission does not name the fresh pins",
      );
    });
    await stage("changed-pins-refused", () => {
      refusesChangedPins(
        coding.Runtime,
        codingPinFields,
        report.pins.coding,
        coding.transport,
        coding.admission,
      );
      refusesChangedPins(
        validation.Runtime,
        validationPinFields,
        report.pins.validation,
        validation.transport,
        validation.admission,
      );
    });

    // Coding: the probe in a live session, then its exact stop.
    await stage("coding-live-boundary-probe", async () => {
      let probed = false;
      codingLaunched = true;
      const running = coding.transport
        .run(
          {
            ...codingSession,
            pins: report.pins.coding,
            argv: [
              "exec",
              "--json",
              "--skip-git-repo-check",
              "--sandbox",
              "workspace-write",
              prompt,
            ],
            branch: "codex/issue04-worker-qualification",
            sourceRevision: sha256("aios-native-worker-qualification").slice(
              0,
              40,
            ),
            files: files(),
            inputSha256,
            allowanceMs: 180000,
            mayDispatch: () => !interrupted(),
            checkpoint: () => !interrupted() && !probed,
            onEvent: () => !interrupted(),
          },
          () => {},
        )
        .then(
          () => ({ ended: true }),
          (error) => ({ error }),
        );
      let ended, end;
      running.then((settled) => (ended = settled));
      try {
        let live = false;
        for (let i = 0; i < 120 && !live && !ended; i++) {
          // Until preparation records the session, the guest refuses to
          // observe it; only a running observation counts.
          try {
            const observed =
              await coding.transport.observeSession(codingSession);
            live = observed.running && observed.phase === "running";
          } catch {
            live = false;
          }
          if (!live) await pause(1000);
        }
        check(live, "The coding session never ran");
        const result = await coding.transport.probeBoundary(
          codingSession,
          admittedFile,
        );
        check(
          same(codingPinFields, result.pins, report.pins.coding),
          "The coding pins changed during the probe",
        );
        report.coding.probes = result.probes;
        report.coding.processesWithDescendant = result.processes;
      } finally {
        // Let the turn end and its own exact stop finish before anything else.
        probed = true;
        end = await running;
      }
      check(
        end.ended || runGateRefusal.test(String(end.error?.message)),
        "The coding turn ended unexpectedly: " +
          String(end.error?.message).slice(0, 200),
      );
    });
    await stage("coding-exact-stop-removes-descendants", async () => {
      const observed = await coding.transport.observeSession({
        ...codingSession,
        state: "stopped",
      });
      report.coding.stopped = {
        phase: observed.phase,
        remainingProcesses: observed.remainingProcesses,
        processesGone: observed.processesGone,
      };
      check(
        observed.phase === "stopped" &&
          observed.remainingProcesses === 0 &&
          observed.processesGone === true,
        "A coding descendant survived the exact stop",
      );
    });

    // Validation: the probe as checks, one per probe, in a fresh container each.
    const newAttempt = () => ({ operationId: randomUUID(), fence: 1 });
    const runCheck = (attempt, request, mayDispatch = () => !interrupted()) =>
      validation.transport.run({
        ...attempt,
        treeSha256,
        files: files(),
        check: request,
        mayDispatch,
      });
    await stage("validation-boundary-probe", async () => {
      const attempt = newAttempt();
      report.validation.probes = [];
      for (const name of probes.names) {
        const result = await runCheck(attempt, probeCheck(probes.script, name));
        check(
          same(validationPinFields, result.pins, report.pins.validation),
          "The validation pins changed during the probe",
        );
        report.validation.probes.push({
          name,
          outcome:
            result.exitCode === 0 && !result.timedOut ? "passed" : "failed",
        });
        persist(report);
      }
      const stopped = await validation.transport.stop(attempt);
      check(
        stopped.stopped && stopped.remainingProcesses === 0,
        "The probe attempt did not stop",
      );
      check(
        stopped.treeSha256 === treeSha256,
        "A probe check changed the tested tree",
      );
    });
    await stage("validation-deadline-kills-descendants", async () => {
      const attempt = newAttempt();
      const result = await runCheck(attempt, {
        id: "deadline-descendants",
        command: ["/bin/sh", "-c", "sleep 600 & setsid sleep 600 & sleep 600"],
        timeoutMs: 3000,
      });
      const stopped = await validation.transport.stop(attempt);
      report.validation.deadline = {
        timedOut: result.timedOut,
        exitCode: result.exitCode,
        remainingProcesses: stopped.remainingProcesses,
      };
      check(result.timedOut === true, "The guest deadline did not end it");
      check(
        stopped.stopped && stopped.remainingProcesses === 0,
        "A descendant survived the deadline and stop",
      );
    });
    await stage("validation-stop-mid-check-and-fence", async () => {
      const attempt = newAttempt();
      let dispatches = 0,
        started,
        halted = false;
      const running = new Promise((resolve) => (started = resolve));
      const pending = runCheck(
        attempt,
        {
          id: "stopped-mid-check",
          command: ["/bin/sh", "-c", "sleep 600 & setsid sleep 600 & wait"],
          timeoutMs: 120000,
        },
        () => {
          // Prepare and start, then at least one poll: the check is running.
          if (++dispatches === 4) started();
          return !interrupted() && !halted;
        },
      ).then(
        (result) => ({ result }),
        (error) => ({ error }),
      );
      const which = await Promise.race([
        running.then(() => "running"),
        pending.then(() => "ended"),
      ]);
      check(which === "running", "The long check ended on its own");
      const stopped = await validation.transport.stop(attempt);
      halted = true;
      const end = await pending;
      report.validation.midStop = {
        stopped: stopped.stopped,
        remainingProcesses: stopped.remainingProcesses,
        checkPassed: end.result?.exitCode === 0,
      };
      check(
        stopped.stopped && stopped.remainingProcesses === 0,
        "A check survived the stop",
      );
      check(end.result?.exitCode !== 0, "A stopped check passed");
      let fenced = false;
      try {
        await runCheck(attempt, probeCheck(probes.script, "tools"));
      } catch {
        fenced = true;
      }
      report.validation.lateCheckFenced = fenced;
      check(fenced, "A check ran after its attempt was stopped");
    });
    await stage("validation-changed-tree-never-tested", async () => {
      const attempt = newAttempt();
      const result = await runCheck(attempt, {
        id: "changes-the-tree",
        command: ["/bin/sh", "-c", `echo changed > ${admittedFile}`],
        timeoutMs: 30000,
      });
      const stopped = await validation.transport.stop(attempt);
      report.validation.changedTree = {
        exitCode: result.exitCode,
        reportedTested: stopped.treeSha256 === treeSha256,
      };
      check(
        stopped.stopped &&
          /^[a-f0-9]{64}$/.test(String(stopped.treeSha256)) &&
          stopped.treeSha256 !== treeSha256,
        "A changed tree was reported as the tested tree",
      );
    });

    report.failedProbes = [
      ...report.coding.probes.map((p) => ({ ...p, worker: "coding" })),
      ...report.validation.probes.map((p) => ({ ...p, worker: "validation" })),
    ]
      .filter((p) => p.outcome !== "passed")
      .map((p) => `${p.worker}:${p.name}`);
    const failed = report.failedProbes;
    report.outcome = failed.length ? "failed" : passingOutcome;
  } catch {
    report.outcome = interrupted() ? "interrupted" : "blocked";
    if (codingLaunched)
      try {
        await coding.transport.stop({ ...codingSession, state: "uncertain" });
      } catch {
        report.outcome = "uncertain";
      }
  }
  // Stages that never ran are named, so a blocked report is complete.
  for (const name of stageNames)
    if (!report.stages.some((entry) => entry.name === name))
      report.stages.push({ name, outcome: "not-run" });
  persist(report);
  return report;
}

function sourceEvidence(root) {
  const build = freshBuild(root);
  const git = (...args) =>
    spawnSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      timeout: 5000,
    });
  return {
    ...build,
    sourceRevision: git("rev-parse", "HEAD").stdout.trim(),
    sourceDirty: git("status", "--porcelain").stdout.trim() !== "",
    runnerSha256: sha256(readFileSync(new URL(import.meta.url))),
  };
}

async function main() {
  const [
    machine,
    codingRecord,
    validationRecord,
    imageSha256,
    reportPath,
    approval,
    ...extra
  ] = process.argv.slice(2);
  if (
    !/^aios-[a-z0-9-]+$/.test(machine ?? "") ||
    !codingRecord ||
    !validationRecord ||
    !/^[a-f0-9]{64}$/.test(imageSha256 ?? "") ||
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
  const { NativePodmanValidationTransport } = await import(
    "../dist/podman-validation.js"
  );
  const { ownerCodingAdmission } = await import("../dist/coding-admission.js");
  const { PinnedCodingRuntime } = await import("../dist/feature-candidate.js");
  const { ownerValidationAdmission, PinnedValidationRuntime } = await import(
    "../dist/native-validation.js"
  );
  const { boundaryProbe, boundaryProbeNames, codingBoundaryProbe } =
    await import("../dist/worker-probes.js");
  // The authorities each VM's management state and the owner records already
  // belong to, as in the admission acceptances.
  const coding = {
    transport: new NativePodmanCodingTransport(
      machine,
      sha256("issue04-native-offline-lifecycle-v1:" + machine),
    ),
    admission: ownerCodingAdmission(codingRecord),
    Runtime: PinnedCodingRuntime,
  };
  const validation = {
    transport: new NativePodmanValidationTransport(
      machine,
      sha256("issue04-native-offline-validation-v1:" + machine),
      imageSha256,
    ),
    admission: ownerValidationAdmission(validationRecord),
    Runtime: PinnedValidationRuntime,
  };
  for (const { transport } of [coding, validation])
    if (transport.mode !== "live" || transport.productionEnabled !== false)
      throw Error("Expected live transports with production disabled");
  // Refuse overwriting retained evidence before any worker effect.
  closeSync(openSync(reportPath, "wx", 0o600));
  const context = {
    host: { platform: platform(), arch: arch(), release: release(), machine },
    imageSha256,
    probeSha256: sha256(boundaryProbe),
    // The coding worker runs the shared probes plus its own controls.
    codingProbeSha256: sha256(codingBoundaryProbe),
    ...source,
  };
  let interrupted = false;
  const interrupt = () => (interrupted = true);
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  const report = await workerQualification(
    {
      coding,
      validation,
      imageSha256,
      probes: { script: boundaryProbe, names: boundaryProbeNames },
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
      // Fresh pins, so the owner can write or check the records.
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
