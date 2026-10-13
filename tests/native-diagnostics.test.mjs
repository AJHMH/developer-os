import assert from "node:assert/strict";
import { test } from "node:test";
import { nativeProbeDiagnostic } from "../dist/native-diagnostics.js";

test("native diagnostics refuse malformed known fields and strip arbitrary private metadata", () => {
  for (const value of [null, undefined, "secret", 42, false])
    assert.equal(nativeProbeDiagnostic(value), undefined);
  const base = { elapsedMs: 0, failureKind: "exit" };
  for (const failureKind of ["check", "exit", "timeout", "output-limit"])
    assert.deepEqual(
      nativeProbeDiagnostic({
        ...base,
        failureKind,
        exitCode: -128,
        commandElapsedMs: 600000,
        originalCodexProcesses: 100000,
        remainingOriginalCodexProcesses: 0,
        responseBytes: 65536,
        responseStatus: 403,
        requestExitCode: 255,
        stderr: "synthetic-private",
      }),
      {
        elapsedMs: 0,
        failureKind,
        exitCode: -128,
        commandElapsedMs: 600000,
        originalCodexProcesses: 100000,
        remainingOriginalCodexProcesses: 0,
        responseBytes: 65536,
        responseStatus: 403,
        requestExitCode: 255,
      },
    );
  for (const field of [
    "elapsedMs",
    "commandElapsedMs",
    "originalCodexProcesses",
    "remainingOriginalCodexProcesses",
    "exitCode",
    "responseBytes",
    "responseStatus",
    "requestExitCode",
  ])
    for (const value of [
      "1",
      1.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER,
      -129,
    ])
      assert.equal(
        nativeProbeDiagnostic({ ...base, [field]: value }),
        undefined,
      );
  assert.equal(
    nativeProbeDiagnostic({ ...base, failureKind: "arbitrary" }),
    undefined,
  );
  assert.deepEqual(nativeProbeDiagnostic({ ...base, exitCode: 255 }), {
    ...base,
    exitCode: 255,
  });
});
