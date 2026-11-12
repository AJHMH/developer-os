import "./helpers/owner-host-stand-in.mjs";
// #267: publish-feature and reconcile-publication install the native
// publisher from the owner's publication record, and the production gate
// from the owner's production record. The name sorts after every other test
// file but the zzz ones.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { codingFixture } from "./helpers/feature-fixture.mjs";
import {
  nativePublicationRuntime,
  readPublicationIdentity,
} from "../dist/publication-identity.js";

const cliPath = new URL("../dist/cli.js", import.meta.url).pathname;
function cli(state, ...args) {
  const r = spawnSync(
    process.execPath,
    [cliPath, ...args, "--state-dir", state],
    {
      encoding: "utf8",
    },
  );
  const line = r.stderr
    .split("\n")
    .reverse()
    .find((l) => l.startsWith("{"));
  return {
    status: r.status,
    stdout: r.stdout,
    error: line ? JSON.parse(line).error : undefined,
  };
}
function owner(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-publish-cli-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const record = {
    scope: "aios-publication-identity-v1",
    repository: "AJHMH/profile-page",
    login: "aaron-howard",
    name: "Aaron Howard",
    email: "owner@example.invalid",
    signingKey: join(root, "id_ed25519.pub"),
    appId: "5180250",
    installationId: "167664341",
    botLogin: "ajhmh-software-factory[bot]",
    appKeyPath: join(root, "app.pem"),
    approver: "aaron-howard",
  };
  const path = join(root, "publication-identity.json");
  writeFileSync(path, JSON.stringify(record), { mode: 0o600 });
  return { root, record, path };
}

test("publish-feature and reconcile-publication take the owner's publication and production records, and refuse empty ones", (t) => {
  const o = owner(t);
  const state = join(o.root, "state");
  for (const command of ["publish-feature", "reconcile-publication"]) {
    for (const args of [
      ["--publication-identity", ""],
      ["--production-admission", ""],
      ["--coding-admission", "x"],
      ["--auth-directory", "x"],
    ]) {
      const r = cli(
        state,
        command,
        "--id",
        "00000000-0000-4000-8000-000000000000",
        ...args,
      );
      assert.equal(r.status, 1, `${command} ${args[0]}`);
      assert.match(r.error, /^Use start/);
    }
  }
});

test("an invalid publication record refuses before anything is touched", (t) => {
  const o = owner(t);
  const state = join(o.root, "state");
  const id = ["--id", "00000000-0000-4000-8000-000000000000"];
  writeFileSync(join(o.root, "loose.json"), JSON.stringify(o.record), {
    mode: 0o644,
  });
  spawnSync("chmod", ["644", join(o.root, "loose.json")]);
  for (const bad of [join(o.root, "missing.json"), join(o.root, "loose.json")])
    assert.match(
      cli(state, "publish-feature", ...id, "--publication-identity", bad).error,
      /owner publication record is missing or invalid\. Nothing was published/,
    );
});

test("with a valid publication record, publishing still needs the owner's production admission", async (t) => {
  const f = codingFixture(t);
  const o = owner(t);
  const r = cli(
    f.state,
    "publish-feature",
    "--id",
    f.delivery.id,
    "--publication-identity",
    o.path,
  );
  assert.equal(r.status, 1);
  assert.match(r.error, /production admission/);
  // A production record that isn't there admits nothing either.
  const missing = cli(
    f.state,
    "publish-feature",
    "--id",
    f.delivery.id,
    "--publication-identity",
    o.path,
    "--production-admission",
    join(o.root, "missing.json"),
  );
  assert.match(missing.error, /production admission/);
  // The publisher's own folder is private and per repository.
  const folder = join(f.state, "publication");
  assert.equal(statSync(folder).isDirectory(), true);
});

test("the native publication runtime is bound to the record's digest and keeps its metadata in a private folder", (t) => {
  const o = owner(t);
  const state = join(o.root, "state");
  const runtime = nativePublicationRuntime(o.path, state);
  assert.equal(runtime.mode, "controlled");
  assert.equal(runtime.bindingSha256, readPublicationIdentity(o.path).sha256);
  const folders = spawnSync(
    "find",
    [join(state, "publication"), "-mindepth", "1", "-maxdepth", "1"],
    { encoding: "utf8" },
  )
    .stdout.trim()
    .split("\n");
  assert.equal(folders.length, 1);
  assert.equal(statSync(folders[0]).mode & 0o777, 0o700);
  // A relative key path is not the owner's record.
  writeFileSync(
    o.path,
    JSON.stringify({ ...o.record, appKeyPath: "app.pem" }),
    { mode: 0o600 },
  );
  assert.throws(
    () => readPublicationIdentity(o.path),
    /Invalid owner publication record/,
  );
  writeFileSync(
    o.path,
    // A relative key path, built rather than written out.
    JSON.stringify({
      ...o.record,
      signingKey: o.record.signingKey.split("/").pop(),
    }),
    { mode: 0o600 },
  );
  assert.throws(
    () => readPublicationIdentity(o.path),
    /Invalid owner publication record/,
  );
});

test("a production record path that isn't absolute, or sits in a repository, refuses before anything is touched", (t) => {
  const o = owner(t);
  const state = join(o.root, "state");
  for (const bad of [
    "production-admission.json",
    join(process.cwd(), "production-admission.json"),
  ])
    assert.match(
      cli(
        state,
        "publish-feature",
        "--id",
        "00000000-0000-4000-8000-000000000000",
        "--production-admission",
        bad,
      ).error,
      /owner production admission record is missing or invalid\. Production remains disabled/,
    );
});
