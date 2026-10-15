// Diagnostic measurement only; no result from this script authorizes a required gate.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
const consumer = resolve(process.argv[2]);
const factory = resolve(process.argv[3]);
const original = readFileSync(join(consumer, "factory-contract.yaml"), "utf8");
assert.equal(original.split("run: npm test").length - 1, 1);
const path = join(consumer, "factory-benchmark-contract.yaml");
assert.equal(existsSync(path), false);
let failed = false;
try {
  for (const [index, concurrency] of [4, 6, 4].entries()) {
    writeFileSync(
      path,
      original.replace(
        "run: npm test",
        `run: npm run build && node --test --test-concurrency=${concurrency}`,
      ),
    );
    const started = Date.now();
    const result = spawnSync(
      process.execPath,
      [
        join(factory, "scripts/factory-validation.mjs"),
        "validate",
        "--contract",
        path,
        "--trusted-repo",
        factory,
        "--trusted-revision",
        "805c50d54254acd62e2f8f5aa78d0338b6346ce0",
      ],
      { cwd: factory, encoding: "utf8", timeout: 180000, maxBuffer: 8388608 },
    );
    assert.equal(result.error, undefined, result.error?.code);
    const report = JSON.parse(result.stdout);
    writeFileSync(
      `contract-throughput-${index + 1}-${concurrency}.json`,
      JSON.stringify(report, null, 2),
    );
    const test = report.results.find((r) => r.capability === "test");
    assert.ok(test, "test stage must execute");
    const summary = test.stdout
      .split("\n")
      .filter((line) => /ℹ (tests|pass|fail|skipped|duration_ms)/.test(line));
    console.log(
      JSON.stringify({
        sample: index + 1,
        concurrency,
        status: test.status,
        timedOut: test.timedOut,
        stageMs: Date.parse(test.finishedAt) - Date.parse(test.startedAt),
        totalMs: Date.now() - started,
        summary,
      }),
    );
    if (test.status === "passed")
      assert.match(
        test.stdout,
        /ℹ tests 552\b/,
        "complete current inventory must run",
      );
    else failed = true;
  }
} finally {
  unlinkSync(path);
}
if (failed) process.exitCode = 1;
