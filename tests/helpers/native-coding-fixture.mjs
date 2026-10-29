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
export const realSpawn = childProcess.spawn;
export const realReadFileSync = fs.readFileSync;
export const realWriteFileSync = fs.writeFileSync;
export const realRenameSync = fs.renameSync;
export const realMkdtempSync = fs.mkdtempSync;
export const realRmSync = fs.rmSync;
export const realMkdirSync = fs.mkdirSync;
export const guestHarness = new URL(
  "./native-coding-guest.py",
  import.meta.url,
);

/** The long-lived management channel's argv (the session relay). */
export const channelArgv = [
  "machine",
  "ssh",
  "aios-test",
  "/usr/bin/python3",
  "-I",
  "-u",
  "-c",
  "'import sys,base64;exec(base64.b64decode(sys.stdin.readline()))'",
];

// External host/process seam only: no real VM, engine or credentials are used.
// `channel` answers a channel spawn; without one, a channel is refused.
export function nativeHost(t, respond, platform = "darwin", channel) {
  const requests = [],
    programs = [];
  const processEffects = { kills: 0 };
  // Fields a test adds to, or changes in, the machine's Podman configuration.
  const machineConfig = {};
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
          ...machineConfig,
        })
      : Buffer.from("trusted-host-executable"),
  );
  t.mock.method(childProcess, "spawnSync", () => ({
    status: 0,
    stdout: JSON.stringify({ Client: { Version: "6.1.1" } }),
  }));
  t.mock.method(childProcess, "spawn", (file, argv, options) => {
    assert.equal(options.shell, false);
    assert.equal(options.env.OPENAI_API_KEY, undefined);
    if (JSON.stringify(argv) === JSON.stringify(channelArgv)) {
      assert.ok(channel, "unexpected management channel");
      return channel(options);
    }
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
  return { requests, programs, processEffects, machineConfig };
}
/** A session gateway that records every call and streams `chunks`. */
export function sessionGateway(chunks = [Buffer.from("data: done\n\n")]) {
  const gateway = {
    capability: "e".repeat(64),
    calls: [],
    revoked: [],
    async respond(...args) {
      gateway.calls.push(args);
      return (async function* () {
        yield* chunks;
      })();
    },
    revoke(reason) {
      gateway.revoked.push(reason);
    },
  };
  return gateway;
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
    allowanceMs: 60000,
    mayDispatch: () => true,
    checkpoint: () => true,
    onEvent: () => true,
    ...overrides,
  };
}

export function guestFixture(t, engine = {}, restoredRoot = undefined) {
  const root =
    restoredRoot ??
    realMkdtempSync(`${realTemporaryDirectory}/aios-native-coding-`);
  const statePath = `${root}/engine.json`;
  // A relay left by a failed test must not hold the fixed port for the next.
  t.after(async () => {
    let pids = [];
    try {
      pids = JSON.parse(realReadFileSync(statePath, "utf8")).relayPids ?? [];
    } catch {}
    for (const pid of pids)
      try {
        process.kill(-pid, "SIGKILL");
      } catch {}
    for (let i = 0; i < 100 && pids.some(running); i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    realRmSync(root, { recursive: true, force: true });
  });
  // A restored root already holds its simulated engine state.
  if (!restoredRoot)
    realWriteFileSync(
      statePath,
      JSON.stringify({
        commands: [],
        container: null,
        alive: false,
        ...engine,
      }),
    );
  let lastProgram;
  // The channel runs the same simulator, kept open for the relay's frames.
  const channel = (options) => {
    const child = realSpawn(
      process.env.AIOS_TEST_PYTHON || "python3",
      ["-I", "-S", guestHarness.pathname, root, "--channel"],
      { stdio: ["pipe", "pipe", "pipe"], env: options.env },
    );
    // The first line is the program; record its request like any other.
    const write = child.stdin.write.bind(child.stdin);
    let first = true;
    child.stdin.write = (line, ...rest) => {
      if (first) {
        first = false;
        const source = Buffer.from(String(line), "base64").toString();
        requests.push(
          JSON.parse(
            Buffer.from(
              source.match(/b64decode\('([^']+)'\)/)[1],
              "base64",
            ).toString(),
          ),
        );
      }
      return write(line, ...rest);
    };
    return child;
  };
  const fixture = nativeHost(
    t,
    (_request, program) => {
      lastProgram = program;
      const result = realSpawnSync(
        process.env.AIOS_TEST_PYTHON || "python3",
        // The guest runs `python3 -I`; -S also skips the site module, which the
        // stdlib-only program never needs, to save start-up time per request.
        ["-I", "-S", guestHarness.pathname, root],
        { input: program, encoding: "utf8" },
      );
      return result.status === 0
        ? JSON.parse(result.stdout)
        : { processFailure: true };
    },
    "darwin",
    (options) => channel(options),
  );
  const requests = fixture.requests;
  return {
    root,
    requests,
    machineConfig: fixture.machineConfig,
    transport: new NativePodmanCodingTransport("aios-test", "a".repeat(64)),
    /** The last management program sent to the guest, as transported. */
    program: () => lastProgram,
    read: () => JSON.parse(realReadFileSync(statePath, "utf8")),
    // Rename a whole copy into place: a guest may load the file mid-write.
    write: (state) => {
      realWriteFileSync(`${statePath}.${process.pid}`, JSON.stringify(state));
      realRenameSync(`${statePath}.${process.pid}`, statePath);
    },
  };
}
function running(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
export const posixGuest = {
  skip:
    process.platform === "win32"
      ? "Linux guest simulator requires a POSIX filesystem"
      : false,
};

// Tests within one file run serially, so a single fixed root can be reused.
// The standard first launch runs once per engine configuration; each later
// caller receives a byte-for-byte copy of that stopped predecessor state at the
// same absolute path. `cp -a` preserves the 0700/0600 modes the management
// program verifies. This changes setup cost only, never what a test asserts.
let launchedBase;
const launchedTemplates = new Map();
function copyTree(from, to) {
  const copied = realSpawnSync("cp", ["-a", from, to], { encoding: "utf8" });
  if (copied.status !== 0) throw Error("Unable to copy launched guest fixture");
}
export async function launchedGuest(t, engine = {}) {
  if (!launchedBase) {
    launchedBase = realMkdtempSync(
      `${realTemporaryDirectory}/aios-native-launched-`,
    );
    const base = launchedBase;
    process.once("exit", () =>
      realRmSync(base, { recursive: true, force: true }),
    );
  }
  const key = JSON.stringify(engine);
  const root = `${launchedBase}/guest`;
  realRmSync(root, { recursive: true, force: true });
  const template = launchedTemplates.get(key);
  if (template) {
    copyTree(template, root);
    return guestFixture(t, engine, root);
  }
  realMkdirSync(root, { mode: 0o700 });
  realWriteFileSync(
    `${root}/engine.json`,
    JSON.stringify({ commands: [], container: null, alive: false, ...engine }),
  );
  const fixture = guestFixture(t, engine, root);
  await fixture.transport.run(
    await launchRequest(fixture.transport, { allowanceMs: 60000 }),
    () => {},
  );
  const saved = `${launchedBase}/template-${launchedTemplates.size}`;
  copyTree(root, saved);
  launchedTemplates.set(key, saved);
  return fixture;
}
