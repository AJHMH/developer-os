import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeFixture } from "./helpers/merge-fixture.mjs";

test("lost merge receipt survives restart and reconciles accepted PR/main linkage without another write", async (t) => {
  const f = await mergeFixture(t);
  let receipt;
  const merge = f.mergeRuntime.merge;
  f.mergeRuntime.merge = async (r) => {
    receipt = await merge(r);
    return new Promise(() => {});
  };
  let d = await f.controller.mergeFeature(f.delivery.id);
  assert.equal(d.merge.attempts.at(-1).state, "uncertain");
  assert.throws(() => f.controller.release(f.delivery.id), /merge/);
  assert.throws(() => f.controller.resume(f.delivery.id), /merge/);
  await assert.rejects(f.controller.publishFeature(f.delivery.id), /merge/);
  await assert.rejects(f.controller.repairReview(f.delivery.id), /merge/);
  f.controller = f.reopenMerge();
  f.mergeRuntime.reconcile = async () => receipt;
  d = await f.controller.recover(f.delivery.id);
  assert.equal(d.phase, "merged");
  await f.controller.mergeFeature(f.delivery.id);
  assert.equal(f.merges.length, 1);
});

test("unproven absence never retries while quiescent absence permits a new freshly gated attempt", async (t) => {
  const f = await mergeFixture(t),
    merge = f.mergeRuntime.merge;
  f.mergeRuntime.merge = async () => {
    throw Error("credential-secret-canary");
  };
  let d = await f.controller.mergeFeature(f.delivery.id);
  const operationId = d.merge.attempts.at(-1).operationId;
  f.controller = f.reopenMerge();
  f.mergeRuntime.reconcile = async () => ({
    operationId,
    state: "absent",
    quiescent: false,
  });
  d = await f.controller.mergeFeature(f.delivery.id);
  assert.equal(d.merge.attempts.at(-1).state, "uncertain");
  assert.equal(JSON.stringify(d).includes("credential-secret-canary"), false);
  f.mergeRuntime.reconcile = async () => ({
    operationId,
    state: "absent",
    quiescent: true,
  });
  d = await f.controller.reconcileMerge(f.delivery.id);
  assert.equal(d.merge.attempts.at(-1).state, "not-applied");
  f.mergeRuntime.merge = merge;
  d = await f.controller.mergeFeature(f.delivery.id);
  assert.equal(d.phase, "merged");
  assert.notEqual(d.merge.attempts.at(-1).operationId, operationId);
});

test("pause during dispatch fences new effects but retains an accepted merge without resuming delivery", async (t) => {
  const f = await mergeFixture(t),
    merge = f.mergeRuntime.merge;
  f.mergeRuntime.merge = async (r) => {
    const receipt = await merge(r);
    await f.controller.pause(f.delivery.id);
    assert.equal(r.mayDispatch(), false);
    return receipt;
  };
  const d = await f.controller.mergeFeature(f.delivery.id);
  assert.equal(d.phase, "paused");
  assert.equal(d.merge.attempts.at(-1).state, "merged");
  assert.equal(f.merges.length, 1);
});

test("a competing controller recovering a pre-dispatch intent prevents the original controller from merging", async (t) => {
  const f = await mergeFixture(t);
  let release, entered;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  const observe = f.mergeRuntime.observe;
  f.mergeRuntime.observe = async () => {
    entered();
    await new Promise((resolve) => {
      release = resolve;
    });
    return observe();
  };
  const pending = f.controller.mergeFeature(f.delivery.id);
  await ready;
  const other = f.reopenMerge();
  const recovered = await other.recover(f.delivery.id);
  assert.equal(recovered.merge.attempts.at(-1).state, "blocked");
  release();
  await pending;
  assert.equal(f.merges.length, 0);
});

test("wrong merge linkage and changed adapter bindings cannot settle uncertain effects", async (t) => {
  const f = await mergeFixture(t),
    merge = f.mergeRuntime.merge;
  let receipt;
  f.mergeRuntime.merge = async (r) => {
    receipt = await merge(r);
    return { ...receipt, head: "e".repeat(40) };
  };
  let d = await f.controller.mergeFeature(f.delivery.id);
  assert.equal(d.merge.attempts.at(-1).state, "uncertain");
  for (const bad of [
    { ...receipt, operationId: "another" },
    { ...receipt, baseRevision: "e".repeat(40) },
    { ...receipt, reachable: false },
    { ...receipt, mainRevision: "secret-canary" },
  ]) {
    f.mergeRuntime.reconcile = async () => bad;
    d = await f.controller.reconcileMerge(f.delivery.id);
    assert.equal(d.merge.attempts.at(-1).state, "uncertain");
    assert.equal(JSON.stringify(d).includes("secret-canary"), false);
  }
  f.mergeRuntime.bindingSha256 = "1".repeat(64);
  await assert.rejects(
    f.controller.recover(f.delivery.id),
    /same trusted binding/,
  );
  assert.equal(f.merges.length, 1);
});

test("a remote head race after observation is rejected by the conditional effect and never lands the raced candidate", async (t) => {
  const f = await mergeFixture(t);
  f.mergeRuntime.merge = async (r) => {
    const racedHead = "e".repeat(40);
    assert.equal(r.head, "a".repeat(40));
    assert.notEqual(r.head, racedHead);
    assert.equal(r.mayDispatch(), true);
    // Trusted adapter models remote expected-head rejection, including quiescence.
    return { operationId: r.operationId, state: "absent", quiescent: true };
  };
  const d = await f.controller.mergeFeature(f.delivery.id);
  assert.equal(d.merge.attempts.at(-1).state, "not-applied");
  assert.equal(d.phase, "blocked");
  assert.equal(f.merges.length, 0);
});

test("late advanced-base observation cannot overwrite a newer controller's merged outcome", async (t) => {
  const f = await mergeFixture(t),
    observe = f.mergeRuntime.observe;
  f.mergeTimeout = 10000;
  f.controller = f.reopenMerge();
  let entered, release;
  const ready = new Promise((r) => {
    entered = r;
  });
  let first = true;
  f.mergeRuntime.observe = async (r) => {
    const result = await observe(r);
    if (first) {
      first = false;
      entered();
      await new Promise((r) => {
        release = r;
      });
      result.baseRevision = "e".repeat(40);
    }
    return result;
  };
  const pending = f.controller.mergeFeature(f.delivery.id);
  await ready;
  const other = f.reopenMerge();
  await other.recover(f.delivery.id);
  assert.equal((await other.mergeFeature(f.delivery.id)).phase, "merged");
  release();
  const result = await pending;
  assert.equal(result.phase, "merged");
  assert.equal(result.merge.attempts.at(-1).advancedBase, undefined);
  assert.equal(f.merges.length, 1);
});
