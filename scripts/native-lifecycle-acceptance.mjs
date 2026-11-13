// The lifecycle controls on real deliveries (#274, v1 ticket 16): pause,
// resume, cancel and controller recovery through the CLI, each interrupting a
// step that is running on the Mac's VM, and the coding worker's output
// admission refusing a symbolic link. Run by
// `run-native-cli-delivery-acceptance.mjs --lifecycle`, which supplies the
// owner's records, the VM's fresh pins and the CLI.
//
// Three deliveries of one synthetic repository, one at a time, each released
// before the next:
//   A. `code-feature` is paused mid-turn, resumed, coded to a candidate, then
//      `validate-candidate` is cancelled mid-check, and a resume refused.
//   B. The CLI running `code-feature` is killed outright, as a crashed
//      controller is, and `recover` stops the exact session it left running.
//   C. A request for a symbolic link: the guest's output admission refuses
//      the link, so no candidate is admitted.
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const lifecyclePassingOutcome = "observed-native-lifecycle-controls";
/** Every stage, in order. */
export const lifecycleStageNames = Object.freeze([
  "owner-records-name-fresh-pins",
  "a-start",
  "a-pause-mid-coding",
  "a-resume",
  "a-code-after-resume",
  "a-cancel-mid-validation",
  "a-resume-refused-after-cancel",
  "a-release",
  "b-start",
  "b-controller-killed-mid-coding",
  "b-recover",
  "b-release",
  "c-start",
  "c-symlink-output-refused",
  "c-release",
  "coding-session-cleanup",
]);
export const symlinkRequest =
  "Add latest.html as a symbolic link to index.html, so both names show the contact page.";
/** How long a step may take to start running, and how often to look. */
export const runningWaitMs = 180000;
export const pollMs = 1000;
/** Time a running step is given before it is interrupted, so the
 * interruption lands mid-step, not at its start. */
export const settleMs = 5000;

/** One CLI process per call that the caller can also kill: `done` settles
 * with its exit status and output. */
export function cliProcessRunner(state) {
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  return (args) => {
    const child = spawn(
      process.execPath,
      [cli, ...args, "--state-dir", state],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const out = [],
      err = [];
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    const done = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (status, signal) =>
        resolve({
          status,
          signal,
          stdout: Buffer.concat(out).toString("utf8"),
          stderr: Buffer.concat(err).toString("utf8"),
        }),
      );
    });
    return { kill: (signal) => child.kill(signal), done };
  };
}

/** Run the lifecycle controls. `host` holds the CLI (`cli` runs one step to
 * its end, `spawnCli` starts one that can be interrupted), the owner's
 * records, the VM's pins and `ownerInputs`, which writes a synthetic
 * repository and its owner records into a folder. */
export async function lifecycleAcceptance(host, options = {}) {
  const {
    cli,
    spawnCli,
    pins,
    pinFields,
    machine,
    codingAdmission,
    validationAdmission,
    authDirectory,
    cleanupCodingSession,
    ownerInputs,
    root,
    codingMinutes,
    budgetDollars,
  } = host;
  const persist = options.persist ?? (() => {});
  const sleep =
    options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  const interrupted = options.interrupted ?? (() => false);
  const report = {
    scope: "native-lifecycle-controls",
    productionEnabled: false,
    qualified: false,
    inferenceAuthorized: true,
    budgetDollars,
    synthetic: ["repository", "owner-policy", "attestation", "criteria"],
    outcome: "running",
    stages: [],
    deliveries: {},
  };
  const check = (condition, message) => {
    if (!condition) throw Error(message);
  };
  const bounded = (text) => String(text).slice(0, 300);
  const origin = now(),
    elapsed = () => now() - origin;
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
  const vm = ["--podman-machine", machine];
  const validation = [...vm, "--validation-admission", validationAdmission];
  // Pause, cancel and recover stop the exact native session or attempt.
  const stops = [
    ...vm,
    "--coding-admission",
    codingAdmission,
    "--validation-admission",
    validationAdmission,
  ];
  const open = new Set();

  /** Start one synthetic delivery, planned and with a passing baseline. */
  async function begin(label, request) {
    const inputs = ownerInputs(join(root, label));
    const owner = [
      "--owner-policy",
      inputs.policyPath,
      "--onboarding-attestation",
      inputs.attestationPath,
    ];
    const started = await run(
      "start",
      "--repo",
      inputs.repository,
      "--request",
      request,
      ...owner,
      "--coding-minutes",
      String(codingMinutes),
      "--budget-dollars",
      String(budgetDollars),
    );
    check(
      started.blocker?.code === "DELIVERY_NOT_ENABLED",
      "Production delivery is not disabled",
    );
    const id = started.id;
    open.add(id);
    report.deliveries[label] = { id };
    const planned = await run(
      "plan-feature",
      "--id",
      id,
      "--feature-criteria",
      inputs.criteria(id, request),
    );
    check(planned.feature?.outcome === "planned", "Planning failed");
    const baseline = await run(
      "validate-baseline",
      "--id",
      id,
      ...owner,
      ...validation,
    );
    check(
      baseline.validation?.attempts.at(-1)?.outcome === "passed",
      "The baseline did not pass",
    );
    return { id, owner };
  }
  // The allowance is declared only before a delivery's first session; a
  // later turn draws on what is left of it.
  const coding = (d, { first = true } = {}) => [
    "code-feature",
    "--id",
    d.id,
    ...d.owner,
    ...validation,
    "--coding-admission",
    codingAdmission,
    "--auth-directory",
    authDirectory,
    ...(first ? ["--coding-minutes", String(codingMinutes)] : []),
  ];
  /** Poll status until `ready` holds, so an interruption lands mid-step. */
  async function whenRunning(id, ready, what) {
    const start = now();
    for (;;) {
      const d = await run("status", "--id", id);
      if (ready(d)) {
        await sleep(settleMs);
        return d;
      }
      check(now() - start < runningWaitMs, `${what} never started running`);
      await sleep(pollMs);
    }
  }
  const codingRunning = (d) =>
    d.feature?.session?.state === "running" &&
    d.feature.session.threadStarted === true;
  /** The interrupted step's own process: it must end by itself. */
  async function ended(step, what) {
    let settled;
    step.done.then((r) => (settled = r));
    const start = now();
    while (!settled) {
      check(now() - start < runningWaitMs, `${what} never ended`);
      await sleep(pollMs);
    }
    return settled;
  }
  async function release(label) {
    const { id } = report.deliveries[label];
    const released = await run("release", "--id", id);
    check(released.ownership?.held === false, "Ownership was not released");
    open.delete(id);
    report.deliveries[label].released = true;
  }

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

    // A: pause, resume, cancel.
    const a = await stage("a-start", () => begin("a", host.request));
    await stage("a-pause-mid-coding", async () => {
      const step = spawnCli(coding(a));
      const running = await whenRunning(a.id, codingRunning, "Coding");
      const paused = await run("pause", "--id", a.id, ...stops);
      const session = paused.feature?.session;
      const result = await ended(step, "The paused coding step");
      report.deliveries.a.pause = {
        phase: paused.phase,
        session: session?.state ?? null,
        operationId: session?.operationId ?? null,
        stepExit: result.status,
      };
      check(
        paused.phase === "paused",
        `Pause left the delivery ${paused.phase}`,
      );
      check(
        session?.state === "stopped" &&
          session.operationId === running.feature.session.operationId,
        "Pause didn't stop the exact running session",
      );
      const after = await run("status", "--id", a.id);
      check(!after.feature?.candidate, "A paused turn admitted a candidate");
    });
    await stage("a-resume", async () => {
      const resumed = await run("resume", "--id", a.id);
      report.deliveries.a.resumedPhase = resumed.phase;
      check(
        !["paused", "cancelled"].includes(resumed.phase),
        `Resume left the delivery ${resumed.phase}`,
      );
    });
    await stage("a-code-after-resume", async () => {
      const coded = await run(...coding(a, { first: false }));
      const session = coded.feature?.session;
      report.deliveries.a.afterResume = {
        outcome: coded.feature?.outcome ?? null,
        session: session?.state ?? null,
        resumedThread: Boolean(session?.resumeFrom),
        candidate: Boolean(coded.feature?.candidate),
      };
      check(session?.state === "stopped", "The session was not stopped");
      check(
        coded.feature?.outcome === "admitted" && coded.feature.candidate,
        "The resumed delivery admitted no candidate",
      );
    });
    await stage("a-cancel-mid-validation", async () => {
      const step = spawnCli([
        "validate-candidate",
        "--id",
        a.id,
        ...a.owner,
        ...validation,
      ]);
      const running = await whenRunning(
        a.id,
        (d) =>
          d.validation?.attempts.at(-1)?.stage === "candidate" &&
          d.validation.attempts.at(-1).state === "running",
        "Candidate validation",
      );
      const attempt = running.validation.attempts.at(-1);
      const cancelled = await run("cancel", "--id", a.id, ...stops);
      const result = await ended(step, "The cancelled validation step");
      const stopped = cancelled.validation?.attempts.find(
        (x) => x.operationId === attempt.operationId,
      );
      report.deliveries.a.cancel = {
        phase: cancelled.phase,
        attempt: stopped?.state ?? null,
        allStopped:
          cancelled.validation?.attempts.every((x) => x.state === "stopped") ??
          false,
        stepExit: result.status,
      };
      check(
        cancelled.phase === "cancelled",
        `Cancel left the delivery ${cancelled.phase}`,
      );
      check(
        stopped?.state === "stopped" && report.deliveries.a.cancel.allStopped,
        "Cancel didn't stop the running validation attempt",
      );
      check(
        stopped.outcome !== "passed",
        "A cancelled validation reported a pass",
      );
    });
    await stage("a-resume-refused-after-cancel", async () => {
      const result = await cli(["resume", "--id", a.id]);
      report.deliveries.a.resumeAfterCancel = {
        status: result.status,
        refusal: result.status === 0 ? null : refusal(result),
      };
      check(result.status !== 0, "A cancelled delivery was resumed");
      check(
        /cancelled/i.test(report.deliveries.a.resumeAfterCancel.refusal),
        "The refusal didn't name the cancellation",
      );
    });
    await stage("a-release", () => release("a"));

    // B: a controller killed mid-turn, then recovered.
    const b = await stage("b-start", () => begin("b", host.request));
    await stage("b-controller-killed-mid-coding", async () => {
      const step = spawnCli(coding(b));
      const running = await whenRunning(b.id, codingRunning, "Coding");
      step.kill("SIGKILL");
      const result = await ended(step, "The killed CLI");
      const left = await run("status", "--id", b.id);
      report.deliveries.b.killed = {
        signal: result.signal ?? null,
        session: left.feature?.session?.state ?? null,
      };
      check(result.signal === "SIGKILL", "The CLI was not killed");
      check(
        left.feature?.session?.state === "running",
        "The killed controller left no running session to recover",
      );
    });
    await stage("b-recover", async () => {
      const before = await run("status", "--id", b.id);
      const recovered = await run("recover", "--id", b.id, ...stops);
      const session = recovered.feature?.session;
      report.deliveries.b.recover = {
        phase: recovered.phase,
        session: session?.state ?? null,
        sameSession:
          session?.operationId === before.feature?.session?.operationId,
      };
      check(
        session?.state === "stopped" && report.deliveries.b.recover.sameSession,
        "Recover didn't stop the exact session the killed controller left",
      );
      check(
        !recovered.feature?.candidate,
        "A killed turn admitted a candidate",
      );
      // Ownership is released only once nothing runs: cancel, then release.
      const cancelled = await run("cancel", "--id", b.id, ...stops);
      check(cancelled.phase === "cancelled", "B could not be cancelled");
    });
    await stage("b-release", () => release("b"));

    // C: a symbolic link in the output.
    const c = await stage("c-start", () => begin("c", symlinkRequest));
    await stage("c-symlink-output-refused", async () => {
      const coded = await run(...coding(c));
      const session = coded.feature?.session;
      report.deliveries.c.symlink = {
        outcome: coded.feature?.outcome ?? null,
        session: session?.state ?? null,
        candidate: Boolean(coded.feature?.candidate),
        spent: coded.spend?.spent ?? 0,
        interrupted: Boolean(coded.spend?.interruption),
      };
      check(session?.state === "stopped", "The session was not stopped");
      check(
        session.threadStarted === true &&
          report.deliveries.c.symlink.spent > 0 &&
          !report.deliveries.c.symlink.interrupted,
        "The turn didn't run to its end, so the refusal proves nothing",
      );
      check(
        !coded.feature?.candidate && coded.feature?.outcome !== "admitted",
        "Output with a symbolic link was admitted as a candidate",
      );
      const cancelled = await run("cancel", "--id", c.id, ...stops);
      check(cancelled.phase === "cancelled", "C could not be cancelled");
    });
    await stage("c-release", () => release("c"));

    await stage("coding-session-cleanup", async () => {
      // Each delivery's last session, with the predecessors it resumed: A's
      // resumed the paused session, so its lineage holds two.
      report.cleanedSessions = 0;
      for (const label of ["a", "b", "c"]) {
        const d = await run("status", "--id", report.deliveries[label].id);
        const session = d.feature.session;
        const expected = session.resumeFrom ? 2 : 1;
        const receipt = await cleanupCodingSession(session);
        check(
          receipt.cleaned === expected,
          `Expected ${label}'s ${expected} session${expected > 1 ? "s" : ""} cleaned, not ${receipt.cleaned}`,
        );
        report.cleanedSessions += receipt.cleaned;
      }
    });
    report.outcome = lifecyclePassingOutcome;
  } catch (error) {
    report.error = bounded(error?.message);
    report.outcome = "blocked";
  } finally {
    // Anything still open is cancelled by its exact identity.
    for (const id of open)
      try {
        await cli(["cancel", "--id", id, ...stops]);
      } catch {}
    // Every stage this run never reached is reported, not left out.
    for (const name of lifecycleStageNames)
      if (!report.stages.some((s) => s.name === name))
        report.stages.push({ name, outcome: "not-run" });
    report.interrupted = interrupted();
    persist(report);
  }
  return report;
}

/** Owner criteria for one delivery's exact request. */
export function writeCriteria(path, deliveryId, request) {
  writeFileSync(
    path,
    JSON.stringify({
      scope: "aios-feature-criteria-v1",
      deliveryId,
      request,
      criteria: [
        request === symlinkRequest
          ? "latest.html is a symbolic link to index.html."
          : "The contact page shows a visible hint.",
      ],
      verification: ["Check the page in the isolated workspace."],
      ambiguity: null,
    }),
    { mode: 0o600 },
  );
  return path;
}
