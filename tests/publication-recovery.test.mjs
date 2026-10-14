import assert from "node:assert/strict";
import { test } from "node:test";
import { SplitPublicationAdapter } from "../dist/publication-adapter.js";
import { fixture } from "./helpers/publication-controller-fixture.mjs";

async function splitFixture(t) {
  const f = await fixture(t);
  const authority = await f.runtimePublication.inspect();
  let signed, remote, pr;
  const Git = {
    async inspect() {
      return { ...authority, login: authority.publicationLogin };
    },
    async sign(r) {
      signed = await f.runtimePublication.sign(r);
      return { commit: signed.commit };
    },
    async verifyLocal() {
      return signed;
    },
    async push(r) {
      remote = await f.runtimePublication.push(r);
    },
    async findSigned() {
      return signed
        ? { state: "found", result: signed }
        : { state: "absent", quiescent: true };
    },
    async observeRemote() {
      return remote
        ? { state: "found", result: remote }
        : { state: "absent", quiescent: true };
    },
  };
  const App = {
    async inspect() {
      return {
        ...authority,
        login: authority.appLogin,
        keySha256: authority.appKeySha256,
        permissions: authority.appPermissions,
      };
    },
    async create(r) {
      assert.equal(r.mayDispatch(), true);
      f.events.push("pr");
      pr = {
        number: 1,
        repository: r.repository,
        head: r.head,
        branch: r.branch,
        base: r.base,
        author: authority.appLogin,
        approver: r.approver,
      };
    },
    async observe() {
      return pr
        ? { state: "found", result: pr }
        : { state: "absent", quiescent: true };
    },
  };
  const runtime = new SplitPublicationAdapter("f".repeat(64), Git, App);
  // Preserve the original controlled transport used by the port closures.
  const original = f.runtimePublication;
  const { DeliveryController } = await import("../dist/controller.js");
  f.controller = new DeliveryController(f.state, f.options, {
    featurePlanner: f.criteria,
    featureRuntime: f.runtime,
    validationRuntime: f.validation,
    publicationRuntime: runtime,
    clock: () => f.now,
  });
  assert.equal(f.runtimePublication, original);
  return { ...f, Git, App, publicationRuntime: runtime };
}

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
