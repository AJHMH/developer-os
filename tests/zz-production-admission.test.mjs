// The owner's production admission (ticket 04, #264): a private record naming
// the exact coding and validation pins of a passing worker qualification
// report, which it names by path and digest. The name sorts after every other
// test file, so no other file changes shard.
import "./helpers/owner-host-stand-in.mjs";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ownerProductionAdmission } from "../dist/production-admission.js";
import { validationBindingSha256 } from "../dist/native-validation.js";

const coding = Object.freeze({
  cliVersion: "2.1.311",
  cliSha256: "c".repeat(64),
  policySha256: "d".repeat(64),
  bindingSha256: "e".repeat(64),
});
const validation = Object.freeze({
  imageSha256: "a".repeat(64),
  policySha256: "b".repeat(64),
  bindingSha256: "f".repeat(64),
});
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** A passing report and a record naming it, in a private folder outside any
 * repository. `report` and `record` patch either one. */
function owner(t, { report = {}, record = {}, reportText } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "aios-production-admission-"));
  t.after(() => rmSync(directory, { recursive: true }));
  chmodSync(directory, 0o700);
  const reportPath = join(directory, "qualification.json");
  const text =
    reportText ??
    JSON.stringify({
      scope: "native-worker-offline-qualification",
      outcome: "observed-offline-worker-qualification",
      buildFresh: true,
      sourceDirty: false,
      qualified: false,
      productionEnabled: false,
      pins: { coding, validation },
      ...report,
    });
  writeFileSync(reportPath, text, { mode: 0o600 });
  const path = join(directory, "production-admission.json");
  const write = (fields = record) =>
    writeFileSync(
      path,
      JSON.stringify({
        scope: "aios-production-admission-v1",
        approvedAt: "2026-11-10T00:00:00.000Z",
        qualificationReport: reportPath,
        qualificationSha256: sha256(text),
        pins: { coding, validation },
        ...fields,
      }),
      { mode: 0o600 },
    );
  write();
  return { directory, path, reportPath, write };
}
const now = () => Date.parse("2026-11-11T00:00:00.000Z");

test("a record naming a passing report's exact pins admits those pins", (t) => {
  const o = owner(t);
  const admitted = ownerProductionAdmission(o.path, { clock: now }).admitted();
  assert.deepEqual(admitted.coding, coding);
  assert.equal(
    admitted.validationBindingSha256,
    validationBindingSha256(validation),
  );
  assert.match(admitted.productionSha256, /^[a-f0-9]{64}$/);
});

test("the admission's digest changes with the record", (t) => {
  const o = owner(t);
  const admission = ownerProductionAdmission(o.path, { clock: now });
  const first = admission.admitted().productionSha256;
  o.write({ approvedAt: "2026-11-10T01:00:00.000Z" });
  assert.notEqual(admission.admitted().productionSha256, first);
});

for (const [name, patch] of [
  ["another outcome", { report: { outcome: "failed" } }],
  ["another scope", { report: { scope: "native-session-acceptance" } }],
  ["a stale build", { report: { buildFresh: false } }],
  ["a dirty source", { report: { sourceDirty: true } }],
  [
    "other coding pins",
    {
      report: {
        pins: { coding: { ...coding, cliVersion: "2.1.312" }, validation },
      },
    },
  ],
  [
    "other validation pins",
    {
      report: {
        pins: {
          coding,
          validation: { ...validation, imageSha256: "9".repeat(64) },
        },
      },
    },
  ],
  ["a report that isn't JSON", { reportText: "not json" }],
])
  test(`a report with ${name} admits nothing`, (t) => {
    const o = owner(t, patch);
    assert.throws(
      () => ownerProductionAdmission(o.path, { clock: now }).admitted(),
      /Owner production admission is missing or invalid/,
    );
  });

for (const [name, fields] of [
  ["another scope", { scope: "aios-claude-coding-admission-v1" }],
  ["a future approval", { approvedAt: "2026-11-12T00:00:00.000Z" }],
  ["an inexact approval time", { approvedAt: "2026-11-10" }],
  ["another report digest", { qualificationSha256: "0".repeat(64) }],
  ["a relative report path", { qualificationReport: "qualification.json" }],
  ["an extra field", { note: "x" }],
  [
    "pins the report doesn't name",
    { pins: { coding: { ...coding, cliSha256: "1".repeat(64) }, validation } },
  ],
  [
    "a missing pin",
    { pins: { coding: { ...coding, cliVersion: undefined }, validation } },
  ],
  ["an extra pin group", { pins: { coding, validation, other: {} } }],
])
  test(`a record with ${name} admits nothing`, (t) => {
    const o = owner(t);
    o.write(fields);
    assert.throws(
      () => ownerProductionAdmission(o.path, { clock: now }).admitted(),
      /Owner production admission is missing or invalid/,
    );
  });

test("a report changed after approval revokes the admission", (t) => {
  const o = owner(t);
  const admission = ownerProductionAdmission(o.path, { clock: now });
  admission.admitted();
  writeFileSync(o.reportPath, "{}", { mode: 0o600 });
  assert.throws(() => admission.admitted(), /missing or invalid/);
});

test("a removed record revokes the admission", (t) => {
  const o = owner(t);
  const admission = ownerProductionAdmission(o.path, { clock: now });
  admission.admitted();
  rmSync(o.path);
  assert.throws(() => admission.admitted(), /missing or invalid/);
});

test("records and reports never live in a repository", (t) => {
  const o = owner(t);
  assert.throws(
    () => ownerProductionAdmission("production-admission.json"),
    /must be absolute/,
  );
  const repository = join(o.directory, "repo");
  mkdirSync(join(repository, ".git"), { recursive: true });
  assert.throws(
    () =>
      ownerProductionAdmission(join(repository, "production-admission.json")),
    /never live in a repository/,
  );
  // A report inside a repository is refused at the read.
  const inside = join(repository, "qualification.json");
  writeFileSync(inside, "{}", { mode: 0o600 });
  o.write({ qualificationReport: inside });
  assert.throws(
    () => ownerProductionAdmission(o.path, { clock: now }).admitted(),
    /missing or invalid/,
  );
});

test("a record others can read admits nothing", (t) => {
  const o = owner(t);
  chmodSync(o.path, 0o644);
  assert.throws(
    () => ownerProductionAdmission(o.path, { clock: now }).admitted(),
    /missing or invalid/,
  );
});

const checkProduction = (path) =>
  spawnSync(
    process.execPath,
    ["dist/cli.js", "check-production", "--production-admission", path],
    { encoding: "utf8" },
  );

test("the owner checks a production record from the CLI", (t) => {
  const o = owner(t);
  const checked = checkProduction(o.path);
  assert.equal(checked.status, 0, checked.stderr);
  const result = JSON.parse(checked.stdout);
  assert.deepEqual(result.coding, coding);
  assert.equal(
    result.validationBindingSha256,
    validationBindingSha256(validation),
  );
  assert.match(result.productionSha256, /^[a-f0-9]{64}$/);
});

test("the CLI refuses an unusable production record", (t) => {
  const o = owner(t, { report: { outcome: "failed" } });
  const checked = checkProduction(o.path);
  assert.notEqual(checked.status, 0);
  assert.match(
    checked.stderr,
    /production admission record is missing or invalid/,
  );
  assert.equal(checked.stdout, "");
});
