// Shared external host/process fixtures for native coding transport tests.
// No real VM, engine or credentials are used.
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { resolve } from "node:path";
import { NativePodmanCodingTransport } from "../../dist/podman-coding.js";

export const realTemporaryDirectory = fs.realpathSync(os.tmpdir());
export const realSpawnSync = childProcess.spawnSync;
export const realReadFileSync = fs.readFileSync;
export const realWriteFileSync = fs.writeFileSync;
export const realMkdtempSync = fs.mkdtempSync;
export const realRmSync = fs.rmSync;
export const realMkdirSync = fs.mkdirSync;
export const guestHarness = new URL(
  "./native-coding-guest.py",
  import.meta.url,
);

// External host/process seam only: no real VM, engine or credentials are used.
export function nativeHost(t, respond, platform = "darwin") {
  const requests = [],
    programs = [];
  const processEffects = { kills: 0 };
  t.mock.method(os, "platform", () => platform);
  t.mock.method(os, "arch", () => (platform === "darwin" ? "arm64" : "x64"));
  t.mock.method(os, "release", () =>
    platform === "darwin" ? "27.2.0" : "10.0.26100",
  );
  t.mock.method(os, "homedir", () => "/virtual-home");
  t.mock.method(fs, "lstatSync", () => ({
    isFile: () => true,
    isSymbolicLink: () => false,
    nlink: 1,
    size: 100,
  }));
  t.mock.method(fs, "realpathSync", (path) => resolve(path));
  t.mock.method(fs, "existsSync", () => true);
  t.mock.method(fs, "readFileSync", (path) =>
    String(path).endsWith("aios-test.json")
      ? JSON.stringify({
          Name: "aios-test",
          Version: 1,
          Mounts: [],
          HostUser: { Rootful: false },
          HyperVHypervisor: {},
          AppleHypervisor: { Vfkit: { Rosetta: false, BinaryPath: null } },
          Rosetta: false,
          ImportNativeCA: false,
          Ansible: null,
          Resources: { USBs: [] },
        })
      : Buffer.from("trusted-host-executable"),
  );
  t.mock.method(childProcess, "spawnSync", () => ({
    status: 0,
    stdout: JSON.stringify({ Client: { Version: "6.1.1" } }),
  }));
  t.mock.method(childProcess, "spawn", (file, argv, options) => {
    assert.deepEqual(argv, [
      "machine",
      "ssh",
      "aios-test",
      "/usr/bin/python3",
      "-I",
    ]);
    assert.equal(options.shell, false);
    assert.equal(options.env.OPENAI_API_KEY, undefined);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {
      processEffects.kills++;
    };
    child.stdin = new Writable({
      write(bytes, _encoding, done) {
        const source = bytes.toString();
        programs.push(source);
        const request = JSON.parse(
          Buffer.from(
            source.match(/b64decode\('([^']+)'\)/)[1],
            "base64",
          ).toString(),
        );
        requests.push(request);
        queueMicrotask(() => {
          try {
            const response = respond(request, source);
            if (response.hang) return;
            child.stderr.emit(
              "data",
              Buffer.from("synthetic guest diagnostic"),
            );
            child.stdout.emit(
              "data",
              Buffer.from(response.rawOutput ?? JSON.stringify(response)),
            );
            child.emit("close", response.processFailure ? 1 : 0);
          } catch (error) {
            child.emit("error", error);
            child.emit("close", 1);
          }
        });
        done();
      },
    });
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return { requests, programs, processEffects };
}
export const session = {
  operationId: "12345678-1234-4234-8234-123456789abc",
  fence: 1,
  state: "running",
  intent: "start",
};
export const observation = {
  engineVersion: "6.1.1",
  vmImageSha256: "1".repeat(64),
  template: "pinned",
  hostId: "2".repeat(64),
};

export async function launchRequest(transport, overrides = {}) {
  return {
    ...session,
    argv: [
      "exec",
      "--json",
      "--skip-git-repo-check",
      "--sandbox",
      "workspace-write",
      "Change the title",
    ],
    branch: "codex/example",
    sourceRevision: "b".repeat(40),
    inputSha256:
      "79e66062117b48d4c618d93d2fba5fbb22250bbf83df8aaa67ed60cc7022a4b4",
    files: [
      { path: "index.html", bytes: Buffer.from("before\n"), executable: false },
    ],
    pins: await transport.inspect(session),
    allowanceMs: 1000,
    mayDispatch: () => true,
    checkpoint: () => true,
    onEvent: () => true,
    ...overrides,
  };
}

export function guestFixture(t, engine = {}) {
  const root = realMkdtempSync(`${realTemporaryDirectory}/aios-native-coding-`);
  t.after(() => realRmSync(root, { recursive: true, force: true }));
  const statePath = `${root}/engine.json`;
  realWriteFileSync(
    statePath,
    JSON.stringify({ commands: [], container: null, alive: false, ...engine }),
  );
  const fixture = nativeHost(t, (_request, program) => {
    const result = realSpawnSync(
      process.env.AIOS_TEST_PYTHON || "python3",
      [guestHarness.pathname, root],
      { input: program, encoding: "utf8" },
    );
    return result.status === 0
      ? JSON.parse(result.stdout)
      : { processFailure: true };
  });
  return {
    root,
    requests: fixture.requests,
    transport: new NativePodmanCodingTransport("aios-test", "a".repeat(64)),
    read: () => JSON.parse(realReadFileSync(statePath, "utf8")),
    write: (state) => realWriteFileSync(statePath, JSON.stringify(state)),
  };
}
export const posixGuest = {
  skip:
    process.platform === "win32"
      ? "Linux guest simulator requires a POSIX filesystem"
      : false,
};
