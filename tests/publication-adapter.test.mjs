import assert from "node:assert/strict";
import { test } from "node:test";
import { DeliveryController } from "../dist/controller.js";
import { fixture } from "./helpers/publication-controller-fixture.mjs";

test("split identity adapter verifies a real signed Git tree and leaves the source checkout untouched", async (t) => {
  const f = await fixture(t);
  const { signedFixture } = await import("./helpers/publication-fixture.mjs");
  const signed = signedFixture(f);
  f.runtimePublication = signed.runtime;
  f.controller = f.reopen();
  const d = await f.controller.publishFeature(f.delivery.id);
  assert.equal(d.publication.outcome, "published");
  assert.equal(
    signed.git(["show", "-s", "--format=%T", d.publication.commit]),
    d.publication.treeSha1,
  );
  assert.equal(d.publication.localSignature.localVerified, true);
  assert.equal(d.publication.pullRequest.author, "factory[bot]");
  assert.equal(f.git("rev-parse", "HEAD"), d.publication.sourceRevision);
});

test("a conflicting existing remote branch blocks the split adapter before push", async (t) => {
  const f = await fixture(t);
  const { signedFixture } = await import("./helpers/publication-fixture.mjs");
  const signed = signedFixture(f);
  let pushed = false;
  signed.Git.push = async () => {
    pushed = true;
    throw Error("must not push");
  };
  signed.Git.observeRemote = async (r) => ({
    state: "found",
    result: {
      commit: "b".repeat(40),
      tree: r.publication.treeSha1,
      repository: r.publication.repository,
      branch: r.publication.branch,
      githubVerified: true,
      signer: "aaron-howard",
      publisher: "aaron-howard",
    },
  });
  f.runtimePublication = signed.runtime;
  f.controller = f.reopen();
  await f.controller.publishFeature(f.delivery.id);
  assert.equal(pushed, false);
});

test("environment drift before publication dispatch performs no signing", async (t) => {
  const f = await fixture(t);
  const inspect = f.validation.inspect.bind(f.validation);
  f.validation.inspect = async () => ({
    ...(await inspect()),
    environment: {
      ...(await inspect()).environment,
      imageSha256: "0".repeat(64),
    },
  });
  await assert.rejects(f.controller.publishFeature(f.delivery.id), /blocked/);
  assert.deepEqual(f.events, []);
});

test("lost publication authority stops after signing without scheduling a push", async (t) => {
  const f = await fixture(t),
    sign = f.runtimePublication.sign.bind(f.runtimePublication),
    inspect = f.runtimePublication.inspect.bind(f.runtimePublication);
  f.runtimePublication.sign = async (r) => {
    const result = await sign(r);
    f.runtimePublication.inspect = async () => ({
      ...(await inspect()),
      publicationAllowed: false,
    });
    return result;
  };
  const d = await f.controller.publishFeature(f.delivery.id);
  assert.deepEqual(f.events, ["sign"]);
  assert.equal(d.phase, "blocked");
  assert.equal(d.publication.commit, "a".repeat(40));
});

test("cancel preserves a possibly accepted push and read-only recovery cannot create a PR", async (t) => {
  const f = await fixture(t),
    push = f.runtimePublication.push.bind(f.runtimePublication);
  let result;
  f.runtimePublication.push = async (r) => {
    result = await push(r);
    await f.controller.cancel(f.delivery.id);
    throw Error("late accepted response");
  };
  await f.controller.publishFeature(f.delivery.id);
  f.runtimePublication.reconcile = async () => ({ state: "found", result });
  const d = await f.controller.recover(f.delivery.id);
  assert.equal(d.phase, "cancelled");
  assert.equal(d.publication.effects.at(-1).state, "succeeded");
  assert.deepEqual(f.events, ["sign", "push"]);
  await assert.rejects(f.controller.publishFeature(f.delivery.id), /blocked/);
});
