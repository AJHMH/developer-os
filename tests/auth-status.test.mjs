import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspectSubscriptionAuth } from "../dist/auth-status.js";

const account = {
  issuer: "https://auth.openai.com",
  clientId: "oaiapp_fixture",
  subject: "synthetic-owner",
  hostId: "urn:uuid:fixture",
  scopes: ["resource.invoke", "chatgpt.tokens.use.direct"],
  planUsageAuthorized: true,
  expiresAt: 100001,
  accessToken: "synthetic-secret",
  refreshToken: "synthetic-refresh",
  idToken: "synthetic-identity",
};
const id = createHash("sha256")
  .update(
    JSON.stringify([
      account.issuer,
      account.clientId,
      account.subject,
      account.hostId,
    ]),
  )
  .digest("hex");
const inspect = (value, selected = id) =>
  inspectSubscriptionAuth("/auth", "/repo", "/state", selected, {
    platform: "win32",
    arch: "x64",
    now: () => 70000,
    registration: () => ({ hostId: account.hostId }),
    readAccount: () => Buffer.from(JSON.stringify(value)).toString("base64"),
  });
test("host auth status returns only eligibility metadata without granting inference", () => {
  const result = inspect(account);
  assert.equal(result.status, "eligible");
  assert.equal(result.validForInferenceWindow, true);
  assert.equal(result.inferenceAuthorized, false);
  assert.equal(result.productionEnabled, false);
  assert.doesNotMatch(
    JSON.stringify(result),
    /synthetic-secret|synthetic-refresh|synthetic-identity|synthetic-owner|oaiapp_fixture/,
  );
});
test("expiry, short remaining lifetime and missing scope require separate sign-in", () => {
  for (const value of [
    { ...account, expiresAt: 70000 },
    { ...account, expiresAt: 100000 },
    { ...account, scopes: ["resource.invoke"] },
    { ...account, planUsageAuthorized: false },
  ]) {
    const result = inspect(value);
    assert.equal(result.status, "sign-in-required");
    assert.equal(result.inferenceAuthorized, false);
  }
});
test("malformed or mismatched protected accounts expose no secret diagnostics", () => {
  for (const value of [
    { ...account, subject: "another-owner" },
    { ...account, hostId: "another-host" },
    { ...account, expiresAt: "100001" },
    { ...account, scopes: null },
    { ...account, accessToken: "" },
    null,
  ]) {
    assert.deepEqual(inspect(value), {
      status: "unavailable",
      reason: "storage-or-account",
      validForInferenceWindow: false,
      inferenceAuthorized: false,
      productionEnabled: false,
    });
  }
});
test("malformed selection and unsupported hosts refuse before opening protected storage", () => {
  let reads = 0;
  const adapters = {
    platform: "win32",
    arch: "x64",
    now: () => 70000,
    registration: () => {
      reads++;
      throw Error("synthetic-private");
    },
    readAccount: () => {
      reads++;
      throw Error("synthetic-private");
    },
  };
  assert.equal(
    inspectSubscriptionAuth("/auth", "/repo", "/state", "invalid", adapters)
      .status,
    "unavailable",
  );
  assert.equal(
    inspectSubscriptionAuth("/auth", "/repo", "/state", id, {
      ...adapters,
      platform: "linux",
    }).status,
    "unavailable",
  );
  assert.equal(reads, 0);
});
test("public auth-status refuses missing registration without creating storage or opening authorization", (t) => {
  const root = mkdtempSync(join(tmpdir(), "auth-status-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "repo"),
    state = join(root, "state"),
    directory = join(root, "missing-auth");
  mkdirSync(repository);
  mkdirSync(state);
  const result = spawnSync(
    process.execPath,
    [
      resolve("dist/cli.js"),
      "auth-status",
      "--repo",
      repository,
      "--state-dir",
      state,
      "--auth-directory",
      directory,
      "--auth-account",
      id,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).status, "unavailable");
  assert.equal(existsSync(directory), false);
  assert.doesNotMatch(
    result.stdout,
    /authorizationUrl|synthetic-secret|synthetic-refresh/,
  );
});
import { macKeychainStore } from "../dist/keychain-store.js";
import fs from "node:fs";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";

test("read-only macOS account storage refuses missing deployment without writing or compiling", (t) => {
  const descriptors = Object.fromEntries(
    ["platform", "arch", "geteuid"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(process, key),
    ]),
  );
  Object.defineProperty(process, "platform", {
    value: "darwin",
    configurable: true,
  });
  Object.defineProperty(process, "arch", {
    value: "arm64",
    configurable: true,
  });
  Object.defineProperty(process, "geteuid", {
    value: () => 501,
    configurable: true,
  });
  t.mock.method(fs, "lstatSync", () => ({
    isSymbolicLink: () => false,
    isDirectory: () => true,
    uid: 501,
    mode: 0o700,
  }));
  t.mock.method(fs, "existsSync", () => false);
  let commands = [];
  t.mock.method(childProcess, "spawnSync", (path) => {
    commands.push(path);
    assert.equal(path, "/bin/ls");
    return { status: 0, stdout: "drwx------ 1 owner staff 0 auth\n" };
  });
  for (const name of [
    "mkdtempSync",
    "writeFileSync",
    "linkSync",
    "chmodSync",
    "rmSync",
  ])
    t.mock.method(fs, name, () =>
      assert.fail("read-only inspection attempted a write"),
    );
  syncBuiltinESMExports();
  t.after(() => {
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(process, key, descriptor);
      else delete process[key];
    }
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  assert.throws(
    () => macKeychainStore("/auth", true),
    /unavailable or changed/,
  );
  assert.deepEqual(commands, ["/bin/ls"]);
});
