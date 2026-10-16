// Explicit offline host observation. Never run automatically or grant qualification.
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
const authority = sha256("issue04-native-offline-lifecycle-v1:" + machine);
const transport = new NativePodmanCodingTransport(machine, authority);
assert.equal(transport.mode, "live");
assert.equal(transport.productionEnabled, false);
const session = {
  operationId: randomUUID(),
  fence: 1,
  state: "running",
  intent: "start",
};
const report = {
  scope: "native-coding-offline-first-launch",
  productionEnabled: false,
  qualified: false,
  outcome: "not-run",
  sourceRevision: revision.stdout.trim(),
  runtimeSourceDirty: sourceState.status !== 0,
  authorization: "fixed-synthetic-offline-only",
  runnerSha256: sha256(readFileSync(new URL(import.meta.url))),
  transportSourceSha256: sha256(
    readFileSync(new URL("../../src/podman-coding.ts", import.meta.url)),
  ),
  host: { platform: platform(), arch: arch(), release: release(), machine },
  authority,
  session,
  stages: [],
  remaining: [
    "Windows observation",
    "adversarial mount/network/escape and descendant probes",
    "independent timer expiry and interrupted-controller recovery",
    "writable storage limits, explicit resume and dependency controls",
    "model-only authority, usage/exhaustion and production integration",
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
let output = Buffer.alloc(0);
let runReturned = false;
let launchAttempted = false;
try {
  const pins = await stage("fresh-pins", () => transport.inspect(session));
  report.pins = pins;
  const bytes = Buffer.from("AIOS native coding offline input\n");
  const files = [{ path: "canary.txt", bytes, executable: false }];
  const request = {
    ...session,
    pins,
    argv: [
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--sandbox",
      "workspace-write",
      "Offline qualification only. Do not call any tool or change any file.",
    ],
    branch: "codex/ticket04-native-offline-observation",
    sourceRevision: report.sourceRevision,
    inputSha256: sha256(
      JSON.stringify([
        { path: "canary.txt", sha256: sha256(bytes), executable: false },
      ]),
    ),
    files,
    allowanceMs: 60000,
    mayDispatch: () => !interrupted,
    checkpoint: () => !interrupted,
    onEvent: () => !interrupted,
  };
  launchAttempted = true;
  const result = await stage("offline-launch-and-exit", () =>
    transport.run(request, (chunk) => {
      output = Buffer.concat([output, chunk]);
      assert.ok(output.length <= 65536);
    }),
  );
  runReturned = true;
  report.exitCode = result.exitCode;
  report.output = { bytes: output.length, sha256: sha256(output) };
  // This empty-home, deny-all worker has no authority to complete inference.
  assert.notEqual(result.exitCode, 0);
  await stage("fresh-exact-session-stop", async () => {
    const recovered = new NativePodmanCodingTransport(machine, authority);
    const stopped = await recovered.stop({ ...session, state: "uncertain" });
    assert.equal(stopped.stopped, true);
    assert.equal(stopped.remainingProcesses, 0);
    assert.deepEqual(await recovered.inspect(session), pins);
  });
  await stage("stopped-ordinary-file-collection", async () => {
    const collection = await transport.collect({
      ...session,
      state: "stopped",
    });
    assert.equal(collection.complete, true);
    assert.equal(collection.files.length, 1);
    assert.equal(collection.files[0].path, "canary.txt");
    assert.deepEqual(collection.files[0].bytes, bytes);
    assert.equal(collection.files[0].ordinary, true);
    assert.equal(collection.files[0].links, 1);
    report.collection = { files: 1, inputPreserved: true };
  });
  assert.equal(interrupted, false);
  report.outcome = "observed-offline-refusal";
} catch (error) {
  report.outcome = "blocked";
  process.exitCode = 1;
} finally {
  // A failed launch can still have effects. Preserve exact-session stop evidence.
  try {
    if (launchAttempted)
      await stage("final-exact-session-stop", async () => {
        const stopped = await transport.stop({
          ...session,
          state: "uncertain",
        });
        assert.equal(stopped.stopped, true);
        assert.equal(stopped.remainingProcesses, 0);
      });
  } catch {
    report.outcome = "uncertain";
    process.exitCode = 1;
  }
  report.runReturned = runReturned;
  report.output = { bytes: output.length, sha256: sha256(output) };
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
