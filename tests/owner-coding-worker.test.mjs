import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  claudeCodingAdmissionScope,
  readOwnerRecord,
} from "../dist/coding-admission.js";
import {
  nativeCodingAuthority,
  nativeCodingRuntime,
  ownerCodingWorker,
} from "../dist/native-coding-runtime.js";
import { claudeGuest, codexGuest } from "../dist/podman-coding.js";

// The owner-run native scripts take their coding worker from the owner's
// record (ADR 0008): its scope names Claude Code's guest or Codex's.
const claudePins = {
  cliVersion: "2.1.311",
  cliSha256: "c".repeat(64),
  policySha256: "d".repeat(64),
  bindingSha256: "e".repeat(64),
};
const codexPins = {
  ...claudePins,
  cliVersion: "0.161.0",
  codeModeHostSha256: "b".repeat(64),
};

function record(t, scope, pins) {
  const directory = mkdtempSync(join(tmpdir(), "aios-owner-worker-"));
  t.after(() => rmSync(directory, { recursive: true }));
  chmodSync(directory, 0o700);
  const path = join(directory, "coding-admission.json");
  writeFileSync(
    path,
    JSON.stringify({ scope, approvedAt: "2026-11-01T12:00:00.000Z", pins }),
    { mode: 0o600 },
  );
  return path;
}

test("a Claude Code record names the Claude Code guest under its own admission", (t) => {
  const worker = ownerCodingWorker(
    "aios-test",
    record(t, claudeCodingAdmissionScope, claudePins),
  );
  assert.equal(worker.agent, "claude");
  assert.equal(worker.transport.guest, claudeGuest);
  assert.equal(worker.transport.machine, "aios-test");
  assert.deepEqual(worker.admission.pins(), claudePins);
});

test("any other record names the Codex guest, whose admission judges it", (t) => {
  const codex = ownerCodingWorker(
    "aios-test",
    record(t, "aios-native-coding-admission-v1", codexPins),
  );
  assert.equal(codex.agent, "codex");
  assert.equal(codex.transport.guest, codexGuest);
  assert.deepEqual(codex.admission.pins(), codexPins);
  // An unreadable or missing record is never Claude Code's, and the Codex
  // admission refuses it.
  for (const path of [
    record(t, "aios-other-scope", claudePins),
    join(tmpdir(), "aios-missing-owner-record.json"),
  ]) {
    const worker = ownerCodingWorker("aios-test", path);
    assert.equal(worker.agent, "codex");
    assert.throws(() => worker.admission.pins(), /missing or invalid/);
  }
  // A Codex-scoped record holding Claude pins is refused too.
  const mixed = ownerCodingWorker(
    "aios-test",
    record(t, "aios-native-coding-admission-v1", claudePins),
  );
  assert.throws(() => mixed.admission.pins(), /missing or invalid/);
});

test("both guests run under the machine's one coding authority", (t) => {
  for (const [scope, pins] of [
    [claudeCodingAdmissionScope, claudePins],
    ["aios-native-coding-admission-v1", codexPins],
  ]) {
    const worker = ownerCodingWorker("aios-test", record(t, scope, pins));
    assert.equal(
      worker.transport.authority,
      nativeCodingAuthority("aios-test"),
    );
  }
});

test("a record in a folder that does not exist is refused, never admitted", () => {
  const path = join(
    tmpdir(),
    "aios-missing-owner-folder",
    "coding-admission.json",
  );
  const worker = ownerCodingWorker("aios-test", path);
  assert.equal(worker.agent, "codex");
  assert.throws(() => worker.admission.pins(), /missing or invalid/);
});

test("an owner record is read only from an absolute path outside every repository", () => {
  assert.throws(
    () => readOwnerRecord("coding-admission.json"),
    /must be absolute/,
  );
  // This checkout is a repository: no owner record may live in it.
  assert.throws(
    () =>
      readOwnerRecord(
        join(process.cwd(), "tests", "fixtures", "coding-admission.json"),
      ),
    /never live in a repository/,
  );
});

test("the CLI's coding runtime runs the agent its owner record names", (t) => {
  const claude = nativeCodingRuntime(
    "aios-test",
    record(t, claudeCodingAdmissionScope, claudePins),
  );
  assert.equal(claude.agent.provider, "claude");
  assert.deepEqual(claude.pins, claudePins);
  const codex = nativeCodingRuntime(
    "aios-test",
    record(t, "aios-native-coding-admission-v1", codexPins),
  );
  assert.equal(codex.agent.provider, "codex");
  assert.deepEqual(codex.pins, codexPins);
});
