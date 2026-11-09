import "./helpers/owner-host-stand-in.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  anthropicAccount,
  anthropicAccountId,
  anthropicAccountRecord,
  anthropicKeyFingerprint,
  decodeAnthropicAccount,
  encodeAnthropicAccount,
  readAnthropicKey,
  storeAnthropicKey,
  validAnthropicApiKey,
  verifyAnthropicKey,
} from "../dist/anthropic-key.js";

const hostId = "urn:uuid:01234567-89ab-cdef-0123-456789abcdef";
// Fresh synthetic keys each run, so the source carries no key-shaped value.
const synthetic = (tier = "api03") =>
  `sk-ant-${tier}-` + randomBytes(24).toString("base64url");
const key = synthetic(),
  other = synthetic();
const organizationId = "org-synthetic-1234";

function directory(t, registration = true) {
  const d = realpathSync(mkdtempSync(join(tmpdir(), "aios-anthropic-")));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  if (registration)
    writeFileSync(
      join(d, "registration.json"),
      JSON.stringify({ schema: 1, hostId, agentName: "Developer OS" }),
      { mode: 0o600 },
    );
  return d;
}
function fakeVault() {
  const entries = new Map(),
    writes = [];
  return {
    entries,
    writes,
    write(id, value, replace = false) {
      writes.push({ id, replace });
      if (entries.has(id) !== replace) throw Error("keychain refused");
      entries.set(id, value);
    },
    read(id) {
      if (!entries.has(id)) throw Error("missing");
      return entries.get(id);
    },
  };
}
function fakeFetch({ status = 200, org = organizationId, fail } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    if (fail) throw Error("offline " + init.headers["x-api-key"]);
    return {
      status,
      headers: {
        get: (name) => (name === "anthropic-organization-id" ? org : null),
      },
    };
  };
  impl.calls = calls;
  return impl;
}

test("a verified key goes only to the vault; the record names its account and holds no key", async (t) => {
  const d = directory(t),
    vault = fakeVault(),
    fetch = fakeFetch();
  const stored = await storeAnthropicKey({
    directory: d,
    apiKey: `  ${key}\n`,
    vault: () => vault,
    fetch,
  });
  const identity = {
    hostId,
    organizationId,
    keyFingerprint: anthropicKeyFingerprint(key),
  };
  assert.deepEqual(stored, {
    status: "stored",
    accountId: anthropicAccountId(identity),
    organizationId,
    keyFingerprint: identity.keyFingerprint,
    deliveryEnabled: false,
  });
  assert.equal(fetch.calls.length, 1);
  assert.equal(
    fetch.calls[0].url,
    "https://api.anthropic.com/v1/models?limit=1",
  );
  assert.equal(fetch.calls[0].init.redirect, "error");
  assert.equal(fetch.calls[0].init.headers["x-api-key"], key);
  assert.equal(fetch.calls[0].init.headers["anthropic-version"], "2023-06-01");
  const record = readFileSync(join(d, anthropicAccountRecord), "utf8");
  assert.equal(record.includes(key), false);
  assert.deepEqual(anthropicAccount(d), {
    schema: 1,
    accountId: stored.accountId,
    provider: "anthropic",
    ...identity,
  });
  assert.deepEqual(vault.writes, [{ id: stored.accountId, replace: false }]);
  assert.equal(readAnthropicKey(vault, anthropicAccount(d)).apiKey, key);
  assert.deepEqual(readdirSync(d).sort(), [
    anthropicAccountRecord,
    "registration.json",
  ]);
});

test("malformed and admin keys are refused before any request or write", async (t) => {
  for (const bad of [
    "",
    "not-a-key",
    synthetic("admin01"),
    synthetic("oat01"),
    synthetic("usrx"),
    "sk-ant-api03-short",
    "sk-ant-usr-short",
    key + " trailing",
  ]) {
    const d = directory(t),
      vault = fakeVault(),
      fetch = fakeFetch();
    await assert.rejects(
      storeAnthropicKey({
        directory: d,
        apiKey: bad,
        vault: () => vault,
        fetch,
      }),
      /not an Anthropic API key/,
    );
    assert.equal(fetch.calls.length, 0);
    assert.equal(vault.writes.length, 0);
    assert.equal(existsSync(join(d, anthropicAccountRecord)), false);
  }
  // Organization, Console personal and service account keys.
  for (const tier of ["api03", "usr", "usr01", "svc", "svc01"])
    assert.equal(validAnthropicApiKey(synthetic(tier)), true, tier);
});

test("a key Anthropic refuses, or an answer without an organization, stores nothing and never echoes the key", async (t) => {
  for (const [options, message] of [
    [{ status: 401 }, /refused the key/],
    [{ status: 403 }, /refused the key/],
    [{ status: 500 }, /HTTP 500/],
    [{ fail: true }, /could not be reached/],
    [{ org: null }, /named no organization/],
    [{ org: "bad org!" }, /named no organization/],
  ]) {
    const d = directory(t),
      vault = fakeVault();
    const error = await storeAnthropicKey({
      directory: d,
      apiKey: key,
      vault: () => vault,
      fetch: fakeFetch(options),
    }).catch((e) => e);
    assert.match(error.message, message);
    assert.equal(error.message.includes(key), false);
    assert.equal(vault.writes.length, 0);
    assert.equal(existsSync(join(d, anthropicAccountRecord)), false);
  }
});

test("a stored key is replaced only on request", async (t) => {
  const d = directory(t),
    vault = fakeVault();
  const first = await storeAnthropicKey({
    directory: d,
    apiKey: key,
    vault: () => vault,
    fetch: fakeFetch(),
  });
  const again = fakeFetch();
  await assert.rejects(
    storeAnthropicKey({
      directory: d,
      apiKey: other,
      vault: () => vault,
      fetch: again,
    }),
    /already stored/,
  );
  assert.equal(again.calls.length, 0);
  // The same key again rewrites its own vault entry.
  await storeAnthropicKey({
    directory: d,
    apiKey: key,
    vault: () => vault,
    fetch: fakeFetch(),
    replace: true,
  });
  assert.deepEqual(vault.writes.at(-1), { id: first.accountId, replace: true });
  // Another key gets its own account, and the record now names it.
  const second = await storeAnthropicKey({
    directory: d,
    apiKey: other,
    vault: () => vault,
    fetch: fakeFetch(),
    replace: true,
  });
  assert.notEqual(second.accountId, first.accountId);
  assert.equal(anthropicAccount(d).accountId, second.accountId);
  assert.equal(readAnthropicKey(vault, anthropicAccount(d)).apiKey, other);
});

test("without a host registration, or when the Keychain write fails, nothing is recorded", async (t) => {
  const missing = directory(t, false),
    fetch = fakeFetch();
  await assert.rejects(
    storeAnthropicKey({
      directory: missing,
      apiKey: key,
      vault: () => fakeVault(),
      fetch,
    }),
    /prepare-auth/,
  );
  assert.equal(fetch.calls.length, 0);
  const d = directory(t);
  await assert.rejects(
    storeAnthropicKey({
      directory: d,
      apiKey: key,
      vault: () => ({
        write() {
          throw Error("denied");
        },
      }),
      fetch: fakeFetch(),
    }),
    /Keychain/,
  );
  assert.equal(existsSync(join(d, anthropicAccountRecord)), false);
});

test("a vault entry decodes only as exactly the named account", () => {
  const identity = {
    provider: "anthropic",
    hostId,
    organizationId,
    keyFingerprint: anthropicKeyFingerprint(key),
  };
  const id = anthropicAccountId(identity),
    good = encodeAnthropicAccount({ ...identity, apiKey: key });
  assert.equal(decodeAnthropicAccount(good, id, hostId).apiKey, key);
  const encode = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
  for (const [encoded, accountId, host] of [
    [good, "f".repeat(64), hostId],
    [good, id, "urn:uuid:ffffffff-89ab-cdef-0123-456789abcdef"],
    [encode({ ...identity, apiKey: other }), id, hostId],
    [encode({ ...identity, apiKey: key, extra: 1 }), id, hostId],
    [encode({ ...identity, provider: "openai", apiKey: key }), id, hostId],
    ["not base64!", id, hostId],
    [encode("x".repeat(9000)), id, hostId],
  ])
    assert.equal(decodeAnthropicAccount(encoded, accountId, host), undefined);
  assert.throws(
    () =>
      readAnthropicKey(
        { read: () => good },
        { accountId: "f".repeat(64), hostId },
      ),
    /unavailable/,
  );
  assert.throws(
    () =>
      readAnthropicKey(
        {
          read() {
            throw Error("locked");
          },
        },
        { accountId: id, hostId },
      ),
    /unavailable/,
  );
});

test("the account record is refused when tampered with or bound to another host", async (t) => {
  const d = directory(t);
  assert.equal(anthropicAccount(d), undefined);
  await storeAnthropicKey({
    directory: d,
    apiKey: key,
    vault: () => fakeVault(),
    fetch: fakeFetch(),
  });
  const file = join(d, anthropicAccountRecord),
    record = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(
    file,
    JSON.stringify({ ...record, organizationId: "org-other-0000" }),
    {
      mode: 0o600,
    },
  );
  assert.throws(() => anthropicAccount(d), /record is invalid/);
  writeFileSync(file, JSON.stringify(record), { mode: 0o600 });
  writeFileSync(
    join(d, "registration.json"),
    JSON.stringify({
      schema: 1,
      hostId: "urn:uuid:ffffffff-89ab-cdef-0123-456789abcdef",
      agentName: "Developer OS",
    }),
    { mode: 0o600 },
  );
  assert.throws(() => anthropicAccount(d), /another host registration/);
});

test("verification refuses a malformed key without a request", async () => {
  const fetch = fakeFetch();
  await assert.rejects(
    verifyAnthropicKey("nope", fetch),
    /not an Anthropic API key/,
  );
  assert.equal(fetch.calls.length, 0);
});

const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const run = (args, input) =>
  spawnSync(process.execPath, [cli, ...args], { input, encoding: "utf8" });

test("the CLI reads the key from standard input and refuses before any network or Keychain use", (t) => {
  const d = directory(t);
  const bad = run(
    ["store-anthropic-key", "--auth-directory", d],
    "not-a-key\n",
  );
  assert.equal(bad.status, 1);
  assert.match(bad.stderr + bad.stdout, /not an Anthropic API key/);
  const missing = directory(t, false);
  const none = run(["store-anthropic-key", "--auth-directory", missing], key);
  assert.equal(none.status, 1);
  assert.match(none.stderr + none.stdout, /prepare-auth/);
  assert.equal((none.stderr + none.stdout).includes(key), false);
  const empty = run(["store-anthropic-key", "--auth-directory", d], "");
  assert.equal(empty.status, 1);
  for (const args of [
    ["store-anthropic-key"],
    ["store-anthropic-key", "--auth-directory", d, "--repo", d],
  ]) {
    const refused = run(args, key);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr + refused.stdout, /store-anthropic-key/);
  }
  assert.deepEqual(readdirSync(d), ["registration.json"]);
});

test("a vault entry that is base64 but not JSON is refused", () => {
  for (const text of ["not json", "{", "\u0000"])
    assert.equal(
      decodeAnthropicAccount(
        Buffer.from(text, "utf8").toString("base64"),
        "a".repeat(64),
        "b".repeat(64),
      ),
      undefined,
      text,
    );
});
