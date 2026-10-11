import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-auth-setup-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, "repo"),
    state = join(root, "state"),
    auth = join(root, "auth");
  mkdirSync(repo);
  const command = (directory) =>
    spawnSync(
      process.execPath,
      [
        "dist/cli.js",
        "prepare-auth",
        "--repo",
        repo,
        "--state-dir",
        state,
        "--auth-directory",
        directory,
      ],
      { encoding: "utf8" },
    );
  return { repo, state, auth, command };
}

test("separate authentication preparation preserves a stable host registration without credentials or delivery authority", (t) => {
  const f = fixture(t);
  const first = f.command(f.auth);
  assert.equal(first.status, 0, first.stderr);
  const plan = JSON.parse(first.stdout);
  assert.equal(plan.status, "prepared");
  assert.equal(plan.deliveryEnabled, false);
  assert.equal(plan.credentialsStored, false);
  assert.equal(JSON.parse(f.command(f.auth).stdout).hostId, plan.hostId);
  assert.deepEqual(readdirSync(f.auth), ["registration.json"]);
  const stored = JSON.parse(readFileSync(join(f.auth, "registration.json")));
  assert.equal(stored.hostId, plan.hostId);
  assert.equal(stored.access_token, undefined);
});

test("candidate and ledger owned authentication paths refuse preparation without creating files", (t) => {
  const f = fixture(t);
  for (const target of [join(f.repo, "auth"), join(f.state, "auth")]) {
    assert.equal(f.command(target).status, 1);
  }
  assert.deepEqual(readdirSync(f.repo), []);
});
