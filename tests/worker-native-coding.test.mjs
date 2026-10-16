import assert from "node:assert/strict";
import { test } from "node:test";
import { NativePodmanCodingTransport } from "../dist/podman-coding.js";
import { PinnedCodingRuntime } from "../dist/feature-candidate.js";

const realTemporaryDirectory = fs.realpathSync(os.tmpdir());
const realSpawnSync = childProcess.spawnSync;
const realReadFileSync = fs.readFileSync;
const realWriteFileSync = fs.writeFileSync;
const realMkdtempSync = fs.mkdtempSync;
const realRmSync = fs.rmSync;
const guestHarness = new URL(
  "./helpers/native-coding-guest.py",
  import.meta.url,
);

test("native coding transport stays outside controlled production admission", async () => {
  const transport = new NativePodmanCodingTransport(
    "aios-test",
    "a".repeat(64),
  );
  assert.equal(transport.mode, "live");
  assert.equal(transport.productionEnabled, false);
  assert.throws(() => {
    transport.mode = "controlled";
  }, TypeError);
  assert.throws(
    () =>
      new PinnedCodingRuntime(
        {
          cliVersion: "0.161.0",
          cliSha256: "c".repeat(64),
          policySha256: "d".repeat(64),
          bindingSha256: "e".repeat(64),
        },
        transport,
      ),
    /Unqualified coding transport/,
  );
  await assert.rejects(
    transport.run({ intent: "resume" }, () => {}),
    /Native resume is not qualified/,
  );
});

import os from "node:os";
import fs from "node:fs";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { resolve } from "node:path";

// External host/process seam only: no real VM, engine or credentials are used.
function nativeHost(t, respond, platform = "darwin") {
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
const session = {
  operationId: "12345678-1234-4234-8234-123456789abc",
  fence: 1,
  state: "running",
  intent: "start",
};
const observation = {
  engineVersion: "6.1.1",
  vmImageSha256: "1".repeat(64),
  template: "pinned",
  hostId: "2".repeat(64),
};

test("native inspection independently binds each supported host and the guest executable", async (t) => {
  for (const platform of ["darwin", "win32"])
    await t.test(platform, async (t) => {
      const fixture = nativeHost(
        t,
        (request) => ({
          session: request.session,
          binding: observation,
          cliSha256: request.cliSha256,
        }),
        platform,
      );
      const transport = new NativePodmanCodingTransport(
        "aios-test",
        "a".repeat(64),
      );
      const first = await transport.inspect(session);
      assert.equal(first.cliVersion, "0.161.0");
      assert.match(first.cliSha256, /^[a-f0-9]{64}$/);
      assert.match(first.policySha256, /^[a-f0-9]{64}$/);
      assert.match(first.bindingSha256, /^[a-f0-9]{64}$/);
      assert.equal(fixture.requests[0].action, "inspect");
      const second = await transport.inspect(session);
      assert.deepEqual(first, second);
    });
});

async function launchRequest(transport, overrides = {}) {
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
    inputSha256: "c".repeat(64),
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

test("native launch transfers only data, streams bounded output and stops before collection", async (t) => {
  const fixture = nativeHost(t, (r) => ({
    session: r.session,
    binding: observation,
    cliSha256: r.cliSha256,
    ...(r.action === "poll"
      ? {
          running: false,
          exitCode: 1,
          output: Buffer.from('{"type":"turn.failed"}\n').toString("base64"),
        }
      : {}),
    ...(r.action === "stop" ? { stopped: true, remainingProcesses: 0 } : {}),
    ...(r.action === "collect"
      ? {
          files: [
            {
              path: "index.html",
              bytes: Buffer.from("after\n").toString("base64"),
              executable: false,
            },
          ],
        }
      : {}),
  }));
  const transport = new NativePodmanCodingTransport(
    "aios-test",
    "a".repeat(64),
  );
  const request = await launchRequest(transport);
  const output = [];
  const result = await transport.run(request, (bytes) => output.push(bytes));
  assert.equal(result.exitCode, 1);
  assert.equal(Buffer.concat(output).toString(), '{"type":"turn.failed"}\n');
  const effects = fixture.requests.filter((r) => r.action !== "inspect");
  assert.deepEqual(
    effects.map((r) => r.action),
    ["prepare", "launch", "poll", "stop"],
  );
  assert.equal(
    effects[0].files[0].bytes,
    Buffer.from("before\n").toString("base64"),
  );
  assert.equal(effects[0].argv.at(-1), "Change the title");
  assert.ok(
    !fixture.programs[0].includes("Change the title"),
    "candidate input never becomes Python source",
  );
  const collection = await transport.collect(session);
  assert.equal(collection.complete, true);
  assert.equal(collection.files[0].bytes.toString(), "after\n");
  assert.equal(collection.files[0].ordinary, true);
});

test(
  "transported management executes launch, revocation and stable collection against external Linux fixtures",
  {
    skip:
      process.platform === "win32"
        ? "Linux guest simulator requires a POSIX filesystem"
        : false,
  },
  async (t) => {
    const { transport, read, root, requests } = guestFixture(t);
    const request = await launchRequest(transport, { allowanceMs: 60000 });
    const result = await transport.run(request, () => {});
    assert.equal(result.exitCode, 1);
    const collected = await transport.collect({
      ...session,
      state: "uncertain",
    });
    assert.equal(collected.files[0].bytes.toString(), "after\n");
    const state = JSON.parse(realReadFileSync(`${root}/engine.json`, "utf8"));
    assert.ok(state.sharedManagementLocks.length > 0);
    assert.ok(
      state.sharedManagementLocks.every(Boolean),
      "all effects share the existing fixed-worker management lock",
    );
    const create = state.commands.find((args) => args[1] === "create");
    assert.ok(create.includes("--network=none"));
    assert.ok(create.includes("--read-only"));
    assert.ok(create.includes("--cap-drop=ALL"));
    assert.ok(create.includes("--userns=keep-id:uid=65534,gid=65534"));
    const seccomp = JSON.parse(
      realReadFileSync(
        `${root}/.local/state/aios-coding-v1/seccomp.json`,
        "utf8",
      ),
    );
    assert.deepEqual(seccomp.syscalls[0].names, ["read"]);
    await assert.rejects(transport.run(request, () => {}));
    assert.equal(
      requests.filter((r) => r.action === "launch").length,
      1,
      "revoked session cannot relaunch",
    );
  },
);

test("unsafe native inputs and unsupported authority paths refuse before VM effects", async (t) => {
  const fixture = nativeHost(t, (r) => ({
    session: r.session,
    binding: observation,
    cliSha256: r.cliSha256,
  }));
  const transport = new NativePodmanCodingTransport(
    "aios-test",
    "a".repeat(64),
  );
  const request = await launchRequest(transport);
  const inspected = fixture.requests.length;
  for (const override of [
    { argv: ["exec", "--dangerously-bypass-approvals-and-sandbox", "prompt"] },
    { threadId: "unapproved-thread" },
    { baseRefresh: {} },
    { allowanceMs: 0 },
    {
      files: [
        { path: "../escape", bytes: Buffer.from("x"), executable: false },
      ],
    },
    {
      files: [
        {
          path: ".codex/config.toml",
          bytes: Buffer.from("x"),
          executable: false,
        },
      ],
    },
    {
      files: [
        { path: "large", bytes: Buffer.alloc(262145), executable: false },
      ],
    },
    {
      files: [
        { path: "a", bytes: Buffer.from("x"), executable: false },
        { path: "A", bytes: Buffer.from("y"), executable: false },
      ],
    },
  ])
    await assert.rejects(transport.run({ ...request, ...override }, () => {}));
  assert.equal(fixture.requests.length, inspected);
  assert.throws(
    () => new NativePodmanCodingTransport("shared", "a".repeat(64)),
    /Invalid native coding authority/,
  );
  await assert.rejects(
    transport.inspect({ ...session, fence: -1 }),
    /Invalid native coding session/,
  );
});

test("revocation during preparation stops the exact session without releasing Codex", async (t) => {
  let allowed = true;
  const fixture = nativeHost(t, (r) => {
    if (r.action === "prepare") allowed = false;
    return {
      session: r.session,
      binding: observation,
      cliSha256: r.cliSha256,
      ...(r.action === "stop" ? { stopped: true, remainingProcesses: 0 } : {}),
    };
  });
  const transport = new NativePodmanCodingTransport(
    "aios-test",
    "a".repeat(64),
  );
  const request = await launchRequest(transport, {
    mayDispatch: () => allowed,
  });
  await assert.rejects(
    transport.run(request, () => {}),
    /authority changed/,
  );
  assert.equal(
    fixture.requests.some((r) => r.action === "launch"),
    false,
  );
  const stopped = fixture.requests.find((r) => r.action === "stop");
  assert.deepEqual(stopped.session, session);
});

test("retained launch mutations and malformed streams cannot bypass native shutdown", async (t) => {
  for (const failure of ["mutation", "stream", "checkpoint", "pins"])
    await t.test(failure, async (t) => {
      let request;
      const fixture = nativeHost(t, (r) => {
        if (failure === "mutation" && r.action === "prepare")
          request.argv[5] = "replacement";
        return {
          session: r.session,
          binding: observation,
          cliSha256: r.cliSha256,
          ...(r.action === "poll"
            ? { running: false, exitCode: 0, output: "not base64!" }
            : {}),
          ...(r.action === "stop"
            ? { stopped: true, remainingProcesses: 0 }
            : {}),
          ...(failure === "pins" && r.action === "prepare"
            ? { binding: { ...observation, engineVersion: "6.2.0" } }
            : {}),
        };
      });
      const transport = new NativePodmanCodingTransport(
        "aios-test",
        "a".repeat(64),
      );
      request = await launchRequest(transport, {
        checkpoint: () => failure !== "checkpoint",
      });
      await assert.rejects(transport.run(request, () => {}));
      assert.equal(
        fixture.requests.filter((r) => r.action === "stop").length,
        1,
      );
    });
});

test("collection refuses unsafe bytes, paths and changed native binding", async (t) => {
  for (const failure of ["path", "bytes", "pins", "shape", "shutdown"])
    await t.test(failure, async (t) => {
      nativeHost(t, (r) => ({
        session: r.session,
        binding: observation,
        cliSha256: r.cliSha256,
        ...(r.action === "collect"
          ? {
              files: [
                {
                  path: failure === "path" ? ".git/config" : "index.html",
                  bytes: failure === "bytes" ? "!" : "YWZ0ZXIK",
                  executable: false,
                },
              ],
            }
          : {}),
        ...(failure === "pins" && r.action === "collect"
          ? { binding: { ...observation, engineVersion: "6.2.0" } }
          : {}),
        ...(failure === "shape" && r.action === "collect"
          ? { files: [null] }
          : {}),
        ...(r.action === "stop"
          ? { stopped: false, remainingProcesses: 1 }
          : {}),
      }));
      const transport = new NativePodmanCodingTransport(
        "aios-test",
        "a".repeat(64),
      );
      if (failure === "shutdown")
        await assert.rejects(transport.stop(session), /uncertain/);
      else await assert.rejects(transport.collect(session));
    });
});

function guestFixture(t, engine = {}) {
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
const posixGuest = {
  skip:
    process.platform === "win32"
      ? "Linux guest simulator requires a POSIX filesystem"
      : false,
};

test(
  "native management persists a revocation before a delayed first dispatch",
  posixGuest,
  async (t) => {
    const { transport, read } = guestFixture(t);
    const request = await launchRequest(transport, { allowanceMs: 60000 });
    const stopped = await transport.stop({ ...session, state: "uncertain" });
    assert.equal(stopped.stopped, true);
    await assert.rejects(transport.run(request, () => {}));
    assert.equal(
      read().commands.some((args) => args[1] === "create"),
      false,
    );
  },
);

test(
  "unsafe effective native networking is refused before worker start",
  posixGuest,
  async (t) => {
    const { transport, read } = guestFixture(t, { unsafeNetwork: true });
    const request = await launchRequest(transport, { allowanceMs: 60000 });
    await assert.rejects(transport.run(request, () => {}));
    assert.equal(
      read().commands.some((args) => args[1] === "start"),
      false,
    );
    assert.equal((await transport.stop(session)).remainingProcesses, 0);
  },
);

test(
  "native orphan evidence blocks collection until independent exact-session recovery",
  posixGuest,
  async (t) => {
    const { transport, read, write } = guestFixture(t, {
      keepRunning: true,
      orphan: true,
    });
    let checkpoints = 0;
    const request = await launchRequest(transport, {
      allowanceMs: 60000,
      checkpoint: () => ++checkpoints < 3,
    });
    await assert.rejects(transport.run(request, () => {}));
    await assert.rejects(transport.collect(session));
    const retained = read();
    assert.equal(retained.alive, true);
    assert.equal(retained.container.State.Running, false);
    // An independent process observation now confirms the retained process is gone.
    write({ ...retained, alive: false, orphan: false });
    assert.equal(
      (await transport.stop({ ...session, state: "uncertain" }))
        .remainingProcesses,
      0,
    );
    assert.equal(
      (await transport.collect(session)).files[0].bytes.toString(),
      "after\n",
    );
  },
);

test(
  "stopped native collection refuses linked output and preserves the workspace",
  posixGuest,
  async (t) => {
    const { transport, read } = guestFixture(t);
    const request = await launchRequest(transport, { allowanceMs: 60000 });
    await transport.run(request, () => {});
    const workspace = read().container.Mounts.find(
      (m) => m.Destination === "/workspace",
    ).Source;
    fs.linkSync(`${workspace}/index.html`, `${workspace}/linked.html`);
    await assert.rejects(transport.collect(session));
    assert.equal(
      realReadFileSync(`${workspace}/index.html`, "utf8"),
      "after\n",
    );
  },
);

test(
  "missing independent native lease refuses Codex release and still stops the worker",
  posixGuest,
  async (t) => {
    const { transport, read } = guestFixture(t, { leaseUnavailable: true });
    const request = await launchRequest(transport, { allowanceMs: 60000 });
    await assert.rejects(transport.run(request, () => {}));
    const state = read();
    assert.equal(
      state.commands.some((args) => args[0] === "systemd-run"),
      true,
    );
    assert.equal(
      state.commands.some((args) => args[1] === "exec"),
      false,
    );
    assert.equal(state.alive, false);
    assert.equal((await transport.stop(session)).remainingProcesses, 0);
  },
);

test("native polling emits only newly observed bytes across running and unchanged polls", async (t) => {
  let polls = 0;
  const first = '{"type":"thread.started","thread_id":"synthetic-thread"}\n';
  const last = '{"type":"turn.failed"}\n';
  const fixture = nativeHost(t, (r) => ({
    session: r.session,
    binding: observation,
    cliSha256: r.cliSha256,
    ...(r.action === "poll"
      ? {
          running: ++polls < 3,
          exitCode: 1,
          output: Buffer.from(polls < 3 ? first : first + last).toString(
            "base64",
          ),
        }
      : {}),
    ...(r.action === "stop" ? { stopped: true, remainingProcesses: 0 } : {}),
  }));
  const transport = new NativePodmanCodingTransport(
    "aios-test",
    "a".repeat(64),
  );
  const request = await launchRequest(transport, { allowanceMs: 5000 });
  const chunks = [];
  assert.equal(
    (await transport.run(request, (bytes) => chunks.push(bytes.toString())))
      .exitCode,
    1,
  );
  assert.deepEqual(
    chunks,
    [first, last],
    "unchanged polls cannot duplicate events",
  );
  assert.equal(polls, 3);
  assert.equal(fixture.requests.filter((r) => r.action === "stop").length, 1);
});

test("rewritten native log prefixes refuse completion and still stop the exact worker", async (t) => {
  let polls = 0;
  const fixture = nativeHost(t, (r) => ({
    session: r.session,
    binding: observation,
    cliSha256: r.cliSha256,
    ...(r.action === "poll"
      ? {
          running: ++polls === 1,
          exitCode: 0,
          output: Buffer.from(
            polls === 1 ? "original\n" : "replacement\n",
          ).toString("base64"),
        }
      : {}),
    ...(r.action === "stop" ? { stopped: true, remainingProcesses: 0 } : {}),
  }));
  const transport = new NativePodmanCodingTransport(
    "aios-test",
    "a".repeat(64),
  );
  const request = await launchRequest(transport, { allowanceMs: 5000 });
  await assert.rejects(
    transport.run(request, () => {}),
    /Native coding stream changed/,
  );
  assert.deepEqual(
    fixture.requests.find((r) => r.action === "stop").session,
    session,
  );
});

test("native process failures and forged observation bindings refuse inspection", async (t) => {
  for (const failure of [
    "json",
    "oversized",
    "session",
    "executable",
    "binding",
  ])
    await t.test(failure, async (t) => {
      const fixture = nativeHost(t, (r) => ({
        session: r.session,
        binding: observation,
        cliSha256: r.cliSha256,
        ...(failure === "json" ? { rawOutput: "{" } : {}),
        ...(failure === "oversized"
          ? { rawOutput: "x".repeat(8 * 1024 * 1024 + 1) }
          : {}),
        ...(failure === "session"
          ? { session: { ...r.session, fence: 99 } }
          : {}),
        ...(failure === "executable" ? { cliSha256: "0".repeat(64) } : {}),
        ...(failure === "binding" ? { binding: null } : {}),
      }));
      const transport = new NativePodmanCodingTransport(
        "aios-test",
        "a".repeat(64),
      );
      await assert.rejects(transport.inspect(session));
      assert.equal(fixture.requests.length, 1);
      if (failure === "oversized")
        assert.equal(fixture.processEffects.kills, 1);
    });
});

test("a stalled native management process is terminated at the observation deadline", async (t) => {
  const fixture = nativeHost(t, () => ({ hang: true }));
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const transport = new NativePodmanCodingTransport(
    "aios-test",
    "a".repeat(64),
  );
  const pending = transport.inspect(session);
  const refusal = assert.rejects(
    pending,
    /Native coding observation timed out/,
  );
  t.mock.timers.tick(45000);
  await refusal;
  assert.equal(fixture.processEffects.kills, 1);
  assert.equal(fixture.requests.length, 1);
});

test("changed initial native pins refuse before any staging or worker effect", async (t) => {
  const fixture = nativeHost(t, (r) => ({
    session: r.session,
    binding: observation,
    cliSha256: r.cliSha256,
  }));
  const transport = new NativePodmanCodingTransport(
    "aios-test",
    "a".repeat(64),
  );
  const request = await launchRequest(transport);
  request.pins.policySha256 = "0".repeat(64);
  await assert.rejects(
    transport.run(request, () => {}),
    /Native coding authority changed/,
  );
  assert.equal(
    fixture.requests.every((r) => r.action === "inspect"),
    true,
  );
});

test("revocation during host preparation refuses the guest management effect", async (t) => {
  let allowed = true;
  const fixture = nativeHost(t, (r) => ({
    session: r.session,
    binding: observation,
    cliSha256: r.cliSha256,
    ...(r.action === "stop" ? { stopped: true, remainingProcesses: 0 } : {}),
  }));
  const transport = new NativePodmanCodingTransport(
    "aios-test",
    "a".repeat(64),
  );
  const request = await launchRequest(transport, {
    mayDispatch: () => allowed,
  });
  let versions = 0;
  t.mock.method(childProcess, "spawnSync", () => {
    if (++versions === 2) allowed = false;
    return {
      status: 0,
      stdout: JSON.stringify({ Client: { Version: "6.1.1" } }),
    };
  });
  syncBuiltinESMExports();
  await assert.rejects(
    transport.run(request, () => {}),
    /Native coding authority changed/,
  );
  assert.equal(
    fixture.requests.some((r) => r.action === "prepare"),
    false,
  );
  assert.equal(
    fixture.requests.some((r) => r.action === "stop"),
    true,
  );
});

test(
  "native observations do not cap the engine private database at the stream byte limit",
  posixGuest,
  async (t) => {
    const { transport } = guestFixture(t, { largeDatabase: true });
    const request = await launchRequest(transport, { allowanceMs: 60000 });
    const result = await transport.run(request, () => {});
    assert.equal(result.exitCode, 1);
    assert.equal((await transport.stop(session)).remainingProcesses, 0);
    assert.equal(
      (await transport.collect(session)).files[0].bytes.toString(),
      "after\n",
    );
  },
);

for (const stream of ["stdout", "stderr"])
  test(
    `native management refuses oversized ${stream} while preserving the observation limit`,
    posixGuest,
    async (t) => {
      const { transport } = guestFixture(t, { oversizedObservation: stream });
      await assert.rejects(transport.inspect(session));
    },
  );

test(
  "native management kills and reaps a stalled command when its unchanged deadline expires",
  posixGuest,
  async (t) => {
    const { transport, read } = guestFixture(t, { hungObservation: true });
    let pid;
    try {
      await assert.rejects(transport.inspect(session));
      pid = read().managementPid;
      assert.ok(Number.isSafeInteger(pid) && pid > 1);
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    } finally {
      // Failure of the regression must not leave its owned synthetic child alive.
      if (pid)
        try {
          process.kill(pid, "SIGKILL");
        } catch (error) {
          assert.equal(error.code, "ESRCH");
        }
    }
  },
);

test(
  "native exact-session recovery tolerates independently observed collected timer units",
  posixGuest,
  async (t) => {
    const { transport } = guestFixture(t, { strictTimers: true });
    const request = await launchRequest(transport, { allowanceMs: 60000 });
    await transport.run(request, () => {});
    assert.equal((await transport.stop(session)).remainingProcesses, 0);
    assert.equal((await transport.collect(session)).complete, true);
  },
);

test(
  "native polling does not exhaust the manager timer start-rate allowance",
  posixGuest,
  async (t) => {
    const { transport } = guestFixture(t, {
      keepRunning: true,
      stopAfterPolls: 8,
      enforceTimerRate: true,
    });
    const request = await launchRequest(transport, { allowanceMs: 60000 });
    assert.equal((await transport.run(request, () => {})).exitCode, 1);
    assert.equal((await transport.stop(session)).remainingProcesses, 0);
  },
);

for (const mode of [
  "unavailable",
  "malformed",
  "pending-job",
  "stop-unavailable",
])
  test(
    `unverified native timer cleanup blocks collection: ${mode}`,
    posixGuest,
    async (t) => {
      const { transport } = guestFixture(
        t,
        mode === "stop-unavailable"
          ? { timerStopUnavailable: true }
          : { timerObservation: mode },
      );
      const request = await launchRequest(transport, { allowanceMs: 60000 });
      await assert.rejects(transport.run(request, () => {}));
      await assert.rejects(transport.collect(session));
    },
  );

test(
  "checkpoint refusal after native polling reports a gated stop and preserves recovery",
  posixGuest,
  async (t) => {
    const { transport } = guestFixture(t, { keepRunning: true });
    let checkpoints = 0;
    const request = await launchRequest(transport, {
      allowanceMs: 60000,
      checkpoint: () => ++checkpoints < 2,
    });
    await assert.rejects(
      transport.run(request, () => {}),
      {
        message: "Native coding run stopped by its gate",
      },
    );
    assert.equal((await transport.stop(session)).remainingProcesses, 0);
    assert.equal((await transport.collect(session)).complete, true);
  },
);
