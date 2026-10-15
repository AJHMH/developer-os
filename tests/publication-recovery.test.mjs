import assert from "node:assert/strict";
import { test } from "node:test";
import { DeliveryController } from "../dist/controller.js";
import { fixture } from "./helpers/publication-controller-fixture.mjs";

test("concurrent publication calls reserve only one signing operation", async (t) => {
  const f = await fixture(t);
  const results = await Promise.allSettled([
    f.controller.publishFeature(f.delivery.id),
    f.controller.publishFeature(f.delivery.id),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.deepEqual(f.events, ["sign", "push", "pr"]);
});

test("changed signing keys or adapter binding cannot resume partial publication", async (t) => {
  const f = await fixture(t),
    push = f.runtimePublication.push.bind(f.runtimePublication),
    inspect = f.runtimePublication.inspect.bind(f.runtimePublication);
  f.runtimePublication.push = async (r) => {
    await push(r);
    throw Error("lost reply");
  };
  await f.controller.publishFeature(f.delivery.id);
  f.runtimePublication.bindingSha256 = "0".repeat(64);
  await assert.rejects(
    f.reopen().reconcilePublication(f.delivery.id),
    /binding/,
  );
  f.runtimePublication.bindingSha256 = "f".repeat(64);
  f.runtimePublication.inspect = async () => ({
    ...(await inspect()),
    signingKeySha256: "3".repeat(64),
  });
  const d = await f.controller.reconcilePublication(f.delivery.id);
  assert.equal(d.publication.outcome, "uncertain");
});

test("an old publisher cannot block a new execution after its pending signing is reconciled", async (t) => {
  const f = await fixture(t),
    sign = f.runtimePublication.sign.bind(f.runtimePublication),
    push = f.runtimePublication.push.bind(f.runtimePublication);
  let signingStarted, releaseSign, pushStarted, releasePush, accepted;
  const signEntered = new Promise((r) => {
      signingStarted = r;
    }),
    signWait = new Promise((r) => {
      releaseSign = r;
    });
  const pushEntered = new Promise((r) => {
      pushStarted = r;
    }),
    pushWait = new Promise((r) => {
      releasePush = r;
    });
  t.after(() => {
    releaseSign();
    releasePush();
  });
  f.runtimePublication.sign = async (r) => {
    accepted = await sign(r);
    signingStarted();
    await signWait;
    return accepted;
  };
  const first = f.controller.publishFeature(f.delivery.id);
  await signEntered;
  f.runtimePublication.reconcile = async () => ({
    state: "found",
    result: accepted,
  });
  await f.controller.reconcilePublication(f.delivery.id);
  f.runtimePublication.push = async (r) => {
    const result = await push(r);
    pushStarted();
    await pushWait;
    return result;
  };
  const second = f.controller.publishFeature(f.delivery.id);
  await pushEntered;
  releaseSign();
  await first;
  assert.equal(f.controller.status(f.delivery.id).phase, "publishing");
  releasePush();
  assert.equal((await second).publication.outcome, "published");
  assert.deepEqual(f.events, ["sign", "push", "pr"]);
});

test("candidate artifact tampering blocks all publication effects", async (t) => {
  const f = await fixture(t);
  const { writeFileSync } = await import("node:fs");
  writeFileSync(
    f.controller.status(f.delivery.id).feature.candidate.path,
    "[]",
  );
  await assert.rejects(f.controller.publishFeature(f.delivery.id), /blocked/);
  assert.deepEqual(f.events, []);
});

test("publication intent is durable before dispatch and the CLI installs no native publisher", async (t) => {
  const f = await fixture(t),
    sign = f.runtimePublication.sign.bind(f.runtimePublication);
  f.runtimePublication.sign = async (r) => {
    const saved = f.reopen().status(f.delivery.id).publication;
    assert.equal(saved.effects.at(-1).id, r.effect.id);
    assert.equal(saved.effects.at(-1).state, "dispatched");
    return sign(r);
  };
  const { spawnSync } = await import("node:child_process");
  const refused = spawnSync(
    process.execPath,
    [
      "dist/cli.js",
      "publish-feature",
      "--state-dir",
      f.state,
      "--id",
      f.delivery.id,
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /native writes remain disabled/);
  assert.equal(f.controller.status(f.delivery.id).publication, undefined);
  assert.equal(
    (await f.controller.publishFeature(f.delivery.id)).publication.outcome,
    "published",
  );
});
