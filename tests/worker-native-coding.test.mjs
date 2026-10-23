import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { NativePodmanCodingTransport } from "../dist/podman-coding.js";
import { PinnedCodingRuntime } from "../dist/feature-candidate.js";
import {
  realTemporaryDirectory,
  realSpawnSync,
  realReadFileSync,
  realWriteFileSync,
  realMkdtempSync,
  realRmSync,
  realMkdirSync,
  guestHarness,
  nativeHost,
  session,
  observation,
  launchRequest,
  guestFixture,
  posixGuest,
} from "./helpers/native-coding-fixture.mjs";

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
    /Unsupported native coding resume/,
  );
});

import os from "node:os";
import fs from "node:fs";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { resolve } from "node:path";

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

test(
  "the native coding binding names the VM by its machine ID and survives a restart",
  posixGuest,
  async (t) => {
    const { transport, read, write, machineConfig } = guestFixture(t);
    machineConfig.LastUp = "2026-10-23T09:14:51.505287-05:00";
    const first = await transport.inspect(session);
    // Apple's hypervisor gives the VM a new hardware UUID on every boot, and
    // Podman stamps each start in the machine's configuration.
    write({ ...read(), productUuid: "restarted-vm-uuid" });
    machineConfig.LastUp = "2026-10-23T09:26:15.056198-05:00";
    assert.deepEqual(await transport.inspect(session), first);
    // Any other configuration change still needs a new record.
    machineConfig.Resources = { USBs: [], CPUs: 4 };
    assert.notEqual(
      (await transport.inspect(session)).bindingSha256,
      first.bindingSha256,
    );
    delete machineConfig.Resources;
    // A recreated VM gets a new machine ID, so it needs a new record.
    write({ ...read(), machineId: "f".repeat(32) });
    const recreated = await transport.inspect(session);
    assert.notEqual(recreated.bindingSha256, first.bindingSha256);
    assert.equal(recreated.policySha256, first.policySha256);
    for (const machineId of [
      "",
      "F".repeat(32),
      "0".repeat(31),
      "0".repeat(33),
    ]) {
      write({ ...read(), machineId });
      await assert.rejects(transport.inspect(session));
    }
  },
);

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

function controllerLossFixture(mode = "valid", selectedTimer = "lease") {
  const effects = [];
  const pins = {
    cliVersion: "0.161.0",
    cliSha256: "a".repeat(64),
    policySha256: "b".repeat(64),
    bindingSha256: "c".repeat(64),
  };
  let lost = false,
    stopped = false,
    polls = 0,
    now = 0;
  const probe = {
    session,
    pins,
    timer: selectedTimer,
    controller: {
      async start() {
        effects.push("start");
      },
      async terminate() {
        if (mode === "controller-uncertain")
          throw Error("controller termination uncertain");
        if (!lost) effects.push("controller-lost");
        lost = true;
      },
    },
    transport: {
      async inspect() {
        return pins;
      },
      async observeSession() {
        const gone =
          mode === "natural-exit" ||
          (lost && ++polls > 1 && mode !== "never-stops");
        effects.push(gone ? "independent-stop" : "running-control");
        return {
          ...session,
          pins:
            mode === "pin-drift"
              ? { ...pins, bindingSha256: "d".repeat(64) }
              : pins,
          phase: mode === "cleanup-before-loss" ? "stopped" : "running",
          running: !gone,
          remainingProcesses: gone ? 0 : 1,
          processesGone: gone,
          timers: {
            lease: {
              loadState: "loaded",
              activeState: gone ? "inactive" : "active",
            },
            deadline: { loadState: "loaded", activeState: "active" },
          },
        };
      },
      async observeTimerExecution(_session, timer) {
        const fired =
          (lost && (timer === selectedTimer || mode === "both-fired")) ||
          (mode === "preloss-execution" && now > 0);
        return {
          ...session,
          pins,
          timer,
          lastTriggerUs: fired ? 100 : 0,
          startedUs: fired ? 101 : 0,
          finishedUs: fired ? 102 : 0,
          code: fired ? 1 : 0,
          status: lost && mode === "failed-kill" ? 1 : 0,
        };
      },
      async stop() {
        effects.push("explicit-recovery");
        stopped = true;
        return {
          ...session,
          stopped: mode !== "recovery-uncertain",
          remainingProcesses: 0,
        };
      },
      async collect() {
        if (!stopped && mode !== "early-collection")
          throw Error("explicit stop required");
        effects.push("collect");
        return {
          ...session,
          complete: mode !== "collection-incomplete",
          files: [],
        };
      },
    },
    clock: {
      now: () => (mode === "clock-unavailable" ? NaN : now),
      async wait(ms) {
        now +=
          mode === "late-stop" ? 50000 : mode === "clock-backwards" ? -1 : ms;
      },
    },
    onEvidence(stage) {
      if (mode === "evidence-after-start" && stage === "session")
        throw Error("evidence unavailable after start");
      if (mode === "evidence-unavailable") throw Error("evidence unavailable");
    },
  };
  return { probe, effects };
}

test("offline controller-loss procedure observes independent expiry before recovery", async () => {
  const { observeNativeControllerLoss } = await import(
    "../dist/native-coding-qualification.js"
  );
  const { probe, effects } = controllerLossFixture();
  const result = await observeNativeControllerLoss(probe);
  assert.equal(result.qualified, false);
  assert.equal(result.productionEnabled, false);
  assert.ok(
    effects.indexOf("running-control") < effects.indexOf("controller-lost"),
  );
  assert.ok(
    effects.indexOf("independent-stop") < effects.indexOf("explicit-recovery"),
  );
  assert.ok(effects.indexOf("explicit-recovery") < effects.indexOf("collect"));
});

for (const mode of [
  "natural-exit",
  "cleanup-before-loss",
  "pin-drift",
  "never-stops",
  "failed-kill",
  "both-fired",
  "early-collection",
  "controller-uncertain",
  "recovery-uncertain",
  "collection-incomplete",
  "clock-unavailable",
  "clock-backwards",
  "late-stop",
  "evidence-unavailable",
  "evidence-after-start",
])
  test(`offline controller-loss procedure refuses misleading evidence: ${mode}`, async () => {
    const { observeNativeControllerLoss } = await import(
      "../dist/native-coding-qualification.js"
    );
    const { probe, effects } = controllerLossFixture(mode);
    await assert.rejects(observeNativeControllerLoss(probe));
    if (effects.includes("start"))
      assert.ok(effects.includes("explicit-recovery"));
    else assert.deepEqual(effects, []);
  });

test("offline fixed-deadline procedure distinguishes the deadline from the lease", async () => {
  const { observeNativeControllerLoss } = await import(
    "../dist/native-coding-qualification.js"
  );
  const { probe } = controllerLossFixture("valid", "deadline");
  const result = await observeNativeControllerLoss(probe);
  assert.equal(result.timer, "deadline");
  assert.equal(result.qualified, false);
});

for (const timer of ["deadline", "lease"])
  for (const state of ["missing", "inactive", "failed"])
    test(
      `native timer loss after launch stops before output: ${timer} ${state}`,
      posixGuest,
      async (t) => {
        const { transport, read } = guestFixture(t, {
          keepRunning: true,
          stopAfterPolls: 3,
          loseTimerAfterLaunch: timer,
          advanceAfterLaunch: 11,
          ...(state === "missing" ? {} : { timerLossState: state }),
        });
        const request = await launchRequest(transport, { allowanceMs: 60000 });
        const output = [];
        await assert.rejects(
          transport.run(request, (bytes) => output.push(bytes)),
        );
        assert.deepEqual(output, []);
        assert.equal(read().alive, false);
        assert.equal(
          read().commands.some(
            (args) => args[0] === "systemctl" && args[2] === "restart",
          ),
          false,
        );
        assert.equal((await transport.stop(session)).remainingProcesses, 0);
        assert.equal((await transport.collect(session)).complete, true);
      },
    );

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

test("native inspection of a live launch request sends only the session identity", async (t) => {
  // The pinned runtime re-inspects with the controller's whole request,
  // callbacks included, just before launch.
  const fixture = nativeHost(t, (request) => ({
    session: request.session,
    binding: observation,
    cliSha256: request.cliSha256,
  }));
  const transport = new NativePodmanCodingTransport(
    "aios-test",
    "a".repeat(64),
  );
  const request = await launchRequest(transport);
  const pins = await transport.inspect(request);
  assert.deepEqual(pins, request.pins);
  const inspected = fixture.requests.at(-1);
  assert.equal(inspected.action, "inspect");
  // No prompt, input bytes or callbacks cross into management for inspection.
  assert.deepEqual(inspected.session, session);
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

test(
  "native session observation reports stopped process and timer evidence without mutating lifecycle",
  posixGuest,
  async (t) => {
    const { transport, read } = guestFixture(t);
    const request = await launchRequest(transport);
    await transport.run(request, () => {});
    const before = read();
    await assert.rejects(
      transport.observeSession({ ...session, fence: session.fence + 1 }),
    );
    const observed = await transport.observeSession({
      ...session,
      state: "uncertain",
    });
    assert.equal(observed.operationId, session.operationId);
    assert.equal(observed.fence, session.fence);
    assert.equal(observed.phase, "stopped");
    assert.equal(observed.running, false);
    assert.equal(observed.remainingProcesses, 0);
    assert.equal(observed.processesGone, true);
    assert.deepEqual(observed.timers, {
      lease: { loadState: "not-found", activeState: "inactive" },
      deadline: { loadState: "not-found", activeState: "inactive" },
    });
    assert.deepEqual(observed.pins, request.pins);
    const commands = read().commands.slice(before.commands.length);
    assert.equal(
      commands.some(
        (args) =>
          args[0] === "systemd-run" ||
          (args[0] === "systemctl" && args[2] !== "show") ||
          (args[0] === "podman" &&
            ["start", "stop", "exec", "create", "logs"].includes(args[1])),
      ),
      false,
    );
    assert.equal(read().alive, false);
  },
);

test(
  "native timer execution observation identifies the bound kill command without lifecycle effects",
  posixGuest,
  async (t) => {
    const { transport, read, write } = guestFixture(t);
    await transport.run(await launchRequest(transport), () => {});
    write({ ...read(), executionEvidence: true });
    const before = read();
    await assert.rejects(
      transport.observeTimerExecution(
        { ...session, fence: session.fence + 1 },
        "lease",
      ),
    );
    const result = await transport.observeTimerExecution(session, "lease");
    assert.equal(result.timer, "lease");
    assert.equal(result.lastTriggerUs, 100);
    assert.equal(result.startedUs, 101);
    assert.equal(result.finishedUs, 102);
    assert.equal(result.code, 1);
    assert.equal(result.status, 0);
    assert.equal(result.operationId, session.operationId);
    assert.equal(result.fence, session.fence);
    assert.equal(
      read()
        .commands.slice(before.commands.length)
        .some(
          (args) =>
            args[0] === "systemd-run" ||
            (args[0] === "systemctl" && args[2] !== "show") ||
            (args[0] === "podman" &&
              ["stop", "start", "exec", "logs"].includes(args[1])),
        ),
      false,
    );
  },
);

for (const mode of [
  "unavailable",
  "wrong-command",
  "ignored-failure",
  "malformed",
  "wrapped-data",
])
  test(
    `native timer execution refuses unverified manager data: ${mode}`,
    posixGuest,
    async (t) => {
      const { transport, read, write } = guestFixture(t);
      await transport.run(await launchRequest(transport), () => {});
      write({
        ...read(),
        executionEvidence: mode !== "unavailable",
        executionMode: mode,
      });
      await assert.rejects(transport.observeTimerExecution(session, "lease"));
      assert.equal(read().alive, false);
    },
  );

test("offline native acceptance CLI refuses missing approval and direct child entry before effects", (t) => {
  const root = realMkdtempSync(`${realTemporaryDirectory}/aios-loss-cli-`);
  t.after(() => realRmSync(root, { recursive: true, force: true }));
  const path = `${root}/report.json`;
  const script = new URL(
    "../.scratch/aios-v1-implementation/native-coding-controller-loss-acceptance.mjs",
    import.meta.url,
  );
  const missing = realSpawnSync(
    process.execPath,
    [fileURLToPath(script), "aios-test", path, "lease"],
    { encoding: "utf8", timeout: 5000 },
  );
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /--approve-offline-native-run/);
  assert.equal(fs.existsSync(path), false);
  const direct = realSpawnSync(
    process.execPath,
    [
      fileURLToPath(script),
      "aios-test",
      "--controller-child",
      "lease",
      "--approve-offline-native-run",
      session.operationId,
    ],
    { encoding: "utf8", timeout: 5000 },
  );
  assert.notEqual(direct.status, 0);
  assert.match(direct.stderr, /function|darwin|win32/);
  assert.equal(fs.existsSync(path), false);
});

for (const invalid of [
  { lastTriggerUs: 0 },
  { startedUs: 0, lastTriggerUs: 0 },
  { finishedUs: 100 },
  { code: 0 },
  { status: 256 },
  { lastTriggerUs: "100" },
  { timer: "foreign" },
])
  test(`native timer execution refuses contradictory evidence ${JSON.stringify(invalid)}`, async (t) => {
    nativeHost(t, (r) => ({
      session: r.session,
      binding: observation,
      cliSha256: r.cliSha256,
      timer: "lease",
      lastTriggerUs: 100,
      startedUs: 101,
      finishedUs: 102,
      code: 1,
      status: 0,
      ...invalid,
    }));
    const transport = new NativePodmanCodingTransport(
      "aios-test",
      "a".repeat(64),
    );
    await assert.rejects(
      transport.observeTimerExecution(session, "lease"),
      /observation unavailable/,
    );
  });

test(
  "native session observation proves expiry before recovery without renewing timers or authorizing collection",
  posixGuest,
  async (t) => {
    const { transport, read, write } = guestFixture(t, { keepRunning: true });
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let allowed = true,
      ready;
    const started = new Promise((resolve) => {
      ready = resolve;
    });
    const request = await launchRequest(transport, {
      allowanceMs: 60000,
      checkpoint: () => allowed,
    });
    const pending = transport.run(request, () => ready());
    const stopped = assert.rejects(pending, /stopped by its gate/);
    try {
      await Promise.race([started, pending]);
      const before = read();
      const live = await transport.observeSession(session);
      assert.equal(live.phase, "running");
      assert.equal(live.running, true);
      assert.equal(live.remainingProcesses, 1);
      assert.equal(live.processesGone, false);
      assert.deepEqual(live.timers, {
        lease: { loadState: "loaded", activeState: "active" },
        deadline: { loadState: "loaded", activeState: "active" },
      });
      assert.deepEqual(read().timers, before.timers);
      const expired = read();
      const lease = Object.keys(expired.timers).find((name) =>
        name.endsWith("-lease.timer"),
      );
      expired.timers[lease].active = "inactive";
      expired.alive = false;
      expired.container.State = {
        ...expired.container.State,
        Running: false,
        Pid: 0,
        Status: "exited",
      };
      write(expired);
      const afterExpiry = await transport.observeSession({
        ...session,
        state: "uncertain",
      });
      assert.equal(
        afterExpiry.phase,
        "running",
        "observation cannot reconcile the protected lifecycle record",
      );
      assert.equal(afterExpiry.running, false);
      assert.equal(afterExpiry.remainingProcesses, 0);
      assert.equal(afterExpiry.processesGone, true);
      assert.equal(afterExpiry.timers.lease.activeState, "inactive");
      assert.deepEqual(
        read().timers,
        expired.timers,
        "expired timers cannot be revived by observation",
      );
      const commands = read().commands.slice(before.commands.length);
      assert.equal(
        commands.some(
          (args) =>
            args[0] === "systemd-run" ||
            (args[0] === "systemctl" && args[2] !== "show") ||
            (args[0] === "podman" &&
              ["start", "stop", "exec", "create", "logs"].includes(args[1])),
        ),
        false,
      );
      await assert.rejects(transport.collect({ ...session, state: "stopped" }));
    } finally {
      allowed = false;
      t.mock.timers.tick(100);
      await stopped;
    }
    assert.equal(
      (await transport.collect({ ...session, state: "stopped" })).complete,
      true,
    );
  },
);

for (const mode of ["unavailable", "malformed", "pending-job"])
  test(
    `native session observation refuses ${mode} timer evidence`,
    posixGuest,
    async (t) => {
      const { transport, read, write } = guestFixture(t);
      await transport.run(await launchRequest(transport), () => {});
      write({ ...read(), timerObservation: mode });
      await assert.rejects(transport.observeSession(session));
    },
  );

for (const invalid of [
  { phase: ["running"] },
  { running: "false" },
  { remainingProcesses: -1 },
  { remainingProcesses: 0.5 },
  { running: true, remainingProcesses: 0, processesGone: false },
  { running: true, remainingProcesses: 1, processesGone: true },
  {
    timers: {
      lease: { loadState: ["loaded"], activeState: "active" },
      deadline: { loadState: "loaded", activeState: "active" },
    },
  },
  {
    timers: {
      lease: { loadState: "not-found", activeState: "active" },
      deadline: { loadState: "loaded", activeState: "active" },
    },
  },
])
  test(`native session observation refuses malformed external evidence ${JSON.stringify(invalid)}`, async (t) => {
    nativeHost(t, (r) => ({
      session: r.session,
      binding: observation,
      cliSha256: r.cliSha256,
      phase: "running",
      running: true,
      remainingProcesses: 1,
      processesGone: false,
      timers: {
        lease: { loadState: "loaded", activeState: "active" },
        deadline: { loadState: "loaded", activeState: "active" },
      },
      ...invalid,
    }));
    const transport = new NativePodmanCodingTransport(
      "aios-test",
      "a".repeat(64),
    );
    await assert.rejects(
      transport.observeSession(session),
      /session observation unavailable/,
    );
  });

test(
  "retained elapsed timer refuses live worker continuity before renewal",
  posixGuest,
  async (t) => {
    const { transport, read, write } = guestFixture(t, { keepRunning: true });
    let checkpoints = 0;
    const request = await launchRequest(transport, {
      allowanceMs: 60000,
      checkpoint: () => {
        if (++checkpoints === 2) {
          const state = read();
          const unit = Object.keys(state.timers).find((name) =>
            name.endsWith("-lease.timer"),
          );
          state.timers[unit].sub = "elapsed";
          write(state);
        }
        return checkpoints < 4;
      },
    });
    await assert.rejects(
      transport.run(request, () => {}),
      /Native coding poll observation unavailable/,
    );
    assert.equal(
      read().commands.some(
        (args) => args[0] === "systemctl" && args[2] === "restart",
      ),
      false,
    );
    assert.equal((await transport.stop(session)).remainingProcesses, 0);
  },
);

test("offline deadline procedure refuses a timer execution during the preloss wait", async () => {
  const { observeNativeControllerLoss } = await import(
    "../dist/native-coding-qualification.js"
  );
  const { probe, effects } = controllerLossFixture(
    "preloss-execution",
    "deadline",
  );
  await assert.rejects(
    observeNativeControllerLoss(probe),
    /already executed before controller loss/,
  );
  assert.ok(effects.includes("explicit-recovery"));
  assert.equal(effects.includes("collect"), false);
});

test(
  "native timer execution accepts the untriggered scalar property and direct command array",
  posixGuest,
  async (t) => {
    const { transport, read, write } = guestFixture(t);
    await transport.run(await launchRequest(transport), () => {});
    write({
      ...read(),
      executionEvidence: true,
      executionMode: "never-triggered",
    });
    const value = await transport.observeTimerExecution(session, "lease");
    assert.equal(value.lastTriggerUs, 0);
    assert.equal(value.startedUs, 0);
    assert.equal(value.finishedUs, 0);
    assert.equal(value.code, 0);
    assert.equal(value.status, 0);
  },
);

test(
  "native launch refuses a digest that does not describe its admitted file bytes before effects",
  posixGuest,
  async (t) => {
    const { transport, read } = guestFixture(t);
    const request = await launchRequest(transport, {
      inputSha256: "0".repeat(64),
    });
    const before = read().commands.length;
    await assert.rejects(
      transport.run(request, () => {}),
      /Native coding input digest mismatch/,
    );
    assert.equal(read().commands.length, before);
  },
);

test(
  "native guest refuses transferred file bytes that no longer match the admitted digest before container creation",
  posixGuest,
  async (t) => {
    const { transport, read } = guestFixture(t, {
      transferredInputDrift: true,
    });
    await assert.rejects(
      transport.run(await launchRequest(transport), () => {}),
      /Native coding prepare observation unavailable/,
    );
    assert.equal(
      read().commands.some(
        (args) => args[0] === "podman" && args[1] === "create",
      ),
      false,
    );
  },
);

test(
  "native guest refuses changed launch provenance before starting the prepared worker",
  posixGuest,
  async (t) => {
    const { transport, read } = guestFixture(t, {
      launchProvenanceDrift: true,
    });
    await assert.rejects(
      transport.run(await launchRequest(transport), () => {}),
      /Native coding launch observation unavailable/,
    );
    assert.equal(
      read().commands.some(
        (args) => args[0] === "podman" && args[1] === "start",
      ),
      false,
    );
  },
);

test(
  "native launch refuses unresolved or unsafe provenance before host observations",
  posixGuest,
  async (t) => {
    const { transport, read } = guestFixture(t);
    const request = await launchRequest(transport);
    const before = read().commands.length;
    for (const override of [
      { sourceRevision: "main" },
      { sourceRevision: "b".repeat(40) + "\n" },
      { sourceRevision: undefined },
      { branch: undefined },
      { branch: "codex/task\n" },
      { branch: "main" },
      { branch: "codex/" + "a".repeat(240) },
      { branch: "codex/task//nested" },
      { branch: "codex/task/.private" },
      { branch: "codex/task." },
      { branch: "codex/../other" },
      { branch: "codex/task.lock" },
      { branch: "codex/task\nother" },
      { inputSha256: undefined },
      { inputSha256: "c".repeat(64) + "\n" },
      { inputSha256: "unknown" },
      { intent: "unexpected" },
    ])
      await assert.rejects(
        transport.run({ ...request, ...override }, () => {}),
        /Unsupported native coding launch/,
      );
    assert.equal(read().commands.length, before);
  },
);

test(
  "native admitted manifest preserves UTF-8 paths and executable flags through stopped collection",
  posixGuest,
  async (t) => {
    const { transport } = guestFixture(t);
    const request = await launchRequest(transport, {
      files: [
        {
          path: "café.txt",
          bytes: Buffer.from("bounded unicode\n"),
          executable: true,
        },
      ],
      inputSha256:
        "c7a1966631a6b1f0c269599fe83a297bdf5bc69edd66981b46a0f057a580dfa8",
    });
    await transport.run(request, () => {});
    const collected = await transport.collect(session);
    assert.equal(collected.complete, true);
    const file = collected.files.find((entry) => entry.path === "café.txt");
    assert.ok(file);
    assert.deepEqual(file.bytes, Buffer.from("bounded unicode\n"));
    assert.equal(file.executable, true);
    assert.equal(file.ordinary, true);
    assert.equal(file.links, 1);
  },
);

test("native coding refuses malformed file lists and timer names before host effects", async (t) => {
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
  const before = fixture.requests.length;
  for (const files of ["index.html", Array(1001).fill(request.files[0])])
    await assert.rejects(
      transport.run({ ...request, files }, () => {}),
      /file limit/,
    );
  await assert.rejects(
    transport.observeTimerExecution(session, "renewal"),
    /timer execution/,
  );
  assert.equal(fixture.requests.length, before);
});
