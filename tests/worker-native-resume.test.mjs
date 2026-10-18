import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { resolve } from "node:path";
import { NativePodmanCodingTransport } from "../dist/podman-coding.js";
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

// Explicit native session resume. Split from worker-native-coding.test.mjs so
// this serial block runs in parallel with the rest of the suite.
const resumeThread = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const resumedOperation = "22345678-1234-4234-8234-123456789abc";

async function nativeResumeRequest(transport, overrides = {}) {
  return launchRequest(transport, {
    operationId: resumedOperation,
    fence: 2,
    intent: "resume",
    threadId: resumeThread,
    resumeFrom: { ...session, state: "stopped" },
    argv: [
      "exec",
      "resume",
      "--json",
      "--skip-git-repo-check",
      "-c",
      'sandbox_mode="workspace-write"',
      resumeThread,
      "Continue the title",
    ],
    allowanceMs: 60000,
    ...overrides,
  });
}

test(
  "native explicit resume retains only the named stopped session home under fresh launch isolation",
  posixGuest,
  async (t) => {
    const { transport, read, root } = guestFixture(t, {
      threadId: resumeThread,
    });
    await transport.run(
      await launchRequest(transport, { allowanceMs: 60000 }),
      () => {},
    );
    const original = read().container;
    const originalHome = original.Mounts.find(
      (m) => m.Destination === "/session",
    ).Source;
    realWriteFileSync(
      `${originalHome}/retained-session`,
      "private thread canary",
    );
    const output = [];
    const result = await transport.run(
      await nativeResumeRequest(transport),
      (bytes) => output.push(bytes),
    );
    assert.equal(result.exitCode, 1);
    assert.match(Buffer.concat(output).toString(), new RegExp(resumeThread));
    const resumed = read().container;
    const home = resumed.Mounts.find(
      (m) => m.Destination === "/session",
    ).Source;
    assert.notEqual(home, originalHome);
    assert.equal(
      realReadFileSync(`${home}/retained-session`, "utf8"),
      "private thread canary",
    );
    assert.deepEqual(resumed.Config.Cmd.slice(-8), [
      "exec",
      "resume",
      "--json",
      "--skip-git-repo-check",
      "-c",
      'sandbox_mode="workspace-write"',
      resumeThread,
      "Continue the title",
    ]);
    assert.equal(resumed.HostConfig.NetworkMode, "none");
    assert.equal(resumed.HostConfig.ReadonlyRootfs, true);
    assert.notEqual(
      resumed.Config.Labels["aios.coding.session"],
      original.Config.Labels["aios.coding.session"],
    );
    await assert.rejects(
      transport.run(
        await nativeResumeRequest(transport, {
          operationId: "32345678-1234-4234-8234-123456789abc",
        }),
        () => {},
      ),
    );
    assert.equal(
      read().commands.filter((args) => args[1] === "create").length,
      2,
      "predecessor can be claimed once",
    );
  },
);

for (const planted of [
  "config.toml",
  "hooks.json",
  "AGENTS.md",
  "AGENTS.override.md",
  "skills/planted/SKILL.md",
])
  test(
    `native explicit resume refuses retained worker-writable Codex configuration ${planted}`,
    posixGuest,
    async (t) => {
      const { transport, read } = guestFixture(t, { threadId: resumeThread });
      await transport.run(
        await launchRequest(transport, { allowanceMs: 60000 }),
        () => {},
      );
      const originalHome = read().container.Mounts.find(
        (m) => m.Destination === "/session",
      ).Source;
      realMkdirSync(resolve(originalHome, planted, ".."), { recursive: true });
      realWriteFileSync(
        `${originalHome}/${planted}`,
        "planted by a prior turn",
      );
      await assert.rejects(
        transport.run(await nativeResumeRequest(transport), () => {}),
      );
      assert.equal(
        read().commands.filter((args) => args[1] === "create").length,
        1,
        "no resumed worker is created",
      );
      assert.equal(
        realReadFileSync(`${originalHome}/${planted}`, "utf8"),
        "planted by a prior turn",
        "the predecessor home stays retained and unclaimed",
      );
    },
  );

test("native explicit resume rejects missing identity and unsafe CLI selection before host effects", async (t) => {
  const fixture = nativeHost(t, (r) => ({
    session: r.session,
    binding: observation,
    cliSha256: r.cliSha256,
  }));
  const transport = new NativePodmanCodingTransport(
    "aios-test",
    "a".repeat(64),
  );
  const request = await nativeResumeRequest(transport);
  const before = fixture.requests.length;
  for (const changes of [
    { threadId: undefined },
    { threadId: "--last" },
    { threadId: `${resumeThread}\n` },
    { resumeFrom: undefined },
    { resumeFrom: { ...session, state: "stopped", fence: 1.5 } },
    { resumeFrom: { ...session, state: "stopped", intent: "recover" } },
    { resumeFrom: { ...session, state: "running" } },
    { resumeFrom: { ...session, state: "stopped", fence: 3 } },
    { resumeFrom: { ...session, state: "stopped", fence: 0 } },
    {
      resumeFrom: {
        ...session,
        state: "stopped",
        operationId: resumedOperation,
      },
    },
    { resumeFrom: { ...session, state: "stopped", operationId: "../foreign" } },
    {
      argv: [
        "exec",
        "resume",
        "--json",
        "--skip-git-repo-check",
        "-c",
        'sandbox_mode="workspace-write"',
        "--last",
        "prompt",
      ],
    },
    {
      // A resumed turn must pin the same in-container sandbox as first launch.
      argv: [
        "exec",
        "resume",
        "--json",
        "--skip-git-repo-check",
        resumeThread,
        "Continue the title",
      ],
    },
    {
      argv: [
        "exec",
        "resume",
        "--json",
        "--skip-git-repo-check",
        "-c",
        'sandbox_mode="danger-full-access"',
        resumeThread,
        "Continue the title",
      ],
    },
    { baseRefresh: { from: {}, to: {} } },
  ])
    await assert.rejects(transport.run({ ...request, ...changes }, () => {}));
  assert.equal(fixture.requests.length, before);
});

for (const refusal of [
  "thread",
  "missing-thread",
  "source",
  "branch",
  "running",
  "orphan",
  "timer",
  "unknown-operation",
  "wrong-fence",
])
  test(
    `native explicit resume refuses ${refusal} without starting another worker`,
    posixGuest,
    async (t) => {
      const fixture = guestFixture(
        t,
        refusal === "missing-thread" ? {} : { threadId: resumeThread },
      );
      const { transport, read, write } = fixture;
      await transport.run(
        await launchRequest(transport, { allowanceMs: 60000 }),
        () => {},
      );
      const state = read();
      const changes = {};
      if (refusal === "thread") {
        changes.threadId = "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee";
        changes.argv = [
          "exec",
          "resume",
          "--json",
          "--skip-git-repo-check",
          "-c",
          'sandbox_mode="workspace-write"',
          changes.threadId,
          "Continue",
        ];
      }
      if (refusal === "source") changes.sourceRevision = "f".repeat(40);
      if (refusal === "branch") changes.branch = "codex/foreign";
      if (refusal === "running") {
        state.container.State.Running = true;
        state.container.State.Pid = 42;
      }
      if (refusal === "orphan") state.alive = true;
      if (refusal === "timer")
        state.timers[
          state.commands
            .find((args) => args[0] === "systemd-run")
            .find((arg) => arg.startsWith("--unit="))
            .slice(7) + ".timer"
        ] = { active: "active", sub: "waiting", starts: [] };
      if (refusal === "unknown-operation")
        changes.resumeFrom = {
          ...session,
          state: "stopped",
          operationId: "42345678-1234-4234-8234-123456789abc",
        };
      if (refusal === "wrong-fence")
        changes.resumeFrom = { ...session, state: "stopped", fence: 2 };
      // The external engine's persisted container identities refer to the same
      // simulated process; update its observation, not the management journal.
      if (refusal === "running")
        for (const c of Object.values(state.containers))
          c.State = state.container.State;
      write(state);
      await assert.rejects(
        transport.run(await nativeResumeRequest(transport, changes), () => {}),
      );
      assert.equal(
        read().commands.filter((args) => args[1] === "create").length,
        1,
      );
      assert.equal(
        read().commands.filter((args) => args[1] === "start").length,
        1,
      );
    },
  );

test(
  "native explicit resume refuses a retained predecessor when fresh dispatch admission is denied",
  posixGuest,
  async (t) => {
    const { transport, read } = guestFixture(t, { threadId: resumeThread });
    await transport.run(
      await launchRequest(transport, { allowanceMs: 60000 }),
      () => {},
    );
    await assert.rejects(
      transport.run(
        await nativeResumeRequest(transport, { mayDispatch: () => false }),
        () => {},
      ),
    );
    assert.equal(
      read().commands.filter((args) => args[1] === "create").length,
      1,
    );
    await transport.run(await nativeResumeRequest(transport), () => {});
    assert.equal(
      read().commands.filter((args) => args[1] === "create").length,
      2,
    );
  },
);

for (const mismatch of ["different", "missing"])
  test(
    `native explicit resume rejects ${mismatch} resumed thread output and stops the new worker`,
    posixGuest,
    async (t) => {
      const { transport, read, write } = guestFixture(t, {
        threadId: resumeThread,
      });
      await transport.run(
        await launchRequest(transport, { allowanceMs: 60000 }),
        () => {},
      );
      const state = read();
      state.threadId =
        mismatch === "different"
          ? "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee"
          : undefined;
      write(state);
      const output = [];
      await assert.rejects(
        transport.run(await nativeResumeRequest(transport), (b) =>
          output.push(b),
        ),
      );
      assert.equal(output.length, 0);
      assert.equal(read().container.State.Running, false);
      assert.equal(read().alive, false);
    },
  );

test("native explicit resume snapshots predecessor identity across admission callbacks", async (t) => {
  const fixture = nativeHost(t, (r) => ({
    session: r.session,
    binding: observation,
    cliSha256: r.cliSha256,
  }));
  const transport = new NativePodmanCodingTransport(
    "aios-test",
    "a".repeat(64),
  );
  const request = await nativeResumeRequest(transport);
  request.mayDispatch = () => {
    request.resumeFrom.fence = 2;
    return true;
  };
  await assert.rejects(transport.run(request, () => {}));
  assert.equal(
    fixture.requests.some((r) => r.action === "prepare"),
    false,
  );
});

test(
  "native explicit resume can continue the latest stopped turn but cannot reuse its ancestor",
  posixGuest,
  async (t) => {
    const { transport, read } = guestFixture(t, { threadId: resumeThread });
    await transport.run(
      await launchRequest(transport, { allowanceMs: 60000 }),
      () => {},
    );
    const second = await nativeResumeRequest(transport);
    await transport.run(second, () => {});
    const third = await nativeResumeRequest(transport, {
      operationId: "32345678-1234-4234-8234-123456789abc",
      resumeFrom: {
        operationId: second.operationId,
        fence: second.fence,
        state: "stopped",
        intent: "resume",
        threadId: resumeThread,
      },
    });
    await transport.run(third, () => {});
    assert.equal(
      read().commands.filter((args) => args[1] === "start").length,
      3,
    );
  },
);

for (const unsafeHome of ["missing", "hardlink", "symlink", "oversized"])
  test(
    `native explicit resume refuses ${unsafeHome} retained home before claiming it`,
    posixGuest,
    async (t) => {
      const { transport, read } = guestFixture(t, { threadId: resumeThread });
      await transport.run(
        await launchRequest(transport, { allowanceMs: 60000 }),
        () => {},
      );
      const mounts = read().container.Mounts;
      const home = mounts.find((m) => m.Destination === "/session").Source;
      const workspace = mounts.find(
        (m) => m.Destination === "/workspace",
      ).Source;
      if (unsafeHome === "missing") fs.renameSync(home, `${home}-missing`);
      else if (unsafeHome === "hardlink")
        fs.linkSync(`${workspace}/index.html`, `${home}/shared-output`);
      else if (unsafeHome === "symlink")
        fs.symlinkSync(`${workspace}/index.html`, `${home}/shared-output`);
      else realWriteFileSync(`${home}/oversized`, Buffer.alloc(4194305));
      await assert.rejects(
        transport.run(await nativeResumeRequest(transport), () => {}),
      );
      assert.equal(
        read().commands.filter((args) => args[1] === "create").length,
        1,
      );
      if (unsafeHome === "missing") fs.renameSync(`${home}-missing`, home);
      else
        fs.unlinkSync(
          `${home}/${unsafeHome === "oversized" ? "oversized" : "shared-output"}`,
        );
      await transport.run(
        await nativeResumeRequest(transport, {
          operationId: "32345678-1234-4234-8234-123456789abc",
        }),
        () => {},
      );
      assert.equal(
        read().commands.filter((args) => args[1] === "create").length,
        2,
      );
    },
  );

test(
  "native explicit resume keeps predecessor recovery separate from a running successor",
  posixGuest,
  async (t) => {
    const { transport, read, write } = guestFixture(t, {
      threadId: resumeThread,
    });
    await transport.run(
      await launchRequest(transport, { allowanceMs: 60000 }),
      () => {},
    );
    const state = read();
    state.keepRunning = true;
    write(state);
    let permit = true;
    let outputReady;
    const ready = new Promise((resolve) => {
      outputReady = resolve;
    });
    const request = await nativeResumeRequest(transport, {
      checkpoint: () => permit,
    });
    const running = transport.run(request, () => outputReady());
    // Attach rejection handling before an intentional later checkpoint refusal.
    const stopped = assert.rejects(running);
    try {
      await Promise.race([
        ready,
        running.then(() => {
          throw Error("successor exited before output");
        }),
      ]);
      const current = read().container;
      assert.equal(current.State.Running, true);
      await assert.rejects(
        transport.observeSession({ ...session, state: "stopped" }),
      );
      await assert.rejects(transport.stop({ ...session, state: "stopped" }));
      const after = read().container;
      assert.equal(after.State.Running, true);
      assert.equal(after.State.Pid, current.State.Pid);
      assert.deepEqual(after.Config.Labels, current.Config.Labels);
      assert.equal(
        read().commands.filter(
          (args) => args[0] === "podman" && args[1] === "stop",
        ).length,
        0,
      );
    } finally {
      permit = false;
      await stopped;
    }
    assert.equal(read().container.State.Running, false);
  },
);

test("native first launch cannot borrow a predecessor home without explicit resume intent", async (t) => {
  const fixture = nativeHost(t, (r) => ({
    session: r.session,
    binding: observation,
    cliSha256: r.cliSha256,
  }));
  const transport = new NativePodmanCodingTransport(
    "aios-test",
    "a".repeat(64),
  );
  const request = await launchRequest(transport, {
    resumeFrom: { ...session, state: "stopped" },
  });
  const before = fixture.requests.length;
  await assert.rejects(transport.run(request, () => {}));
  assert.equal(fixture.requests.length, before);
});

test(
  "native explicit resume refuses changed host runtime pins even when guest pins are unchanged",
  posixGuest,
  async (t) => {
    const { transport, read } = guestFixture(t, { threadId: resumeThread });
    await transport.run(
      await launchRequest(transport, { allowanceMs: 60000 }),
      () => {},
    );
    const hostRead = fs.readFileSync;
    t.mock.method(fs, "readFileSync", (path, ...args) =>
      String(path).endsWith("aios-test.json")
        ? hostRead(path, ...args)
        : Buffer.from("updated trusted host executable"),
    );
    syncBuiltinESMExports();
    await assert.rejects(
      transport.run(await nativeResumeRequest(transport), () => {}),
    );
    assert.equal(
      read().commands.filter((args) => args[1] === "create").length,
      1,
    );
  },
);
