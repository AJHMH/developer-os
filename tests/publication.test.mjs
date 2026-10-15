import assert from "node:assert/strict";
import { test } from "node:test";
import { DeliveryController } from "../dist/controller.js";
import { fixture } from "./helpers/publication-controller-fixture.mjs";

test("a validated candidate is signed and pushed by Git identity then proposed by the separate App identity", async (t) => {
  const f = await fixture(t);
  const d = await f.controller.publishFeature(f.delivery.id);
  assert.deepEqual(f.events, ["sign", "push", "pr"]);
  assert.equal(d.publication.outcome, "published");
  assert.equal(d.publication.pullRequest.author, "factory[bot]");
  assert.equal(d.publication.pullRequest.approver, "aaron-howard");
  assert.deepEqual(
    d.publication.effects.map((e) => e.state),
    ["succeeded", "succeeded", "succeeded"],
  );
  assert.equal(
    f.reopen().status(f.delivery.id).publication.commit,
    "a".repeat(40),
  );
  await f.controller.publishFeature(f.delivery.id);
  assert.deepEqual(f.events, ["sign", "push", "pr"]);
});

test("unknown push acceptance is reconciled after restart without another push", async (t) => {
  const f = await fixture(t),
    push = f.runtimePublication.push.bind(f.runtimePublication);
  let accepted;
  f.runtimePublication.push = async (r) => {
    accepted = await push(r);
    throw Error("response lost");
  };
  const d = await f.controller.publishFeature(f.delivery.id);
  assert.equal(d.publication.outcome, "uncertain");
  assert.deepEqual(f.events, ["sign", "push"]);
  await assert.rejects(f.controller.publishFeature(f.delivery.id), /blocked/);
  f.controller = f.reopen();
  f.runtimePublication.reconcile = async (r) => {
    assert.equal(r.effect.kind, "push");
    return { state: "found", result: accepted };
  };
  await f.controller.reconcilePublication(f.delivery.id);
  const result = await f.controller.publishFeature(f.delivery.id);
  assert.equal(result.publication.outcome, "published");
  assert.deepEqual(f.events, ["sign", "push", "pr"]);
});

test("partial PR acceptance is recovered with its original author and head and never duplicated", async (t) => {
  const f = await fixture(t),
    create = f.runtimePublication.createPullRequest.bind(f.runtimePublication);
  let accepted;
  f.runtimePublication.createPullRequest = async (r) => {
    accepted = await create(r);
    throw Error("lost reply");
  };
  await f.controller.publishFeature(f.delivery.id);
  f.runtimePublication.reconcile = async () => ({
    state: "found",
    result: accepted,
  });
  const recovered = await f.reopen().reconcilePublication(f.delivery.id);
  assert.equal(recovered.publication.outcome, "published");
  await f.controller.publishFeature(f.delivery.id);
  assert.deepEqual(f.events, ["sign", "push", "pr"]);
});

test("paused accepted signing is retained but cannot schedule push until explicit resume", async (t) => {
  const f = await fixture(t),
    sign = f.runtimePublication.sign.bind(f.runtimePublication);
  f.runtimePublication.sign = async (r) => {
    const result = await sign(r);
    await f.controller.pause(f.delivery.id);
    return result;
  };
  const d = await f.controller.publishFeature(f.delivery.id);
  assert.equal(d.phase, "paused");
  assert.equal(d.publication.effects[0].state, "succeeded");
  assert.deepEqual(f.events, ["sign"]);
  f.controller.resume(f.delivery.id);
  await f.controller.publishFeature(f.delivery.id);
  assert.deepEqual(f.events, ["sign", "push", "pr"]);
});

test("a timeout fences late dispatch and requires proven quiescent absence before retry", async (t) => {
  const f = await fixture(t);
  let late;
  f.runtimePublication.sign = async (r) => {
    late = r;
    return new Promise(() => {});
  };
  f.controller = new DeliveryController(f.state, f.options, {
    featurePlanner: f.criteria,
    featureRuntime: f.runtime,
    validationRuntime: f.validation,
    publicationRuntime: f.runtimePublication,
    observationTimeoutMs: 20,
  });
  await f.controller.publishFeature(f.delivery.id);
  assert.equal(late.mayDispatch(), false);
  assert.throws(
    () => f.controller.release(f.delivery.id),
    /Reconcile publication/,
  );
  f.runtimePublication.reconcile = async () => ({
    state: "absent",
    quiescent: false,
  });
  assert.equal(
    (await f.controller.reconcilePublication(f.delivery.id)).publication
      .outcome,
    "uncertain",
  );
  f.runtimePublication.reconcile = async () => ({
    state: "absent",
    quiescent: true,
  });
  const d = await f.controller.reconcilePublication(f.delivery.id);
  assert.equal(d.publication.effects[0].reason, "not-applied");
  assert.equal(late.mayDispatch(), false);
});
