import assert from "node:assert/strict";
import { test } from "node:test";
import {
  changeGateContractSha256,
  classifyChange,
  defaultChangeGateContract,
  matchesGlob,
  validChangeGateContract,
} from "../dist/change-gate.js";

const head = "a".repeat(40),
  base = "b".repeat(40);
const file = (path, extra = {}) => ({
  path,
  status: "modified",
  additions: 1,
  deletions: 1,
  ...extra,
});
const observe = (files, extra = {}) => ({
  head,
  base,
  complete: true,
  baseIsAncestor: true,
  files,
  ...extra,
});
const contract = (extra = {}) => ({
  ...defaultChangeGateContract(),
  dataPaths: ["data/**", "db/migrations/*.sql"],
  ...extra,
});

test("a small ordinary change is ungated and bound to its head and contract", () => {
  const c = contract();
  const e = classifyChange(observe([file("src/a.ts"), file("src/b.ts")]), c);
  assert.deepEqual(e, {
    head,
    base,
    contractSha256: changeGateContractSha256(c),
    gated: false,
    destructive: [],
    wideImpact: [],
    files: 2,
    lines: 4,
  });
});

test("a removed file is destructive; a renamed one is not", () => {
  const removed = classifyChange(
    observe([file("src/old.ts", { status: "removed", additions: 0 })]),
    contract(),
  );
  assert.equal(removed.gated, true);
  assert.deepEqual(removed.destructive, ["deletes src/old.ts"]);
  const renamed = classifyChange(
    observe([
      file("src/new.ts", { status: "renamed", previousPath: "src/old.ts" }),
    ]),
    contract(),
  );
  assert.equal(renamed.gated, false);
});

test("changing, renaming or removing persisted data is destructive, adding it is not", () => {
  for (const [f, reason] of [
    [file("data/users.json"), "alters persisted data data/users.json"],
    [
      file("archive/users.json", {
        status: "renamed",
        previousPath: "data/users.json",
      }),
      "alters persisted data data/users.json",
    ],
    [
      file("db/migrations/001.sql"),
      "alters persisted data db/migrations/001.sql",
    ],
  ])
    assert.deepEqual(classifyChange(observe([f]), contract()).destructive, [
      reason,
    ]);
  assert.deepEqual(
    classifyChange(
      observe([file("data/seed.json", { status: "added" })]),
      contract(),
    ).destructive,
    [],
  );
  assert.deepEqual(
    classifyChange(
      observe([file("data/users.json", { status: "removed" })]),
      contract(),
    ).destructive,
    ["deletes data/users.json"],
  );
});

test("a head whose base is not an ancestor rewrites history", () => {
  const e = classifyChange(
    observe([file("src/a.ts")], { baseIsAncestor: false }),
    contract(),
  );
  assert.deepEqual(e.destructive, ["rewrites history"]);
  assert.equal(e.gated, true);
});

test("file and line limits are inclusive at the edge and gate one past it", () => {
  const c = contract({ maxFiles: 3, maxLines: 10 });
  const at = [1, 2, 3].map((n) =>
    file(`src/${n}.ts`, { additions: n === 3 ? 3 : 2, deletions: 1 }),
  );
  assert.equal(classifyChange(observe(at), c).gated, false);
  assert.deepEqual(
    classifyChange(
      observe([...at, file("src/4.ts", { additions: 0, deletions: 0 })]),
      c,
    ).wideImpact,
    ["changes 4 files, over the limit of 3"],
  );
  assert.deepEqual(
    classifyChange(
      observe([
        ...at.slice(0, 2),
        file("src/3.ts", { additions: 4, deletions: 1 }),
      ]),
      c,
    ).wideImpact,
    ["changes 11 lines, over the limit of 10"],
  );
});

test("touching controller authority is wide-impact, including a rename out of it", () => {
  assert.deepEqual(
    classifyChange(observe([file(".github/workflows/ci.yml")]), contract())
      .wideImpact,
    ["touches controller authority .github/workflows/ci.yml"],
  );
  assert.deepEqual(
    classifyChange(observe([file("docs/CODEOWNERS")]), contract()).wideImpact,
    ["touches controller authority docs/CODEOWNERS"],
  );
  assert.deepEqual(
    classifyChange(
      observe([
        file("ci/ci.yml", {
          status: "renamed",
          previousPath: ".github/workflows/ci.yml",
        }),
      ]),
      contract(),
    ).wideImpact,
    ["touches controller authority ci/ci.yml"],
  );
});

test("an incomplete file list is gated, never assumed small", () => {
  assert.deepEqual(
    classifyChange(observe([file("src/a.ts")], { complete: false }), contract())
      .wideImpact,
    ["changed file list is incomplete"],
  );
});

test("each head is classified afresh: a later push can turn an ungated head gated", () => {
  const first = classifyChange(observe([file("src/a.ts")]), contract());
  const pushed = classifyChange(
    observe([file("src/a.ts"), file("src/b.ts", { status: "removed" })], {
      head: "c".repeat(40),
    }),
    contract(),
  );
  assert.equal(first.gated, false);
  assert.equal(pushed.gated, true);
  assert.equal(pushed.head, "c".repeat(40));
});

test("malformed observations throw instead of classifying", () => {
  for (const bad of [
    observe([file("../escape")]),
    observe([file("/abs")]),
    observe([file("a\\b")]),
    observe([file("a//b")]),
    observe([file("a.ts"), file("a.ts")]),
    observe([file("a.ts", { status: "deleted" })]),
    observe([file("a.ts", { status: "renamed" })]),
    observe([file("a.ts", { previousPath: "b.ts" })]),
    observe([file("a.ts", { additions: -1 })]),
    observe([file("a.ts", { deletions: 1.5 })]),
    observe([file("a.ts")], { head: "short" }),
    observe([file("a.ts")], { complete: "yes" }),
    observe("not files"),
  ])
    assert.throws(() => classifyChange(bad, contract()), /Unverified/);
});

test("contracts are strict, and their digest ignores glob order", () => {
  assert.equal(validChangeGateContract(defaultChangeGateContract()), true);
  for (const bad of [
    { ...contract(), maxFiles: 0 },
    { ...contract(), maxLines: -1 },
    { ...contract(), extra: true },
    { ...contract(), authorityPaths: ["../x"] },
    { ...contract(), dataPaths: ["a**b"] },
    null,
  ]) {
    assert.equal(validChangeGateContract(bad), false);
    assert.throws(
      () => classifyChange(observe([]), bad),
      /Invalid change gate/,
    );
  }
  assert.equal(
    changeGateContractSha256(contract({ authorityPaths: ["a/**", "b/**"] })),
    changeGateContractSha256(contract({ authorityPaths: ["b/**", "a/**"] })),
  );
});

test("globs match within a segment with * and across segments with **", () => {
  assert.equal(matchesGlob(".github/**", ".github/workflows/ci.yml"), true);
  assert.equal(matchesGlob(".github/**", ".github"), true);
  assert.equal(matchesGlob("**/CODEOWNERS", "CODEOWNERS"), true);
  assert.equal(matchesGlob("**/CODEOWNERS", "a/b/CODEOWNERS"), true);
  assert.equal(matchesGlob("db/*.sql", "db/x.sql"), true);
  assert.equal(matchesGlob("db/*.sql", "db/sub/x.sql"), false);
  assert.equal(matchesGlob("db/*.sql", "db/x.sqlx"), false);
  assert.equal(matchesGlob("src/a.ts", "src/a.ts"), true);
  assert.equal(matchesGlob("src/a?ts", "src/a.ts"), false);
});
