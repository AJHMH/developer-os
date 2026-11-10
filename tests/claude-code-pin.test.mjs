import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  claudeCodePin,
  claudeCodeTemplate,
  hostTargets,
} from "../dist/host-target.js";
import {
  claudeCodingPinFields,
  validClaudeCodingPins,
} from "../dist/feature-candidate.js";
import {
  claudeCodingAdmissionScope,
  ownerClaudeCodingAdmission,
} from "../dist/coding-admission.js";

const pins = Object.freeze({
  cliVersion: "2.1.311",
  cliSha256: "c".repeat(64),
  policySha256: "d".repeat(64),
  bindingSha256: "e".repeat(64),
});

test("the Mac target pins the Claude Code binary from the official musl arm64 package", () => {
  // npm view @anthropic-ai/claude-code-linux-arm64-musl@2.1.311 dist.integrity,
  // and shasum -a 256 of package/claude in that tarball.
  assert.deepEqual(hostTargets.darwin.claudeCode, {
    package: "@anthropic-ai/claude-code-linux-arm64-musl",
    version: "2.1.311",
    integrity:
      "sha512-ymSGc6vv0QCcVQZCC2JG03P/upLraox+iXAG1DfnUU1OZBCIR9QncxINBEp6QgnKbqywwR2/ic3GD8hAz0Tiow==",
    binary: "claude",
    sha256: "172150e3f9ea07e8e2e2e29862d7d9a25f5c234d8e909e4063df237665bf09b9",
    // Docker's official bash:5.3.15-alpine3.24, its linux/arm64 manifest
    // digest and its config's exact environment (registry-1.docker.io).
    template:
      "docker.io/library/bash@sha256:826e424f395d3d1e10adc155e63f3c69090c5559c5f3914b0d4c9064e767b06a",
    imageEnv: [
      "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      "_BASH_VERSION=5.3.15",
      "_BASH_BASELINE=5.3",
      "_BASH_LATEST_PATCH=15",
    ],
  });
  assert.equal(claudeCodePin("darwin", "arm64"), hostTargets.darwin.claudeCode);
  assert.equal(
    claudeCodeTemplate("darwin", "arm64"),
    hostTargets.darwin.claudeCode.template,
  );
  assert.equal(claudeCodeTemplate("darwin", "x64"), undefined);
  assert.equal(claudeCodePin("darwin", "x64"), undefined);
  assert.equal(claudeCodePin("linux", "arm64"), undefined);
});

test("Claude coding pins have no code-mode host and must be exact", () => {
  assert.deepEqual(
    [...claudeCodingPinFields],
    ["cliVersion", "cliSha256", "policySha256", "bindingSha256"],
  );
  assert.equal(validClaudeCodingPins(pins), true);
  for (const bad of [
    undefined,
    { ...pins, cliVersion: "latest" },
    { ...pins, cliVersion: 2 },
    { ...pins, cliSha256: "x" },
    { ...pins, policySha256: 5 },
    { ...pins, bindingSha256: undefined },
  ])
    assert.equal(validClaudeCodingPins(bad), false, JSON.stringify(bad));
});

function record(t, fields) {
  const directory = mkdtempSync(join(tmpdir(), "aios-claude-admission-"));
  t.after(() => rmSync(directory, { recursive: true }));
  chmodSync(directory, 0o700);
  const path = join(directory, "coding-admission.json");
  writeFileSync(
    path,
    JSON.stringify({
      scope: claudeCodingAdmissionScope,
      approvedAt: "2026-11-08T12:00:00.000Z",
      pins,
      ...fields,
    }),
    { mode: 0o600 },
  );
  return path;
}

test("Claude coding admission has its own scope, apart from Codex-era records", (t) => {
  assert.equal(claudeCodingAdmissionScope, "aios-claude-coding-admission-v1");
  assert.deepEqual(ownerClaudeCodingAdmission(record(t)).pins(), pins);
  const refused = {
    "Codex scope": { scope: "aios-native-coding-admission-v1" },
    "code-mode host pin": {
      pins: { ...pins, codeModeHostSha256: "b".repeat(64) },
    },
    "malformed pin": { pins: { ...pins, cliSha256: "x" } },
  };
  for (const [name, fields] of Object.entries(refused))
    assert.throws(
      () => ownerClaudeCodingAdmission(record(t, fields)).pins(),
      /Owner coding admission is missing or invalid/,
      name,
    );
  assert.throws(
    () => ownerClaudeCodingAdmission("relative.json"),
    /must be absolute/,
  );
});
