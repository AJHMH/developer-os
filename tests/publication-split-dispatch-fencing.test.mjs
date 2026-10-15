import assert from "node:assert/strict";
import { test } from "node:test";
import { splitFixture } from "./helpers/split-publication-controller-fixture.mjs";

test("remote head changed after push blocks App creation", async (t) => {
  const f = await splitFixture(t),
    observe = f.Git.observeRemote;
  let found = 0;
  f.Git.observeRemote = async () => {
    const r = await observe();
    if (r.state === "found" && ++found > 1)
      r.result = { ...r.result, commit: "b".repeat(40) };
    return r;
  };
  const d = await f.controller.publishFeature(f.delivery.id);
  assert.equal(d.publication.outcome, "uncertain");
  assert.deepEqual(f.events, ["sign", "push"]);
});

test("separate ports cannot bind different repositories", async (t) => {
  const f = await splitFixture(t),
    inspect = f.App.inspect;
  f.App.inspect = async () => ({
    ...(await inspect()),
    repository: "other/repository",
  });
  await assert.rejects(f.controller.publishFeature(f.delivery.id), /blocked/);
  assert.deepEqual(f.events, []);
  await assert.rejects(
    f.controller.reconcilePublication(f.delivery.id),
    /retained operation/,
  );
});

for (const [method, expected] of [
  ["sign", []],
  ["push", ["sign"]],
  ["createPullRequest", ["sign", "push"]],
]) {
  test(`pause immediately before split adapter ${method} prevents dispatch`, async (t) => {
    const f = await splitFixture(t),
      apply = f.publicationRuntime[method].bind(f.publicationRuntime);
    f.publicationRuntime[method] = async (r) => {
      await f.controller.pause(f.delivery.id);
      return apply(r);
    };
    const d = await f.controller.publishFeature(f.delivery.id);
    assert.equal(d.phase, "paused");
    assert.equal(d.publication.outcome, "uncertain");
    assert.deepEqual(f.events, expected);
  });
}
