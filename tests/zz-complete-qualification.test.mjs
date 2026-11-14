// #274 (v1 ticket 16): the complete controller qualification binds the
// owner-run component reports, and a production admission naming it admits
// the complete level.
import "./helpers/owner-host-stand-in.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  completeQualification,
  passingCompleteQualification,
  qualificationBoundaries,
  qualificationComponents,
} from "../dist/complete-qualification.js";
import { ownerProductionAdmission } from "../dist/production-admission.js";

const revision = "f".repeat(40);
const host = {
  platform: "darwin",
  arch: "arm64",
  release: "27.3.0",
  machine: "aios-macos-noshare",
};
const coding = Object.freeze({
  cliVersion: "2.1.311",
  cliSha256: "c".repeat(64),
  policySha256: "d".repeat(64),
  bindingSha256: "e".repeat(64),
});
const validation = Object.freeze({
  imageSha256: "a".repeat(64),
  policySha256: "b".repeat(64),
  bindingSha256: "9".repeat(64),
});
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const stagesFor = (name) => [
  ...new Set(
    qualificationBoundaries.flatMap((b) =>
      b.evidence.filter(([c]) => c === name).flatMap(([, stages]) => stages),
    ),
  ),
];
const probes = (names) => names.map((name) => ({ name, outcome: "passed" }));

/** A passing report for each component, as the scripts write them. */
function reports() {
  const common = (name) => ({
    scope: qualificationComponents[name].scope,
    outcome: qualificationComponents[name].outcome,
    buildFresh: true,
    sourceDirty: false,
    sourceRevision: revision,
    productionEnabled: false,
    host,
    stages: stagesFor(name).map((stage) => ({
      name: stage,
      outcome: "passed",
    })),
  });
  return {
    worker: {
      ...common("worker"),
      pins: { coding, validation },
      coding: { probes: probes(["network", "proxy", "cross-delivery"]) },
      validation: { probes: probes(["network", "proxy"]) },
    },
    session: { ...common("session"), pins: coding },
    validation: { ...common("validation"), pins: validation },
    lifecycle: { ...common("lifecycle"), freshPins: { coding, validation } },
    delivery: { ...common("delivery"), freshPins: { coding, validation } },
  };
}

/** The reports in a private owner folder; `patch` changes some first. */
function owner(t, patch = (r) => r) {
  const directory = mkdtempSync(join(tmpdir(), "aios-complete-qualification-"));
  t.after(() => rmSync(directory, { recursive: true }));
  chmodSync(directory, 0o700);
  const all = patch(reports());
  const paths = {};
  for (const [name, report] of Object.entries(all)) {
    paths[name] = join(directory, `${name}.json`);
    writeFileSync(paths[name], JSON.stringify(report), { mode: 0o600 });
  }
  return { directory, paths };
}
const boundary = (report, id) => report.boundaries.find((b) => b.id === id);

test("components from one clean revision, Mac, VM and pins pass every boundary", (t) => {
  const o = owner(t);
  const report = completeQualification(o.paths, revision);
  assert.equal(report.outcome, passingCompleteQualification);
  assert.equal(report.productionEnabled, false);
  assert.deepEqual(report.missing, []);
  assert.deepEqual(report.pins, { coding, validation });
  for (const b of report.boundaries) assert.equal(b.outcome, "passed", b.id);
  // Every boundary names the criterion it evidences and its exact stages.
  assert.deepEqual(
    [...new Set(report.boundaries.map((b) => b.criterion))].sort(),
    [1, 2, 3, 4],
  );
  for (const c of Object.values(report.components)) {
    assert.equal(c.accepted, true);
    assert.match(c.sha256, /^[a-f0-9]{64}$/);
  }
});

test("a component from another revision, host, VM or pins is rejected, and its boundaries are not run", (t) => {
  for (const [label, patch, problem] of [
    [
      "another revision",
      (r) => ((r.lifecycle.sourceRevision = "0".repeat(40)), r),
      /source revision/,
    ],
    ["a dirty tree", (r) => ((r.session.sourceDirty = true), r), /dirty/],
    ["a stale build", (r) => ((r.delivery.buildFresh = false), r), /stale/],
    [
      "an old macOS",
      (r) => ((r.validation.host = { ...host, release: "22.6.0" }), r),
      /unsupported host/,
    ],
    [
      "another VM",
      (r) => ((r.lifecycle.host = { ...host, machine: "other" }), r),
      /another VM/,
    ],
    [
      "other coding pins",
      (r) => (
        (r.session.pins = { ...coding, policySha256: "0".repeat(64) }),
        r
      ),
      /other coding pins/,
    ],
    [
      "other validation pins",
      (r) => (
        (r.delivery.freshPins = {
          coding,
          validation: { ...validation, imageSha256: "0".repeat(64) },
        }),
        r
      ),
      /other validation pins/,
    ],
    [
      "another outcome",
      (r) => ((r.lifecycle.outcome = "blocked"), r),
      /outcome blocked/,
    ],
    [
      "another kind of report",
      (r) => ((r.delivery.scope = "native-delivery-through-sync"), r),
      /another kind/,
    ],
    [
      "production enabled",
      (r) => ((r.session.productionEnabled = true), r),
      /production enabled/,
    ],
  ]) {
    const o = owner(t, patch);
    const report = completeQualification(o.paths, revision);
    assert.equal(report.outcome, "blocked", label);
    const rejected = Object.entries(report.components).filter(
      ([, c]) => !c.accepted,
    );
    assert.equal(rejected.length, 1, label);
    assert.match(rejected[0][1].problems.join(";"), problem, label);
    const name = rejected[0][0];
    for (const b of report.boundaries)
      if (b.evidence.some((e) => e.component === name))
        assert.equal(b.outcome, "not-run", `${label}: ${b.id}`);
  }
});

test("a failed stage or probe fails its boundary; a missing one leaves it not run", (t) => {
  const failed = completeQualification(
    owner(t, (r) => {
      r.lifecycle.stages.find((s) => s.name === "b-recover").outcome =
        "blocked";
      r.worker.coding.probes.find((p) => p.name === "proxy").outcome = "failed";
      return r;
    }).paths,
    revision,
  );
  assert.equal(failed.outcome, "blocked");
  assert.equal(boundary(failed, "controller-recovery").outcome, "failed");
  assert.equal(boundary(failed, "boundary-probes").outcome, "failed");
  assert.equal(boundary(failed, "pause-and-cancel").outcome, "passed");
  const missing = completeQualification(
    owner(t, (r) => {
      r.lifecycle.stages.find((s) => s.name === "a-pause-mid-coding").outcome =
        "not-run";
      r.validation.stages = r.validation.stages.filter(
        (s) => s.name !== "controller-browser-validation",
      );
      // A worker qualification from before the two new probes.
      r.worker.coding.probes = probes(["network"]);
      return r;
    }).paths,
    revision,
  );
  assert.equal(boundary(missing, "pause-and-cancel").outcome, "not-run");
  assert.equal(boundary(missing, "isolated-web-validation").outcome, "not-run");
  assert.equal(boundary(missing, "boundary-probes").outcome, "not-run");
  // A worker report with no probe results at all.
  const noProbes = completeQualification(
    owner(t, (r) => {
      delete r.worker.validation;
      return r;
    }).paths,
    revision,
  );
  assert.equal(boundary(noProbes, "boundary-probes").outcome, "not-run");
  assert.ok(
    boundary(noProbes, "boundary-probes").evidence.some(
      (e) => e.stage === "validation-probes",
    ),
  );
});

test("a missing or unreadable component blocks, and is named", (t) => {
  const o = owner(t);
  const { delivery, ...rest } = o.paths;
  const report = completeQualification(rest, revision);
  assert.equal(report.outcome, "blocked");
  assert.deepEqual(report.missing, ["delivery"]);
  assert.equal(boundary(report, "delivery-through-cleanup").outcome, "not-run");
  const unreadable = completeQualification(
    { ...o.paths, worker: join(o.directory, "none.json") },
    revision,
  );
  assert.match(unreadable.components.worker.problems[0], /unreadable/);
  const relative = completeQualification(
    { ...o.paths, session: "session.json" },
    revision,
  );
  assert.match(relative.components.session.problems[0], /absolute/);
  writeFileSync(join(o.directory, "list.json"), "[]", { mode: 0o600 });
  const notObject = completeQualification(
    { ...o.paths, session: join(o.directory, "list.json") },
    revision,
  );
  assert.match(notObject.components.session.problems[0], /isn't a report/);
  assert.equal(delivery.endsWith("delivery.json"), true);
});

/** A production admission record naming `reportPath`. */
function record(directory, reportPath, pins = { coding, validation }) {
  const path = join(directory, "production-admission.json");
  writeFileSync(
    path,
    JSON.stringify({
      scope: "aios-production-admission-v1",
      approvedAt: "2026-11-10T00:00:00.000Z",
      qualificationReport: reportPath,
      qualificationSha256: sha256(readFileSync(reportPath, "utf8")),
      pins,
    }),
    { mode: 0o600 },
  );
  return path;
}
const now = () => Date.parse("2026-11-11T00:00:00.000Z");

test("a production admission naming a passing complete qualification admits the complete level", (t) => {
  const o = owner(t);
  const complete = join(o.directory, "complete.json");
  writeFileSync(
    complete,
    JSON.stringify({
      ...completeQualification(o.paths, revision),
      buildFresh: true,
      sourceDirty: false,
    }),
    { mode: 0o600 },
  );
  const admission = ownerProductionAdmission(record(o.directory, complete), {
    clock: now,
  });
  const admitted = admission.admitted();
  assert.equal(admitted.level, "complete");
  assert.deepEqual(admitted.coding, coding);
  // The worker qualification alone admits only the worker level.
  const worker = ownerProductionAdmission(record(o.directory, o.paths.worker), {
    clock: now,
  }).admitted();
  assert.equal(worker.level, "worker");
  // A component changed since the combination revokes the complete level.
  ownerProductionAdmission(record(o.directory, complete), { clock: now });
  writeFileSync(
    o.paths.lifecycle,
    JSON.stringify({ ...reports().lifecycle, note: "edited" }),
    { mode: 0o600 },
  );
  assert.throws(() => admission.admitted(), /missing or invalid/);
  // So does one removed.
  const again = owner(t);
  const kept = join(again.directory, "complete.json");
  writeFileSync(
    kept,
    JSON.stringify({
      ...completeQualification(again.paths, revision),
      buildFresh: true,
      sourceDirty: false,
    }),
    { mode: 0o600 },
  );
  const removed = ownerProductionAdmission(record(again.directory, kept), {
    clock: now,
  });
  assert.equal(removed.admitted().level, "complete");
  rmSync(again.paths.session);
  assert.throws(() => removed.admitted(), /missing or invalid/);
});

test("a complete qualification that didn't pass, or lost a component, is never admitted", (t) => {
  const o = owner(t);
  const base = {
    ...completeQualification(o.paths, revision),
    buildFresh: true,
    sourceDirty: false,
  };
  for (const [label, report] of [
    ["blocked", { ...base, outcome: "blocked" }],
    [
      "a component dropped",
      {
        ...base,
        components: Object.fromEntries(
          Object.entries(base.components).filter(([n]) => n !== "session"),
        ),
      },
    ],
    [
      "a component not accepted",
      {
        ...base,
        components: {
          ...base.components,
          session: { ...base.components.session, accepted: false },
        },
      },
    ],
    [
      "a relative component path",
      {
        ...base,
        components: {
          ...base.components,
          session: { ...base.components.session, path: "session.json" },
        },
      },
    ],
    ["no components", { ...base, components: [] }],
  ]) {
    const path = join(o.directory, "candidate.json");
    rmSync(path, { force: true });
    writeFileSync(path, JSON.stringify(report), { mode: 0o600 });
    assert.throws(
      () =>
        ownerProductionAdmission(record(o.directory, path), {
          clock: now,
        }).admitted(),
      /missing or invalid/,
      label,
    );
  }
});

test("the combination script refuses malformed arguments before reading anything", () => {
  for (const args of [[], ["a.json", "b.json"], ["a.json", "--unknown", "x"]]) {
    const r = spawnSync(
      process.execPath,
      [
        new URL(
          "../scripts/run-native-complete-qualification.mjs",
          import.meta.url,
        ).pathname,
        ...args,
      ],
      { encoding: "utf8" },
    );
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^Usage:/);
  }
});
