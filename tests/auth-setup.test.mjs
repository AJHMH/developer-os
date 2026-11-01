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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { GeneralSessionGateway } from "../dist/general-session-gateway.js";
import {
  credentialedGeneralSessions,
  hostRegistration,
} from "../dist/general-sessions.js";
import { gatewayModel } from "../dist/inference-contract.js";
import {
  requiredSubscriptionScopes,
  subscriptionAccountId,
  subscriptionIssuer,
} from "../dist/subscription-account.js";

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

test("the credentialed run reads the host registration back from private storage, and nothing else passes for one", (t) => {
  const f = fixture(t);
  const prepared = f.command(f.auth);
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.equal(
    hostRegistration(f.auth).hostId,
    JSON.parse(prepared.stdout).hostId,
  );
  assert.throws(() => hostRegistration(f.repo));
  writeFileSync(join(f.auth, "registration.json"), "{}");
  assert.throws(() => hostRegistration(f.auth), /registration is invalid/);
});

// ADR 0004 slice 5: the CLI's routed turns, over a fake vault and provider.
function credentialedSessions(t, vaultAccount = {}) {
  const f = fixture(t);
  const prepared = f.command(f.auth);
  assert.equal(prepared.status, 0, prepared.stderr);
  const { hostId } = JSON.parse(prepared.stdout);
  const owner = {
    issuer: subscriptionIssuer,
    clientId: "oaiapp_owner",
    subject: "owner",
    hostId,
    planUsageAuthorized: true,
    scopes: [...requiredSubscriptionScopes],
    expiresAt: Date.now() + 40 * 60_000,
    accessToken: "owner-access-token-" + "t".repeat(32),
  };
  const accountId = subscriptionAccountId(owner);
  const reads = [],
    tokens = [];
  const factory = credentialedGeneralSessions(f.auth, accountId, {
    vault: {
      read: (id) => {
        reads.push(id);
        return Buffer.from(
          JSON.stringify({ ...owner, ...vaultAccount }),
        ).toString("base64");
      },
    },
    async *provider(token) {
      tokens.push(token);
      yield Buffer.from('data: {"type":"response.completed"}\n\n');
    },
  });
  const turn = (changes = {}) => ({
    deliveryId: randomUUID(),
    sessionId: randomUUID(),
    decisionSha256: "d".repeat(64),
    accountId,
    expiresAt: Date.now() + 10 * 60_000,
    ...changes,
  });
  const body = JSON.stringify({
    model: gatewayModel,
    instructions: "synthetic",
    input: [{ role: "user", content: "synthetic turn" }],
    store: false,
    stream: true,
  });
  async function respond(gateway, deliveryId) {
    let text = "";
    for await (const chunk of await gateway.respond(
      deliveryId,
      gateway.capability,
      body,
    ))
      text += Buffer.from(chunk).toString();
    return text;
  }
  return { f, owner, accountId, reads, tokens, factory, turn, respond };
}

test("the CLI's general sessions open a real gateway on the registered host, reading the vault only at a model request", async (t) => {
  const s = credentialedSessions(t);
  const turn = s.turn();
  let asked = 0;
  const gateway = s.factory(turn, async () => {
    asked++;
    return "permitted";
  });
  assert.ok(gateway instanceof GeneralSessionGateway);
  assert.deepEqual(s.reads, [], "no credential is read to open the session");
  assert.match(await s.respond(gateway, turn.deliveryId), /completed/);
  assert.deepEqual(s.reads, [s.accountId]);
  assert.deepEqual(s.tokens, [s.owner.accessToken]);
  assert.equal(asked, 1);
  assert.equal(gateway.observation.completed, 1);
});

test("the CLI's general sessions refuse another account, an unusable vault account and a missing registration", async (t) => {
  const s = credentialedSessions(t);
  assert.throws(
    () =>
      s.factory(s.turn({ accountId: "c".repeat(64) }), async () => "permitted"),
    /another account/,
  );
  assert.deepEqual(s.reads, []);
  // Fresh authority still gates the provider.
  const lapsed = s.turn(),
    gateway = s.factory(lapsed, async () => "exhausted");
  await assert.rejects(s.respond(gateway, lapsed.deliveryId));
  assert.equal(gateway.observation.revokedFor, "exhausted");
  assert.deepEqual(s.tokens, []);
  // An expired vault account never reaches the provider.
  const expired = credentialedSessions(t, { expiresAt: Date.now() - 1 });
  const stale = expired.turn(),
    refused = expired.factory(stale, async () => "permitted");
  await assert.rejects(expired.respond(refused, stale.deliveryId));
  assert.equal(refused.observation.revokedFor, "account");
  assert.deepEqual(expired.tokens, []);
  assert.throws(() => credentialedGeneralSessions(s.f.repo, s.accountId));
});
