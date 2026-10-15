import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { cleanupFixture } from "./helpers/cleanup-fixture.mjs";

test("cleanup rejects a different or unavailable canonical checkout without deleting branches", async (t) => {
  const f = await cleanupFixture(t);
  f.local("eligible");
  for (const checkout of [f.root, join(f.root, "missing-checkout")]) {
    f.inventoryChange = (o) => ({ ...o, checkout });
    const d = await f.controller.cleanupBranches(f.delivery.id);
    assert.equal(d.phase, "blocked");
    assert.equal(f.deletions.length, 0);
    assert.equal(f.g("rev-parse", "eligible"), f.old);
  }
});

test("untrusted PR linkage fields cannot qualify deletion or persist arbitrary transport values", async (t) => {
  const f = await cleanupFixture(t),
    head = f.newCommit();
  f.local("unmerged", head);
  const proof = {
    repository: "AJHMH/profile-page",
    base: "main",
    head,
    mergeCommit: f.target,
    merged: true,
    reachable: true,
    complete: true,
  };
  for (const change of [
    { repository: "private-transport-value" },
    { base: "private-transport-value" },
    { head: "private-transport-value" },
    { mergeCommit: "private-transport-value" },
  ]) {
    f.linkages.set("local:unmerged", { ...proof, ...change });
    const d = await f.controller.cleanupBranches(f.delivery.id);
    assert.equal(d.phase, "blocked");
    assert.equal(f.deletions.length, 0);
    const e = d.cleanup.rounds
      .at(-1)
      .entries.find((e) => e.fact.name === "unmerged");
    assert.equal(e.reason, "ambiguous-merge-linkage");
    assert.doesNotMatch(JSON.stringify(d), /private-transport-value/);
    assert.equal(f.g("rev-parse", "unmerged"), head);
  }
});

test("unavailable operation and final inventories retain outcomes until read-only recovery can verify completion", async (t) => {
  const f = await cleanupFixture(t);
  f.local("first");
  const observe = f.cleanupRuntime.observe;
  let rejectOperation = true,
    afterDelete = false;
  f.afterDelete = async () => {
    afterDelete = true;
  };
  f.cleanupRuntime.observe = async (target) => {
    if (
      afterDelete &&
      (rejectOperation ? Boolean(target.operationId) : !target.operationId)
    )
      throw Error("private observation failure");
    return observe(target);
  };
  let d = await f.controller.cleanupBranches(f.delivery.id);
  assert.equal(d.phase, "blocked");
  assert.ok(
    d.cleanup.rounds.at(-1).entries.some((e) => e.state === "uncertain"),
  );
  const count = f.deletions.length;
  f.cleanupRuntime.observe = observe;
  d = await f.controller.recover(f.delivery.id);
  assert.equal(f.deletions.length, count);
  assert.doesNotMatch(JSON.stringify(d), /private observation failure/);
  // Complete any undispatched eligible entries under a new explicit plan first.
  d = await f.controller.cleanupBranches(f.delivery.id);
  assert.equal(d.phase, "completed");
  f.local("second");
  rejectOperation = false;
  afterDelete = false;
  f.cleanupRuntime.observe = async (target) => {
    if (afterDelete && !target.operationId)
      throw Error("private final-inventory failure");
    return observe(target);
  };
  d = await f.controller.cleanupBranches(f.delivery.id);
  assert.equal(d.phase, "blocked");
  assert.equal(
    d.cleanup.rounds.at(-1).entries.find((e) => e.fact.name === "second").state,
    "deleted",
  );
  const finalCount = f.deletions.length;
  f.cleanupRuntime.observe = observe;
  d = await f.controller.recover(f.delivery.id);
  assert.equal(d.phase, "completed");
  assert.equal(f.deletions.length, finalCount);
});
