export interface NativeProbeDiagnostic {
  elapsedMs: number;
  commandElapsedMs?: number;
  failureKind: "check" | "exit" | "timeout" | "output-limit";
  exitCode?: number;
  originalCodexProcesses?: number;
  remainingOriginalCodexProcesses?: number;
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
  ] as const) {
    if (input[key] !== undefined) {
      if (!integer(input[key], 0, key === "commandElapsedMs" ? 600000 : 100000))
        return undefined;
      result[key] = input[key] as number;
    }
  }
  if (input.exitCode !== undefined) {
    if (!integer(input.exitCode, -128, 255)) return undefined;
    result.exitCode = input.exitCode as number;
  }
  return result;
}
