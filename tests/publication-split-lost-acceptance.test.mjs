import assert from "node:assert/strict";
import { test } from "node:test";
import { splitFixture } from "./helpers/split-publication-controller-fixture.mjs";

for (const stage of ["sign", "push", "pr"]) {
  test(`split ports reconcile lost ${stage} acceptance without duplicating the effect`, async (t) => {
    const f = await splitFixture(t);
    const port = stage === "pr" ? f.App : f.Git;
    const method = stage === "pr" ? "create" : stage;
    const apply = port[method];
    port[method] = async (r) => {
      await apply(r);
      throw Error("lost response");
    };
    assert.equal(
      (await f.controller.publishFeature(f.delivery.id)).publication.outcome,
      "uncertain",
    );
    await f.controller.reconcilePublication(f.delivery.id);
    assert.equal(
      (await f.controller.publishFeature(f.delivery.id)).publication.outcome,
      "published",
    );
    assert.deepEqual(f.events, ["sign", "push", "pr"]);
    assert.equal(
      (await f.controller.reconcilePublication(f.delivery.id)).publication
        .outcome,
      "published",
    );
  });
}

test("split ports retry signing only after quiescent absence and retain refusal evidence", async (t) => {
  const f = await splitFixture(t),
    sign = f.Git.sign;
  f.Git.sign = async () => {
    throw Error("not accepted");
  };
  await f.controller.publishFeature(f.delivery.id);
  await f.controller.reconcilePublication(f.delivery.id);
  f.Git.sign = sign;
  const d = await f.controller.publishFeature(f.delivery.id);
  assert.equal(d.publication.outcome, "published");
  assert.equal(d.publication.effects[0].reason, "not-applied");
  assert.deepEqual(f.events, ["sign", "push", "pr"]);
});

test("existing matching App PR is retained without creating another", async (t) => {
  const f = await splitFixture(t);
  f.App.observe = async (r) => ({
    state: "found",
    result: {
      number: 42,
      repository: r.repository,
      head: r.head,
      branch: r.branch,
      base: r.base,
      author: "factory[bot]",
      approver: r.approver,
    },
  });
  const d = await f.controller.publishFeature(f.delivery.id);
  assert.equal(d.publication.pullRequest.number, 42);
  assert.deepEqual(f.events, ["sign", "push"]);
});
