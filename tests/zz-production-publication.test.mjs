// Publication, and so every later stage, needs the owner's production
// admission naming the coding pins and validation binding the delivery ran
// under (ticket 04, #264). The name sorts after every other test file, so no
// other file changes shard.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fixture } from "./helpers/publication-controller-fixture.mjs";
import { controlledProduction } from "./helpers/production-fixture.mjs";
import { mergeFixture } from "./helpers/merge-fixture.mjs";

const refusal = /need the owner's production admission/;

async function refused(t, production) {
  const f = await fixture(t);
  f.production = production?.(f);
  f.controller = f.reopen();
  const before = f.controller.status(f.delivery.id);
  await assert.rejects(f.controller.publishFeature(f.delivery.id), refusal);
  assert.deepEqual(f.controller.status(f.delivery.id), before);
  assert.deepEqual(f.events, []);
}

test("publication without a production admission is refused before any effect", (t) =>
  refused(t, undefined));

test("a production admission for other coding pins is refused", (t) =>
  refused(t, (f) =>
    controlledProduction(f, {
      coding: { ...f.runtime.pins, cliVersion: "2.1.312" },
    }),
  ));

test("a production admission for another validation binding is refused", (t) =>
  refused(t, (f) =>
    controlledProduction(f, { validationBindingSha256: "4".repeat(64) }),
  ));

test("an unusable production admission is refused", (t) =>
  refused(t, (f) => {
    const production = controlledProduction(f);
    production.revoke();
    return production;
  }));

test("a matching production admission publishes and is recorded", async (t) => {
  const f = await fixture(t);
  const published = await f.controller.publishFeature(f.delivery.id);
  assert.equal(published.publication.outcome, "published");
  assert.equal(published.publication.productionSha256, "9".repeat(64));
  assert.deepEqual(f.events, ["sign", "push", "pr"]);
});

test("revoking the production admission mid-publication stops it", async (t) => {
  const f = await fixture(t);
  const sign = f.runtimePublication.sign.bind(f.runtimePublication);
  f.runtimePublication.sign = async (r) => {
    const signed = await sign(r);
    f.production.revoke();
    return signed;
  };
  const stopped = await f.controller.publishFeature(f.delivery.id);
  assert.notEqual(stopped.publication.outcome, "published");
  assert.deepEqual(f.events, ["sign"]);
});

test("a production record rewritten mid-publication stops it", async (t) => {
  const f = await fixture(t);
  const sign = f.runtimePublication.sign.bind(f.runtimePublication);
  let digest = "9".repeat(64);
  const admitted = f.production.admitted.bind(f.production);
  f.production.admitted = () => ({ ...admitted(), productionSha256: digest });
  f.runtimePublication.sign = async (r) => {
    const signed = await sign(r);
    digest = "8".repeat(64);
    return signed;
  };
  const stopped = await f.controller.publishFeature(f.delivery.id);
  assert.notEqual(stopped.publication.outcome, "published");
  assert.equal(stopped.publication.productionSha256, "9".repeat(64));
  assert.deepEqual(f.events, ["sign"]);
});

test("merge re-checks the production admission its publication ran under", async (t) => {
  const f = await mergeFixture(t);
  f.production.revoke();
  const before = f.controller.status(f.delivery.id);
  await assert.rejects(
    f.controller.mergeFeature(f.delivery.id),
    /need the owner's production admission/,
  );
  assert.deepEqual(f.controller.status(f.delivery.id), before);
  assert.deepEqual(f.merges, []);
});

test("merge refuses a production record other than the publication's", async (t) => {
  const f = await mergeFixture(t);
  const admitted = f.production.admitted.bind(f.production);
  f.production.admitted = () => ({
    ...admitted(),
    productionSha256: "8".repeat(64),
  });
  await assert.rejects(
    f.controller.mergeFeature(f.delivery.id),
    /need the owner's production admission/,
  );
  assert.deepEqual(f.merges, []);
});

test("an admitted delivery merges", async (t) => {
  const f = await mergeFixture(t);
  const merged = await f.controller.mergeFeature(f.delivery.id);
  assert.equal(merged.merge.attempts.at(-1).state, "merged");
  assert.equal(f.merges.length, 1);
});
