// Temporary diagnostic preload: no arguments, environment values or program output are logged.
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { performance } from "node:perf_hooks";

const original = childProcess.spawnSync;
const markers = ["entered", "imports", "server-launched"];
const tag = (stage) => `[DEBUG-pr39-python:${stage}]`;
let sequence = 0;
childProcess.spawnSync = function (command, args, options) {
  if (!/(?:^|[\\/])python(?:[0-9.]*)?(?:\.exe)?$/i.test(String(command)))
    return original.apply(this, arguments);
  const id = ++sequence;
  let instrumented = false;
  if (
    Array.isArray(args) &&
    args[0] === "-c" &&
    process.env.AIOS_DIAGNOSTIC_PYTHON_MARKERS !== "off" &&
    (args[1].includes("identity='expiry-fixture'") ||
      args[1].includes("synthetic-management"))
  ) {
    instrumented = true;
    let source = args[1];
    source = source.replace(
      /^(import [^\n]+)$/m,
      (line) =>
        `${line}\nsys.stderr.write(${JSON.stringify(tag("imports") + "\n")});sys.stderr.flush()`,
    );
    source = source.replace(
      /^(p=subprocess\.Popen[^\n]+)$/m,
      (line) =>
        `${line}\nsys.stderr.write(${JSON.stringify(tag("server-launched") + "\n")});sys.stderr.flush()`,
    );
    source = `import sys;sys.stderr.write(${JSON.stringify(tag("entered") + "\n")});sys.stderr.flush()\n${source}`;
    args = [...args];
    args[1] = source;
  }
  process.stderr.write(
    `[DEBUG-pr39-spawn] ${JSON.stringify({ event: "start", id, instrumented, timeoutMs: options?.timeout ?? null })}\n`,
  );
  const start = performance.now();
  const result = original.call(this, command, args, options);
  const stderr = String(result.stderr ?? "");
  process.stderr.write(
    `[DEBUG-pr39-spawn] ${JSON.stringify({
      event: "finish",
      id,
      durationMs: Math.round(performance.now() - start),
      status: result.status,
      signal: result.signal,
      errorCode: result.error?.code ?? null,
      stdoutBytes: Buffer.byteLength(String(result.stdout ?? "")),
      stderrBytes: Buffer.byteLength(stderr),
      stages: markers.filter((stage) => stderr.includes(tag(stage))),
    })}\n`,
  );
  if (instrumented && typeof result.stderr === "string") {
    for (const stage of markers)
      result.stderr = result.stderr.replaceAll(tag(stage) + "\n", "");
  }
  return result;
};
syncBuiltinESMExports();
