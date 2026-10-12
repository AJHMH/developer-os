import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  chmodSync,
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

test("authorization refuses a malformed selected account before preparing external storage", (t) => {
  const f = fixture(t);
  const result = spawnSync(
    process.execPath,
    [
      "dist/cli.js",
      "authorize-auth",
      "--repo",
      f.repo,
      "--state-dir",
      f.state,
      "--auth-directory",
      f.auth,
      "--auth-account",
      "not-an-account",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /selected account/);
  assert.equal(result.stdout, "");
});

test("authentication setup refuses existing shared storage without changing its permissions", (t) => {
  if (process.platform === "win32") return;
  const f = fixture(t);
  mkdirSync(f.auth);
  chmodSync(f.auth, 0o777);
  const result = f.command(f.auth);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.deepEqual(readdirSync(f.auth), []);
});

test("macOS authentication setup refuses extended ACL access without rewriting existing storage", (t) => {
  if (process.platform !== "darwin") return t.skip("macOS ACL observation");
  const f = fixture(t);
  mkdirSync(f.auth, { mode: 0o700 });
  const acl = spawnSync(
    "/bin/chmod",
    ["+a", "everyone allow read,write,execute", f.auth],
    { encoding: "utf8" },
  );
  assert.equal(acl.status, 0, acl.stderr);
  assert.equal(f.command(f.auth).status, 1);
  assert.deepEqual(readdirSync(f.auth), []);
});

test("Windows preparation refuses permissive retained registration without rewriting it", (t) => {
  if (process.platform !== "win32") return t.skip("Windows ACL observation");
  const f = fixture(t);
  assert.equal(f.command(f.auth).status, 0);
  const path = join(f.auth, "registration.json");
  const original = readFileSync(path, "utf8");
  const script = String.raw`
$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
foreach($name in @('Microsoft.PowerShell.Utility','Microsoft.PowerShell.Management','Microsoft.PowerShell.Security')) {
 Import-Module ([IO.Path]::Combine($PSHOME,'Modules',$name,($name+'.psd1'))) -ErrorAction Stop
}
$path=[Console]::In.ReadToEnd() | ConvertFrom-Json
$file=New-Object IO.FileInfo($path)
$acl=$file.GetAccessControl([Security.AccessControl.AccessControlSections]::Access)
$sid=New-Object Security.Principal.SecurityIdentifier('S-1-1-0')
$rule=New-Object Security.AccessControl.FileSystemAccessRule($sid,'Write','Allow')
$acl.AddAccessRule($rule)
$file.SetAccessControl($acl)
`;
  const changed = spawnSync(
    join(
      process.env.SystemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    {
      input: JSON.stringify(path),
      encoding: "utf8",
      timeout: 15000,
      env: { SystemRoot: process.env.SystemRoot },
      windowsHide: true,
    },
  );
  assert.equal(changed.status, 0, changed.stderr);
  const result = f.command(f.auth);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(readFileSync(path, "utf8"), original);
});
