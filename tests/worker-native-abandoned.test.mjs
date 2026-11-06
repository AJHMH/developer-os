import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  realSpawnSync,
  realReadFileSync,
  realWriteFileSync,
  launchRequest,
  session,
  guestFixture,
  launchedGuest,
  posixGuest,
  observation,
  nativeHost,
} from "./helpers/native-coding-fixture.mjs";
import { NativePodmanCodingTransport } from "../dist/podman-coding.js";

// The owner's sweep of coding sessions nothing can ever need again. Each case
// builds its session through the real transport against the guest simulator,
// so a state only counts if the guest program really reaches it.
const thread = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const predecessor = { ...session, state: "stopped" };
const successor = {
  operationId: "22345678-1234-4234-8234-123456789abc",
  fence: 2,
  state: "stopped",
  intent: "resume",
};

function resumeRequest(transport, overrides = {}) {
  return launchRequest(transport, {
    operationId: successor.operationId,
    fence: 2,
    intent: "resume",
    threadId: thread,
    resumeFrom: predecessor,
    argv: [
      "exec",
      "resume",
      "--json",
      "--skip-git-repo-check",
      "-c",
      'sandbox_mode="workspace-write"',
      thread,
      "Continue the title",
    ],
    allowanceMs: 60000,
    ...overrides,
  });
}
function guestState(root) {
  const listing = realSpawnSync(
    "find",
    [`${root}/.local/state/aios-coding-v1`, "-mindepth", "1", "-maxdepth", "1"],
    { encoding: "utf8" },
  ).stdout.split("\n");
  const records = listing.filter((p) =>
    /\/aios-coding-[a-f0-9]+\.json$/.test(p),
  );
  return {
    folders: listing.filter((p) => /\/aios-coding-[a-f0-9]+$/.test(p)).sort(),
    records: records.map((path) => ({
      path,
      ...JSON.parse(realReadFileSync(path, "utf8")),
    })),
  };
}
// The simulator keeps the latest container apart from earlier ones.
const engineContainers = (state) => ({
  ...state.containers,
  ...(state.containerName ? { [state.containerName]: state.container } : {}),
});
const containers = ({ read }) => Object.keys(engineContainers(read())).sort();
const nameOf = (entry) =>
  entry.path
    .split("/")
    .at(-1)
    .replace(/\.json$/, "");
const edit = (entry, change) => {
  const { path, ...record } = entry;
  realWriteFileSync(path, JSON.stringify({ ...record, ...change }));
};

/** A start stopped by its dispatch gate after `create`, never launched: the
 * engine keeps it as `created`. */
async function preparedStart(t, operationId = session.operationId) {
  const fixture = guestFixture(t);
  await addPreparedStart(fixture, operationId);
  return fixture;
}
async function addPreparedStart(fixture, operationId, fence = 1) {
  let calls = 0;
  await assert.rejects(
    fixture.transport.run(
      await launchRequest(fixture.transport, {
        operationId,
        fence,
        allowanceMs: 60000,
        mayDispatch: () => ++calls < 3,
      }),
      () => {},
    ),
    /authority changed/,
  );
  assert.equal(calls, 3, "stopped between prepare and launch");
}
async function failedCreate(t) {
  const fixture = guestFixture(t);
  fixture.write({ ...fixture.read(), createUnavailable: true });
  await assert.rejects(
    fixture.transport.run(
      await launchRequest(fixture.transport, { allowanceMs: 60000 }),
      () => {},
    ),
  );
  fixture.write({ ...fixture.read(), createUnavailable: false });
  return fixture;
}
/** A resume interrupted before launch whose home recovery returned. */
async function recoveredResume(t) {
  const fixture = await launchedGuest(t, { threadId: thread });
  fixture.write({ ...fixture.read(), createUnavailable: true });
  await assert.rejects(
    fixture.transport.run(await resumeRequest(fixture.transport), () => {}),
  );
  fixture.write({ ...fixture.read(), createUnavailable: false });
  return fixture;
}
async function strandedAfterCreate(t) {
  const fixture = await launchedGuest(t, { threadId: thread });
  let calls = 0;
  await assert.rejects(
    fixture.transport.run(
      await resumeRequest(fixture.transport, {
        mayDispatch: () => ++calls < 3,
      }),
      () => {},
    ),
    /authority changed/,
  );
  return fixture;
}
/** A launched resume that reported no thread: unresolved until settled. */
async function unresolvedResume(t) {
  const fixture = await launchedGuest(t, { threadId: thread });
  fixture.write({ ...fixture.read(), startUnavailable: true });
  await assert.rejects(
    fixture.transport.run(await resumeRequest(fixture.transport), () => {
      throw Error("controller rejected the stream");
    }),
  );
  fixture.write({ ...fixture.read(), startUnavailable: false });
  await fixture.transport.stop({ ...successor, state: "running" });
  return fixture;
}

for (const [name, arrange, sessions, hadContainer] of [
  ["a start stopped after create, never launched", preparedStart, 1, true],
  ["a start whose create failed", failedCreate, 1, false],
  ["a launched start that reported no thread", launchedGuest, 1, true],
])
  test(
    `the sweep removes ${name} and keeps its record as a tombstone`,
    posixGuest,
    async (t) => {
      const fixture = await arrange(t);
      const before = guestState(fixture.root);
      assert.equal(before.records.length, sessions);
      assert.equal(containers(fixture).length, hadContainer ? 1 : 0);

      const preview = await fixture.transport.cleanupAbandonedSessions(false);
      assert.equal(preview.abandoned, sessions);
      assert.equal(preview.removed, 0);
      assert.deepEqual(
        guestState(fixture.root).folders,
        before.folders,
        "a preview removes nothing",
      );
      assert.equal(containers(fixture).length, hadContainer ? 1 : 0);

      const swept = await fixture.transport.cleanupAbandonedSessions(true);
      assert.equal(swept.removed, sessions);
      assert.equal(swept.abandoned, 0);
      assert.equal(swept.refused, 0);
      assert.deepEqual(containers(fixture), []);
      const after = guestState(fixture.root);
      assert.deepEqual(after.folders, []);
      assert.equal(after.records.length, sessions);
      assert.ok(after.records.every((r) => r.cleaned === true));

      const again = await fixture.transport.cleanupAbandonedSessions(true);
      assert.equal(again.removed, 0, "a repeated sweep is idempotent");
      assert.equal(again.kept.cleaned, sessions);
      // A stop of the swept session still answers: nothing is left to stop.
      assert.equal((await fixture.transport.stop(predecessor)).stopped, true);
    },
  );

test(
  "the sweep removes a recovered resume and its predecessor still resumes",
  posixGuest,
  async (t) => {
    const fixture = await strandedAfterCreate(t);
    await fixture.transport.recoverInterruptedResume(successor, predecessor);
    const [recovered] = guestState(fixture.root).records.filter(
      (r) => r.recovered,
    );
    assert.ok(containers(fixture).includes(nameOf(recovered)));
    const swept = await fixture.transport.cleanupAbandonedSessions(true);
    assert.equal(swept.removed, 1);
    assert.equal(swept.kept.lineage, 1, "the predecessor stays");
    assert.ok(!containers(fixture).includes(nameOf(recovered)));
    assert.equal(containers(fixture).length, 1);
    await fixture.transport.run(
      await resumeRequest(fixture.transport, {
        operationId: randomUUID(),
        fence: 3,
      }),
      () => {},
    );
  },
);

test(
  "the sweep removes a recovered resume whose create failed",
  posixGuest,
  async (t) => {
    const fixture = await recoveredResume(t);
    await fixture.transport.recoverInterruptedResume(successor, predecessor);
    const swept = await fixture.transport.cleanupAbandonedSessions(true);
    assert.equal(swept.removed, 1);
    assert.equal(swept.kept.lineage, 1);
    assert.equal(containers(fixture).length, 1, "the predecessor's container");
  },
);

test(
  "the sweep keeps a recovered resume that still holds a home",
  posixGuest,
  async (t) => {
    const fixture = await strandedAfterCreate(t);
    await fixture.transport.recoverInterruptedResume(successor, predecessor);
    const [recovered] = guestState(fixture.root).records.filter(
      (r) => r.recovered,
    );
    realSpawnSync("mkdir", [
      "-m",
      "700",
      `${recovered.path.slice(0, -5)}/home`,
    ]);
    const swept = await fixture.transport.cleanupAbandonedSessions(true);
    assert.equal(swept.removed, 0);
    assert.equal(swept.kept.lineage, 2);
    assert.equal(containers(fixture).length, 2);
  },
);

// Every session resume or recovery still inspects by exact identity stays, and
// that later step still works after the sweep.
test(
  "the sweep keeps a threaded start and it still resumes",
  posixGuest,
  async (t) => {
    const fixture = await launchedGuest(t, { threadId: thread });
    const swept = await fixture.transport.cleanupAbandonedSessions(true);
    assert.equal(swept.removed, 0);
    assert.equal(swept.abandoned, 0);
    assert.equal(swept.kept.lineage, 1);
    assert.equal(containers(fixture).length, 1);
    await fixture.transport.run(
      await resumeRequest(fixture.transport),
      () => {},
    );
  },
);

test(
  "the sweep keeps a resumed lineage, and superseded cleanup still reaches it",
  posixGuest,
  async (t) => {
    const fixture = await launchedGuest(t, { threadId: thread });
    await fixture.transport.run(
      await resumeRequest(fixture.transport),
      () => {},
    );
    const swept = await fixture.transport.cleanupAbandonedSessions(true);
    assert.equal(swept.removed, 0);
    assert.equal(swept.kept.lineage, 2);
    assert.equal(containers(fixture).length, 2);
    const { cleaned } =
      await fixture.transport.cleanupSupersededLineage(successor);
    assert.equal(cleaned, 2);
  },
);

test(
  "the sweep keeps a stranded resume and its recovery still works",
  posixGuest,
  async (t) => {
    const fixture = await strandedAfterCreate(t);
    const swept = await fixture.transport.cleanupAbandonedSessions(true);
    assert.equal(swept.removed, 0);
    assert.equal(swept.kept.lineage, 2);
    assert.equal(containers(fixture).length, 2);
    const { recovered } = await fixture.transport.recoverInterruptedResume(
      successor,
      predecessor,
    );
    assert.equal(recovered, true);
  },
);

test(
  "the sweep keeps an unresolved resume and a retired lineage, whose cleanup still works",
  posixGuest,
  async (t) => {
    const fixture = await unresolvedResume(t);
    const swept = await fixture.transport.cleanupAbandonedSessions(true);
    assert.equal(swept.removed, 0);
    assert.equal(swept.kept.lineage, 2);
    const { outcome } = await fixture.transport.reconcileInterruptedResume(
      successor,
      predecessor,
      true,
    );
    assert.equal(outcome, "retired");
    const retired = await fixture.transport.cleanupAbandonedSessions(true);
    assert.equal(retired.removed, 0);
    assert.equal(containers(fixture).length, 2);
    assert.equal(
      (await fixture.transport.cleanupRetiredLineage(successor)).cleaned,
      2,
    );
  },
);

test(
  "the sweep keeps a session whose stop never finished",
  posixGuest,
  async (t) => {
    const fixture = await launchedGuest(t);
    const [entry] = guestState(fixture.root).records;
    // A controller lost after launch: the timer killed the worker, no stop ran.
    edit(entry, { phase: "running" });
    const swept = await fixture.transport.cleanupAbandonedSessions(true);
    assert.equal(swept.removed, 0);
    assert.equal(swept.kept.unstopped, 1);
    assert.equal(containers(fixture).length, 1);
  },
);

test(
  "the sweep refuses while any container runs, and removes nothing",
  posixGuest,
  async (t) => {
    const fixture = await launchedGuest(t);
    const state = fixture.read();
    for (const c of Object.values(engineContainers(state)))
      c.State = { ...c.State, Running: true, Pid: 99, Status: "running" };
    fixture.write(state);
    await assert.rejects(fixture.transport.cleanupAbandonedSessions(true));
    assert.equal(guestState(fixture.root).folders.length, 1);
    assert.equal(containers(fixture).length, 1);
  },
);

for (const [name, fault] of [
  [
    "a foreign label",
    (fixture, session) => {
      const state = fixture.read();
      engineContainers(state)[session].Config.Labels["aios.extra"] = "1";
      fixture.write(state);
    },
  ],
  [
    "a process still recorded on its container",
    (fixture, session) => {
      const state = fixture.read();
      engineContainers(state)[session].State.Pid = 99;
      fixture.write(state);
    },
  ],
  [
    "an active timer",
    (fixture, session) => {
      const state = fixture.read();
      state.timers = {
        ...state.timers,
        [`${session}-lease.timer`]: { active: "active" },
      };
      fixture.write(state);
    },
  ],
  [
    "an engine that refuses the removal",
    (fixture, session) =>
      fixture.write({ ...fixture.read(), rmRefused: session }),
  ],
])
  test(
    `the sweep refuses a session with ${name} and still removes the others`,
    posixGuest,
    async (t) => {
      const fixture = await preparedStart(t);
      await addPreparedStart(fixture, randomUUID(), 2);
      const refused = nameOf(guestState(fixture.root).records[0]);
      fault(fixture, refused);
      const swept = await fixture.transport.cleanupAbandonedSessions(true);
      assert.equal(swept.removed, 1);
      assert.equal(swept.refused, 1);
      assert.equal(swept.abandoned, 1, "it stays for a later sweep");
      assert.deepEqual(containers(fixture), [refused]);
      assert.deepEqual(
        guestState(fixture.root).folders.map((p) => p.split("/").at(-1)),
        [refused],
      );
    },
  );

test(
  "a partly removed session finishes on a later sweep, including read-only directories",
  posixGuest,
  async (t) => {
    const fixture = await preparedStart(t);
    const [entry] = guestState(fixture.root).records;
    const folder = entry.path.slice(0, -5);
    realSpawnSync("mkdir", ["-m", "555", `${folder}/workspace/locked`]);
    // The container went, and the sweep stopped before the folder and record.
    fixture.write({ ...fixture.read(), containerName: null, container: null });
    assert.equal(
      (await fixture.transport.cleanupAbandonedSessions(true)).removed,
      1,
    );
    assert.deepEqual(guestState(fixture.root).folders, []);
  },
);

test(
  "a sweep works through a backlog in bounded batches",
  posixGuest,
  async (t) => {
    const fixture = await preparedStart(t);
    for (let fence = 2; fence <= 10; fence++)
      await addPreparedStart(fixture, randomUUID(), fence);
    const before = fixture.requests.length;
    const swept = await fixture.transport.cleanupAbandonedSessions(true);
    assert.equal(swept.removed, 10);
    assert.equal(swept.abandoned, 0);
    assert.equal(swept.refused, 0);
    assert.deepEqual(containers(fixture), []);
    assert.equal(fixture.requests.length - before, 2, "8, then the last 2");
  },
);

test(
  "a sweep moves past sessions that keep refusing and reports them",
  posixGuest,
  async (t) => {
    const fixture = await preparedStart(t);
    for (let fence = 2; fence <= 10; fence++)
      await addPreparedStart(fixture, randomUUID(), fence);
    const names = containers(fixture);
    // The first full batch in the guest's order refuses every time.
    const refused = names.slice(0, 8);
    const state = fixture.read();
    for (const name of refused)
      engineContainers(state)[name].Config.Labels["aios.extra"] = "1";
    fixture.write(state);
    const swept = await fixture.transport.cleanupAbandonedSessions(true);
    assert.equal(swept.removed, 2, "the sessions after them are reached");
    assert.equal(swept.refused, 8);
    assert.equal(swept.abandoned, 8, "they stay for a later sweep");
    assert.deepEqual(containers(fixture), refused);
    // A later sweep tries them again, so a fixed fault then clears them.
    const clean = fixture.read();
    for (const name of refused)
      delete engineContainers(clean)[name].Config.Labels["aios.extra"];
    fixture.write(clean);
    const again = await fixture.transport.cleanupAbandonedSessions(true);
    assert.equal(again.removed, 8);
    assert.equal(again.refused, 0);
    assert.deepEqual(containers(fixture), []);
  },
);

test(
  "a preview asks the guest once and refuses nothing",
  posixGuest,
  async (t) => {
    const fixture = await preparedStart(t);
    for (let fence = 2; fence <= 9; fence++)
      await addPreparedStart(fixture, randomUUID(), fence);
    const before = fixture.requests.length;
    const preview = await fixture.transport.cleanupAbandonedSessions(false);
    assert.equal(preview.abandoned, 9);
    assert.equal(preview.refused, 0);
    assert.equal(fixture.requests.length - before, 1);
  },
);

test("a sweep treats a batch that makes no progress as uncertain", async (t) => {
  let calls = 0;
  nativeHost(t, (r) => {
    calls += 1;
    return {
      session: r.session,
      binding: observation,
      cliSha256: r.cliSha256,
      removed: 0,
      abandoned: 3,
      refused: 0,
      refusedSessions: [],
      kept: { cleaned: 0, unprepared: 0, unstopped: 0, lineage: 0 },
    };
  });
  const transport = new NativePodmanCodingTransport(
    "aios-test",
    "a".repeat(64),
  );
  await assert.rejects(transport.cleanupAbandonedSessions(true), /uncertain/);
  assert.equal(calls, 1);
});

test("the sweep treats an unrecognized guest receipt as uncertain", async (t) => {
  const fixture = nativeHost(t, (r) => ({
    session: r.session,
    binding: observation,
    cliSha256: r.cliSha256,
    removed: 1,
  }));
  const transport = new NativePodmanCodingTransport(
    "aios-test",
    "a".repeat(64),
  );
  await assert.rejects(transport.cleanupAbandonedSessions(true), /uncertain/);
  assert.equal(fixture.requests.length, 1);
  await assert.rejects(
    transport.cleanupAbandonedSessions("yes"),
    /Unsupported native session sweep/,
  );
  assert.equal(fixture.requests.length, 1, "refused before guest effects");
});

test("the abandoned session sweep command needs a machine and an admission record", () => {
  for (const args of [
    [],
    ["aios-macos-noshare"],
    ["not-a-machine", "/tmp/coding-admission.json"],
    ["aios-macos-noshare", "/tmp/coding-admission.json", "--approve"],
    [
      "aios-macos-noshare",
      "/tmp/coding-admission.json",
      "--approve-removal",
      "x",
    ],
  ]) {
    const result = realSpawnSync(
      process.execPath,
      ["scripts/sweep-abandoned-coding-sessions.mjs", ...args],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1, args.join(" "));
    assert.match(result.stderr, /Usage: .*--approve-removal/);
  }
});
