import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanupFixture } from "./helpers/cleanup-fixture.mjs";

test("inventory cannot omit either main tip or report a different local main as complete", async (t) => {
  const f = await cleanupFixture(t);
  f.local("eligible");
  for (const modify of [
    (o) => ({
      ...o,
      branches: o.branches.filter(
        (b) => !(b.name === "main" && b.location === "local"),
      ),
    }),
    (o) => ({
      ...o,
      branches: o.branches.filter(
        (b) => !(b.name === "main" && b.location === "remote"),
      ),
    }),
    (o) => ({
      ...o,
      branches: o.branches.map((b) =>
        b.name === "main" && b.location === "local" ? { ...b, tip: f.old } : b,
      ),
    }),
  ]) {
    f.inventoryChange = modify;
    const d = await f.controller.cleanupBranches(f.delivery.id);
    assert.equal(d.phase, "blocked");
    assert.equal(f.deletions.length, 0);
  }
});

test("case-folded or Unicode-equivalent branch namespace collisions refuse the whole plan", async (t) => {
  const f = await cleanupFixture(t);
  f.local("eligible");
  for (const names of [["MAIN"], ["café", "cafe\u0301"]]) {
    f.inventoryChange = (o) => ({
      ...o,
      branches: [
        ...o.branches,
        ...names.map((name) => ({
          ...o.branches.find((b) => b.location === "local"),
          name,
        })),
      ],
    });
    const d = await f.controller.cleanupBranches(f.delivery.id);
    assert.equal(d.phase, "blocked");
    assert.equal(f.deletions.length, 0);
  }
});

test("malformed, duplicate, incomplete and wrong-repository inventories never dispatch and never retain private transport text", async (t) => {
  const f = await cleanupFixture(t);
  f.local("eligible");
  for (const modify of [
    (o) => ({ ...o, complete: false }),
    (o) => ({ ...o, repository: "wrong/repo" }),
    (o) => ({ ...o, branches: [...o.branches, o.branches[0]] }),
    (o) => ({ ...o, branches: [{ ...o.branches[0], name: "invalid..ref" }] }),
    (o) => ({ ...o, quiescent: false }),
  ]) {
    f.inventoryChange = modify;
    const d = await f.controller.cleanupBranches(f.delivery.id);
    assert.equal(d.phase, "blocked");
    assert.equal(f.deletions.length, 0);
  }
  f.inventoryChange = () => {
    throw Error("private transport diagnostic");
  };
  const d = await f.controller.cleanupBranches(f.delivery.id);
  assert.equal(d.phase, "blocked");
  assert.doesNotMatch(JSON.stringify(d), /private transport diagnostic/);
});

test("new eligible branches discovered at final inventory block completion until an explicit new plan", async (t) => {
  const f = await cleanupFixture(t);
  f.local("victim");
  let added = false;
  f.afterDelete = async () => {
    if (!added) {
      added = true;
      f.local("late-merged");
    }
  };
  let d = await f.controller.cleanupBranches(f.delivery.id);
  assert.equal(d.phase, "blocked");
  assert.equal(f.g("rev-parse", "late-merged"), f.old);
  assert.equal(
    d.cleanup.rounds.at(-1).entries.find((e) => e.fact.name === "late-merged")
      .state,
    "eligible",
  );
  f.afterDelete = undefined;
  d = await f.controller.cleanupBranches(f.delivery.id);
  assert.equal(d.phase, "completed");
  assert.equal(d.cleanup.rounds.length, 2);
});
