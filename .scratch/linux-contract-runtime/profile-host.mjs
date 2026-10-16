// Explicit Linux diagnostic: numeric host counters; no child instrumentation.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { cpus, availableParallelism } from "node:os";
import { performance } from "node:perf_hooks";
const [factory, consumer, output] = process.argv.slice(2);
if (process.platform !== "linux" || !factory || !consumer || !output)
  throw Error(
    "Require Linux and explicit Factory, consumer and new output paths",
  );
if (process.env.NODE_OPTIONS)
  throw Error("Refuse preload-instrumented comparison");
mkdirSync(output, { recursive: false });
const { runContract } = await import(
  pathToFileURL(resolve(factory, "scripts/contract-execution.mjs"))
);
const start = performance.now();
const samples = [];
function numericFields(path, keys) {
  try {
    return Object.fromEntries(
      readFileSync(path, "utf8")
        .trim()
        .split("\n")
        .flatMap((line) => {
          const [key, value] = line.split(/\s+/);
          return keys.includes(key) && /^\d+$/.test(value)
            ? [[key, Number(value)]]
            : [];
        }),
    );
  } catch {
    return null;
  }
}
function pressure(kind) {
  try {
    return Object.fromEntries(
      readFileSync("/proc/pressure/" + kind, "utf8")
        .trim()
        .split("\n")
        .flatMap((line) => {
          const [key, ...fields] = line.split(/\s+/);
          if (!["some", "full"].includes(key)) return [];
          return [
            [
              key,
              Object.fromEntries(
                fields.flatMap((field) => {
                  const [label, value] = field.split("=");
                  return ["avg10", "avg60", "avg300", "total"].includes(
                    label,
                  ) && /^\d+(?:\.\d+)?$/.test(value)
                    ? [[label, Number(value)]]
                    : [];
                }),
              ),
            ],
          ];
        }),
    );
  } catch {
    return null;
  }
}
function sample() {
  let cpu = null;
  try {
    const values = readFileSync("/proc/stat", "utf8")
      .split("\n")[0]
      .trim()
      .split(/\s+/)
      .slice(1);
    if (values.every((value) => /^\d+$/.test(value))) cpu = values.map(Number);
  } catch {
    /* Unavailable metrics remain explicit. */
  }
  samples.push({
    elapsedMs: performance.now() - start,
    cpu,
    pressure: {
      cpu: pressure("cpu"),
      io: pressure("io"),
      memory: pressure("memory"),
    },
    cgroupCpu: numericFields("/sys/fs/cgroup/cpu.stat", [
      "usage_usec",
      "user_usec",
      "system_usec",
      "nr_periods",
      "nr_throttled",
      "throttled_usec",
    ]),
    memoryKiB: numericFields("/proc/meminfo", [
      "MemAvailable:",
      "MemFree:",
      "SwapFree:",
    ]),
  });
  writeFileSync(
    resolve(output, "host.json"),
    JSON.stringify({
      schemaVersion: 1,
      diagnosticOnly: true,
      node: process.version,
      architecture: process.arch,
      parallelism: availableParallelism(),
      cpuModel: cpus()[0]?.model,
      samples,
    }),
  );
}
sample();
const timer = setInterval(sample, 2000);
timer.unref();
try {
  const result = await runContract(resolve(consumer, "factory-contract.yaml"));
  writeFileSync(
    resolve(output, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify(
      result.results.map(
        ({ capability, status, timedOut, startedAt, finishedAt }) => ({
          capability,
          status,
          timedOut,
          startedAt,
          finishedAt,
        }),
      ),
    ),
  );
  process.exitCode = result.outcome === "passed" ? 0 : 1;
} finally {
  clearInterval(timer);
  sample();
}
