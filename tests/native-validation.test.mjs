import assert from "node:assert/strict";
import { test } from "node:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeliveryController } from "../dist/controller.js";
import {
  PinnedValidationRuntime,
  offlineValidationEnvironment,
  offlineValidationNetworkPolicySha256,
  ownerValidationAdmission,
} from "../dist/native-validation.js";
import { validationDigest } from "../dist/isolated-validation.js";
import { codingFixture } from "./helpers/feature-fixture.mjs";
import { ownWindowsFixturePaths } from "./helpers/windows-fixture-owner.mjs";

const pins = Object.freeze({
  imageSha256: "a".repeat(64),
  policySha256: "b".repeat(64),
  bindingSha256: "c".repeat(64),
});

// An owner-written validation record in a private folder outside repositories.
function ownerRecord(t, overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), "aios-validation-admission-"));
  t.after(() => rmSync(directory, { recursive: true }));
  chmodSync(directory, 0o700);
  const path = join(directory, "validation-admission.json");
  const write = (fields = {}) => {
    writeFileSync(
      path,
      JSON.stringify({
        scope: "aios-native-validation-admission-v1",
        approvedAt: "2026-10-22T12:00:00.000Z",
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

// A live transport double: exit codes and measured trees are scripted.
function liveTransport(hooks = {}) {
  const effects = { runs: [], stops: 0, inspects: 0 };
  // Like the guest, remember each attempt's materialized tree to measure later.
  const trees = new Map();
  return {
    mode: "live",
    effects,
    async inspect() {
      effects.inspects++;
      return { ...pins, ...hooks.pins?.() };
    },
    async run(request) {
      effects.runs.push({
        checkId: request.check.id,
        command: request.check.command,
        timeoutMs: request.check.timeoutMs,
        files: request.files.length,
        treeSha256: request.treeSha256,
      });
      if (!request.mayDispatch()) throw Error("Dispatch refused");
      trees.set(request.operationId, request.treeSha256);
      await hooks.dispatched?.(request);
      if (!request.mayDispatch()) throw Error("Revoked while running");
      return {
        operationId: request.operationId,
        fence: request.fence,
        checkId: request.check.id,
        exitCode: hooks.exitCode?.(request) ?? 0,
        timedOut: hooks.timedOut?.(request) ?? false,
        pins: { ...pins },
      };
    },
    async stop(attempt) {
      effects.stops++;
      return {
        operationId: attempt.operationId,
        fence: attempt.fence,
        stopped: true,
        remainingProcesses: 0,
        treeSha256: hooks.tree?.(attempt) ?? trees.get(attempt.operationId),
      };
    },
  };
}

// The owner contract declares exactly the offline environment the runtime enforces.
function offlineContract(facts) {
  facts.validationContract.environment = offlineValidationEnvironment(
    pins.imageSha256,
  );
}

function validationController(f, runtime) {
  f.controller = new DeliveryController(f.state, f.options, {
    featurePlanner: f.criteria,
    featureRuntime: f.runtime,
    validationRuntime: runtime,
    subscription: () => f.subscription(),
    clock: () => f.now,
  });
}

async function baseline(f) {
  await f.controller.planFeature(f.delivery.id);
  await f.controller.validateBaseline(f.delivery.id);
  return f.controller.status(f.delivery.id).validation.attempts.at(-1);
}

test("the offline environment declares no network, registries, caches or fixtures", () => {
  const environment = offlineValidationEnvironment(pins.imageSha256);
  assert.deepEqual(environment, {
    imageSha256: pins.imageSha256,
    networkPolicySha256: offlineValidationNetworkPolicySha256,
    registries: [],
    caches: [],
    browser: false,
    database: false,
    synthetic: true,
  });
  assert.match(offlineValidationNetworkPolicySha256, /^[a-f0-9]{64}$/);
  assert.throws(() => offlineValidationEnvironment("not-a-digest"));
});

test("an owner record naming the exact pins admits a live transport through baseline validation", async (t) => {
  const f = codingFixture(t, offlineContract);
  const record = ownerRecord(t);
  const transport = liveTransport();
  const runtime = new PinnedValidationRuntime(
    pins,
    transport,
    ownerValidationAdmission(record.path),
  );
  assert.equal(runtime.mode, "controlled");
  assert.match(runtime.bindingSha256, /^[a-f0-9]{64}$/);
  validationController(f, runtime);
  const attempt = await baseline(f);
  assert.equal(attempt.outcome, "passed");
  assert.equal(attempt.state, "stopped");
  assert.equal(attempt.bindingSha256, runtime.bindingSha256);
  assert.equal(
    attempt.environmentSha256,
    validationDigest(offlineValidationEnvironment(pins.imageSha256)),
  );
  // Every local baseline check ran once, through the transport, in order.
  assert.deepEqual(
    transport.effects.runs.map((r) => r.checkId),
    ["format", "lint", "type", "coverage", "build"],
  );
  assert.deepEqual(transport.effects.runs[0].command, ["npm", "run", "format"]);
  assert.ok(transport.effects.runs.every((r) => r.files === 1));
  assert.ok(transport.effects.stops >= 1);
  // Production delivery stays disabled; validation evidence only.
  assert.equal(
    f.controller.status(f.delivery.id).blocker.code,
    "DELIVERY_NOT_ENABLED",
  );
});

test("exit codes and guest timeouts become check statuses", async (t) => {
  const f = codingFixture(t, offlineContract);
  const record = ownerRecord(t);
  const transport = liveTransport({
    exitCode: (r) => (r.check.id === "lint" ? 2 : 0),
  });
  validationController(
    f,
    new PinnedValidationRuntime(
      pins,
      transport,
      ownerValidationAdmission(record.path),
    ),
  );
  const failed = await baseline(f);
  assert.equal(failed.outcome, "failed");
  assert.deepEqual(
    failed.results.map((r) => [r.checkId, r.status]),
    [
      ["format", "success"],
      ["lint", "failure"],
      ["type", "success"],
      ["coverage", "success"],
      ["build", "success"],
    ],
  );

  const g = codingFixture(t, offlineContract);
  validationController(
    g,
    new PinnedValidationRuntime(
      pins,
      liveTransport({
        timedOut: (r) => r.check.id === "type",
        exitCode: () => 137,
      }),
      ownerValidationAdmission(record.path),
    ),
  );
  const timedOut = await baseline(g);
  assert.equal(
    timedOut.results.find((r) => r.checkId === "type").status,
    "timeout",
  );
  assert.notEqual(timedOut.outcome, "passed");
});

test("a live transport needs an owner record and a controlled one refuses it", (t) => {
  const record = ownerRecord(t);
  assert.throws(
    () => new PinnedValidationRuntime(pins, liveTransport()),
    /Unqualified validation transport/,
  );
  assert.throws(
    () =>
      new PinnedValidationRuntime(
        pins,
        { ...liveTransport(), mode: "controlled" },
        ownerValidationAdmission(record.path),
      ),
    /Unqualified validation transport/,
  );
  // A controlled transport without a record is the existing test seam.
  assert.equal(
    new PinnedValidationRuntime(pins, {
      ...liveTransport(),
      mode: "controlled",
    }).mode,
    "controlled",
  );
  for (const field of Object.keys(pins))
    assert.throws(
      () =>
        new PinnedValidationRuntime(
          { ...pins, [field]: "0".repeat(64) },
          liveTransport(),
          ownerValidationAdmission(record.path),
        ),
      /Unqualified validation transport/,
    );
  assert.throws(
    () =>
      new PinnedValidationRuntime(
        { ...pins, imageSha256: "short" },
        { ...liveTransport(), mode: "controlled" },
      ),
    /Unqualified validation transport/,
  );
});

test("the validation record is its own scope and never a coding record", (t) => {
  for (const overrides of [
    { scope: "aios-native-coding-admission-v1" },
    {
      pins: {
        cliVersion: "0.161.0",
        cliSha256: "c".repeat(64),
        policySha256: "d".repeat(64),
        bindingSha256: "e".repeat(64),
      },
    },
    { pins: { ...pins, extra: "f".repeat(64) } },
    {
      pins: { imageSha256: pins.imageSha256, policySha256: pins.policySha256 },
    },
    { pins: { ...pins, imageSha256: "A".repeat(64) } },
    { approvedAt: "2026-10-22" },
  ]) {
    const record = ownerRecord(t, overrides);
    assert.throws(
      () => ownerValidationAdmission(record.path).pins(),
      /Owner validation admission is missing or invalid/,
    );
  }
  assert.throws(
    () => ownerValidationAdmission("relative/validation-admission.json"),
    /Validation admission record path must be absolute/,
  );
});

test("a contract declaring registries or another image is refused before any check runs", async (t) => {
  for (const change of [
    (e) => (e.registries = ["https://registry.npmjs.org"]),
    (e) => (e.imageSha256 = "d".repeat(64)),
    (e) => (e.networkPolicySha256 = "e".repeat(64)),
    (e) => (e.caches = ["npm"]),
  ]) {
    const f = codingFixture(t, (facts) => {
      offlineContract(facts);
      change(facts.validationContract.environment);
    });
    const record = ownerRecord(t);
    const transport = liveTransport();
    validationController(
      f,
      new PinnedValidationRuntime(
        pins,
        transport,
        ownerValidationAdmission(record.path),
      ),
    );
    await f.controller.planFeature(f.delivery.id);
    await assert.rejects(
      f.controller.validateBaseline(f.delivery.id),
      /Validation environment is unqualified/,
    );
    assert.equal(transport.effects.runs.length, 0);
  }
});

test("fresh pins that differ from the runtime's refuse inspection and dispatch", async (t) => {
  const f = codingFixture(t, offlineContract);
  const record = ownerRecord(t);
  let drift = false;
  const transport = liveTransport({
    pins: () => (drift ? { bindingSha256: "f".repeat(64) } : {}),
  });
  const runtime = new PinnedValidationRuntime(
    pins,
    transport,
    ownerValidationAdmission(record.path),
  );
  drift = true;
  await assert.rejects(runtime.inspect(), /Validation binding changed/);
  validationController(f, runtime);
  await f.controller.planFeature(f.delivery.id);
  // The runtime's own refusal reaches the caller before any check runs.
  await assert.rejects(
    f.controller.validateBaseline(f.delivery.id),
    /Validation binding changed/,
  );
  assert.equal(transport.effects.runs.length, 0);
});

test("a record revoked mid-attempt refuses further checks and the stop receipt", async (t) => {
  const f = codingFixture(t, offlineContract);
  const record = ownerRecord(t);
  let gateAfterRevocation;
  const transport = liveTransport({
    dispatched: (r) => {
      if (r.check.id !== "lint") return;
      rmSync(record.path);
      // The gate the transport polls closes as soon as the record is gone.
      gateAfterRevocation = r.mayDispatch();
    },
  });
  validationController(
    f,
    new PinnedValidationRuntime(
      pins,
      transport,
      ownerValidationAdmission(record.path),
    ),
  );
  const attempt = await baseline(f);
  assert.notEqual(attempt.outcome, "passed");
  assert.equal(gateAfterRevocation, false);
  // No check after the revocation reached the transport.
  assert.deepEqual(
    transport.effects.runs.map((r) => r.checkId),
    ["format", "lint"],
  );
  // The stop was attempted, but its receipt is not trusted without the record.
  assert.ok(transport.effects.stops >= 1);
  assert.equal(attempt.state, "uncertain");
});

test("a measured final tree that differs from the tested tree is never a pass", async (t) => {
  const f = codingFixture(t, offlineContract);
  const record = ownerRecord(t);
  validationController(
    f,
    new PinnedValidationRuntime(
      pins,
      liveTransport({ tree: () => "9".repeat(64) }),
      ownerValidationAdmission(record.path),
    ),
  );
  const attempt = await baseline(f);
  assert.equal(attempt.state, "stopped");
  assert.equal(attempt.outcome, "incomplete");
});

test("a result for another attempt, check or pins is untrusted", async (t) => {
  for (const forge of [
    (r) => ({ operationId: "00000000-0000-4000-8000-000000000000" }),
    (r) => ({ fence: r.fence + 1 }),
    (r) => ({ checkId: "other" }),
    (r) => ({ pins: { ...pins, policySha256: "f".repeat(64) } }),
    (r) => ({ exitCode: -1 }),
    (r) => ({ timedOut: "yes" }),
  ]) {
    const record = ownerRecord(t);
    const base = liveTransport();
    const transport = {
      ...base,
      async run(request) {
        const result = await base.run(request);
        return { ...result, ...forge(request) };
      },
    };
    const runtime = new PinnedValidationRuntime(
      pins,
      transport,
      ownerValidationAdmission(record.path),
    );
    const environment = offlineValidationEnvironment(pins.imageSha256);
    await assert.rejects(
      runtime.execute({
        operationId: "11111111-1111-4111-8111-111111111111",
        fence: 1,
        stage: "baseline",
        treeSha256: "d".repeat(64),
        environmentSha256: validationDigest(environment),
        bindingSha256: runtime.bindingSha256,
        check: {
          id: "format",
          kind: "format",
          scope: "local",
          stages: ["baseline"],
          command: ["true"],
          publisher: "isolated-checker",
          timeoutMs: 1000,
        },
        files: [],
        mayDispatch: () => true,
      }),
      /Untrusted validation result/,
    );
  }
});

test("execute refuses requests outside the runtime's binding, environment or check bounds", async (t) => {
  const record = ownerRecord(t);
  const transport = liveTransport();
  const runtime = new PinnedValidationRuntime(
    pins,
    transport,
    ownerValidationAdmission(record.path),
  );
  const environmentSha256 = validationDigest(
    offlineValidationEnvironment(pins.imageSha256),
  );
  const request = (changes = {}, check = {}) => ({
    operationId: "11111111-1111-4111-8111-111111111111",
    fence: 1,
    stage: "baseline",
    treeSha256: "d".repeat(64),
    environmentSha256,
    bindingSha256: runtime.bindingSha256,
    check: {
      id: "format",
      kind: "format",
      scope: "local",
      stages: ["baseline"],
      command: ["true"],
      publisher: "isolated-checker",
      timeoutMs: 1000,
      ...check,
    },
    files: [],
    mayDispatch: () => true,
    ...changes,
  });
  for (const [changes, check] of [
    [{ bindingSha256: "f".repeat(64) }, {}],
    [{ environmentSha256: "f".repeat(64) }, {}],
    [{ treeSha256: "short" }, {}],
    [{ operationId: "not-a-uuid" }, {}],
    [{ fence: 0 }, {}],
    [{ mayDispatch: () => false }, {}],
    [{}, { scope: "pr" }],
    [{}, { command: [] }],
    [{}, { command: Array(33).fill("x") }],
    [{}, { command: ["bad\u0000arg"] }],
    [{}, { timeoutMs: 0 }],
    [{}, { timeoutMs: 120001 }],
  ])
    await assert.rejects(
      runtime.execute(request(changes, check)),
      /Validation execution refused/,
    );
  assert.equal(transport.effects.runs.length, 0);
  // The well-formed request is dispatched once.
  const result = await runtime.execute(request());
  assert.equal(result.status, "success");
  assert.equal(transport.effects.runs.length, 1);
});

test("the validation acceptance validates a synthetic baseline through the admitted transport", async (t) => {
  const { validationAcceptance, probes } = await import(
    "../scripts/run-native-validation-admission-acceptance.mjs"
  );
  const record = ownerRecord(t);
  const transport = liveTransport();
  const persisted = [];
  const report = await validationAcceptance(
    transport,
    ownerValidationAdmission(record.path),
    pins.imageSha256,
    { persist: (r) => persisted.push(r.outcome) },
  );
  assert.equal(
    report.outcome,
    "observed-offline-validation-admission-acceptance",
    report.error,
  );
  assert.deepEqual(report.pins, pins);
  assert.equal(report.validation.outcome, "passed");
  assert.equal(report.validation.state, "stopped");
  // Every probe ran as a check, in contract order, through the transport.
  assert.deepEqual(
    transport.effects.runs.map((r) => [r.checkId, r.command]),
    Object.entries(probes),
  );
  assert.equal(report.productionEnabled, false);
  assert.ok(persisted.length > 4);
});

test("the validation acceptance stops before any check when the record names other pins", async (t) => {
  const { validationAcceptance } = await import(
    "../scripts/run-native-validation-admission-acceptance.mjs"
  );
  const record = ownerRecord(t, {
    pins: { ...pins, bindingSha256: "f".repeat(64) },
  });
  const transport = liveTransport();
  const report = await validationAcceptance(
    transport,
    ownerValidationAdmission(record.path),
    pins.imageSha256,
  );
  assert.equal(report.outcome, "blocked");
  assert.match(report.error, /does not name the fresh pins/);
  assert.equal(transport.effects.runs.length, 0);
  assert.deepEqual(report.pins, pins);
});

test("the validation acceptance blocks on a failed probe and stops an unsettled attempt", async (t) => {
  const { validationAcceptance } = await import(
    "../scripts/run-native-validation-admission-acceptance.mjs"
  );
  const failing = ownerRecord(t);
  const failed = await validationAcceptance(
    liveTransport({ exitCode: (r) => (r.check.id === "lint" ? 1 : 0) }),
    ownerValidationAdmission(failing.path),
    pins.imageSha256,
  );
  assert.equal(failed.outcome, "blocked");
  assert.match(failed.error, /An isolation probe did not pass/);
  assert.equal(
    failed.validation.results.find((r) => r.checkId === "lint").status,
    "failure",
  );
  // Revoked mid-attempt, the controller cannot trust its own stop receipt.
  const revoked = ownerRecord(t);
  const transport = liveTransport({
    dispatched: (r) => {
      if (r.check.id === "type") rmSync(revoked.path);
    },
  });
  const report = await validationAcceptance(
    transport,
    ownerValidationAdmission(revoked.path),
    pins.imageSha256,
  );
  assert.equal(report.outcome, "blocked");
  const last = report.stages.at(-1);
  assert.equal(last.name, "final-exact-attempt-stop");
  assert.equal(last.outcome, "passed");
  assert.ok(transport.effects.stops >= 2);
});

test("the validation acceptance runs only with explicit, well-formed arguments", async () => {
  const { spawnSync } = await import("node:child_process");
  const image = "a".repeat(64);
  for (const args of [
    [],
    [
      "not-a-machine",
      "/r.json",
      image,
      "/report.json",
      "--approve-offline-native-run",
    ],
    [
      "aios-macos-noshare",
      "/r.json",
      "short",
      "/report.json",
      "--approve-offline-native-run",
    ],
    ["aios-macos-noshare", "/r.json", image, "/report.json", "--approve"],
    ["aios-macos-noshare", "/r.json", image, "--approve-offline-native-run"],
    [
      "aios-macos-noshare",
      "/r.json",
      image,
      "/report.json",
      "--approve-offline-native-run",
      "extra",
    ],
  ]) {
    const result = spawnSync(
      process.execPath,
      ["scripts/run-native-validation-admission-acceptance.mjs", ...args],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1, args.join(" "));
    assert.match(result.stderr, /owner-validation-admission\.json/);
  }
});
