import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { resolve } from "node:path";
import { NativePodmanCodingTransport } from "../dist/podman-coding.js";
import { sessionAcceptance } from "../scripts/run-native-coding-acceptance.mjs";
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
  launchedGuest,
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
    const { transport, read, root } = await launchedGuest(t, {
      threadId: resumeThread,
    });
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

// What Codex 0.161 writes into its home on every start, observed natively.
function plantRegenerated(home) {
  const system = `${home}/skills/.system/imagegen`;
  realMkdirSync(system, { recursive: true });
  realWriteFileSync(`${system}/SKILL.md`, "built-in skill");
  realWriteFileSync(`${home}/skills/.system/.codex-system-skills.marker`, "x");
  const arg0 = `${home}/tmp/arg0/codex-arg0abc`;
  realMkdirSync(arg0, { recursive: true });
  realWriteFileSync(`${arg0}/.lock`, "");
  for (const name of ["apply_patch", "codex-linux-sandbox"])
    realSpawnSync("ln", ["-s", "/codex", `${arg0}/${name}`]);
  realMkdirSync(`${home}/.tmp`, { recursive: true });
  realWriteFileSync(`${home}/.tmp/plugins.sync.lock`, "");
  realMkdirSync(`${home}/sessions/2026/10/21`, { recursive: true });
  realWriteFileSync(`${home}/sessions/2026/10/21/rollout.jsonl`, "{}\n");
  realWriteFileSync(`${home}/state_5.sqlite`, "conversation state");
}

test(
  "native resume strips what Codex regenerates and carries the conversation over",
  posixGuest,
  async (t) => {
    const { transport, read } = await launchedGuest(t, {
      threadId: resumeThread,
    });
    const originalHome = read().container.Mounts.find(
      (m) => m.Destination === "/session",
    ).Source;
    plantRegenerated(originalHome);
    await transport.run(await nativeResumeRequest(transport), () => {});
    const resumedHome = read().container.Mounts.find(
      (m) => m.Destination === "/session",
    ).Source;
    assert.notEqual(
      resumedHome,
      originalHome,
      "the home moved to the successor",
    );
    const listing = realSpawnSync("find", [resumedHome], { encoding: "utf8" })
      .stdout.split("\n")
      .filter(Boolean)
      .map((path) => path.slice(resumedHome.length))
      .sort();
    for (const regenerated of ["/skills", "/tmp", "/.tmp"])
      assert.ok(
        !listing.some(
          (path) => path.startsWith(regenerated + "/") || path === regenerated,
        ),
        `${regenerated} was removed before reuse`,
      );
    assert.ok(listing.includes("/sessions/2026/10/21/rollout.jsonl"));
    assert.ok(listing.includes("/state_5.sqlite"));
  },
);

test(
  "native resume refuses a planted skill beside the built-in ones and removes nothing",
  posixGuest,
  async (t) => {
    const { transport, read } = await launchedGuest(t, {
      threadId: resumeThread,
    });
    const originalHome = read().container.Mounts.find(
      (m) => m.Destination === "/session",
    ).Source;
    plantRegenerated(originalHome);
    realMkdirSync(`${originalHome}/skills/planted`, { recursive: true });
    realWriteFileSync(`${originalHome}/skills/planted/SKILL.md`, "planted");
    await assert.rejects(
      transport.run(await nativeResumeRequest(transport), () => {}),
    );
    assert.equal(
      realReadFileSync(
        `${originalHome}/skills/.system/imagegen/SKILL.md`,
        "utf8",
      ),
      "built-in skill",
      "nothing is removed from a refused home",
    );
  },
);

for (const [name, arrange] of [
  [
    "a configuration file",
    (home) => realWriteFileSync(`${home}/config.toml`, "x"),
  ],
  [
    "a capitalized skills folder",
    (home) => realMkdirSync(`${home}/Skills/planted`, { recursive: true }),
  ],
  [
    "a skills link",
    (home) => {
      realSpawnSync("rm", ["-rf", `${home}/skills`]);
      realSpawnSync("ln", ["-s", "/etc", `${home}/skills`]);
    },
  ],
])
  test(
    `native resume refuses ${name} beside Codex's regenerated files and removes nothing`,
    posixGuest,
    async (t) => {
      const { transport, read } = await launchedGuest(t, {
        threadId: resumeThread,
      });
      const home = read().container.Mounts.find(
        (m) => m.Destination === "/session",
      ).Source;
      plantRegenerated(home);
      arrange(home);
      await assert.rejects(
        transport.run(await nativeResumeRequest(transport), () => {}),
      );
      assert.equal(
        realSpawnSync("test", ["-e", `${home}/tmp/arg0/codex-arg0abc/.lock`])
          .status,
        0,
        "the regenerated files are still there",
      );
    },
  );

test(
  "removing a regenerated link never touches its target",
  posixGuest,
  async (t) => {
    const { transport, read } = await launchedGuest(t, {
      threadId: resumeThread,
    });
    const home = read().container.Mounts.find(
      (m) => m.Destination === "/session",
    ).Source;
    plantRegenerated(home);
    const outside = realMkdtempSync(`${realTemporaryDirectory}/aios-outside-`);
    t.after(() => realSpawnSync("rm", ["-rf", outside]));
    realWriteFileSync(`${outside}/keep`, "outside the home");
    realSpawnSync("ln", ["-s", outside, `${home}/tmp/outside`]);
    await transport.run(await nativeResumeRequest(transport), () => {});
    assert.equal(
      realReadFileSync(`${outside}/keep`, "utf8"),
      "outside the home",
    );
  },
);

test(
  "native resume still refuses a link outside what Codex regenerates",
  posixGuest,
  async (t) => {
    const { transport, read } = await launchedGuest(t, {
      threadId: resumeThread,
    });
    const originalHome = read().container.Mounts.find(
      (m) => m.Destination === "/session",
    ).Source;
    plantRegenerated(originalHome);
    realSpawnSync("ln", ["-s", "/etc", `${originalHome}/sessions/link`]);
    await assert.rejects(
      transport.run(await nativeResumeRequest(transport), () => {}),
    );
    assert.equal(
      read().commands.filter((args) => args[1] === "create").length,
      1,
      "no resumed worker is created",
    );
  },
);

for (const planted of [
  "config.toml",
  "hooks.json",
  "AGENTS.md",
  "AGENTS.override.md",
  "skills/planted/SKILL.md",
  "rules/default.rules",
  ".env",
  "managed_config.toml",
  "prompts/planted.md",
])
  test(
    `native explicit resume refuses retained worker-writable Codex configuration ${planted}`,
    posixGuest,
    async (t) => {
      const { transport, read } = await launchedGuest(t, {
        threadId: resumeThread,
      });
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
      const fixture = await launchedGuest(
        t,
        refusal === "missing-thread" ? {} : { threadId: resumeThread },
      );
      const { transport, read, write } = fixture;
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
    const { transport, read } = await launchedGuest(t, {
      threadId: resumeThread,
    });
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
      const { transport, read, write } = await launchedGuest(t, {
        threadId: resumeThread,
      });
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
    const { transport, read } = await launchedGuest(t, {
      threadId: resumeThread,
    });
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
      const { transport, read } = await launchedGuest(t, {
        threadId: resumeThread,
      });
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
    const { transport, read, write } = await launchedGuest(t, {
      threadId: resumeThread,
    });
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
    const { transport, read } = await launchedGuest(t, {
      threadId: resumeThread,
    });
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

const interruptedOperation = "52345678-1234-4234-8234-123456789abc";
const freshOperation = "62345678-1234-4234-8234-123456789abc";
const laterOperation = "72345678-1234-4234-8234-123456789abc";
const interruptedSuccessor = {
  ...session,
  operationId: interruptedOperation,
  fence: 2,
  intent: "resume",
  state: "stopped",
};
const namedPredecessor = { ...session, state: "stopped" };

// Strand a resume: the external engine refuses creation after the home
// transfer. `arrange` runs against the launched predecessor first.
async function strandedResume(t, arrange = () => {}) {
  const fixture = await launchedGuest(t, { threadId: resumeThread });
  const { transport, read, write } = fixture;
  const predecessorHome = read().container.Mounts.find(
    (m) => m.Destination === "/session",
  ).Source;
  arrange(predecessorHome);
  write({ ...read(), createUnavailable: true });
  await assert.rejects(
    transport.run(
      await nativeResumeRequest(transport, {
        operationId: interruptedOperation,
      }),
      () => {},
    ),
  );
  write({ ...read(), createUnavailable: false });
  // The management record sits beside each session's directory.
  const predecessorRecord = predecessorHome.replace(/\/home$/, ".json");
  return { ...fixture, predecessorHome, predecessorRecord };
}
// Every retained session home in the guest's external management state.
function sessionHomes(root) {
  return realSpawnSync(
    "find",
    [
      `${root}/.local/state/aios-coding-v1`,
      "-mindepth",
      "2",
      "-maxdepth",
      "2",
      "-name",
      "home",
    ],
    { encoding: "utf8" },
  )
    .stdout.split("\n")
    .filter(Boolean)
    .sort();
}
const resumeAgain = async (transport, operationId = laterOperation) =>
  transport.run(
    await nativeResumeRequest(transport, { operationId, fence: 3 }),
    () => {},
  );

test(
  "an interrupted resume preparation returns the retained home to its named predecessor",
  posixGuest,
  async (t) => {
    const { transport, predecessorHome } = await strandedResume(t, (home) =>
      realWriteFileSync(`${home}/retained-session`, "thread canary"),
    );
    await assert.rejects(
      resumeAgain(transport, freshOperation),
      "a reserved predecessor cannot be resumed before recovery",
    );
    const recovered = await transport.recoverInterruptedResume(
      interruptedSuccessor,
      namedPredecessor,
    );
    assert.equal(recovered.recovered, true);
    assert.equal(
      realReadFileSync(`${predecessorHome}/retained-session`, "utf8"),
      "thread canary",
    );
    const output = [];
    const result = await transport.run(
      await nativeResumeRequest(transport, {
        operationId: laterOperation,
        fence: 3,
      }),
      (bytes) => output.push(bytes),
    );
    assert.equal(result.exitCode, 1);
    assert.match(Buffer.concat(output).toString(), new RegExp(resumeThread));
  },
);

for (const refusal of [
  "launch-attempted-successor",
  "moved-home-without-reservation",
  "launched-successor",
  "different-predecessor",
  "already-recovered",
  "foreign-reservation",
  "foreign-reservation-after-return",
  "unstopped-successor",
  "both-homes",
])
  test(
    `interrupted resume recovery refuses ${refusal} without moving any retained home`,
    posixGuest,
    async (t) => {
      let fixture;
      let successor = interruptedSuccessor,
        predecessor = namedPredecessor;
      if (refusal === "launched-successor") {
        // A successor that actually ran owns a genuine continuation.
        fixture = await launchedGuest(t, { threadId: resumeThread });
        await fixture.transport.run(
          await nativeResumeRequest(fixture.transport),
          () => {},
        );
        successor = { ...interruptedSuccessor, operationId: resumedOperation };
      } else if (refusal === "launch-attempted-successor") {
        // Start failed after launch was attempted: Codex may have touched the home.
        fixture = await launchedGuest(t, { threadId: resumeThread });
        fixture.write({ ...fixture.read(), startUnavailable: true });
        await assert.rejects(
          fixture.transport.run(
            await nativeResumeRequest(fixture.transport, {
              operationId: interruptedOperation,
            }),
            () => {},
          ),
        );
        fixture.write({ ...fixture.read(), startUnavailable: false });
      } else fixture = await strandedResume(t);
      const { transport, root, predecessorHome, predecessorRecord } = fixture;
      if (refusal === "different-predecessor") {
        // A real, valid, stopped and unreserved session that this successor
        // never named must not receive its stranded home.
        await transport.run(
          await launchRequest(transport, {
            operationId: freshOperation,
            allowanceMs: 60000,
          }),
          () => {},
        );
        predecessor = { ...namedPredecessor, operationId: freshOperation };
      }
      if (refusal === "already-recovered")
        await transport.recoverInterruptedResume(
          interruptedSuccessor,
          namedPredecessor,
        );
      if (refusal === "foreign-reservation-after-return")
        // The home is already back; another successor's reservation must survive.
        realSpawnSync("mv", [sessionHomes(root)[0], predecessorHome]);
      // Fault injection into the external guest state, not an assertion source.
      if (
        [
          "foreign-reservation",
          "foreign-reservation-after-return",
          "moved-home-without-reservation",
        ].includes(refusal)
      ) {
        const record = JSON.parse(realReadFileSync(predecessorRecord, "utf8"));
        if (refusal.startsWith("foreign-reservation"))
          record.resumedBy = "f".repeat(64);
        else delete record.resumedBy;
        realWriteFileSync(predecessorRecord, JSON.stringify(record));
      }
      if (refusal === "unstopped-successor") {
        // A host lost mid-prepare never stopped the successor; its prepare may
        // still be live, so its home cannot be taken back underneath it.
        const successorRecord = sessionHomes(root)
          .find((home) => home !== predecessorHome)
          .replace(/\/home$/, ".json");
        const record = JSON.parse(realReadFileSync(successorRecord, "utf8"));
        record.phase = "preparing";
        realWriteFileSync(successorRecord, JSON.stringify(record));
      }
      if (refusal === "both-homes")
        realMkdirSync(predecessorHome, { mode: 0o700 });
      const before = sessionHomes(root);
      await assert.rejects(
        transport.recoverInterruptedResume(successor, predecessor),
      );
      assert.deepEqual(
        sessionHomes(root),
        before,
        "a refused recovery moves no home",
      );
    },
  );

for (const priorEffect of ["home-returned", "home-returned-and-released"])
  test(
    `interrupted resume recovery completes after a prior partial recovery: ${priorEffect}`,
    posixGuest,
    async (t) => {
      const { transport, root, predecessorHome, predecessorRecord } =
        await strandedResume(t);
      // A previous attempt returned the home (and possibly released the
      // reservation) before stopping; recovery must finish idempotently.
      const [successorHome] = sessionHomes(root);
      realSpawnSync("mv", [successorHome, predecessorHome]);
      if (priorEffect === "home-returned-and-released") {
        const record = JSON.parse(realReadFileSync(predecessorRecord, "utf8"));
        delete record.resumedBy;
        realWriteFileSync(predecessorRecord, JSON.stringify(record));
      }
      const recovered = await transport.recoverInterruptedResume(
        interruptedSuccessor,
        namedPredecessor,
      );
      assert.equal(recovered.recovered, true);
      assert.equal((await resumeAgain(transport)).exitCode, 1);
    },
  );

test(
  "interrupted resume recovery refuses when the retained home is lost and keeps the predecessor blocked",
  posixGuest,
  async (t) => {
    const { transport, root } = await strandedResume(t);
    for (const home of sessionHomes(root))
      realRmSync(home, { recursive: true, force: true });
    await assert.rejects(
      transport.recoverInterruptedResume(
        interruptedSuccessor,
        namedPredecessor,
      ),
    );
    await assert.rejects(
      resumeAgain(transport),
      "an unrecoverable predecessor stays reserved",
    );
  },
);

test("interrupted resume recovery rejects malformed identities before guest effects", async (t) => {
  const fixture = nativeHost(t, (r) => ({
    session: r.session,
    binding: observation,
    cliSha256: r.cliSha256,
  }));
  const transport = new NativePodmanCodingTransport(
    "aios-test",
    "a".repeat(64),
  );
  for (const [successor, predecessor] of [
    [interruptedSuccessor, undefined],
    [interruptedSuccessor, { ...namedPredecessor, operationId: "--last" }],
    [
      interruptedSuccessor,
      { ...namedPredecessor, operationId: interruptedOperation },
    ],
    [interruptedSuccessor, { ...namedPredecessor, fence: 3 }],
    [interruptedSuccessor, { ...namedPredecessor, fence: 0 }],
    [interruptedSuccessor, { ...namedPredecessor, state: "running" }],
    [interruptedSuccessor, { ...namedPredecessor, intent: "recover" }],
    [undefined, namedPredecessor],
    [{ ...interruptedSuccessor, operationId: "../foreign" }, namedPredecessor],
    [{ ...interruptedSuccessor, fence: 1.5 }, namedPredecessor],
  ])
    await assert.rejects(
      transport.recoverInterruptedResume(successor, predecessor),
    );
  assert.equal(fixture.requests.length, 0);
});

// A resume refused by the retained-home check never records its preparation;
// the controller's exact-session stop then leaves only a revoked record.
async function unpreparedResume(t) {
  const fixture = await strandedResume(t, (home) =>
    realWriteFileSync(`${home}/config.toml`, "planted by a prior turn"),
  );
  await fixture.transport.stop({ ...interruptedSuccessor, state: "running" });
  return fixture;
}

test(
  "interrupted resume recovery releases a successor whose preparation was never recorded",
  posixGuest,
  async (t) => {
    const { transport, root } = await unpreparedResume(t);
    const before = sessionHomes(root);
    const recovered = await transport.recoverInterruptedResume(
      interruptedSuccessor,
      namedPredecessor,
    );
    assert.equal(recovered.recovered, true);
    assert.deepEqual(sessionHomes(root), before, "nothing was moved");
    await assert.rejects(
      transport.recoverInterruptedResume(
        interruptedSuccessor,
        namedPredecessor,
      ),
      "the successor is consumed",
    );
  },
);

test(
  "interrupted resume recovery refuses an unrecorded preparation that holds a home",
  posixGuest,
  async (t) => {
    const { transport, root, predecessorRecord } = await unpreparedResume(t);
    // Fault injection into the external guest state, not an assertion source.
    const state = `${root}/.local/state/aios-coding-v1`;
    const successorRecord = realSpawnSync(
      "find",
      [state, "-maxdepth", "1", "-name", "aios-coding-*.json"],
      { encoding: "utf8" },
    )
      .stdout.split("\n")
      .find((path) => path && path !== predecessorRecord);
    realMkdirSync(successorRecord.replace(/\.json$/, "/home"), {
      recursive: true,
      mode: 0o700,
    });
    const before = sessionHomes(root);
    await assert.rejects(
      transport.recoverInterruptedResume(
        interruptedSuccessor,
        namedPredecessor,
      ),
    );
    assert.deepEqual(sessionHomes(root), before);
  },
);

// A resume that launched, then lost its controller-side stream: the guest
// may or may not have recorded the CLI thread before the worker stopped.
const launchedSuccessor = {
  ...session,
  operationId: resumedOperation,
  fence: 2,
  intent: "resume",
  state: "stopped",
  threadId: resumeThread,
};
async function launchedResume(t, { threadRecorded }) {
  const fixture = await launchedGuest(t, { threadId: resumeThread });
  const { transport, read, write, root } = fixture;
  if (!threadRecorded) write({ ...read(), startUnavailable: true });
  await assert.rejects(
    transport.run(await nativeResumeRequest(transport), () => {
      throw Error("controller rejected the stream");
    }),
  );
  if (!threadRecorded) write({ ...read(), startUnavailable: false });
  await transport.stop({ ...launchedSuccessor, state: "running" });
  await assert.rejects(
    transport.recoverInterruptedResume(launchedSuccessor, namedPredecessor),
    "a launched resume is never recovered",
  );
  return { ...fixture, before: sessionHomes(root) };
}

test(
  "a launched resume whose thread the guest recorded is adopted as the next predecessor",
  posixGuest,
  async (t) => {
    const { transport, root, before } = await launchedResume(t, {
      threadRecorded: true,
    });
    const reconciled = await transport.reconcileInterruptedResume(
      launchedSuccessor,
      namedPredecessor,
      false,
    );
    assert.equal(reconciled.outcome, "adopted");
    assert.deepEqual(sessionHomes(root), before, "nothing was moved");
    await transport.run(
      await nativeResumeRequest(transport, {
        operationId: laterOperation,
        fence: 3,
        resumeFrom: { ...launchedSuccessor },
      }),
      () => {},
    );
  },
);

test(
  "a launched resume without a recorded thread stays unresolved until the owner retires it",
  posixGuest,
  async (t) => {
    const { transport, root, before } = await launchedResume(t, {
      threadRecorded: false,
    });
    const observed = await transport.reconcileInterruptedResume(
      launchedSuccessor,
      namedPredecessor,
      false,
    );
    assert.equal(observed.outcome, "unresolved");
    const retired = await transport.reconcileInterruptedResume(
      launchedSuccessor,
      namedPredecessor,
      true,
    );
    assert.equal(retired.outcome, "retired");
    assert.deepEqual(sessionHomes(root), before, "the home stays quarantined");
    for (const resumeFrom of [namedPredecessor, launchedSuccessor])
      await assert.rejects(
        transport.run(
          await nativeResumeRequest(transport, {
            operationId: laterOperation,
            fence: 3,
            resumeFrom: { ...resumeFrom, threadId: undefined },
          }),
          () => {},
        ),
        "neither lineage session is ever resumed again",
      );
  },
);

test(
  "reconciliation refuses a resume that never launched",
  posixGuest,
  async (t) => {
    const { transport } = await strandedResume(t);
    for (const retire of [false, true])
      await assert.rejects(
        transport.reconcileInterruptedResume(
          interruptedSuccessor,
          namedPredecessor,
          retire,
        ),
      );
  },
);

for (const fault of ["home-returned", "foreign-reservation"])
  test(
    `reconciliation refuses inconsistent launched-resume state: ${fault}`,
    posixGuest,
    async (t) => {
      const { transport, root } = await launchedResume(t, {
        threadRecorded: false,
      });
      // Fault injection into the external guest state, not an assertion source.
      const homes = sessionHomes(root);
      assert.equal(homes.length, 1, "the launched successor holds the home");
      const predecessorRecord = realSpawnSync(
        "find",
        [
          `${root}/.local/state/aios-coding-v1`,
          "-maxdepth",
          "1",
          "-name",
          "aios-coding-*.json",
        ],
        { encoding: "utf8" },
      )
        .stdout.split("\n")
        .filter(Boolean)
        .find((path) => !homes[0].startsWith(path.replace(/\.json$/, "")));
      if (fault === "home-returned")
        realSpawnSync("mv", [
          homes[0],
          predecessorRecord.replace(/\.json$/, "/home"),
        ]);
      else {
        const record = JSON.parse(realReadFileSync(predecessorRecord, "utf8"));
        record.resumedBy = "f".repeat(64);
        realWriteFileSync(predecessorRecord, JSON.stringify(record));
      }
      const before = sessionHomes(root);
      for (const retire of [false, true])
        await assert.rejects(
          transport.reconcileInterruptedResume(
            launchedSuccessor,
            namedPredecessor,
            retire,
          ),
        );
      assert.deepEqual(sessionHomes(root), before);
    },
  );

for (const [method, args, receipt] of [
  [
    "recoverInterruptedResume",
    [interruptedSuccessor, namedPredecessor],
    { recovered: false },
  ],
  [
    "reconcileInterruptedResume",
    [launchedSuccessor, namedPredecessor, false],
    { outcome: "assumed" },
  ],
])
  test(`${method} treats an unrecognized guest receipt as uncertain`, async (t) => {
    const fixture = nativeHost(t, (r) => ({
      session: r.session,
      binding: observation,
      cliSha256: r.cliSha256,
      ...receipt,
    }));
    const transport = new NativePodmanCodingTransport(
      "aios-test",
      "a".repeat(64),
    );
    await assert.rejects(transport[method](...args), /uncertain/);
    assert.equal(fixture.requests.length, 1, "the guest was asked once");
  });

test("resume reconciliation requires an explicit retire decision before guest effects", async (t) => {
  const fixture = nativeHost(t, (r) => ({
    session: r.session,
    binding: observation,
    cliSha256: r.cliSha256,
    outcome: "retired",
  }));
  const transport = new NativePodmanCodingTransport(
    "aios-test",
    "a".repeat(64),
  );
  for (const retire of [undefined, "yes", 1])
    await assert.rejects(
      transport.reconcileInterruptedResume(
        launchedSuccessor,
        namedPredecessor,
        retire,
      ),
    );
  assert.equal(fixture.requests.length, 0);
});

// Session folders and records in the guest's external management state.
function guestSessions(root) {
  const listing = realSpawnSync(
    "find",
    [`${root}/.local/state/aios-coding-v1`, "-mindepth", "1", "-maxdepth", "1"],
    { encoding: "utf8" },
  ).stdout.split("\n");
  return {
    folders: listing.filter((p) => /\/aios-coding-[a-f0-9]+$/.test(p)).sort(),
    records: listing.filter((p) => /\/aios-coding-[a-f0-9]+\.json$/.test(p)),
  };
}
async function retiredResume(t) {
  const fixture = await launchedResume(t, { threadRecorded: false });
  const { outcome } = await fixture.transport.reconcileInterruptedResume(
    launchedSuccessor,
    namedPredecessor,
    true,
  );
  assert.equal(outcome, "retired");
  return fixture;
}

test(
  "cleanup removes a retired lineage's session folders and containers and keeps tombstone records",
  posixGuest,
  async (t) => {
    const { transport, root, read } = await retiredResume(t);
    const before = guestSessions(root);
    assert.equal(before.folders.length, 2, "the successor and its predecessor");
    const receipt = await transport.cleanupRetiredLineage(launchedSuccessor);
    assert.equal(receipt.operationId, launchedSuccessor.operationId);
    assert.equal(receipt.cleaned, 2);
    const after = guestSessions(root);
    assert.deepEqual(after.folders, [], "every lineage folder is gone");
    assert.deepEqual(sessionHomes(root), []);
    assert.equal(after.records.length, 2, "records stay as tombstones");
    for (const path of after.records)
      assert.equal(JSON.parse(realReadFileSync(path, "utf8")).cleaned, true);
    assert.deepEqual(
      Object.keys(read().containers ?? {}),
      [],
      "the stopped containers are removed",
    );
    assert.equal(
      (await transport.cleanupRetiredLineage(launchedSuccessor)).cleaned,
      2,
      "a repeated cleanup is idempotent",
    );
    for (const resumeFrom of [namedPredecessor, launchedSuccessor])
      await assert.rejects(
        transport.run(
          await nativeResumeRequest(transport, {
            operationId: laterOperation,
            fence: 3,
            resumeFrom: { ...resumeFrom, threadId: undefined },
          }),
          () => {},
        ),
        "a cleaned lineage is never resumed",
      );
  },
);

test(
  "an interrupted cleanup completes on a re-run, including directories a worker made read-only",
  posixGuest,
  async (t) => {
    const { transport, root, read, write } = await retiredResume(t);
    const [predecessorFolder] = guestSessions(root).folders.filter(
      (folder) => !sessionHomes(root)[0].startsWith(folder),
    );
    // A worker-made directory without write permission in a workspace.
    const locked = `${predecessorFolder}/workspace/locked`;
    realMkdirSync(locked);
    realWriteFileSync(`${locked}/file`, "x");
    fs.chmodSync(locked, 0o555);
    const predecessorName = predecessorFolder.split("/").at(-1);
    write({ ...read(), rmRefused: predecessorName });
    await assert.rejects(transport.cleanupRetiredLineage(launchedSuccessor));
    assert.deepEqual(
      guestSessions(root).folders,
      [predecessorFolder],
      "the engine refused partway; only the successor is gone",
    );
    write({ ...read(), rmRefused: undefined });
    assert.equal(
      (await transport.cleanupRetiredLineage(launchedSuccessor)).cleaned,
      2,
    );
    assert.deepEqual(guestSessions(root).folders, []);
  },
);

for (const [name, arrange] of [
  [
    "an unresolved resume",
    async (t) => launchedResume(t, { threadRecorded: false }),
  ],
  [
    "an adopted resume",
    async (t) => {
      const fixture = await launchedResume(t, { threadRecorded: true });
      await fixture.transport.reconcileInterruptedResume(
        launchedSuccessor,
        namedPredecessor,
        false,
      );
      return fixture;
    },
  ],
  [
    "a predecessor reserved by another session",
    async (t) => {
      const fixture = await retiredResume(t);
      // Fault injection into the external guest state, not an assertion source.
      const homes = sessionHomes(fixture.root);
      const predecessorRecord = guestSessions(fixture.root).records.find(
        (path) => !homes[0].startsWith(path.replace(/\.json$/, "")),
      );
      const record = JSON.parse(realReadFileSync(predecessorRecord, "utf8"));
      record.resumedBy = "f".repeat(64);
      realWriteFileSync(predecessorRecord, JSON.stringify(record));
      return fixture;
    },
  ],
  [
    "a lineage container that still has a process",
    async (t) => {
      const fixture = await retiredResume(t);
      const state = fixture.read();
      // The predecessor, which a cleanup without the check would reach after
      // already removing the successor. A running container would also change
      // the engine binding, so this one reports a process while not running.
      for (const name of Object.keys(state.containers))
        if (name !== state.containerName) state.containers[name].State.Pid = 99;
      fixture.write(state);
      return fixture;
    },
  ],
  [
    "an active lineage timer",
    async (t) => {
      const fixture = await retiredResume(t);
      const state = fixture.read();
      const [name] = Object.keys(state.containers);
      state.timers = {
        ...state.timers,
        [`${name}-lease.timer`]: { active: "active" },
      };
      fixture.write(state);
      return fixture;
    },
  ],
  [
    "a lineage container with a foreign label",
    async (t) => {
      const fixture = await retiredResume(t);
      const state = fixture.read();
      for (const name of Object.keys(state.containers))
        if (name !== state.containerName)
          state.containers[name].Config.Labels["aios.extra"] = "1";
      fixture.write(state);
      return fixture;
    },
  ],
  [
    "a lineage folder replaced by a link",
    async (t) => {
      const fixture = await retiredResume(t);
      const [predecessorFolder] = guestSessions(fixture.root).folders.filter(
        (folder) => !sessionHomes(fixture.root)[0].startsWith(folder),
      );
      const elsewhere = realMkdtempSync(
        `${realTemporaryDirectory}/aios-elsewhere-`,
      );
      t.after(() => realRmSync(elsewhere, { recursive: true, force: true }));
      // The fixture mocks parts of fs, so use real external commands.
      realSpawnSync("rm", ["-rf", predecessorFolder]);
      realSpawnSync("ln", ["-s", elsewhere, predecessorFolder]);
      return fixture;
    },
  ],
])
  test(`cleanup refuses ${name} and removes nothing`, posixGuest, async (t) => {
    const fixture = await arrange(t);
    const before = guestSessions(fixture.root);
    await assert.rejects(
      fixture.transport.cleanupRetiredLineage(launchedSuccessor),
    );
    assert.deepEqual(guestSessions(fixture.root), before);
  });

test("lineage cleanup rejects a malformed session before guest effects", async (t) => {
  const fixture = nativeHost(t, (r) => ({
    session: r.session,
    binding: observation,
    cliSha256: r.cliSha256,
    cleaned: 2,
  }));
  const transport = new NativePodmanCodingTransport(
    "aios-test",
    "a".repeat(64),
  );
  for (const session of [
    { ...launchedSuccessor, operationId: "not-a-uuid" },
    { ...launchedSuccessor, fence: 0 },
    { ...launchedSuccessor, state: "running" },
    { ...launchedSuccessor, intent: "start" },
  ])
    await assert.rejects(transport.cleanupRetiredLineage(session));
  assert.equal(fixture.requests.length, 0);
});

test("lineage cleanup treats an unrecognized guest receipt as uncertain", async (t) => {
  const fixture = nativeHost(t, (r) => ({
    session: r.session,
    binding: observation,
    cliSha256: r.cliSha256,
    cleaned: "all",
  }));
  const transport = new NativePodmanCodingTransport(
    "aios-test",
    "a".repeat(64),
  );
  await assert.rejects(
    transport.cleanupRetiredLineage(launchedSuccessor),
    /uncertain/,
  );
  assert.equal(fixture.requests.length, 1);
});

// A resume onto a moved main: the predecessor launched on revision "b…".
const movedBase = { from: "b".repeat(40), to: "c".repeat(40) };

test(
  "a resume onto a moved main names the exact move and the guest records it",
  posixGuest,
  async (t) => {
    const { transport, root } = await launchedGuest(t, {
      threadId: resumeThread,
    });
    await transport.run(
      await nativeResumeRequest(transport, {
        sourceRevision: movedBase.to,
        baseMove: movedBase,
      }),
      () => {},
    );
    const record = guestSessions(root)
      .records.map((path) => JSON.parse(realReadFileSync(path, "utf8")))
      .find((r) => r.admission?.resumeFrom);
    assert.deepEqual(record.admission.baseMove, movedBase);
    assert.equal(record.admission.sourceRevision, movedBase.to);
  },
);

test(
  "native resume refuses a move from a revision the predecessor never used",
  posixGuest,
  async (t) => {
    const { transport, root } = await launchedGuest(t, {
      threadId: resumeThread,
    });
    const before = sessionHomes(root);
    await assert.rejects(
      transport.run(
        await nativeResumeRequest(transport, {
          sourceRevision: movedBase.to,
          baseMove: { from: "d".repeat(40), to: movedBase.to },
        }),
        () => {},
      ),
    );
    assert.deepEqual(sessionHomes(root), before, "the home was never moved");
  },
);

test("native resume rejects a malformed base move before guest effects", async (t) => {
  const fixture = nativeHost(t, (r) => ({
    session: r.session,
    binding: observation,
    cliSha256: r.cliSha256,
  }));
  const transport = new NativePodmanCodingTransport(
    "aios-test",
    "a".repeat(64),
  );
  const resume = await nativeResumeRequest(transport, {
    sourceRevision: movedBase.to,
  });
  const launch = await launchRequest(transport, {
    sourceRevision: movedBase.to,
  });
  const before = fixture.requests.length;
  for (const baseMove of [
    { from: movedBase.from, to: "e".repeat(40) },
    { from: movedBase.to, to: movedBase.to },
    { from: "not-a-revision", to: movedBase.to },
    { ...movedBase, extra: true },
    "moved",
  ])
    await assert.rejects(
      transport.run({ ...resume, baseMove }, () => {}),
      /Unsupported native coding/,
    );
  await assert.rejects(
    transport.run({ ...launch, baseMove: movedBase }, () => {}),
    /Unsupported native coding/,
    "a first launch never names a base move",
  );
  assert.equal(fixture.requests.length, before);
});

test(
  "the owner-run native session acceptance passes against the guest fixture",
  posixGuest,
  async (t) => {
    const { transport, root } = guestFixture(t, { threadId: resumeThread });
    const persisted = [];
    const report = await sessionAcceptance(transport, {
      persist: (r) => persisted.push(r.stages.length),
    });
    assert.equal(
      report.outcome,
      "observed-offline-session-acceptance",
      report.error,
    );
    assert.equal(report.productionEnabled, false);
    assert.equal(report.qualified, false);
    assert.ok(
      report.stages.every((s) => s.outcome === "passed"),
      JSON.stringify(report.stages.filter((s) => s.outcome !== "passed")),
    );
    assert.ok(persisted.length > report.stages.length, "persisted per stage");
    assert.ok(
      guestSessions(root).folders.length >= 4,
      "lineage A's session folders remain",
    );
  },
);

test(
  "the native session acceptance reports a missing offline thread as blocked before any resume",
  posixGuest,
  async (t) => {
    const { transport } = guestFixture(t);
    const report = await sessionAcceptance(transport);
    assert.equal(report.outcome, "blocked-before-thread");
    assert.deepEqual(
      report.stages
        .filter((s) => !s.name.startsWith("final-stop"))
        .map((s) => [s.name, s.outcome]),
      [
        ["fresh-pins", "passed"],
        ["lineage-a-first-launch-thread", "blocked"],
      ],
    );
    assert.ok(
      report.stages
        .filter((s) => s.name.startsWith("final-stop"))
        .every((s) => s.outcome === "passed"),
    );
  },
);

test("the native session acceptance command needs a machine, a new report and explicit approval", () => {
  for (const args of [
    [],
    ["aios-macos-noshare", "/tmp/report.json"],
    ["not-a-machine", "/tmp/report.json", "--approve-offline-native-run"],
    ["aios-macos-noshare", "/tmp/report.json", "--approve"],
    [
      "aios-macos-noshare",
      "/tmp/report.json",
      "--approve-offline-native-run",
      "extra",
    ],
  ]) {
    const result = realSpawnSync(
      process.execPath,
      ["scripts/run-native-coding-acceptance.mjs", ...args],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1, args.join(" "));
    assert.match(result.stderr, /approve-offline-native-run/);
  }
});
