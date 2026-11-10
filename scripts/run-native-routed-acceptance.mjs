#!/usr/bin/env node
// Owner-run offline acceptance of a routed coding session on a real dedicated
// VM (Issue 04 slice 3, "Tests"). It never provisions or starts the VM, opens
// credentials or authorizes inference, and it never enables production or
// claims qualification. Run it through scripts/run-native-acceptance.mjs.
//
// One lineage, launch then explicit resume, each a routed turn: Claude Code
// reaches the model only through the session relay, the relay only through a
// real `MessagesGateway`, and the gateway only a fake provider on the host
// (ADR 0008). The provider answers with fixed calls to Claude Code's own
// `Write` and `Bash` tools, so the route and the tools are shown working with
// no real model, network or credential. During
// the launch, between model requests and before the turn's edit, the coding
// boundary probe runs in the routed session: one relay listener that answers,
// no other route, and only the admitted file in the workspace. A passing run
// then removes the lineage; a failed or blocked one keeps it for diagnosis.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
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
import { fakeMessagesProvider, maxKeepalives } from "./routed-provider.mjs";

const usage =
  "Usage: node scripts/run-native-routed-acceptance.mjs <aios-machine> <owner-coding-admission.json> <new-report.json> --approve-offline-native-run";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const passingOutcome = "observed-offline-routed-acceptance";
const prompt =
  "Offline routed acceptance only. Run the tool calls you are given.";
const admittedFile = "canary.txt";
const admittedBytes = Buffer.from("AIOS native routed acceptance\n");
const files = () => [
  { path: admittedFile, bytes: Buffer.from(admittedBytes), executable: false },
];
const inputSha256 = sha256(
  JSON.stringify([
    { path: admittedFile, sha256: sha256(admittedBytes), executable: false },
  ]),
);
/** Every stage, in order. */
export const stageNames = Object.freeze([
  "coding-fresh-pins",
  "owner-record-names-fresh-pins",
  "routed-launch-live-probe",
  "routed-launch-tools-ran",
  "routed-launch-grant-revoked",
  "routed-launch-exact-stop",
  "routed-launch-output-collected",
  "routed-resume",
  "routed-resume-output-collected",
  "routed-lineage-cleanup",
]);

/** Only complete JSON lines count; a partial final line is not evidence.
 * `bound` names the conversation an event starts, if it starts one. */
function threadsIn(bytes, bound) {
  return bytes
    .toString("utf8")
    .split("\n")
    .slice(0, -1)
    .flatMap((line) => {
      try {
        const thread = bound(JSON.parse(line));
        return thread === undefined ? [] : [thread];
      } catch {
        return [];
      }
    });
}
/** Run the routed lineage against `transport` under the owner's Claude Code
 * coding `admission`, and return the report; `persist` receives it after
 * every stage. */
export async function routedAcceptance({ transport, admission }, options = {}) {
  const persist = options.persist ?? (() => {});
  const interrupted = options.interrupted ?? (() => false);
  const pause =
    options.pause ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const { claudeAgent, claudeCodingPinFields } = await import(
    "../dist/feature-candidate.js"
  );
  const { MessagesGateway, MessagesRefusal } = await import(
    "../dist/messages-gateway.js"
  );
  const { claudeCodeArgv } = await import("../dist/coding-agent.js");
  const { pinnedModelPrices } = await import("../dist/spend-budget.js");
  const same = (a, b) =>
    claudeCodingPinFields.every((field) => a[field] === b[field]);
  const report = {
    scope: "native-coding-offline-routed-acceptance",
    agent: "claude",
    productionEnabled: false,
    qualified: false,
    inferenceAuthorized: false,
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

  // One delivery and route for the lineage; each turn gets its own relay
  // capability and gateway grant.
  const deliveryId = randomUUID();
  const decisionSha256 = sha256("aios-native-routed-acceptance:decision");
  const key = `sk-ant-api03-${randomBytes(24).toString("hex")}`;
  const sourceRevision = sha256("aios-native-routed-acceptance").slice(0, 40);
  const attempted = [];
  let nextFence = 0;
  const session = (intent) => ({
    operationId: randomUUID(),
    fence: (nextFence += 1),
    state: "running",
    intent,
  });
  const stopped = (s) => ({ ...s, state: "stopped" });

  /** Start one routed turn. `finish` waits for it and records the result. */
  function startTurn(s, tag, { threadId, resumeFrom, released }) {
    attempted.push(s);
    const allowanceMs = threadId ? 180000 : 300000;
    const route = {
      deliveryId,
      decisionSha256,
      capability: randomBytes(32).toString("hex"),
    };
    const fake = fakeMessagesProvider(tag, released, pinnedModelPrices.model);
    // The key is synthetic, per turn, and never used by the fake. The budget
    // is a counter, never the owner's spend budget.
    const gateway = new MessagesGateway(
      {
        deliveryId,
        sessionId: s.operationId,
        expiresAt: Date.now() + allowanceMs + 60_000,
        maxRequests: maxKeepalives + 8,
      },
      () => key,
      {
        admit: () => !interrupted(),
        charge: () => {},
        chargeReservation: () => {},
        release: () => {},
      },
      fake.provider,
    );
    const turn = (report[tag] = {
      fence: s.fence,
      capabilitySha256: sha256(route.capability),
    });
    let output = Buffer.alloc(0);
    const running = transport
      .run(
        {
          ...s,
          ...(threadId ? { threadId, resumeFrom } : {}),
          pins: report.pins,
          argv: [...claudeCodeArgv(threadId), prompt],
          branch: "aios/issue04-native-routed-acceptance",
          sourceRevision,
          files: files(),
          inputSha256,
          modelRoute: route,
          allowanceMs,
          mayDispatch: () => !interrupted(),
          checkpoint: () => !interrupted(),
          onEvent: () => !interrupted(),
        },
        (chunk) => {
          output = Buffer.concat([output, chunk]);
          check(output.length <= 65536, "Turn output exceeded its bound");
        },
        gateway,
      )
      .then(
        (result) => ({ result }),
        (error) => ({ error }),
      );
    let settled, recorded;
    running.then((end) => (settled = end));
    // The turn is recorded once, however often it is awaited.
    const finish = () => (recorded ??= record());
    async function record() {
      const end = await running;
      const threads = threadsIn(output, (event) =>
        claudeAgent.boundThread(event),
      );
      Object.assign(turn, {
        exitCode: end.result?.exitCode ?? null,
        outputBytes: output.length,
        threads: threads.length,
        provider: { ...fake.observation },
        gateway: gateway.observation,
      });
      // A grant used after its turn's stop is refused.
      try {
        await gateway.respond(deliveryId, gateway.capability, "{}");
        turn.refusedAfterStop = null;
      } catch (error) {
        turn.refusedAfterStop =
          error instanceof MessagesRefusal ? error.reason : "error";
      }
      check(
        !end.error,
        "The routed turn ended unexpectedly: " +
          String(end.error?.message).slice(0, 200),
      );
      check(end.result.exitCode === 0, "The routed turn did not complete");
      return threads;
    }
    return { fake, finish, settled: () => settled };
  }
  /** The provider saw the work script's marker, every request was admitted
   * and answered, and the grant ended with the turn. */
  function toolsRan(turn) {
    check(
      turn.provider.toolsWorked && turn.provider.finalAnswered,
      "Claude Code's tools did not run through the route",
    );
    check(
      turn.provider.unexpected === 0 &&
        Object.keys(turn.gateway.refusals).length === 0,
      "The gateway refused or missed a request",
    );
  }
  function grantRevoked(turn) {
    check(
      turn.gateway.revokedFor === "stopped" &&
        turn.refusedAfterStop === "revoked",
      "The grant outlived its turn",
    );
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
    const file = (path) => collection.files.find((f) => f.path === path);
    report[tag].collected = collection.files.map((f) => f.path).sort();
    check(
      collection.complete === true &&
        Buffer.compare(
          file(admittedFile)?.bytes ?? Buffer.alloc(0),
          admittedBytes,
        ) === 0 &&
        file(`routed-${tag}.txt`)?.bytes.toString() === `routed ${tag}\n`,
      "The routed turn's edit was not collected",
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
    const threadId = await stage("routed-launch-live-probe", async () => {
      let released = false;
      const launch = startTurn(a1, "launch", { released: () => released });
      try {
        // Probe once Claude Code is running and has talked to the provider; the
        // keep-alive scripts hold the turn between model requests meanwhile.
        let live = false;
        for (let i = 0; i < 120 && !live && !launch.settled(); i++) {
          if (launch.fake.observation.requests > 0)
            try {
              const observed = await transport.observeSession(a1);
              live = observed.running && observed.phase === "running";
            } catch {
              live = false;
            }
          if (!live) await pause(1000);
        }
        check(live, "The routed session never ran");
        report.launch.probeAfterRequest = launch.fake.observation.requests;
        const result = await transport.probeBoundary(a1, admittedFile);
        check(
          same(result.pins, report.pins),
          "The coding pins changed during the probe",
        );
        report.probes = result.probes;
        report.launch.processesWithDescendant = result.processes;
      } finally {
        released = true;
        await launch.finish().catch(() => {});
      }
      const threads = await launch.finish();
      check(
        threads.length === 1 && uuid.test(threads[0]),
        "The routed launch reported no single thread",
      );
      return threads[0];
    });
    await stage("routed-launch-tools-ran", () => toolsRan(report.launch));
    await stage("routed-launch-grant-revoked", () =>
      grantRevoked(report.launch),
    );
    await stage("routed-launch-exact-stop", () => exactStop(a1, report.launch));
    await stage("routed-launch-output-collected", () =>
      collected(a1, "launch"),
    );
    const a2 = session("resume");
    await stage("routed-resume", async () => {
      const resume = startTurn(a2, "resume", {
        threadId,
        resumeFrom: stopped(a1),
        released: () => true,
      });
      const threads = await resume.finish();
      check(
        JSON.stringify(threads) === JSON.stringify([threadId]),
        "The routed resume did not continue the thread",
      );
      check(
        report.resume.capabilitySha256 !== report.launch.capabilitySha256,
        "The resume reused the launch's relay capability",
      );
      toolsRan(report.resume);
      grantRevoked(report.resume);
      await exactStop(a2, report.resume);
    });
    await stage("routed-resume-output-collected", () =>
      collected(a2, "resume"),
    );
    report.failedProbes = report.probes
      .filter((p) => p.outcome !== "passed")
      .map((p) => p.name);
    if (!report.failedProbes.length)
      await stage("routed-lineage-cleanup", async () => {
        const receipt = await transport.cleanupSupersededLineage(stopped(a2));
        check(receipt.cleaned === 2, "Expected two cleaned sessions");
      });
    report.outcome = report.failedProbes.length ? "failed" : passingOutcome;
  } catch (error) {
    report.error = String(error?.message).slice(0, 300);
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
  const { nativeCodingAuthority, ownerCodingWorker } = await import(
    "../dist/native-coding-runtime.js"
  );
  const { claudeCodingBoundaryProbe } = await import(
    "../dist/worker-probes.js"
  );
  const { messagesGatewayVersion } = await import(
    "../dist/messages-gateway.js"
  );
  // The owner's Claude Code record (ADR 0008) runs the Claude Code guest,
  // under the coding authority this VM's management state already belongs to.
  const worker = ownerCodingWorker(machine, codingRecord);
  if (worker.agent !== "claude")
    throw Error("The coding admission is not the owner's Claude Code record");
  const { transport, admission } = worker;
  const authority = nativeCodingAuthority(machine);
  if (transport.mode !== "live" || transport.productionEnabled !== false)
    throw Error("Expected the live transport with production disabled");
  // Refuse overwriting retained evidence before any worker effect.
  closeSync(openSync(reportPath, "wx", 0o600));
  const context = {
    host: { platform: platform(), arch: arch(), release: release(), machine },
    authority,
    codingProbeSha256: sha256(claudeCodingBoundaryProbe),
    gatewayVersion: messagesGatewayVersion,
    ...source,
  };
  let interrupted = false;
  const interrupt = () => (interrupted = true);
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  const report = await routedAcceptance(
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
      ...(report.failedProbes?.length
        ? { failedProbes: report.failedProbes }
        : {}),
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
