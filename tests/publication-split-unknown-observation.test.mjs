import assert from "node:assert/strict";
import { test } from "node:test";
import { splitFixture } from "./helpers/split-publication-controller-fixture.mjs";

for (const [stage, afterWrite] of [
  ["push", false],
  ["push", true],
  ["pr", false],
  ["pr", true],
]) {
  test(`unknown ${stage} observation ${afterWrite ? "after" : "before"} write blocks continuation`, async (t) => {
    const f = await splitFixture(t);
    if (stage === "push") {
      const observe = f.Git.observeRemote;
      f.Git.observeRemote = async () =>
        afterWrite && !f.events.includes("push")
          ? observe()
          : { state: "unknown" };
    } else {
      const observe = f.App.observe;
      f.App.observe = async () =>
        afterWrite && !f.events.includes("pr")
          ? observe()
          : { state: "unknown" };
    }
    const d = await f.controller.publishFeature(f.delivery.id);
    assert.equal(d.publication.outcome, "uncertain");
    assert.deepEqual(
      f.events,
      stage === "push"
        ? afterWrite
          ? ["sign", "push"]
          : ["sign"]
        : afterWrite
          ? ["sign", "push", "pr"]
          : ["sign", "push"],
    );
  });
}

test("independently changed local signature blocks push", async (t) => {
  const f = await splitFixture(t),
    verify = f.Git.verifyLocal;
  let n = 0;
  f.Git.verifyLocal = async () => ({
    ...(await verify()),
    localVerified: ++n === 1,
  });
  const d = await f.controller.publishFeature(f.delivery.id);
  assert.equal(d.publication.outcome, "uncertain");
  assert.deepEqual(f.events, ["sign"]);
});
