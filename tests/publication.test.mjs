import assert from "node:assert/strict";
import { test } from "node:test";
import { DeliveryController } from "../dist/controller.js";
import { codingFixture } from "./helpers/feature-fixture.mjs";

async function fixture(t) {
  const f = codingFixture(t);
  await f.controller.planFeature(f.delivery.id);
  await f.controller.validateBaseline(f.delivery.id);
  await f.controller.codeFeature(f.delivery.id);
  await f.controller.validateCandidate(f.delivery.id);
  f.events = [];
  f.runtimePublication = {
    mode: "controlled",
    bindingSha256: "f".repeat(64),
    async inspect() {
      return {
        repository: "AJHMH/profile-page",
        publicationLogin: "aaron-howard",
        appLogin: "factory[bot]",
        approver: "aaron-howard",
        eligibleApprovers: ["aaron-howard"],
        signingAvailable: true,
        publicationAllowed: true,
        appPermissions: ["pull_requests:write"],
        signingKeySha256: "1".repeat(64),
        appKeySha256: "2".repeat(64),
      };
    },
    async sign(r) {
      assert.equal(r.mayDispatch(), true);
      f.events.push("sign");
      return {
        commit: "a".repeat(40),
        tree: r.publication.treeSha1,
        parent: r.publication.sourceRevision,
        signer: "aaron-howard",
        localVerified: true,
      };
    },
    async push(r) {
      assert.equal(r.mayDispatch(), true);
      f.events.push("push");
      return {
        commit: r.publication.commit,
        tree: r.publication.treeSha1,
        repository: r.publication.repository,
        branch: r.publication.branch,
        githubVerified: true,
        signer: "aaron-howard",
        publisher: "aaron-howard",
      };
    },
    async createPullRequest(r) {
      assert.equal(r.mayDispatch(), true);
      f.events.push("pr");
      return {
        number: 1,
        repository: r.publication.repository,
        head: r.publication.commit,
        branch: r.publication.branch,
        base: r.publication.defaultBranch,
        author: "factory[bot]",
        approver: "aaron-howard",
      };
    },
    async reconcile() {
      return { state: "unknown" };
    },
  };
  f.reopen = () =>
    new DeliveryController(f.state, f.options, {
      featurePlanner: f.criteria,
      featureRuntime: f.runtime,
      validationRuntime: f.validation,
      publicationRuntime: f.runtimePublication,
      clock: () => f.now,
    });
  f.controller = f.reopen();
  return f;
}
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

for (const [name, patch] of [
  ["signing unavailable", { signingAvailable: false }],
  ["push denied", { publicationAllowed: false }],
  ["App credentials reused for signing", { signingKeySha256: "2".repeat(64) }],
  [
    "broad App permissions",
    { appPermissions: ["pull_requests:write", "contents:write"] },
  ],
  ["wrong repository", { repository: "untrusted/other" }],
  ["wrong App", { appLogin: "owner" }],
  ["multiple approvers", { eligibleApprovers: ["aaron-howard", "other"] }],
])
  test(name + " refuses publication before any effect", async (t) => {
    const f = await fixture(t),
      inspect = f.runtimePublication.inspect.bind(f.runtimePublication);
    f.runtimePublication.inspect = async () => ({
      ...(await inspect()),
      ...patch,
    });
    await assert.rejects(f.controller.publishFeature(f.delivery.id), /blocked/);
    assert.deepEqual(f.events, []);
    assert.equal(f.controller.status(f.delivery.id).publication, undefined);
  });

for (const [stage, patch] of [
  ["sign", { localVerified: false }],
  ["sign", { tree: "b".repeat(40) }],
  ["sign", { signer: "factory[bot]" }],
  ["sign", { parent: "b".repeat(40) }],
  ["push", { githubVerified: false }],
  ["push", { publisher: "factory[bot]" }],
  ["push", { repository: "wrong/repo" }],
  ["push", { commit: "b".repeat(40) }],
  ["createPullRequest", { author: "aaron-howard" }],
  ["createPullRequest", { head: "b".repeat(40) }],
  ["createPullRequest", { base: "other" }],
  ["createPullRequest", { approver: "other" }],
])
  test(
    stage + " rejects mismatched evidence " + JSON.stringify(patch),
    async (t) => {
      const f = await fixture(t),
        original = f.runtimePublication[stage].bind(f.runtimePublication);
      f.runtimePublication[stage] = async (r) => ({
        ...(await original(r)),
        ...patch,
        credential: "never-record-this",
      });
      const d = await f.controller.publishFeature(f.delivery.id);
      assert.equal(d.publication.outcome, "blocked");
      assert.equal(d.publication.effects.at(-1).reason, "unverified");
      assert.equal(JSON.stringify(d).includes("never-record-this"), false);
      if (stage === "sign") assert.deepEqual(f.events, ["sign"]);
      if (stage === "push") assert.deepEqual(f.events, ["sign", "push"]);
    },
  );

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
