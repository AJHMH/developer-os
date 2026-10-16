// Temporary diagnostic preload: fixed command families and numeric timing only.
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cpus, availableParallelism } from "node:os";
import { performance } from "node:perf_hooks";
const directory = process.env.AIOS_PROCESS_PROFILE;
if (!directory)
  throw new Error("Explicit diagnostic output directory required");
mkdirSync(directory, { recursive: true });
const started = performance.now();
const root = fileURLToPath(new URL("../../", import.meta.url));
const entry = process.argv[1];
const name = entry ? basename(entry) : "";
const file =
  entry &&
  /^[a-z0-9-]{1,100}\.test\.mjs$/.test(name) &&
  resolve(entry) === resolve(root, "tests", name)
    ? name
    : null;
const families = {};
const snapshotPath = join(
  directory,
  `${process.pid}-${process.hrtime.bigint()}.json`,
);
let inFlight = null;
let lastSnapshotAt = started;
function family(command, args) {
  const name = basename(String(command))
    .toLowerCase()
    .replace(/\.exe$/, "");
  if (name === "git") {
    const operation = args.find((value) =>
      [
        "push",
        "fetch",
        "config",
        "rev-parse",
        "status",
        "ls-tree",
        "cat-file",
        "symbolic-ref",
        "update-ref",
        "init",
        "add",
        "commit",
      ].includes(value),
    );
    return "git:" + (operation ?? "other");
  }
  return ["ssh-keygen", "node", "python3", "python"].includes(name)
    ? name
    : "other";
}
function record(command, args, elapsed) {
  const key = family(command, args);
  const item = (families[key] ??= { count: 0, totalMs: 0, maxMs: 0 });
  item.count++;
  item.totalMs += elapsed;
  item.maxMs = Math.max(item.maxMs, elapsed);
}
const original = cp.spawnSync;
cp.spawnSync = function (command, ...args) {
  const before = performance.now();
  inFlight = family(command, Array.isArray(args[0]) ? args[0] : []);
  // Preserve current operation before a synchronous native wait can block timers.
  if (before - lastSnapshotAt >= 2000) safeFlush(false);
  try {
    return Reflect.apply(original, this, [command, ...args]);
  } finally {
    record(
      command,
      Array.isArray(args[0]) ? args[0] : [],
      performance.now() - before,
    );
    inFlight = null;
  }
};
syncBuiltinESMExports();
function flush(completed) {
  writeFileSync(
    snapshotPath,
    JSON.stringify({
      schemaVersion: 1,
      diagnosticOnly: true,
      snapshotFailed,
      file: file ? basename(file) : "node-process",
      elapsedMs: performance.now() - started,
      completed,
      inFlight,
      families,
      cpuUsage: process.cpuUsage(),
      resourceUsage: process.resourceUsage(),
      runtime: {
        node: process.version,
        platform: process.platform,
        architecture: process.arch,
        parallelism: availableParallelism(),
        cpuModel: cpus()[0]?.model,
      },
    }),
  );
}
let snapshotFailed = false;
let timer;
function safeFlush(completed) {
  if (snapshotFailed) return;
  lastSnapshotAt = performance.now();
  try {
    flush(completed);
  } catch {
    snapshotFailed = true;
    clearInterval(timer);
    console.error(
      "[windows-shard-profile] " +
        JSON.stringify({
          snapshotFailed: true,
          file: file ? basename(file) : "node-process",
        }),
    );
    // Never terminate the process that owns any original command deadline.
  }
}
safeFlush(false);
timer = setInterval(() => safeFlush(false), 2000);
timer.unref();
process.on("exit", () => safeFlush(true));
