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
import { claudeGuest } from "../dist/podman-coding.js";

// The owner-run native scripts run the Claude Code guest (ADR 0008) under the
// owner's Claude Code record; a record of any other scope is refused.
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

test("any other record still names the Claude Code guest, whose admission refuses it", (t) => {
  for (const path of [
    record(t, "aios-native-coding-admission-v1", codexPins),
    // A Codex-scoped record holding Claude pins is refused too.
    record(t, "aios-native-coding-admission-v1", claudePins),
    record(t, "aios-other-scope", claudePins),
    record(t, claudeCodingAdmissionScope, codexPins),
    join(tmpdir(), "aios-missing-owner-record.json"),
    join(tmpdir(), "aios-missing-owner-folder", "coding-admission.json"),
  ]) {
    const worker = ownerCodingWorker("aios-test", path);
    assert.equal(worker.agent, "claude");
    assert.equal(worker.transport.guest, claudeGuest);
    assert.equal(
      worker.transport.authority,
      nativeCodingAuthority("aios-test"),
    );
    assert.throws(() => worker.admission.pins(), /missing or invalid/, path);
  }
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

test("the CLI's coding runtime runs Claude Code at its owner record's pins", (t) => {
  const claude = nativeCodingRuntime(
    "aios-test",
    record(t, claudeCodingAdmissionScope, claudePins),
  );
  assert.equal(claude.agent.provider, "claude");
  assert.deepEqual(claude.pins, claudePins);
  assert.throws(
    () =>
      nativeCodingRuntime(
        "aios-test",
        record(t, "aios-native-coding-admission-v1", codexPins),
      ),
    /missing or invalid/,
  );
});
