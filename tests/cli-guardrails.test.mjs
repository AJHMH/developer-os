import "./helpers/owner-host-stand-in.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The fixed worker, its qualification, the online canary and the usage reader
// are gone with Codex (#222): their commands and options are refused.
test("CLI refuses the removed fixed-worker, canary and usage commands and options", (t) => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "aios-cli-guardrails-")),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const state = join(root, "state");
  const id = "00000000-0000-4000-8000-000000000031";
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const run = (args) =>
    spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
  for (const command of [
    "pin-offline",
    "qualify",
    "qualify-macos-controls",
    "qualification-report",
    "offline-canary",
    "online-canary",
    "synthetic-task",
    "check-usage",
    "poll-usage",
    "approve-usage",
  ]) {
    const result = run([command, "--id", id, "--state-dir", state]);
    assert.equal(result.status, 1, command);
    assert.match(result.stderr, /Use start/, command);
  }
  for (const option of [
    ["--worker-policy", join(root, "pins.json")],
    ["--dependency-policy", join(root, "pins.json")],
    ["--codex-executable", join(root, "codex")],
    ["--adversarial"],
  ]) {
    const result = run([
      "recover",
      "--id",
      id,
      "--state-dir",
      state,
      "--podman-machine",
      "aios-test",
      ...option,
    ]);
    assert.equal(result.status, 1, option[0]);
    assert.match(result.stderr, /Use start/, option[0]);
  }
});

test("CLI refuses an auth directory on a command that takes none", (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-cli-auth-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const state = join(root, "state");
  mkdirSync(state);
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const misplacedAuth = spawnSync(
    process.execPath,
    [
      cli,
      "status",
      "--state-dir",
      state,
      "--auth-directory",
      join(root, "auth"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(misplacedAuth.status, 1);
  assert.match(misplacedAuth.stderr, /Use start/);
});
