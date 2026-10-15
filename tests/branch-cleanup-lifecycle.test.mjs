import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanupFixture } from "./helpers/cleanup-fixture.mjs";

test("recovery fences the original cleanup runner before it can continue later deletions", async (t) => {
  const f = await cleanupFixture(t);
  f.local("first");
  f.local("second");
  let release, entered;
  const started = new Promise((r) => (entered = r));
  f.beforeDelete = async () => {
    entered();
    await new Promise((r) => (release = r));
  };
  const old = f.controller.cleanupBranches(f.delivery.id);
  await started;
  f.controller = f.reopenCleanup();
  const recovered = await f.controller.recover(f.delivery.id);
  assert.equal(recovered.phase, "blocked");
  release();
  await old;
  assert.equal(f.deletions.length, 0);
  assert.equal(f.controller.status(f.delivery.id).phase, "blocked");
});

test("late unavailable operation observations cannot overwrite a newer completion", async (t) => {
  const f = await cleanupFixture(t);
  f.local("victim");
  let release,
    entered,
    hold = true;
  const started = new Promise((r) => (entered = r)),
    observe = f.cleanupRuntime.observe;
  f.cleanupRuntime.observe = async (target) => {
    if (target.operationId && hold) {
      entered();
      return new Promise((r) => (release = r));
    }
    return observe(target);
  };
  const old = f.controller.cleanupBranches(f.delivery.id);
  await started;
  hold = false;
  f.controller = f.reopenCleanup();
  const current = await f.controller.recover(f.delivery.id);
  // Recovery may leave undispatched eligible branches for an explicit new plan.
  assert.ok(["completed", "blocked"].includes(current.phase));
  const phase = current.phase,
    count = f.deletions.length;
  release(undefined);
  await old;
  assert.equal(f.controller.status(f.delivery.id).phase, phase);
  assert.equal(f.deletions.length, count);
});

test("failed current-main checks revoke completion without deleting additional branches", async (t) => {
  const f = await cleanupFixture(t);
  f.local("victim");
  const original = f.mainSnapshot;
  f.mainSnapshot = () => {
    const o = original();
    o.checks[0].status = "failure";
    return o;
  };
  await assert.rejects(() => f.controller.cleanupBranches(f.delivery.id));
  assert.equal(f.deletions.length, 0);
  assert.equal(f.controller.status(f.delivery.id).phase, "blocked");
});
