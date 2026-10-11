import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("CLI rejects misplaced host options and incomplete online artifact configuration", (t) => {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "aios-cli-guardrails-")),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const state = join(root, "state");
  const repository = join(root, "repo");
  mkdirSync(repository);
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const run = (args) =>
    spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });

  for (const args of [
    [
      "status",
      "--state-dir",
      state,
      "--dependency-policy",
      join(root, "pins.json"),
    ],
    ["online-canary", "--state-dir", state, "--dependency-policy", ""],
    [
      "online-canary",
      "--state-dir",
      state,
      "--podman-machine",
      "aios-test",
      "--dependency-policy",
      join(root, "pins.json"),
    ],
  ]) {
    const result = run(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Use start/);
  }
});

test("CLI validates selected auth identity before opening browser or native auth storage", (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-cli-auth-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const state = join(root, "state");
  const repository = join(root, "repo");
  const auth = join(root, "auth");
  mkdirSync(repository);
  mkdirSync(state);
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

  const invalidSelectedAccount = spawnSync(
    process.execPath,
    [
      cli,
      "authorize-auth",
      "--state-dir",
      state,
      "--repo",
      repository,
      "--auth-directory",
      auth,
      "--auth-account",
      "invalid",
    ],
    { encoding: "utf8" },
  );
  assert.equal(invalidSelectedAccount.status, 1);
  assert.match(invalidSelectedAccount.stderr, /selected account/);
  assert.equal(
    invalidSelectedAccount.stderr.includes("authorizationUrl"),
    false,
  );

  const misplacedAuth = spawnSync(
    process.execPath,
    [cli, "status", "--state-dir", state, "--auth-directory", auth],
    { encoding: "utf8" },
  );
  assert.equal(misplacedAuth.status, 1);
  assert.match(misplacedAuth.stderr, /Use start/);
});

test("CLI constructs the pinned dependency runtime before refusing a missing delivery", (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-cli-online-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const state = join(root, "state");
  const repository = join(root, "repo");
  const policy = join(root, "pins.json");
  mkdirSync(repository);
  mkdirSync(state);
  writeFileSync(policy, JSON.stringify({ schema: 1 }), { mode: 0o600 });
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  const result = spawnSync(
    process.execPath,
    [
      cli,
      "online-canary",
      "--state-dir",
      state,
      "--podman-machine",
      "aios-test",
      "--worker-policy",
      policy,
      "--dependency-policy",
      policy,
      "--id",
      "00000000-0000-4000-8000-000000000031",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /not found|unknown/i);
});
