// Explicit offline host observation of native explicit-session resume. Never run
// automatically or grant qualification. No credentials or inference authority.
// node <this-script> <machine> <new-report.json> --approve-offline-native-run
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { openSync, closeSync, writeFileSync, readFileSync } from "node:fs";
import { platform, arch, release } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { NativePodmanCodingTransport } from "../../dist/podman-coding.js";

const [machine, reportPath, approval, ...extra] = process.argv.slice(2);
assert.match(machine ?? "", /^aios-[a-z0-9-]+$/);
assert.ok(reportPath);
assert.equal(approval, "--approve-offline-native-run");
assert.equal(extra.length, 0);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
const revision = spawnSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {
  encoding: "utf8",
  timeout: 5000,
});
assert.equal(revision.status, 0);
assert.match(revision.stdout.trim(), /^[a-f0-9]{40}$/);
const sourceState = spawnSync(
  "git",
  ["-C", sourceRoot, "diff", "--quiet", "HEAD", "--", "src"],
  { timeout: 5000 },
);
assert.ok(sourceState.status === 0 || sourceState.status === 1);
// A separate authority scope: never reuses lifecycle or fixed-worker state.
const authority = sha256("issue04-native-explicit-resume-v1:" + machine);
const transport = new NativePodmanCodingTransport(machine, authority);
assert.equal(transport.mode, "live");
assert.equal(transport.productionEnabled, false);
const first = {
  operationId: randomUUID(),
  fence: 1,
  state: "running",
  intent: "start",
};
const second = {
  operationId: randomUUID(),
  fence: 2,
  state: "running",
  intent: "resume",
};
const report = {
  scope: "native-coding-offline-explicit-resume",
  productionEnabled: false,
  qualified: false,
  outcome: "not-run",
  sourceRevision: revision.stdout.trim(),
  runtimeSourceDirty: sourceState.status !== 0,
  authorization: "fixed-synthetic-offline-only",
  inferenceAuthorized: false,
  runnerSha256: sha256(readFileSync(new URL(import.meta.url))),
  transportSourceSha256: sha256(
    readFileSync(new URL("../../src/podman-coding.ts", import.meta.url)),
  ),
  host: { platform: platform(), arch: arch(), release: release(), machine },
  authority,
  sessions: { first, second },
  stages: [],
  remaining: [
    "Windows observation",
    "resumed turn with approved model-only inference",
    "adversarial isolation of the resumed worker and retained home",
    "recovery after a partially prepared home transfer",
    "usage/exhaustion, dependency controls and production integration",
  ],
};
// Refuse overwriting retained evidence before any worker effect.
closeSync(openSync(reportPath, "wx", 0o600));
const persist = () =>
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
persist();
let interrupted = false;
const interrupt = () => {
  interrupted = true;
};
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
const origin = performance.now();
async function stage(name, action) {
  const entry = {
    name,
    startedMs: Math.round(performance.now() - origin),
    outcome: "running",
  };
  report.stages.push(entry);
  persist();
  try {
    const result = await action();
    entry.outcome = "passed";
    return result;
  } catch (error) {
    entry.outcome = "blocked";
    // Adapter errors are bounded; no guest stdout or environment is recorded.
    entry.error = String(error.message).slice(0, 300);
    throw error;
  } finally {
    entry.finishedMs = Math.round(performance.now() - origin);
    persist();
  }
}
// Only complete JSON lines count; a partial final line is not evidence.
const threads = (bytes) =>
  bytes
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
const bytes = Buffer.from("AIOS native explicit resume offline input\n");
const files = [{ path: "canary.txt", bytes, executable: false }];
const inputSha256 = sha256(
  JSON.stringify([
    { path: "canary.txt", sha256: sha256(bytes), executable: false },
  ]),
);
const branch = "codex/ticket04-native-explicit-resume-observation";
const outputs = {
  first: Buffer.alloc(0),
  second: Buffer.alloc(0),
  refused: Buffer.alloc(0),
};
const attempted = [];
async function offlineTurn(name, session, argv, extraFields = {}) {
  attempted.push(session);
  const result = await transport.run(
    {
      ...session,
      ...extraFields,
      pins: report.pins,
      argv,
      branch,
      sourceRevision: report.sourceRevision,
      inputSha256,
      files,
      allowanceMs: 180000,
      mayDispatch: () => !interrupted,
      checkpoint: () => !interrupted,
      onEvent: () => !interrupted,
    },
    (chunk) => {
      outputs[name] = Buffer.concat([outputs[name], chunk]);
      assert.ok(outputs[name].length <= 65536);
    },
  );
  // A deny-all worker has no authority to complete inference.
  assert.notEqual(result.exitCode, 0);
  return result;
}
try {
  report.pins = await stage("fresh-pins", () => transport.inspect(first));
  report.outcome = "running";
  persist();
  const threadId = await stage(
    "offline-first-launch-records-thread",
    async () => {
      const result = await offlineTurn("first", first, [
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--sandbox",
        "workspace-write",
        "Offline qualification only. Do not call any tool or change any file.",
      ]);
      report.firstExitCode = result.exitCode;
      const seen = threads(outputs.first);
      assert.equal(seen.length, 1);
      assert.match(seen[0], uuid);
      return seen[0];
    },
  );
  report.threadId = threadId;
  await stage("predecessor-independently-stopped", async () => {
    const observed = await transport.observeSession({
      ...first,
      state: "stopped",
    });
    assert.equal(observed.phase, "stopped");
    assert.equal(observed.running, false);
    assert.equal(observed.processesGone, true);
    assert.equal(observed.remainingProcesses, 0);
    assert.deepEqual(observed.pins, report.pins);
  });
  await stage("offline-explicit-resume-continues-thread", async () => {
    const result = await offlineTurn(
      "second",
      second,
      [
        "exec",
        "resume",
        "--json",
        "--skip-git-repo-check",
        "-c",
        'sandbox_mode="workspace-write"',
        threadId,
        "Offline qualification only. Do not call any tool or change any file.",
      ],
      { threadId, resumeFrom: { ...first, state: "stopped" } },
    );
    report.secondExitCode = result.exitCode;
    // The resumed CLI must report the same explicit thread, never another.
    assert.deepEqual(threads(outputs.second), [threadId]);
  });
  await stage("consumed-predecessor-cannot-be-resumed-again", async () => {
    const third = {
      operationId: randomUUID(),
      fence: 3,
      state: "running",
      intent: "resume",
    };
    await assert.rejects(
      offlineTurn(
        "refused",
        third,
        [
          "exec",
          "resume",
          "--json",
          "--skip-git-repo-check",
          "-c",
          'sandbox_mode="workspace-write"',
          threadId,
          "Offline qualification only.",
        ],
        { threadId, resumeFrom: { ...first, state: "stopped" } },
      ),
    );
  });
  await stage("stopped-ordinary-file-collection", async () => {
    const collection = await transport.collect({
      ...second,
      state: "stopped",
    });
    assert.equal(collection.complete, true);
    assert.equal(collection.files.length, 1);
    assert.equal(collection.files[0].path, "canary.txt");
    assert.deepEqual(collection.files[0].bytes, bytes);
    report.collection = { files: 1, inputPreserved: true };
  });
  assert.equal(interrupted, false);
  report.outcome = "observed-offline-explicit-resume";
} catch (error) {
  report.outcome = "blocked";
  report.error = String(error.message).slice(0, 300);
  process.exitCode = 1;
} finally {
  // A failed launch can still have effects. Preserve exact-session stop evidence.
  for (const session of attempted)
    try {
      await stage(
        `final-exact-session-stop-fence-${session.fence}`,
        async () => {
          const stopped = await transport.stop({
            ...session,
            state: "uncertain",
          });
          assert.equal(stopped.stopped, true);
          assert.equal(stopped.remainingProcesses, 0);
        },
      );
    } catch {
      report.outcome = "uncertain";
      process.exitCode = 1;
    }
  report.output = Object.fromEntries(
    Object.entries(outputs).map(([key, value]) => [
      key,
      { bytes: value.length, sha256: sha256(value) },
    ]),
  );
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
  persist();
  console.log(
    JSON.stringify({
      outcome: report.outcome,
      reportPath,
      productionEnabled: false,
      qualified: false,
    }),
  );
}
