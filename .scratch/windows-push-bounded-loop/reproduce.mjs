// Explicit synthetic loop. Required tests and production commands are unchanged.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { availableParallelism } from "node:os";
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { workerData } from "node:worker_threads";
import { syncFixture } from "../../tests/helpers/main-sync-fixture.mjs";
const mode = process.argv[2];
assert.equal(process.argv.length, 3);
assert.ok(["--approve-native-windows-loop", "--local-control"].includes(mode));
const native = mode === "--approve-native-windows-loop";
if (native) {
  assert.equal(process.platform, "win32");
  assert.equal(process.arch, "x64");
}
const paired = workerData?.kind === "bounded-push-pair";
let stop;
if (paired) {
  assert.ok([1, 2].includes(workerData.id));
  assert.ok(workerData.stop instanceof SharedArrayBuffer);
  assert.equal(workerData.stop.byteLength, 4);
  stop = new Int32Array(workerData.stop);
  const original = cp.spawnSync;
  cp.spawnSync = function (...args) {
    if (Atomics.load(stop, 0) !== 0) throw new PeerStopped();
    return Reflect.apply(original, this, args);
  };
  syncBuiltinESMExports();
}
class DiagnosticFailure extends Error {
  constructor() {
    super("Required progress evidence unavailable");
  }
}
class PeerStopped extends Error {
  constructor() {
    super("Peer refusal stopped further native dispatch");
  }
}
const limit = native ? (paired ? 50 : 100) : 2;
const report = {
  schemaVersion: 1,
  diagnosticOnly: true,
  nativeWindows: native,
  sourceRevision: /^[a-f0-9]{40}$/.test(
    process.env.AIOS_DIAGNOSTIC_REVISION ?? "",
  )
    ? process.env.AIOS_DIAGNOSTIC_REVISION
    : null,
  runtime: {
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    parallelism: availableParallelism(),
  },
  worker: paired ? workerData.id : null,
  limit,
  completed: 0,
  iteration: 0,
  stage: "fixture",
  outcome: "running",
  productionEnabled: false,
};
const output = resolve(
  paired
    ? join(workerData.outputDirectory, `worker-${workerData.id}.json`)
    : "tmp/windows-push-loop.json",
);
mkdirSync(resolve("tmp"), { recursive: true });
function persist() {
  try {
    writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
    return true;
  } catch {
    report.evidenceFailed = true;
    if (["running", "passed"].includes(report.outcome))
      report.outcome = "diagnostic-failed";
    if (stop) Atomics.store(stop, 0, 1);
    process.exitCode = 1;
    try {
      console.error('[push-loop] {"reportWriteFailed":true}');
    } catch {}
    return false;
  }
}
function checkpoint() {
  if (!persist()) throw new DiagnosticFailure();
}
checkpoint();
test("bounded fresh-remote pushes stop at the first native refusal", async (t) => {
  try {
    // Includes the original two setup pushes; no preparatory Git warmup.
    const fixture = await syncFixture(t);
    for (let iteration = 1; iteration <= limit; iteration++) {
      report.iteration = iteration;
      report.stage = "initialize-remote";
      checkpoint();
      console.error(
        "[push-loop] " + JSON.stringify({ iteration, stage: report.stage }),
      );
      const remote = join(fixture.root, "fresh-remote-" + iteration);
      mkdirSync(remote);
      assert.equal(fixture.run(["init", "--bare"], remote).status, 0);
      report.stage = "select-remote";
      checkpoint();
      fixture.g("remote", "set-url", "origin", remote);
      report.stage = "push";
      checkpoint();
      // Exact original fixture push seam, isolated arguments and 5000 ms timeout.
      fixture.g("push", "origin", "main");
      report.completed = iteration;
      checkpoint();
    }
    report.stage = "complete";
    report.outcome = "passed";
  } catch (error) {
    if (stop) Atomics.store(stop, 0, 1);
    report.outcome =
      error instanceof PeerStopped
        ? "peer-stopped"
        : error instanceof DiagnosticFailure
          ? "diagnostic-failed"
          : "failed";
    throw error; // Preserve original failure; never retry or continue this host.
  } finally {
    persist();
  }
});
