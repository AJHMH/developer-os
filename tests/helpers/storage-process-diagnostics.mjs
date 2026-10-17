// Test-only preload: preserve native calls; retain fixed labels and numbers only.
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { writeSync } from "node:fs";
import { basename } from "node:path";
const original = cp.spawnSync;
function emit(record, descriptor = 2) {
  try {
    writeSync(descriptor, "[storage-process] " + JSON.stringify(record) + "\n");
  } catch {
    // Evidence failure must never interrupt the caller's native supervision.
  }
}
const errorCode = (code) =>
  ["ETIMEDOUT", "ENOENT", "EACCES", "EPERM", "ENOBUFS"].includes(code)
    ? code
    : code
      ? "other"
      : null;
/** Real-call seam used by the preload and its subprocess failure controls. */
export function observeStorageProcess(
  stage,
  executable,
  args,
  options,
  descriptor = 2,
) {
  if (!["initialize-directory", "protected-storage", "control"].includes(stage))
    throw Error("Unknown diagnostic stage");
  const started = performance.now();
  emit({ stage, event: "started" }, descriptor);
  let result;
  try {
    result = Reflect.apply(original, cp, [executable, args, options]);
    return result;
  } finally {
    emit(
      {
        stage,
        event: "finished",
        elapsedMs: Math.round(performance.now() - started),
        status: Number.isInteger(result?.status) ? result.status : null,
        signal: ["SIGTERM", "SIGKILL", "SIGABRT", "SIGSEGV"].includes(
          result?.signal,
        )
          ? result.signal
          : result?.signal
            ? "other"
            : null,
        errorCode: errorCode(result?.error?.code),
        threw: result === undefined,
      },
      descriptor,
    );
  }
}
if (process.platform === "win32") {
  emit({ stage: "cli-preload", event: "entered" });
  cp.spawnSync = function (executable, args, options) {
    if (basename(String(executable)).toLowerCase() !== "powershell.exe")
      return Reflect.apply(original, this, [executable, args, options]);
    // Both fixed production storage scripts use bounded string input. No input
    // value, encoded script, account, path or child output is retained.
    const stage =
      typeof options?.input === "string" && !options.input.includes("\n")
        ? "initialize-directory"
        : "protected-storage";
    return observeStorageProcess(stage, executable, args, options);
  };
  syncBuiltinESMExports();
}
