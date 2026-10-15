import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewed, resolutionFixture } from "./helpers/review-fixture.mjs";

test("unknown conversation resolution is reconciled after restart even when checks fail, without late writes", async (t) => {
  const f = await resolutionFixture(t);
  let request;
  f.reviewRuntime.resolve = async (r) => {
    request = r;
    return new Promise(() => {});
  };
  let d = await f.controller.resolveReviewThread(f.delivery.id, "thread1");
  assert.equal(d.review.runs.at(-1).resolutions[0].state, "uncertain");
  assert.equal(request.mayDispatch(), false);
  assert.throws(() => f.controller.release(d.id), /Reconcile review/);
  await assert.rejects(f.controller.repairReview(d.id));
  await f.controller.pause(d.id);
  assert.throws(() => f.controller.resume(d.id), /Reconcile review/);
  const original = f.reviewSnapshot;
  f.reviewSnapshot = () => {
    const s = original();
    s.threads[0].resolved = true;
    s.resolutions = [{ operationId: request.operationId, state: "accepted" }];
    return s;
  };
  const checks = f.snapshot;
  f.snapshot = () => {
    const s = checks();
    s.checks[0].status = "failure";
    return s;
  };
  f.time += 5000;
  f.controller = f.reopenReview();
  d = await f.controller.recover(d.id);
  assert.equal(d.phase, "paused");
  assert.equal(d.review.runs.at(-1).resolutions[0].state, "accepted");
  assert.equal(d.review.runs.at(-1).approval, undefined);
  assert.equal(request.mayDispatch(), false);
});

test("changed review thread content invalidates verification and cannot be resolved", async (t) => {
  const f = await resolutionFixture(t),
    original = f.reviewSnapshot;
  f.reviewSnapshot = () => {
    const s = original();
    s.threads[0].digest = "4".repeat(64);
    return s;
  };
  await assert.rejects(
    f.controller.resolveReviewThread(f.delivery.id, "thread1"),
  );
  assert.deepEqual(f.resolutions, []);
  assert.equal(f.controller.status(f.delivery.id).repair.attempts.length, 1);
});

test("stale concurrent review observations cannot replace a newer dismissal", async (t) => {
  const f = await reviewed(t),
    original = f.reviewRuntime.observe;
  let entered, finish;
  const started = new Promise((r) => (entered = r));
  f.reviewRuntime.observe = () => {
    entered();
    return new Promise((r) => (finish = r));
  };
  const pending = f.controller.monitorReview(f.delivery.id);
  await started;
  f.reviewRuntime.observe = async () => {
    const s = await original();
    s.reviews[0].state = "DISMISSED";
    return s;
  };
  const fresh = await f.controller.monitorReview(f.delivery.id);
  assert.equal(fresh.phase, "waiting-review");
  finish(await original());
  await pending;
  assert.equal(
    f.controller.status(f.delivery.id).review.runs.at(-1).approval,
    undefined,
  );
});

test("runtime drift and pause fence a prepared conversation resolution", async (t) => {
  const f = await resolutionFixture(t);
  f.reviewRuntime.resolve = async (r) => {
    assert.equal(r.mayDispatch(), true);
    f.reviewRuntime.bindingSha256 = "7".repeat(64);
    assert.equal(r.mayDispatch(), false);
    await f.controller.pause(f.delivery.id);
    assert.equal(r.mayDispatch(), false);
    throw Error("Authorization: Bearer secret-canary");
  };
  const d = await f.controller.resolveReviewThread(f.delivery.id, "thread1");
  assert.equal(d.phase, "paused");
  assert.equal(d.review.runs.at(-1).resolutions[0].state, "uncertain");
  assert.equal(JSON.stringify(d).includes("secret-canary"), false);
  assert.deepEqual(f.resolutions, []);
});

test("only quiescent absence permits another explicit resolution attempt", async (t) => {
  const f = await resolutionFixture(t),
    resolve = f.reviewRuntime.resolve,
    original = f.reviewSnapshot;
  let first;
  f.reviewRuntime.resolve = async (r) => {
    first = r;
    throw Error("lost response");
  };
  await f.controller.resolveReviewThread(f.delivery.id, "thread1");
  f.reviewSnapshot = () => ({
    ...original(),
    resolutions: [
      { operationId: first.operationId, state: "absent", quiescent: false },
    ],
  });
  await assert.rejects(
    f.controller.resolveReviewThread(f.delivery.id, "thread1"),
  );
  f.reviewSnapshot = () => ({
    ...original(),
    resolutions: [
      { operationId: first.operationId, state: "absent", quiescent: true },
    ],
  });
  f.reviewRuntime.resolve = resolve;
  const d = await f.controller.resolveReviewThread(f.delivery.id, "thread1");
  assert.equal(d.review.runs.at(-1).resolutions[0].state, "not-applied");
  assert.equal(d.review.runs.at(-1).resolutions[1].state, "accepted");
  assert.equal(f.resolutions.length, 1);
  assert.notEqual(f.resolutions[0].operationId, first.operationId);
  assert.equal(first.mayDispatch(), false);
});

test("a concurrent disputed reassessment fences resolution of unchanged thread content", async (t) => {
  const f = await resolutionFixture(t),
    original = f.reviewSnapshot;
  let permitted;
  f.reviewRuntime.resolve = async (r) => {
    assert.equal(r.mayDispatch(), true);
    f.reviewSnapshot = () => {
      const s = original();
      s.threads[0].assessment.disposition = "disputed";
      return s;
    };
    await f.controller.monitorReview(f.delivery.id);
    permitted = r.mayDispatch();
    throw Error("Dispatch fenced after reassessment");
  };
  const d = await f.controller.resolveReviewThread(f.delivery.id, "thread1");
  assert.equal(d.review.runs.at(-1).resolutions[0].state, "uncertain");
  assert.equal(permitted, false);
  assert.deepEqual(f.resolutions, []);
});
