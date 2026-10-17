// Explicit synthetic loop. Required tests and production commands are unchanged.
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { availableParallelism } from "node:os";
import { syncFixture } from "../../tests/helpers/main-sync-fixture.mjs";
const mode = process.argv[2];
assert.equal(process.argv.length, 3);
assert.ok(["--approve-native-windows-loop", "--local-control"].includes(mode));
const native = mode === "--approve-native-windows-loop";
if (native) {
  assert.equal(process.platform, "win32");
  assert.equal(process.arch, "x64");
}
const limit = native ? 100 : 2;
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
  limit,
  completed: 0,
  iteration: 0,
  stage: "fixture",
  outcome: "running",
  productionEnabled: false,
};
const output = resolve("tmp/windows-push-loop.json");
mkdirSync(resolve("tmp"), { recursive: true });
function persist() {
  try {
    writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  } catch {
    console.error('[push-loop] {"reportWriteFailed":true}');
  }
}
persist();
test("bounded fresh-remote pushes stop at the first native refusal", async (t) => {
  try {
    // Includes the original two setup pushes; no preparatory Git warmup.
    const fixture = await syncFixture(t);
    for (let iteration = 1; iteration <= limit; iteration++) {
      report.iteration = iteration;
      report.stage = "initialize-remote";
      persist();
      console.error(
        "[push-loop] " + JSON.stringify({ iteration, stage: report.stage }),
      );
      const remote = join(fixture.root, "fresh-remote-" + iteration);
      mkdirSync(remote);
      assert.equal(fixture.run(["init", "--bare"], remote).status, 0);
      report.stage = "select-remote";
      persist();
      fixture.g("remote", "set-url", "origin", remote);
      report.stage = "push";
      persist();
      // Exact original fixture push seam, isolated arguments and 5000 ms timeout.
      fixture.g("push", "origin", "main");
      report.completed = iteration;
      persist();
    }
    report.stage = "complete";
    report.outcome = "passed";
  } catch (error) {
    report.outcome = "failed";
    throw error; // Preserve original failure; never retry or continue this host.
  } finally {
    persist();
  }
});
