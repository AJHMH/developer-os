import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  PinnedCodingRuntime,
  claudeAgent,
  claudeCodingPinFields,
  codexAgent,
} from "../dist/feature-candidate.js";
import {
  claudeCodingAdmissionScope,
  ownerClaudeCodingAdmission,
  ownerCodingAdmission,
} from "../dist/coding-admission.js";

// The pinned coding runtime admits Claude Code turns at Claude Code's own pins
// (ADR 0008): no code-mode host, under the Claude Code owner record.
const claudePins = Object.freeze({
  cliVersion: "2.1.311",
  cliSha256: "c".repeat(64),
  policySha256: "d".repeat(64),
  bindingSha256: "e".repeat(64),
});
const codexPins = Object.freeze({
  ...claudePins,
  cliVersion: "0.161.0",
  codeModeHostSha256: "b".repeat(64),
});
const live = (pins) => ({ mode: "live", inspect: async () => ({ ...pins }) });

function record(t, scope, pins) {
  const directory = mkdtempSync(join(tmpdir(), "aios-claude-runtime-"));
  t.after(() => rmSync(directory, { recursive: true }));
  chmodSync(directory, 0o700);
  const path = join(directory, "coding-admission.json");
  const write = (value) =>
    writeFileSync(
      path,
      JSON.stringify({
        scope,
        approvedAt: "2026-11-01T12:00:00.000Z",
        pins: value,
      }),
      { mode: 0o600 },
    );
  write(pins);
  return { path, write };
}

test("a Claude Code runtime is admitted at exactly its owner record's Claude pins", (t) => {
  const r = record(t, claudeCodingAdmissionScope, claudePins);
  const admission = ownerClaudeCodingAdmission(r.path);
  const runtime = new PinnedCodingRuntime(
    claudePins,
    live(claudePins),
    admission,
    claudeAgent,
  );
  assert.deepEqual(runtime.pins, claudePins);
  for (const field of claudeCodingPinFields) {
    // A changed or missing pin is refused.
    assert.throws(
      () =>
        new PinnedCodingRuntime(
          {
            ...claudePins,
            [field]: field === "cliVersion" ? "2.1.312" : "0".repeat(64),
          },
          live(claudePins),
          admission,
          claudeAgent,
        ),
      /Unqualified coding transport/,
      field,
    );
    const missing = { ...claudePins };
    delete missing[field];
    assert.throws(
      () =>
        new PinnedCodingRuntime(
          missing,
          live(claudePins),
          admission,
          claudeAgent,
        ),
      /Unqualified coding transport/,
      field,
    );
  }
  // A record naming other pins revokes admission.
  r.write({ ...claudePins, policySha256: "0".repeat(64) });
  assert.throws(
    () =>
      new PinnedCodingRuntime(
        claudePins,
        live(claudePins),
        admission,
        claudeAgent,
      ),
    /Unqualified coding transport/,
  );
});

test("Claude Code pins never carry a code-mode host, and Codex pins always do", (t) => {
  const claude = ownerClaudeCodingAdmission(
    record(t, claudeCodingAdmissionScope, claudePins).path,
  );
  assert.throws(
    () =>
      new PinnedCodingRuntime(
        { ...claudePins, codeModeHostSha256: "b".repeat(64) },
        live(claudePins),
        claude,
        claudeAgent,
      ),
    /Unqualified coding transport/,
  );
  // Claude Code pins never admit a Codex runtime, even under a record that
  // names them.
  const codex = ownerCodingAdmission(
    record(t, "aios-native-coding-admission-v1", codexPins).path,
  );
  assert.throws(
    () =>
      new PinnedCodingRuntime(claudePins, live(claudePins), codex, codexAgent),
    /Unqualified coding transport/,
  );
  assert.deepEqual(
    new PinnedCodingRuntime(codexPins, live(codexPins), codex, codexAgent).pins,
    codexPins,
  );
  // A Codex record never admits a Claude Code runtime.
  assert.throws(
    () =>
      new PinnedCodingRuntime(claudePins, live(claudePins), codex, claudeAgent),
    /Unqualified coding transport/,
  );
});
