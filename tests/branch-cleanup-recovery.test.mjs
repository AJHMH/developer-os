import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanupFixture } from "./helpers/cleanup-fixture.mjs";

const latest = (d) => d.cleanup.rounds.at(-1);
test("partial local success and remote refusal persist independently; recovery never retries a deletion", async (t) => {
  const f = await cleanupFixture(t);
  f.local("pair");
  f.remoteBranch("pair");
  f.beforeDelete = async (r) => {
    if (r.name === "pair" && r.location === "remote") throw Error("refused");
  };
  let d = await f.controller.cleanupBranches(f.delivery.id);
  assert.equal(d.phase, "blocked");
  assert.equal(
    latest(d).entries.find(
      (e) => e.fact.name === "pair" && e.fact.location === "local",
    ).state,
    "deleted",
  );
  assert.equal(
    latest(d).entries.find(
      (e) => e.fact.name === "pair" && e.fact.location === "remote",
    ).state,
    "blocked",
  );
  const count = f.deletions.length;
  f.controller = f.reopenCleanup();
  await f.controller.recover(f.delivery.id);
  assert.equal(f.deletions.length, count);
  f.beforeDelete = undefined;
  d = await f.controller.cleanupBranches(f.delivery.id);
  assert.equal(d.phase, "completed");
  assert.equal(
    f.deletions.filter((x) => x.name === "pair" && x.location === "local")
      .length,
    1,
  );
});

test("lost accepted receipts reconcile deletion without repeating merge, PR creation or deletion", async (t) => {
  const f = await cleanupFixture(t);
  f.local("victim");
  f.afterDelete = async () => {
    throw Error("lost result");
  };
  let d = await f.controller.cleanupBranches(f.delivery.id);
  assert.equal(d.phase, "completed");
  const count = f.deletions.length;
  f.controller = f.reopenCleanup();
  d = await f.controller.recover(f.delivery.id);
  assert.equal(d.phase, "completed");
  assert.equal(f.deletions.length, count);
  assert.equal(f.merges.length, 1);
  assert.deepEqual(f.events, ["sign", "push", "pr"]);
});

test("uncertain deletion fences delayed senders, prevents sync/release and recovers without redispatch", async (t) => {
  const f = await cleanupFixture(t);
  f.local("victim");
  let captured;
  f.cleanupRuntime.remove = async (r) => {
    captured = r;
    f.cleanupInflight = true;
    return new Promise(() => {});
  };
  let d = await f.controller.cleanupBranches(f.delivery.id);
  assert.ok(latest(d).entries.some((e) => e.state === "uncertain"));
  assert.equal(captured.mayDispatch(), false);
  assert.throws(() => f.controller.release(f.delivery.id), /Reconcile cleanup/);
  assert.throws(() => f.controller.resume(f.delivery.id), /Reconcile cleanup/);
  await assert.rejects(
    () => f.controller.syncMain(f.delivery.id),
    /Reconcile cleanup/,
  );
  f.controller = f.reopenCleanup();
  await f.controller.cleanupBranches(f.delivery.id);
  assert.equal(f.deletions.length, 0);
  assert.equal(f.controller.status(f.delivery.id).cleanup.rounds.length, 1);
  f.cleanupInflight = false;
  d = await f.controller.recover(f.delivery.id);
  assert.equal(d.phase, "blocked");
  assert.ok(
    latest(d).entries.some((e) => e.reason === "deletion-not-accepted"),
  );
  assert.equal(f.deletions.length, 0);
});

test("remote main advancement after accepted deletion records the outcome but blocks completion", async (t) => {
  const f = await cleanupFixture(t);
  f.local("victim");
  let next;
  f.afterDelete = async (r) => {
    if (r.name === "victim") {
      next = f.newCommit("advanced main");
      f.g("push", "origin", `${next}:refs/heads/main`);
    }
  };
  const d = await f.controller.cleanupBranches(f.delivery.id);
  assert.equal(d.phase, "blocked");
  assert.equal(
    latest(d).entries.find((e) => e.fact.name === "victim").state,
    "deleted",
  );
  assert.equal(f.g("rev-parse", "main"), f.target);
  assert.notEqual(
    f.g("ls-remote", "--heads", "origin", "refs/heads/main").split(/\s/)[0],
    f.target,
  );
});

test("cancelled cleanup remains cancelled during read-only recovery", async (t) => {
  const f = await cleanupFixture(t);
  f.local("victim");
  let captured;
  f.cleanupRuntime.remove = async (r) => {
    captured = r;
    f.cleanupInflight = true;
    return new Promise(() => {});
  };
  await f.controller.cleanupBranches(f.delivery.id);
  await f.controller.cancel(f.delivery.id);
  assert.equal(captured.mayDispatch(), false);
  f.cleanupInflight = false;
  const d = await f.controller.recover(f.delivery.id);
  assert.equal(d.phase, "cancelled");
  assert.equal(f.deletions.length, 0);
});
