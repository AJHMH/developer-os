// Diagnostic workload only: two isolated JS workers, <=100 total fresh remotes.
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import {
  mkdtempSync,
  mkdirSync,
  openSync,
  writeSync,
  closeSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
const mode = process.argv[2];
assert.equal(process.argv.length, 3);
assert.ok(["--approve-native-windows-loop", "--local-control"].includes(mode));
if (mode === "--approve-native-windows-loop") {
  assert.equal(process.platform, "win32");
  assert.equal(process.arch, "x64");
}
mkdirSync(resolve("tmp"), { recursive: true });
const directory = mkdtempSync(resolve("tmp/windows-push-paired-"));
const shared = new SharedArrayBuffer(4),
  stop = new Int32Array(shared);
let diagnosticFailed = false;
const results = await Promise.all(
  [1, 2].map(
    (id) =>
      new Promise((resolveResult) => {
        let out, worker;
        try {
          out = openSync(join(directory, `worker-${id}.tap`), "wx", 0o600);
          worker = new Worker(new URL("./reproduce.mjs", import.meta.url), {
            argv: [mode],
            workerData: {
              kind: "bounded-push-pair",
              id,
              stop: shared,
              outputDirectory: directory,
            },
            stdout: true,
            stderr: true,
          });
        } catch {
          diagnosticFailed = true;
          Atomics.store(stop, 0, 1);
          try {
            if (out !== undefined) closeSync(out);
          } catch {}
          resolveResult({ id, code: null, workerError: true, report: null });
          return;
        }
        const drains = [worker.stdout, worker.stderr].map(
          (stream) =>
            new Promise((resolveDrain) => {
              stream.on("data", (chunk) => {
                try {
                  let offset = 0;
                  while (offset < chunk.length) {
                    const size = writeSync(
                      out,
                      chunk,
                      offset,
                      chunk.length - offset,
                    );
                    if (size <= 0) throw Error("Incomplete diagnostic write");
                    offset += size;
                  }
                } catch {
                  diagnosticFailed = true;
                  Atomics.store(stop, 0, 1);
                }
              });
              stream.once("end", resolveDrain);
              stream.once("error", () => {
                diagnosticFailed = true;
                Atomics.store(stop, 0, 1);
                resolveDrain();
              });
            }),
        );
        let workerError = false;
        worker.on("error", () => {
          workerError = true;
          Atomics.store(stop, 0, 1);
        });
        worker.on("exit", async (code) => {
          if (code !== 0) Atomics.store(stop, 0, 1);
          await Promise.all(drains);
          try {
            closeSync(out);
          } catch {
            diagnosticFailed = true;
            Atomics.store(stop, 0, 1);
          }
          let report;
          try {
            report = JSON.parse(
              readFileSync(join(directory, `worker-${id}.json`), "utf8"),
            );
          } catch {
            diagnosticFailed = true;
            Atomics.store(stop, 0, 1);
          }
          resolveResult({ id, code, workerError, report });
        });
      }),
  ),
);
const passed =
  !diagnosticFailed &&
  results.every(
    (r) =>
      r.code === 0 &&
      !r.workerError &&
      r.report?.outcome === "passed" &&
      r.report.worker === r.id &&
      r.report.limit === (mode === "--approve-native-windows-loop" ? 50 : 2) &&
      r.report.completed === r.report.limit,
  );
const summary = {
  schemaVersion: 1,
  diagnosticOnly: true,
  nativeWindows: mode === "--approve-native-windows-loop",
  outcome: passed ? "passed" : "failed",
  diagnosticFailed,
  stopped: Atomics.load(stop, 0) !== 0,
  workers: results,
};
try {
  writeFileSync(
    join(directory, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
} catch {
  diagnosticFailed = true;
  Atomics.store(stop, 0, 1);
}
console.log(
  "[push-loop-pair] " +
    JSON.stringify({
      outcome: passed && !diagnosticFailed ? "passed" : "failed",
      diagnosticFailed,
      workers: results.map((r) => ({
        id: r.id,
        code: r.code,
        completed: r.report?.completed ?? null,
        outcome: r.report?.outcome ?? "missing",
      })),
    }),
);
process.exitCode = passed && !diagnosticFailed ? 0 : 1;
