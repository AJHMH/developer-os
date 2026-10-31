import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeliveryController } from "../dist/controller.js";
import { PinnedCodingRuntime } from "../dist/feature-candidate.js";
import { ownerCodingAdmission } from "../dist/coding-admission.js";
import {
  nativeCodingAuthority,
  nativeCodingRuntime,
} from "../dist/native-coding-runtime.js";
import { createHash } from "node:crypto";
import { codingFixture } from "./helpers/feature-fixture.mjs";
import { planAndValidate } from "./helpers/validation-fixture.mjs";
import { ownWindowsFixturePaths } from "./helpers/windows-fixture-owner.mjs";

const pins = Object.freeze({
  cliSha256: "c".repeat(64),
  codeModeHostSha256: "b".repeat(64),
  cliVersion: "0.161.0",
  policySha256: "d".repeat(64),
  bindingSha256: "e".repeat(64),
});

// An owner-written record in a private folder outside any repository.
function ownerRecord(t, overrides = {}, folder) {
  const directory =
    folder ?? mkdtempSync(join(tmpdir(), "aios-coding-admission-"));
  if (!folder) t.after(() => rmSync(directory, { recursive: true }));
  chmodSync(directory, 0o700);
  const path = join(directory, "coding-admission.json");
  const write = (fields = {}) => {
    writeFileSync(
      path,
      JSON.stringify({
        scope: "aios-native-coding-admission-v1",
        approvedAt: "2026-10-21T12:00:00.000Z",
        pins,
        ...overrides,
        ...fields,
      }),
      { mode: 0o600 },
    );
    ownWindowsFixturePaths([directory, path]);
  };
  write();
  return { directory, path, write };
}

// A live transport that replays the fixture runtime through the CLI stream.
function liveTransport(f, hooks = {}) {
  const effects = { runs: 0, stops: 0 };
  const transport = {
    mode: "live",
    effects,
    async inspect() {
      return { ...pins };
    },
    async run(request, output) {
      effects.runs++;
      if (!request.mayDispatch()) throw Error("Dispatch refused");
      await hooks.dispatched?.();
      const result = await f.runtime.execute(request);
      output(
        Buffer.from(
          result.events.map((e) => JSON.stringify(e)).join("\n") + "\n",
        ),
      );
      return {
        operationId: request.operationId,
        fence: request.fence,
        exitCode: result.exitCode,
        pins: { ...pins },
      };
    },
    async stop(request) {
      effects.stops++;
      return f.runtime.stop(request);
    },
    // The independent census a live transport needs before a stop is trusted.
    async observeSession(request) {
      return {
        operationId: request.operationId,
        fence: request.fence,
        phase: "stopped",
        running: false,
        remainingProcesses: 0,
        processesGone: true,
        timers: {
          lease: { loadState: "not-found", activeState: "inactive" },
          deadline: { loadState: "not-found", activeState: "inactive" },
        },
        pins: { ...pins },
      };
    },
    collect: (request) => f.runtime.collect(request),
  };
  return transport;
}

function admittedController(f, runtime) {
  return new DeliveryController(f.state, f.options, {
    featurePlanner: f.criteria,
    validationRuntime: f.validation,
    featureRuntime: runtime,
    subscription: () => f.subscription(),
    clock: () => f.now,
  });
}

test("an owner record naming the exact pins admits a live transport through coding", async (t) => {
  const f = codingFixture(t);
  const record = ownerRecord(t);
  const transport = liveTransport(f);
  const runtime = new PinnedCodingRuntime(
    pins,
    transport,
    ownerCodingAdmission(record.path),
  );
  assert.equal(runtime.mode, "controlled");
  f.controller = admittedController(f, runtime);
  await planAndValidate(f);
  const result = await f.controller.codeFeature(f.delivery.id);
  assert.equal(result.feature.outcome, "admitted");
  assert.equal(transport.effects.runs, 1);
  // Production delivery stays disabled; admission only reaches coding.
  assert.equal(result.blocker.code, "DELIVERY_NOT_ENABLED");
});

const stoppedObservation = (request) => ({
  operationId: request.operationId,
  fence: request.fence,
  phase: "stopped",
  running: false,
  remainingProcesses: 0,
  processesGone: true,
  timers: {
    lease: { loadState: "not-found", activeState: "inactive" },
    deadline: { loadState: "loaded", activeState: "failed" },
  },
  pins: { ...pins },
});

test("a live stop is trusted only with an independent observation of the exact stopped session", async (t) => {
  const f = codingFixture(t);
  const record = ownerRecord(t);
  const session = {
    operationId: "11111111-2222-4333-8444-555555555555",
    fence: 2,
    state: "running",
    intent: "start",
  };
  const stopping = (observeSession) => {
    const transport = {
      ...liveTransport(f),
      async stop(request) {
        return {
          operationId: request.operationId,
          fence: request.fence,
          stopped: true,
          remainingProcesses: 0,
        };
      },
      ...(observeSession ? { observeSession } : {}),
    };
    if (!observeSession) delete transport.observeSession;
    return new PinnedCodingRuntime(
      pins,
      transport,
      ownerCodingAdmission(record.path),
    );
  };
  const observed = [];
  assert.equal(
    (
      await stopping(async (request) => {
        observed.push(request);
        return stoppedObservation(request);
      }).stop(session)
    ).stopped,
    true,
  );
  assert.deepEqual(observed, [session], "the exact session is observed");
  await assert.rejects(stopping().stop(session), /independently observed/);
  for (const [name, change] of [
    ["another operation", { operationId: "f".repeat(8) }],
    ["another fence", { fence: 3 }],
    ["a revoked phase", { phase: "revoked" }],
    ["a running worker", { running: true, remainingProcesses: 1 }],
    ["a surviving process", { remainingProcesses: 1, processesGone: false }],
    ["an unproven census", { processesGone: false }],
    [
      "an active timer",
      { timers: { lease: { loadState: "loaded", activeState: "active" } } },
    ],
    ["changed pins", { pins: { ...pins, cliSha256: "f".repeat(64) } }],
  ])
    await assert.rejects(
      stopping(async (request) => ({
        ...stoppedObservation(request),
        ...change,
      })).stop(session),
      /independently observed/,
      name,
    );
  await assert.rejects(
    stopping(async () => {
      throw Error("Native coding session observation unavailable");
    }).stop(session),
    /observation unavailable/,
  );
});

test("an unobserved live stop leaves the coding session uncertain, blocking release", async (t) => {
  const f = codingFixture(t);
  const record = ownerRecord(t);
  const transport = {
    ...liveTransport(f),
    async observeSession(request) {
      return {
        ...stoppedObservation(request),
        remainingProcesses: 1,
        processesGone: false,
      };
    },
  };
  f.controller = admittedController(
    f,
    new PinnedCodingRuntime(pins, transport, ownerCodingAdmission(record.path)),
  );
  await planAndValidate(f);
  await f.controller.codeFeature(f.delivery.id).catch(() => {});
  const status = f.controller.status(f.delivery.id);
  assert.equal(status.feature.session.state, "uncertain");
  assert.equal(status.feature.candidate, undefined);
  assert.equal(status.blocker.code, "UNCERTAIN_SESSION");
  assert.throws(() => f.controller.release(f.delivery.id));
});

// A pause stops the turn while the turn stops itself: the two stops overlap,
// and the guest serializes them under its management lock.
for (const order of [
  ["unobserved", "observed"],
  ["observed", "unobserved"],
])
  test(`a pause racing the turn's own stop ends stopped once either stop is observed (${order.join(", then ")})`, async (t) => {
    const f = codingFixture(t);
    const record = ownerRecord(t);
    let release;
    const held = new Promise((resolve) => (release = resolve));
    t.after(() => release());
    let paused, secondStarted;
    const stops = [];
    const transport = {
      ...liveTransport(f, {
        dispatched: async () => {
          paused = f.controller.pause(f.delivery.id);
          await held;
        },
      }),
      async observeSession(request) {
        const n = stops.push(request),
          outcome = order[n - 1] ?? "observed";
        // The first stop settles only once the second has started, first.
        if (n === 1)
          await new Promise((resolve) => {
            const limit = setTimeout(resolve, 10000);
            secondStarted = () => resolve(clearTimeout(limit));
          });
        else {
          secondStarted?.();
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return outcome === "observed"
          ? stoppedObservation(request)
          : {
              ...stoppedObservation(request),
              remainingProcesses: 1,
              processesGone: false,
            };
      },
    };
    f.controller = admittedController(
      f,
      new PinnedCodingRuntime(
        pins,
        transport,
        ownerCodingAdmission(record.path),
      ),
    );
    await planAndValidate(f);
    const coded = f.controller.codeFeature(f.delivery.id).catch(() => {});
    while (!paused) await new Promise((resolve) => setTimeout(resolve, 10));
    await Promise.all([paused.catch(() => {}), coded]);
    const status = f.controller.status(f.delivery.id);
    assert.equal(status.phase, "paused");
    assert.equal(status.feature.session.state, "stopped");
    assert.equal(status.feature.candidate, undefined);
    assert.notEqual(status.blocker.code, "UNCERTAIN_SESSION");
    assert.equal(stops.length, 2, "the pause's and the turn's stops overlap");
    assert.ok(
      stops.every(
        (s) =>
          s.operationId === status.feature.session.operationId &&
          s.fence === status.feature.session.fence,
      ),
      "every stop names the turn's exact session",
    );
  });

test("a live transport needs an owner record and a controlled one refuses it", (t) => {
  const f = codingFixture(t);
  const record = ownerRecord(t);
  assert.throws(
    () => new PinnedCodingRuntime(pins, liveTransport(f)),
    /Unqualified coding transport/,
  );
  assert.throws(
    () =>
      new PinnedCodingRuntime(
        pins,
        { ...liveTransport(f), mode: "controlled" },
        ownerCodingAdmission(record.path),
      ),
    /Unqualified coding transport/,
  );
  assert.throws(
    () =>
      new PinnedCodingRuntime(
        pins,
        { ...liveTransport(f), mode: "production" },
        ownerCodingAdmission(record.path),
      ),
    /Unqualified coding transport/,
  );
});

test("a record for any other pin refuses the live transport", async (t) => {
  const f = codingFixture(t);
  for (const field of Object.keys(pins))
    await t.test(field, (t) => {
      const record = ownerRecord(t, {
        pins: {
          ...pins,
          [field]: field === "cliVersion" ? "0.162.0" : "f".repeat(64),
        },
      });
      assert.throws(
        () =>
          new PinnedCodingRuntime(
            pins,
            liveTransport(f),
            ownerCodingAdmission(record.path),
          ),
        /Unqualified coding transport/,
      );
    });
});

// Revoke the record once dispatch has passed, `advanceMs` before the stream.
async function revokedAfterDispatch(t, advanceMs) {
  const f = codingFixture(t);
  const record = ownerRecord(t);
  let now = Date.parse("2026-10-21T13:00:00.000Z");
  const transport = liveTransport(f, {
    dispatched: () => {
      rmSync(record.path);
      now += advanceMs;
    },
  });
  const runtime = new PinnedCodingRuntime(
    pins,
    transport,
    ownerCodingAdmission(record.path, { clock: () => now }),
  );
  // Observe why the runtime refused the turn.
  let refusal;
  const execute = runtime.execute.bind(runtime);
  runtime.execute = (request) =>
    execute(request).catch((error) => {
      refusal = error.message;
      throw error;
    });
  f.controller = admittedController(f, runtime);
  await planAndValidate(f);
  const result = await f.controller.codeFeature(f.delivery.id);
  assert.equal(transport.effects.runs, 1);
  assert.equal(result.feature.candidate, undefined);
  // Exact-session shutdown is still attempted, but never trusted unadmitted.
  assert.ok(transport.effects.stops >= 1);
  assert.equal(result.feature.session.state, "uncertain");
  assert.equal(result.blocker.code, "UNCERTAIN_SESSION");
  return { result, refusal };
}

test("a stream outliving its last admission read is refused once the record is revoked", async (t) => {
  const { result, refusal } = await revokedAfterDispatch(t, 1001);
  // The revoked stream is refused before its thread is accepted.
  assert.match(refusal, /Invalid coding frame/);
  assert.equal(result.feature.session.threadId, undefined);
});

test("a record revoked within the stream's read interval still refuses the result", async (t) => {
  const { result, refusal } = await revokedAfterDispatch(t, 0);
  // The thread was observed under a recent read; the result is still refused.
  assert.match(refusal, /Coding result binding changed/);
  assert.equal(
    result.feature.session.threadId,
    "11111111-1111-4111-8111-111111111111",
  );
});

test("a record changed to other pins before coding refuses dispatch", async (t) => {
  const f = codingFixture(t);
  const record = ownerRecord(t);
  const transport = liveTransport(f);
  f.controller = admittedController(
    f,
    new PinnedCodingRuntime(pins, transport, ownerCodingAdmission(record.path)),
  );
  await planAndValidate(f);
  record.write({ pins: { ...pins, bindingSha256: "f".repeat(64) } });
  const result = await f.controller.codeFeature(f.delivery.id);
  assert.equal(transport.effects.runs, 0);
  assert.equal(result.feature.candidate, undefined);
  assert.equal(result.blocker.code, "UNCERTAIN_SESSION");
});

test("the owner record must be a strict, approved, absolute private file outside repositories", async (t) => {
  assert.throws(
    () => ownerCodingAdmission("relative/coding-admission.json"),
    /absolute/,
  );
  const repository = mkdtempSync(join(tmpdir(), "aios-admission-repo-"));
  t.after(() => rmSync(repository, { recursive: true }));
  mkdirSync(join(repository, ".git"));
  mkdirSync(join(repository, "nested"));
  assert.throws(
    () => ownerCodingAdmission(join(repository, "nested", "record.json")),
    /never live in a repository/,
  );
  const cases = {
    missing: (r) => rmSync(r.path),
    "extra field": (r) => r.write({ note: "x" }),
    "other scope": (r) => r.write({ scope: "aios-other" }),
    "future approval": (r) =>
      r.write({ approvedAt: "2999-01-01T00:00:00.000Z" }),
    "non-canonical approval": (r) => r.write({ approvedAt: "2026-10-21" }),
    "invalid approval": (r) => r.write({ approvedAt: "later" }),
    "approval not text": (r) => r.write({ approvedAt: 1 }),
    "extra pin": (r) => r.write({ pins: { ...pins, extra: "x" } }),
    "malformed pin": (r) => r.write({ pins: { ...pins, cliSha256: "x" } }),
    "malformed code-mode host pin": (r) =>
      r.write({ pins: { ...pins, codeModeHostSha256: "x" } }),
    "missing code-mode host pin": (r) => {
      const { codeModeHostSha256: _, ...rest } = pins;
      r.write({ pins: rest });
    },
    "no pins": (r) => r.write({ pins: null }),
    array: (r) => writeFileSync(r.path, "[]"),
    "not JSON": (r) => writeFileSync(r.path, "{"),
  };
  for (const [name, corrupt] of Object.entries(cases))
    await t.test(name, (t) => {
      const record = ownerRecord(t);
      const admission = ownerCodingAdmission(record.path);
      assert.deepEqual(admission.pins(), pins);
      corrupt(record);
      assert.throws(() => admission.pins(), /missing or invalid/);
    });
});

test("a recent successful read admits within its age, and failures are never cached", (t) => {
  const record = ownerRecord(t);
  let now = Date.parse("2026-10-21T13:00:00.000Z");
  const admission = ownerCodingAdmission(record.path, { clock: () => now });
  assert.deepEqual(admission.pins(1000), pins);
  rmSync(record.path);
  now += 1000;
  assert.deepEqual(admission.pins(1000), pins);
  assert.throws(() => admission.pins(), /missing or invalid/);
  record.write();
  assert.deepEqual(admission.pins(1000), pins);
  // A clock that runs backwards never extends a read.
  rmSync(record.path);
  now -= 1;
  assert.throws(() => admission.pins(1000), /missing or invalid/);
  now += 2;
  assert.throws(() => admission.pins(1000), /missing or invalid/);
  // Approval time is judged by the same clock.
  record.write({ approvedAt: new Date(now + 1).toISOString() });
  assert.throws(() => admission.pins(), /missing or invalid/);
});

test("a repository appearing above the record later revokes it", (t) => {
  const outer = mkdtempSync(join(tmpdir(), "aios-admission-outer-"));
  t.after(() => rmSync(outer, { recursive: true }));
  const folder = join(outer, "admission");
  mkdirSync(folder);
  const record = ownerRecord(t, {}, folder);
  const admission = ownerCodingAdmission(record.path);
  assert.deepEqual(admission.pins(), pins);
  mkdirSync(join(outer, ".git"));
  assert.throws(() => admission.pins(), /missing or invalid/);
});

test(
  "a symlinked folder cannot hide a repository above the record",
  {
    skip:
      process.platform === "win32" &&
      "Creating symlinks needs elevated rights on Windows",
  },
  (t) => {
    const repository = mkdtempSync(join(tmpdir(), "aios-admission-repo-"));
    const links = mkdtempSync(join(tmpdir(), "aios-admission-link-"));
    t.after(() => {
      rmSync(repository, { recursive: true });
      rmSync(links, { recursive: true });
    });
    mkdirSync(join(repository, ".git"));
    mkdirSync(join(repository, "admission"));
    symlinkSync(join(repository, "admission"), join(links, "admission"));
    assert.throws(
      () =>
        ownerCodingAdmission(join(links, "admission", "coding-admission.json")),
      /never live in a repository/,
    );
  },
);

test(
  "the owner record refuses storage others can read or replace",
  {
    skip:
      process.platform === "win32" &&
      "POSIX permission bits; Windows uses owner ACLs",
  },
  async (t) => {
    await t.test("readable record", (t) => {
      const record = ownerRecord(t);
      chmodSync(record.path, 0o644);
      assert.throws(
        () => ownerCodingAdmission(record.path).pins(),
        /missing or invalid/,
      );
    });
    await t.test("writable folder", (t) => {
      const record = ownerRecord(t);
      chmodSync(record.directory, 0o777);
      assert.throws(
        () => ownerCodingAdmission(record.path).pins(),
        /missing or invalid/,
      );
    });
  },
);

test("the admission acceptance drives one controller turn through the admitted transport", async (t) => {
  const { admissionAcceptance } = await import(
    "../scripts/run-native-coding-admission-acceptance.mjs"
  );
  const f = codingFixture(t);
  const record = ownerRecord(t);
  const transport = liveTransport(f);
  const persisted = [];
  const report = await admissionAcceptance(
    transport,
    ownerCodingAdmission(record.path),
    { persist: (r) => persisted.push(r.outcome) },
  );
  assert.equal(
    report.outcome,
    "observed-offline-admission-acceptance",
    report.error,
  );
  assert.deepEqual(report.pins, pins);
  assert.equal(transport.effects.runs, 1);
  assert.equal(report.delivery.sessionState, "stopped");
  assert.equal(report.delivery.threadStarted, true);
  assert.equal(report.productionEnabled, false);
  assert.ok(persisted.length > 4);
});

test("the admission acceptance stops before coding when the record names other pins", async (t) => {
  const { admissionAcceptance } = await import(
    "../scripts/run-native-coding-admission-acceptance.mjs"
  );
  const f = codingFixture(t);
  const record = ownerRecord(t, {
    pins: { ...pins, bindingSha256: "f".repeat(64) },
  });
  const transport = liveTransport(f);
  const report = await admissionAcceptance(
    transport,
    ownerCodingAdmission(record.path),
  );
  assert.equal(report.outcome, "blocked");
  assert.match(report.error, /does not name the fresh pins/);
  assert.equal(transport.effects.runs, 0);
  assert.deepEqual(report.pins, pins);
});

test("the admission acceptance stops an unsettled session by its exact identity", async (t) => {
  const { admissionAcceptance } = await import(
    "../scripts/run-native-coding-admission-acceptance.mjs"
  );
  const f = codingFixture(t);
  const record = ownerRecord(t);
  // Revoked mid-turn, the controller cannot trust its own stop receipt.
  const transport = liveTransport(f, {
    dispatched: () => rmSync(record.path),
  });
  const report = await admissionAcceptance(
    transport,
    ownerCodingAdmission(record.path),
  );
  assert.equal(report.delivery.sessionState, "uncertain");
  const last = report.stages.at(-1);
  assert.equal(last.name, "final-exact-session-stop");
  assert.equal(last.outcome, "passed");
  assert.equal(report.outcome, "blocked");
  assert.ok(transport.effects.stops >= 2);
});

test("the admission acceptance runs only with explicit, well-formed arguments", async () => {
  const { spawnSync } = await import("node:child_process");
  for (const args of [
    [],
    [
      "not-a-machine",
      "/r.json",
      "/report.json",
      "--approve-offline-native-run",
    ],
    ["aios-macos-noshare", "/r.json", "/report.json", "--approve"],
    ["aios-macos-noshare", "/r.json", "--approve-offline-native-run"],
    [
      "aios-macos-noshare",
      "/r.json",
      "/report.json",
      "--approve-offline-native-run",
      "extra",
    ],
  ]) {
    const result = spawnSync(
      process.execPath,
      ["scripts/run-native-coding-admission-acceptance.mjs", ...args],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1, args.join(" "));
    assert.match(result.stderr, /owner-admission\.json/);
  }
});

test("the CLI's native coding runtime takes the owner's record pins and the acceptances' authority", (t) => {
  assert.equal(
    nativeCodingAuthority("aios-test"),
    createHash("sha256")
      .update("issue04-native-offline-lifecycle-v1:aios-test")
      .digest("hex"),
  );
  const record = ownerRecord(t);
  const runtime = nativeCodingRuntime("aios-test", record.path);
  assert.equal(runtime.mode, "controlled");
  assert.deepEqual({ ...runtime.pins }, { ...pins });
  assert.equal(runtime.agent.provider, "codex");
  assert.throws(() =>
    nativeCodingRuntime("aios-test", join(record.directory, "missing.json")),
  );
  assert.throws(
    () => nativeCodingRuntime("other", record.path),
    /Invalid native coding authority/,
  );
});
