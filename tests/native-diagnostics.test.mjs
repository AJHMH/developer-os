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
        persistenceErrorCode: -32600,
        persistenceErrorReason: "not-materialized",
        persistenceErrorFlags: 4294967295,
        processLimitHits: 1,
        workerTaskCount: 32,
        workerTaskLimit: 32,
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
        persistenceErrorCode: -32600,
        persistenceErrorReason: "not-materialized",
        persistenceErrorFlags: 4294967295,
        processLimitHits: 1,
        workerTaskCount: 32,
        workerTaskLimit: 32,
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
    "processLimitHits",
    "workerTaskCount",
    "workerTaskLimit",
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
  for (const persistenceErrorReason of [
    "not-materialized",
    "rollout",
    "permission",
    "not-found",
    "not-persisted",
    "closing-thread",
    "not-loaded",
    "internal",
    "missing",
    "active-thread",
    "not-initialized",
    "history",
    "database",
    "invalid-data",
    "file",
    "read",
    "other",
  ])
    assert.equal(
      nativeProbeDiagnostic({ ...base, persistenceErrorReason })
        ?.persistenceErrorReason,
      persistenceErrorReason,
    );
  for (const value of [
    "raw-private-message",
    42,
    null,
    ["rollout"],
    { toString: () => "rollout" },
  ])
    assert.equal(
      nativeProbeDiagnostic({ ...base, persistenceErrorReason: value }),
      undefined,
    );
  for (const value of [-32769, 32768, "-32600", 0.5])
    assert.equal(
      nativeProbeDiagnostic({ ...base, persistenceErrorCode: value }),
      undefined,
    );
  for (const value of [-1, 4294967296, "1", 0.5])
    assert.equal(
      nativeProbeDiagnostic({ ...base, persistenceErrorFlags: value }),
      undefined,
    );
});
