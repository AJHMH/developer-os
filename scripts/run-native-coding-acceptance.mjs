#!/usr/bin/env node
// Owner-run offline acceptance of native coding sessions on a real dedicated
// VM. It never provisions or starts the VM, opens credentials or authorizes
// inference, and it never enables production or claims qualification. Run it
// through scripts/run-native-acceptance.mjs, which holds the shared acceptance
// lock and keeps the Mac awake.
//
// It drives the real coding transport through two synthetic lineages:
// - A: first launch, resume onto a moved main (a named base move), a refused
//   reuse of the consumed predecessor, a resume stranded after preparation and
//   recovered, and a resume after recovery;
// - B: a resume stopped right after launch, never recovered, reconciled as
//   unresolved, retired by the owner decision this run stands for, cleaned up,
//   and never resumed again.
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
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
  "Usage: node scripts/run-native-coding-acceptance.mjs <aios-machine> <new-report.json> --approve-offline-native-run";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const prompt =
  "Offline qualification only. Do not call any tool or change any file.";
// The transport's bounded refusals, by cause.
const refusedBy = {
  guest: (action) => new RegExp(`^Native coding ${action} observation`),
  dispatchGate: /^Native coding authority changed/,
  runGate: /^Native coding run stopped by its gate/,
};

/** Only complete JSON lines count; a partial final line is not evidence. */
function threadsIn(bytes) {
  return bytes
    .toString("utf8")
    .split("\n")
    .slice(0, -1)
    .flatMap((line) => {
      try {
        const event = JSON.parse(line);
        return event?.type === "thread.started" ? [event.thread_id] : [];
      } catch {
        return [];
      }
    });
}

function input(text) {
  const bytes = Buffer.from(text);
  return {
    files: [{ path: "canary.txt", bytes, executable: false }],
    inputSha256: sha256(
      JSON.stringify([
        { path: "canary.txt", sha256: sha256(bytes), executable: false },
      ]),
    ),
  };
}

/** Run the session scenario against `transport` and return the report;
 * `persist` receives it after every stage. */
export async function sessionAcceptance(transport, options = {}) {
  const persist = options.persist ?? (() => {});
  const interrupted = options.interrupted ?? (() => false);
  const revisions = {
    first: sha256("aios-native-session-acceptance:first").slice(0, 40),
    moved: sha256("aios-native-session-acceptance:moved").slice(0, 40),
  };
  const inputs = {
    first: input("AIOS native session acceptance: first main\n"),
    moved: input("AIOS native session acceptance: moved main\n"),
  };
  const branch = "codex/issue04-native-session-acceptance";
  const report = {
    scope: "native-coding-offline-session-acceptance",
    productionEnabled: false,
    qualified: false,
    inferenceAuthorized: false,
    outcome: "running",
    revisions,
    stages: [],
    turns: [],
  };
  const attempted = [];
  let nextFence = 0,
    threadObserved = false;
  const session = (intent) => ({
    operationId: randomUUID(),
    fence: (nextFence += 1),
    state: "running",
    intent,
  });
  const stopped = (s) => ({ ...s, state: "stopped" });
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
  /** Require `pending` to be refused for exactly the expected cause. */
  async function refuses(pending, cause, message) {
    let refusal;
    try {
      await pending;
    } catch (error) {
      refusal = String(error?.message);
    }
    check(refusal !== undefined, message);
    check(cause.test(refusal), "Refused for another reason: " + refusal);
  }
  async function halt(s) {
    const result = await transport.stop({ ...s, state: "uncertain" });
    check(
      result.stopped === true && result.remainingProcesses === 0,
      "Exact-session stop is uncertain",
    );
  }
  // Offline, Codex keeps retrying the provider until its turn allowance ends,
  // so a turn ends once its thread is reported: the run's own gate stops it,
  // and the transport stops the exact session before returning.
  async function turn(s, { revision, threadId, resumeFrom, baseMove, gates }) {
    attempted.push(s);
    let output = Buffer.alloc(0),
      threads = [];
    try {
      await transport.run(
        {
          ...s,
          ...(threadId ? { threadId, resumeFrom } : {}),
          ...(baseMove ? { baseMove } : {}),
          pins: report.pins,
          argv: threadId
            ? [
                "exec",
                "resume",
                "--json",
                "--skip-git-repo-check",
                "-c",
                'sandbox_mode="workspace-write"',
                threadId,
                prompt,
              ]
            : [
                "exec",
                "--json",
                "--skip-git-repo-check",
                "--sandbox",
                "workspace-write",
                prompt,
              ],
          branch,
          sourceRevision: revisions[revision],
          ...inputs[revision],
          allowanceMs: 180000,
          mayDispatch: gates?.mayDispatch ?? (() => !interrupted()),
          checkpoint:
            gates?.checkpoint ?? (() => !interrupted() && threads.length === 0),
          onEvent: () => !interrupted(),
        },
        (chunk) => {
          output = Buffer.concat([output, chunk]);
          check(output.length <= 65536, "Turn output exceeded its bound");
          threads = threadsIn(output);
        },
      );
    } catch (error) {
      // Stopping on a reported thread is the expected end of an offline turn.
      if (!(threads.length && refusedBy.runGate.test(String(error?.message))))
        throw error;
    } finally {
      report.turns.push({
        fence: s.fence,
        outputBytes: output.length,
        threads: threads.length,
      });
    }
    return threads;
  }
  // A first launch reports exactly one explicit thread.
  async function firstLaunch(s) {
    let threads = [];
    try {
      threads = await turn(s, { revision: "first" });
    } catch (error) {
      // A turn that used its whole allowance without a thread reported none.
      if (!refusedBy.runGate.test(String(error?.message))) throw error;
    }
    check(threads.length === 1 && uuid.test(threads[0]), "No offline thread");
    threadObserved = true;
    return threads[0];
  }
  try {
    const a1 = session("start");
    report.pins = await stage("fresh-pins", () => transport.inspect(a1));
    const threadId = await stage("lineage-a-first-launch-thread", () =>
      firstLaunch(a1),
    );
    await stage("lineage-a-first-stopped", async () => {
      const observed = await transport.observeSession(stopped(a1));
      check(
        observed.phase === "stopped" &&
          observed.processesGone === true &&
          observed.remainingProcesses === 0,
        "First turn is not independently stopped",
      );
    });
    const a2 = session("resume");
    await stage("lineage-a-resume-onto-moved-main", async () => {
      const threads = await turn(a2, {
        revision: "moved",
        threadId,
        resumeFrom: stopped(a1),
        baseMove: { from: revisions.first, to: revisions.moved },
      });
      check(
        JSON.stringify(threads) === JSON.stringify([threadId]),
        "The resumed turn did not continue the thread",
      );
    });
    await stage("lineage-a-moved-input-collected", async () => {
      // The guest accepting the base move is the evidence; this only confirms
      // the stopped workspace kept the moved main's admitted input.
      const collection = await transport.collect(stopped(a2));
      const canary = collection.files.find((f) => f.path === "canary.txt");
      check(
        collection.complete === true &&
          !!canary &&
          Buffer.compare(canary.bytes, inputs.moved.files[0].bytes) === 0,
        "The moved main's input was not kept",
      );
    });
    await stage("lineage-a-consumed-predecessor-refused", () =>
      // Same revision as the predecessor, so only its reservation refuses.
      refuses(
        turn(session("resume"), {
          revision: "first",
          threadId,
          resumeFrom: stopped(a1),
        }),
        refusedBy.guest("prepare"),
        "A consumed predecessor was resumed again",
      ),
    );
    const a3 = session("resume");
    await stage("lineage-a-stranded-resume", async () => {
      // The run asks its dispatch gate after inspection, before preparation
      // and after preparation; refusing the third strands a prepared resume.
      let calls = 0;
      await refuses(
        turn(a3, {
          revision: "moved",
          threadId,
          resumeFrom: stopped(a2),
          gates: { mayDispatch: () => ++calls < 3 && !interrupted() },
        }),
        refusedBy.dispatchGate,
        "The stranded resume launched",
      );
      check(calls === 3, "The resume was not stranded after preparation");
      await halt(a3);
    });
    await stage("lineage-a-recovery-returns-home", async () => {
      const receipt = await transport.recoverInterruptedResume(
        stopped(a3),
        stopped(a2),
      );
      check(receipt.recovered === true, "The home was not recovered");
    });
    await stage("lineage-a-resume-after-recovery", async () => {
      const threads = await turn(session("resume"), {
        revision: "moved",
        threadId,
        resumeFrom: stopped(a2),
      });
      check(
        JSON.stringify(threads) === JSON.stringify([threadId]),
        "The recovered predecessor did not resume",
      );
    });
    const b1 = session("start");
    const lineageThread = await stage("lineage-b-first-launch-thread", () =>
      firstLaunch(b1),
    );
    const b2 = session("resume");
    const launched = { ...stopped(b2), threadId: lineageThread };
    await stage("lineage-b-resume-stopped-after-launch", async () => {
      // The run stops before its first poll, so the guest records no thread.
      await refuses(
        turn(b2, {
          revision: "first",
          threadId: lineageThread,
          resumeFrom: stopped(b1),
          gates: { checkpoint: () => false },
        }),
        refusedBy.runGate,
        "The stopped resume completed",
      );
      await halt(b2);
    });
    await stage("lineage-b-launched-resume-is-never-recovered", () =>
      refuses(
        transport.recoverInterruptedResume(launched, stopped(b1)),
        refusedBy.guest("recover-resume"),
        "A launched resume was recovered",
      ),
    );
    await stage("lineage-b-unresolved-then-retired", async () => {
      const observed = await transport.reconcileInterruptedResume(
        launched,
        stopped(b1),
        false,
      );
      check(observed.outcome === "unresolved", "Expected unresolved");
      const retired = await transport.reconcileInterruptedResume(
        launched,
        stopped(b1),
        true,
      );
      check(retired.outcome === "retired", "Expected retired");
    });
    await stage("lineage-b-cleanup", async () => {
      const receipt = await transport.cleanupRetiredLineage(launched);
      check(receipt.cleaned === 2, "Expected two cleaned sessions");
      const again = await transport.cleanupRetiredLineage(launched);
      check(again.cleaned === 2, "Cleanup is not idempotent");
    });
    await stage("lineage-b-never-resumed-after-cleanup", async () => {
      for (const resumeFrom of [stopped(b1), stopped(b2)])
        await refuses(
          turn(session("resume"), {
            revision: "first",
            threadId: lineageThread,
            resumeFrom,
          }),
          refusedBy.guest("prepare"),
          "A cleaned lineage was resumed",
        );
    });
    report.outcome = "observed-offline-session-acceptance";
  } catch (error) {
    report.error = String(error?.message).slice(0, 300);
    // Only a first launch that ran but reported no thread is this outcome.
    report.outcome =
      !threadObserved && report.error === "No offline thread"
        ? "blocked-before-thread"
        : "blocked";
  } finally {
    // A failed launch can still have effects; stop every attempted session.
    for (const s of attempted)
      try {
        await stage(`final-stop-${s.operationId}`, () => halt(s));
      } catch {
        report.outcome = "uncertain";
      }
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
    transportBuildSha256: sha256(
      readFileSync(new URL("../dist/podman-coding.js", import.meta.url)),
    ),
  };
}

async function main() {
  const [machine, reportPath, approval, ...extra] = process.argv.slice(2);
  if (
    !/^aios-[a-z0-9-]+$/.test(machine ?? "") ||
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
  // The coding authority this VM's management state already belongs to.
  const authority = sha256("issue04-native-offline-lifecycle-v1:" + machine);
  const transport = new NativePodmanCodingTransport(machine, authority);
  if (transport.mode !== "live" || transport.productionEnabled !== false)
    throw Error("Expected the live transport with production disabled");
  // Refuse overwriting retained evidence before any worker effect.
  closeSync(openSync(reportPath, "wx", 0o600));
  const context = {
    host: { platform: platform(), arch: arch(), release: release(), machine },
    authority,
    ...source,
  };
  let stop = false;
  const interrupt = () => (stop = true);
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  const report = await sessionAcceptance(transport, {
    interrupted: () => stop,
    persist: (r) =>
      writeFileSync(reportPath, JSON.stringify({ ...context, ...r }, null, 2)),
  });
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
  console.log(JSON.stringify({ outcome: report.outcome, reportPath }));
  if (report.outcome !== "observed-offline-session-acceptance")
    process.exitCode = 1;
}

// Compare real paths, so a symlinked checkout still runs.
const invoked = process.argv[1] && realpathSync(process.argv[1]);
if (invoked && import.meta.url === pathToFileURL(invoked).href)
  main().catch((error) => {
    console.error(String(error?.message).slice(0, 300));
    process.exitCode = 1;
  });
