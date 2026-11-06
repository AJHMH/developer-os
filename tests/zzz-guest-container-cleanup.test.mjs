// What each VM management action leaves in the engine: the real generated
// program runs against a local simulator. No VM, image or credential is used.
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { randomUUID } from "node:crypto";
import {
  nativeHost,
  realMkdtempSync,
  realReadFileSync,
  realRmSync,
  realSpawnSync,
  realTemporaryDirectory,
  realWriteFileSync,
} from "./helpers/native-coding-fixture.mjs";
import { hostTargets } from "../dist/host-target.js";
import { VMManagementChannel } from "../dist/vm-management.js";
import { testPython } from "./helpers/python.mjs";

const simulator = new URL("./helpers/vm-management-engine.py", import.meta.url)
  .pathname;
const windows = process.platform === "win32";
const skip = windows ? "Runs Linux VM management code on the host" : false;

function guest(t, engine = {}) {
  const root = realMkdtempSync(`${realTemporaryDirectory}/aios-vm-guest-`);
  t.after(() => realRmSync(root, { recursive: true, force: true }));
  nativeHost(t, () => ({}));
  const ordinaryFile = fs.lstatSync("/authority");
  t.mock.method(fs, "lstatSync", () => ({
    ...ordinaryFile,
    isDirectory: () => true,
  }));
  syncBuiltinESMExports();
  const channel = new VMManagementChannel("aios-test", "/authority");
  const statePath = `${root}/engine.json`;
  const state = () => JSON.parse(realReadFileSync(statePath, "utf8"));
  realWriteFileSync(statePath, JSON.stringify(engine));
  const records = `${root}/.local/state/aios-offline-v1`;
  const run = (action, payload = {}) => {
    const { input } = channel.prepare(action, payload);
    // A file, as the channel sends it: piped, a program this long can lose
    // its EOF on macOS and the reader never returns.
    const program = `${root}/program.py`;
    realWriteFileSync(program, input);
    const stdin = fs.openSync(program, "r");
    const result = realSpawnSync(testPython, ["-I", "-S", simulator, root], {
      stdio: [stdin, "pipe", "pipe"],
      encoding: "utf8",
      timeout: 60000,
    });
    fs.closeSync(stdin);
    return {
      ok: result.status === 0,
      stderr: result.stderr,
      output: result.stdout ? result.stdout.trim().split("\n").at(-1) : "",
    };
  };
  const enroll = run("enroll");
  assert.equal(enroll.ok, true, enroll.stderr);
  const expected = JSON.parse(enroll.output).binding;
  const names = () => Object.keys(state().containers).sort();
  const removals = () =>
    state()
      .commands.filter((c) => c[0] === "podman" && c[1] === "rm")
      .map((c) => c.at(-1));
  return {
    run,
    expected,
    names,
    removals,
    state,
    records,
    fault: (faults) =>
      realWriteFileSync(statePath, JSON.stringify({ ...state(), faults })),
    seed: (containers) =>
      realWriteFileSync(
        statePath,
        JSON.stringify({
          ...state(),
          containers: { ...state().containers, ...containers },
        }),
      ),
    probeRecords: () =>
      fs.readdirSync(records).filter((name) => name.startsWith("probe-")),
    writeRecord: (name, value) =>
      realWriteFileSync(`${records}/${name}`, JSON.stringify(value), {
        mode: 0o600,
      }),
    authority: () =>
      JSON.parse(realReadFileSync(`${records}/authority.json`, "utf8")).id,
    readRecord: (name) =>
      JSON.parse(realReadFileSync(`${records}/${name}`, "utf8")),
  };
}

const container = (authority, status = "exited", extra = {}) => ({
  Name: "",
  Mounts: [],
  Config: { Labels: { "aios.authority": authority, ...extra } },
  HostConfig: {},
  State: { Running: false, Pid: 0, Status: status },
});

const challenge = () => ({
  id: randomUUID(),
  port: 18000,
  files: ["/synthetic/a", "/synthetic/b", "/synthetic/c"],
});
/** Each probe action with a prefix, and a request that reaches its container. */
const probes = (f) => [
  {
    action: "observe",
    prefix: "aios-qualification-",
    payload: () => ({ expected: f.expected }),
  },
  {
    action: "isolate",
    prefix: "aios-isolation-",
    payload: () => ({ expected: f.expected, challenge: challenge() }),
  },
  {
    action: "model-frame",
    prefix: "aios-model-frame-",
    payload: () => {
      const marker = new VMManagementChannel("aios-test", "/authority");
      const { input } = marker.prepare("model-frame", {});
      const contract = JSON.parse(
        Buffer.from(input.match(/b64decode\('([^']+)'\)/)[1], "base64"),
      ).inferenceContract;
      return {
        expected: f.expected,
        frameMode: "response",
        frame: Buffer.from(contract.marker).toString("base64"),
      };
    },
  },
];

test(
  "probe actions remove their container and record on success",
  { skip },
  (t) => {
    const f = guest(t);
    for (const { action, prefix, payload } of probes(f)) {
      const result = f.run(action, payload());
      assert.equal(result.ok, true, `${action}: ${result.stderr}`);
      const answer = JSON.parse(result.output);
      assert.equal(answer.blockedStage, undefined, action);
      assert.deepEqual(f.names(), [], action);
      assert.ok(
        f.removals().some((name) => name.startsWith(prefix)),
        action,
      );
      assert.deepEqual(f.probeRecords(), [], action);
    }
  },
);

for (const [failure, faults, reached] of [
  ["a failed start", { start: "exit" }, true],
  ["a timed-out start", { start: "timeout" }, true],
  ["a failed exec", { exec: "exit" }, true],
  [
    "a create that timed out but left the container",
    { create: "timeout" },
    true,
  ],
  ["a create that made nothing", { create: "exit" }, false],
]) {
  test(
    `probe actions remove their container after ${failure}`,
    { skip },
    (t) => {
      const f = guest(t);
      for (const { action, prefix, payload } of probes(f)) {
        f.fault({ [prefix]: faults });
        const before = f.removals().length;
        const result = f.run(action, payload());
        const refused =
          !result.ok || JSON.parse(result.output).blockedStage !== undefined;
        assert.equal(refused, true, action);
        assert.deepEqual(f.names(), [], `${action} left a container`);
        assert.equal(f.removals().length > before, reached, action);
        assert.deepEqual(f.probeRecords(), [], `${action} left a record`);
      }
    },
  );
}

const codexPayload = (f) => ({
  expected: f.expected,
  challenge: challenge(),
  deliveryId: randomUUID(),
  gatewayCapability: "f".repeat(64),
  gatewayVersion: "synthetic",
});

for (const [failure, faults] of [
  ["a timed-out create", { "aios-codex-protocol-": { create: "timeout" } }],
  ["a failed copy", { "aios-codex-protocol-": { cp: "exit" } }],
  ["a failed version check", { "aios-codex-protocol-": { exec: "exit" } }],
  ["a peer that never started", { "aios-relay-peer-": { start: "exit" } }],
  ["a peer that was never created", { "aios-relay-peer-": { create: "exit" } }],
  [
    "a peer create that timed out",
    { "aios-relay-peer-": { create: "timeout" } },
  ],
  // With no relay answer, the first denial check refuses both running workers.
  ["a refused relay denial", {}],
]) {
  test(
    `codex-protocol removes both workers after ${failure}`,
    { skip },
    (t) => {
      const f = guest(t);
      f.fault(faults);
      const result = f.run("codex-protocol", codexPayload(f));
      assert.ok(JSON.parse(result.output).blockedStage, "the probe must stop");
      assert.deepEqual(f.names(), []);
      assert.deepEqual(f.probeRecords(), []);
      assert.deepEqual(
        fs.readdirSync(f.records).filter((n) => n.startsWith("credential-")),
        [],
      );
    },
  );
}

test(
  "a failed removal keeps the evidence and the next action retries it",
  { skip },
  (t) => {
    const f = guest(t);
    f.fault({ "aios-qualification-": { rm: "exit" } });
    const first = f.run("observe", { expected: f.expected });
    assert.equal(first.ok, true, first.stderr);
    assert.ok(JSON.parse(first.output).effective, "evidence stands");
    assert.equal(f.names().length, 1);
    assert.equal(f.probeRecords().length, 1);
    f.fault({});
    const second = f.run("observe", { expected: f.expected });
    assert.equal(second.ok, true, second.stderr);
    assert.deepEqual(f.names(), []);
    assert.deepEqual(f.probeRecords(), []);
  },
);

test(
  "a failed removal is not tried again in the same action",
  { skip },
  (t) => {
    const f = guest(t);
    for (const { action, prefix, payload } of probes(f)) {
      f.fault({ [prefix]: { rm: "exit" } });
      const result = f.run(action, payload());
      assert.equal(result.ok, true, `${action}: ${result.stderr}`);
      assert.equal(JSON.parse(result.output).blockedStage, undefined, action);
      assert.equal(
        f.removals().filter((name) => name.startsWith(prefix)).length,
        1,
        action,
      );
      f.fault({});
    }
  },
);

const leftovers = (f, count) => {
  const seeded = {};
  for (let index = 0; index < count; index++) {
    const name = `aios-qualification-old-${index}`;
    seeded[name] = { ...container(f.authority()), Name: name };
    f.writeRecord(`probe-old-${index}.json`, {
      name,
      cgroup: "",
      pids: {},
      stopped: true,
    });
  }
  f.seed(seeded);
};
// A third of macOS's 90-second action deadline.
const removalBudget = hostTargets.darwin.managementMs / 3000;

test(
  "a stalled removal costs one budget and leaves the action its evidence",
  { skip },
  (t) => {
    const f = guest(t);
    leftovers(f, 12);
    f.fault({ "aios-qualification-": { rm: "stall" } });
    const result = f.run("observe", { expected: f.expected });
    assert.equal(result.ok, true, result.stderr);
    assert.ok(JSON.parse(result.output).effective, "evidence stands");
    assert.equal(f.removals().length, 1, "the budget went on the first");
    assert.equal(f.state().removalSeconds, removalBudget);
    assert.equal(f.probeRecords().length, 13, "every record stays for later");
    f.fault({});
    for (let round = 0; round < 2; round++)
      assert.equal(f.run("observe", { expected: f.expected }).ok, true);
    assert.deepEqual(f.names(), []);
    assert.deepEqual(f.probeRecords(), []);
  },
);

test("slow removals stop when the budget is spent", { skip }, (t) => {
  const f = guest(t);
  leftovers(f, 8);
  f.fault({ "aios-qualification-": { rm: "slow" } });
  const result = f.run("observe", { expected: f.expected });
  assert.equal(result.ok, true, result.stderr);
  // 12 seconds each: two finish and the third is cut off at the budget.
  assert.equal(f.removals().length, 3);
  assert.ok(f.state().removalSeconds <= removalBudget);
  assert.equal(f.names().length, 7);
});

test(
  "each host's removal budget fits inside its action deadline",
  { skip },
  (t) => {
    for (const platform of ["darwin", "win32"]) {
      const host = hostTargets[platform];
      nativeHost(t, () => ({}), platform);
      const ordinaryFile = fs.lstatSync("/authority");
      t.mock.method(fs, "lstatSync", () => ({
        ...ordinaryFile,
        isDirectory: () => true,
      }));
      syncBuiltinESMExports();
      const { input } = new VMManagementChannel(
        "aios-test",
        "/authority",
      ).prepare("observe", {});
      const { target } = JSON.parse(
        Buffer.from(input.match(/b64decode\('([^']+)'\)/)[1], "base64"),
      );
      assert.equal(target.removalSeconds, host.managementMs / 3000, platform);
      t.mock.restoreAll();
    }
  },
);

test(
  "an interrupted run is stopped and removed by the next action",
  { skip },
  (t) => {
    const f = guest(t);
    const authority = f.authority();
    f.seed({
      "aios-qualification-crashed": {
        ...container(authority, "running"),
        Name: "aios-qualification-crashed",
        State: { Running: true, Pid: 4500, Status: "running" },
      },
      "aios-isolation-never-started": {
        ...container(authority, "created"),
        Name: "aios-isolation-never-started",
      },
    });
    f.writeRecord("probe-crashed.json", {
      name: "aios-qualification-crashed",
      cgroup: "",
      pids: {},
      stopped: false,
    });
    f.writeRecord("probe-never-started.json", {
      name: "aios-isolation-never-started",
      cgroup: "",
      pids: {},
      stopped: false,
    });
    // A create that wrote its record and then died made no container.
    f.writeRecord("probe-absent.json", {
      name: "aios-qualification-absent",
      cgroup: "",
      pids: {},
      stopped: false,
    });
    const result = f.run("observe", { expected: f.expected });
    assert.equal(result.ok, true, result.stderr);
    assert.deepEqual(f.names(), []);
    assert.deepEqual(f.probeRecords(), []);
  },
);

test(
  "records left by earlier programs drain a few at a time",
  { skip },
  (t) => {
    const f = guest(t);
    const authority = f.authority();
    const seeded = {};
    for (let index = 0; index < 20; index++) {
      const name = `aios-qualification-old-${index}`;
      seeded[name] = { ...container(authority), Name: name };
      f.writeRecord(`probe-old-${index}.json`, {
        name,
        cgroup: "",
        pids: {},
        stopped: true,
      });
    }
    f.seed(seeded);
    // The codex probe's earlier program kept its record after removal.
    f.writeRecord("probe-removed.json", {
      name: "aios-codex-protocol-gone",
      cgroup: "",
      pids: {},
      stopped: true,
      removed: true,
    });
    const result = f.run("observe", { expected: f.expected });
    assert.equal(result.ok, true, result.stderr);
    assert.equal(f.names().length, 12, "eight at most in one action");
    assert.equal(f.probeRecords().length, 12);
    for (let round = 0; round < 2; round++)
      assert.equal(f.run("observe", { expected: f.expected }).ok, true);
    assert.deepEqual(f.names(), []);
    assert.deepEqual(f.probeRecords(), []);
  },
);

test("nothing the actions did not create is removed", { skip }, (t) => {
  const f = guest(t);
  const authority = f.authority();
  const unrelated = {
    // No record, whatever its name or state.
    "owner-database": container("not-ours"),
    "aios-qualification-no-record": container(authority),
    "aios-coding-session": {
      ...container("coding", "exited"),
      Name: "aios-coding-session",
    },
    "aios-validation-attempt": {
      ...container("validation", "created"),
      Name: "aios-validation-attempt",
    },
  };
  f.seed(unrelated);
  for (const { action, payload } of probes(f)) {
    const result = f.run(action, payload());
    assert.equal(result.ok, true, result.stderr);
  }
  assert.deepEqual(f.names(), Object.keys(unrelated).sort());
  assert.deepEqual(
    f.removals().filter((name) => name in unrelated),
    [],
  );
});

test(
  "a record naming another authority's container refuses and removes nothing",
  { skip },
  (t) => {
    const f = guest(t);
    f.seed({ "aios-qualification-foreign": container("another-authority") });
    f.writeRecord("probe-foreign.json", {
      name: "aios-qualification-foreign",
      cgroup: "",
      pids: {},
      stopped: true,
    });
    assert.equal(f.run("observe", { expected: f.expected }).ok, false);
    assert.deepEqual(f.names(), ["aios-qualification-foreign"]);
    assert.equal(f.probeRecords().length, 1);
    assert.deepEqual(f.removals(), []);
  },
);

const canary = Buffer.from("AIOS offline canary input\n").toString("base64");
const pins = { bindingSha256: "a".repeat(64), policySha256: "b".repeat(64) };
const session = (repositoryKey, fence) => ({
  deliveryId: randomUUID(),
  operationId: randomUUID(),
  sandboxId: randomUUID(),
  workerSessionId: randomUUID(),
  repositoryKey,
  fence,
  state: "running",
});

function runSession(f, s) {
  const started = f.run("execute", {
    expected: f.expected,
    session: s,
    pins,
    input: canary,
  });
  assert.equal(started.ok, true, started.stderr);
  const stopped = f.run("stop", { session: s, pins });
  assert.equal(stopped.ok, true, stopped.stderr);
  return { ...s, state: "stopped" };
}

test(
  "a stopped session stays collectable until a later fence supersedes it",
  { skip },
  (t) => {
    const f = guest(t);
    const first = runSession(f, session("repository-a", 1));
    const name = `aios-offline-${first.sandboxId}`;
    assert.deepEqual(f.names(), [name], "stop keeps the worker's logs");
    const collect = () => f.run("collect", { session: first, pins });
    assert.equal(collect().ok, true);
    assert.equal(collect().ok, true, "a repeated collection still reads it");
    assert.deepEqual(f.names(), [name]);

    // Another repository's session cannot supersede this one.
    const other = runSession(f, session("repository-b", 1));
    assert.ok(f.names().includes(name));
    assert.equal(collect().ok, true);

    // Fences are monotonic per repository: nothing can read the old one now.
    const second = runSession(f, session("repository-a", 2));
    assert.deepEqual(
      f.names(),
      [
        `aios-offline-${other.sandboxId}`,
        `aios-offline-${second.sandboxId}`,
      ].sort(),
    );
    assert.equal(
      collect().ok,
      false,
      "the fence refuses it, not a missing name",
    );
    const record = f.readRecord(`${first.sandboxId}.json`);
    assert.equal(record.stopped, true, "the record outlives the container");
    assert.equal(
      f.run("execute", {
        expected: f.expected,
        session: { ...first, state: "running" },
        pins,
        input: canary,
      }).ok,
      false,
      "the kept record still refuses a replay",
    );
  },
);

test(
  "a superseded session is kept while it runs, or if it is not exactly ours",
  { skip },
  (t) => {
    const f = guest(t);
    const running = session("repository-a", 1);
    const started = f.run("execute", {
      expected: f.expected,
      session: running,
      pins,
      input: canary,
    });
    assert.equal(started.ok, true, started.stderr);
    const foreign = runSession(f, session("repository-a", 2));
    assert.ok(f.names().includes(`aios-offline-${running.sandboxId}`));
    // The same name with another session's label is not this record's worker.
    const name = `aios-offline-${foreign.sandboxId}`;
    f.seed({
      [name]: {
        ...container(f.authority(), "exited", { "aios.session": "another" }),
        Name: name,
      },
    });
    const third = session("repository-a", 3);
    assert.equal(
      f.run("execute", {
        expected: f.expected,
        session: third,
        pins,
        input: canary,
      }).ok,
      true,
    );
    assert.ok(f.names().includes(name));
    assert.ok(f.names().includes(`aios-offline-${running.sandboxId}`));
  },
);

test(
  "a stalled superseded session spends the budget and stays collectable later",
  { skip },
  (t) => {
    const f = guest(t);
    // Failed removals leave two superseded sessions behind.
    f.fault({ "aios-offline-": { rm: "exit" } });
    const first = runSession(f, session("repository-a", 1));
    const second = runSession(f, session("repository-a", 2));
    runSession(f, session("repository-a", 3));
    assert.equal(f.names().length, 3);
    f.fault({ "aios-offline-": { rm: "stall" } });
    const before = f.removals().length;
    const fourth = session("repository-a", 4);
    const started = f.run("execute", {
      expected: f.expected,
      session: fourth,
      pins,
      input: canary,
    });
    assert.equal(started.ok, true, started.stderr);
    assert.equal(f.removals().length - before, 1);
    assert.equal(f.state().removalSeconds, removalBudget);
    for (const { sandboxId } of [first, second])
      assert.notEqual(
        f.readRecord(`${sandboxId}.json`).containerRemoved,
        true,
        "a later action retries it",
      );
  },
);
