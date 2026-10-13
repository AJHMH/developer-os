export interface NativeProbeDiagnostic {
  elapsedMs: number;
  commandElapsedMs?: number;
  failureKind: "check" | "exit" | "timeout" | "output-limit";
  exitCode?: number;
  originalCodexProcesses?: number;
  remainingOriginalCodexProcesses?: number;
  responseBytes?: number;
  responseStatus?: number;
  requestExitCode?: number;
}

/** A diagnostic is explanatory only; it can never make a failed probe pass. */
export function nativeProbeDiagnostic(
  value: unknown,
): NativeProbeDiagnostic | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const integer = (v: unknown, min: number, max: number) =>
    typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
  if (
    !integer(input.elapsedMs, 0, 600000) ||
    !["check", "exit", "timeout", "output-limit"].includes(
      String(input.failureKind),
    )
  )
    return undefined;
  const result: NativeProbeDiagnostic = {
    elapsedMs: input.elapsedMs as number,
    failureKind: input.failureKind as NativeProbeDiagnostic["failureKind"],
  };
  for (const key of [
    "commandElapsedMs",
    "originalCodexProcesses",
    "remainingOriginalCodexProcesses",
    "responseBytes",
    "responseStatus",
  ] as const) {
    if (input[key] !== undefined) {
      const max =
        key === "commandElapsedMs"
          ? 600000
          : key === "responseBytes"
            ? 65536
            : key === "responseStatus"
              ? 599
              : 100000;
      if (!integer(input[key], 0, max)) return undefined;
      result[key] = input[key] as number;
    }
  }
  if (input.requestExitCode !== undefined) {
    if (!integer(input.requestExitCode, -128, 255)) return undefined;
    result.requestExitCode = input.requestExitCode as number;
  }
  if (input.exitCode !== undefined) {
    if (!integer(input.exitCode, -128, 255)) return undefined;
    result.exitCode = input.exitCode as number;
  }
  return result;
}
