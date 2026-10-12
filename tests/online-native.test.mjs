import assert from "node:assert/strict";
import { test } from "node:test";
import os from "node:os";
import fs from "node:fs";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { syncBuiltinESMExports } from "node:module";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { NativeOnlineAccess } from "../dist/online-native.js";
import { onlinePolicyVersion } from "../dist/online-access.js";

const hash = (value) => createHash("sha256").update(value).digest("hex");

test("native online access refuses a dispatched request when owner authorization is denied", async (t) => {
  const root = mkdtempSync(`${tmpdir()}/aios-online-native-`);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const policyPath = `${root}/pins.json`;
  const policy = JSON.stringify({ schema: 1, binding: {} });
  writeFileSync(policyPath, policy, { mode: 0o600 });

  const binding = {
    platform: "darwin",
    arch: "arm64",
    osVersion: "27.2.0",
    provider: "applehv",
    machine: "aios-test",
    hostId: "a".repeat(64),
    engineVersion: "6.1.1",
    vmImageSha256: "b".repeat(64),
    template: "example.invalid/worker@sha256:" + "c".repeat(64),
    workerVersion: "0.161.0",
    policyVersion: "synthetic-policy-v1",
  };
  const keys = [
    "platform",
    "arch",
    "osVersion",
    "provider",
    "machine",
    "hostId",
    "engineVersion",
    "vmImageSha256",
    "template",
    "workerVersion",
    "policyVersion",
  ];
  const native = {
    machine: "aios-test",
    authorityDirectory: `${root}/authority`,
    policyPath,
    observe: () => ({ binding }),
  };
  const access = new NativeOnlineAccess(native);
  const runId = "00000000-0000-4000-8000-000000000021";
  const plan = {
    runId,
    repository: `${root}/repo`,
    policyVersion: onlinePolicyVersion,
    runtimeVersion: access.version,
    hostPolicySha256: hash(policy),
    bindingSha256: hash(JSON.stringify(keys.map((key) => [key, binding[key]]))),
  };
  const originalReadFile = fs.readFileSync;
  let hostPlatform = "darwin";
  let hostArch = "arm64";
  let config = JSON.stringify({
    Name: "aios-test",
    Version: 1,
    Mounts: [],
    HostUser: { Rootful: false },
    AppleHypervisor: { Vfkit: { Rosetta: false, BinaryPath: null } },
    Rosetta: false,
    ImportNativeCA: false,
    Ansible: null,
    Resources: { USBs: [] },
  });
  t.mock.method(os, "platform", () => hostPlatform);
  t.mock.method(os, "arch", () => hostArch);
  t.mock.method(os, "release", () => "27.2.0");
  t.mock.method(os, "homedir", () => "/virtual-home");
  t.mock.method(fs, "lstatSync", () => ({
    isFile: () => true,
    isDirectory: () => true,
    isSymbolicLink: () => false,
    nlink: 1,
    size: 128,
  }));
  t.mock.method(fs, "existsSync", () => true);
  t.mock.method(fs, "realpathSync", (path) => resolve(path));
  t.mock.method(fs, "readFileSync", (path, ...args) => {
    if (String(path).endsWith("aios-test.json")) return config;
    if (String(path) === policyPath) return originalReadFile(path, ...args);
    return originalReadFile(path, ...args);
  });

  let dispatched;
  let approveWorkerRequest = false;
  let childScenario = "accept";
  const dispatches = [];
  t.mock.method(childProcess, "spawn", () => {
    const child = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = () => setImmediate(() => child.emit("close", 1));
    let writes = 0;
    child.stdin.write = (chunk) => {
      if (writes === 0 && !String(chunk).startsWith("{")) {
        assert.match(
          Buffer.from(String(chunk).trim(), "base64").toString(),
          /import sys/,
        );
        return true;
      }
      writes++;
      const value = JSON.parse(String(chunk));
      if (writes === 1) {
        dispatched = value;
        dispatches.push(value);
        setImmediate(() => {
          if (childScenario === "malformed")
            child.stdout.emit("data", Buffer.from("not-json\n"));
          else if (childScenario === "oversized")
            child.stdout.emit("data", Buffer.alloc(65537, "x"));
          else if (childScenario === "duplicate")
            child.stdout.emit(
              "data",
              Buffer.from(
                `${JSON.stringify({ runId, model: "first" })}\n${JSON.stringify({ runId, model: "second" })}\n`,
              ),
            );
          else
            child.stdout.emit(
              "data",
              Buffer.from(JSON.stringify({ authorize: true, runId }) + "\n"),
            );
        });
      } else {
        assert.deepEqual(value, { allowed: approveWorkerRequest });
        if (!approveWorkerRequest) setImmediate(() => child.emit("close", 1));
        else
          setImmediate(() => {
            child.stdout.emit(
              "data",
              Buffer.from(JSON.stringify({ runId, model: "passed" }) + "\n"),
            );
            child.emit("close", 0);
          });
      }
      return true;
    };
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });

  assert.equal(plan.runtimeVersion, access.version);
  assert.equal(plan.policyVersion, onlinePolicyVersion);
  assert.equal(plan.hostPolicySha256, hash(fs.readFileSync(policyPath)));
  assert.equal(
    plan.bindingSha256,
    hash(JSON.stringify(keys.map((key) => [key, binding[key]]))),
  );

  let authorizationChecks = 0;
  await assert.rejects(
    () =>
      access.execute(plan, async () => {
        authorizationChecks++;
        return authorizationChecks === 1;
      }),
    /Synthetic online operation unavailable/,
  );
  assert.equal(authorizationChecks, 2);
  assert.equal(dispatched.action, "execute");
  assert.equal(dispatched.runId, runId);
  assert.equal(dispatched.authority, hash(native.authorityDirectory));
  assert.equal(dispatched.accessToken, undefined);
  assert.equal(dispatched.credentials, undefined);
  assert.equal(dispatched.inference, undefined);

  assert.throws(() => access.stop("invalid"), /Invalid online run/);
  await assert.rejects(
    access.execute(plan, async () => false),
    /Changed online admission/,
  );

  approveWorkerRequest = true;
  const qualifiedAccess = new NativeOnlineAccess(native, "before-create");
  const proof = await qualifiedAccess.execute(plan, async () => true, {
    bytes: Buffer.from("synthetic dependency"),
    sha256: "d".repeat(64),
  });
  assert.equal(proof.model, "passed");
  assert.equal(dispatches.length, 2);
  assert.deepEqual(dispatches[1].dependencyArtifact, {
    bytes: Buffer.from("synthetic dependency").toString("base64"),
    sha256: "d".repeat(64),
  });
  assert.equal(dispatches[1].fault, "before-create");

  for (const scenario of ["malformed", "oversized", "duplicate"]) {
    childScenario = scenario;
    await assert.rejects(
      qualifiedAccess.execute(plan, async () => true),
      /Synthetic online operation unavailable/,
      scenario,
    );
  }

  hostPlatform = "win32";
  hostArch = "x64";
  config = JSON.stringify({
    Name: "aios-test",
    Version: 1,
    Mounts: [],
    HostUser: { Rootful: false },
    HyperVHypervisor: {},
    Rosetta: false,
    ImportNativeCA: false,
    Ansible: null,
    Resources: { USBs: [] },
  });
  childScenario = "accept";
  const windowsProof = await access.execute(plan, async () => true);
  assert.equal(windowsProof.model, "passed");
});
