import assert from "node:assert/strict";
import { DeliveryController } from "../../dist/controller.js";
import { monitored } from "./pr-checks-fixture.mjs";

export async function reviewed(t, configurePolicy) {
  const f = await monitored(t, configurePolicy);
  await f.controller.monitorPRChecks(f.delivery.id);
  f.reviewSnapshot = () => {
    const p = f.controller.status(f.delivery.id).publication;
    return {
      repository: p.repository,
      number: p.pullRequest.number,
      head: p.commit,
      base: p.defaultBranch,
      author: p.appLogin,
      state: "open",
      complete: true,
      eligibleApprovers: [p.approver],
      owner: { login: p.approver, type: "User", permission: "admin" },
      lastPusher: p.publicationLogin,
      requiredChanges: false,
      threads: [],
      resolutions: [],
      reviews: [
        {
          id: 1,
          author: p.approver,
          type: "User",
          head: p.commit,
          state: "APPROVED",
          submittedAt: 100000,
        },
      ],
    };
  };
  f.resolutions = [];
  f.reviewRuntime = {
    mode: "controlled",
    bindingSha256: "8".repeat(64),
    async observe() {
      return f.reviewSnapshot();
    },
    async resolve(r) {
      assert.equal(r.mayDispatch(), true);
      f.resolutions.push(r);
      return { operationId: r.operationId, accepted: true };
    },
  };
  f.reopenReview = () =>
    new DeliveryController(f.state, f.options, {
      featurePlanner: f.criteria,
      featureRuntime: f.runtime,
      subscription: () => f.subscription(f.time),
      validationRuntime: f.validation,
      publicationRuntime: f.runtimePublication,
      prChecksRuntime: f.checks,
      reviewRuntime: f.reviewRuntime,
      clock: () => f.time,
      observationTimeoutMs: 100,
    });
  f.controller = f.reopenReview();
  return f;
}
export async function resolutionFixture(t) {
  const f = await reviewed(t),
    original = f.reviewSnapshot;
  const { validationCriteria } = await import(
    "../../dist/isolated-validation.js"
  );
  const criteria = validationCriteria(
    f.controller.status(f.delivery.id).feature,
  );
  f.reviewSnapshot = () => ({
    ...original(),
    threads: [
      {
        id: "thread1",
        digest: "3".repeat(64),
        resolved: false,
        assessment: {
          criteriaSha256: criteria,
          disposition: "straightforward",
          finding: "Correct the contact label within accepted criteria.",
        },
      },
    ],
  });
  const collect = f.runtime.collect.bind(f.runtime);
  f.runtime.collect = async (r) => {
    const s = await collect(r);
    s.files[0].bytes = Buffer.from("<h1>Contact</h1><p>Review fix</p>\n");
    const { createHash } = await import("node:crypto");
    s.files[0].beforeSha256 = s.files[0].afterSha256 = createHash("sha256")
      .update(s.files[0].bytes)
      .digest("hex");
    return s;
  };
  await f.controller.repairReview(f.delivery.id);
  const sign = f.runtimePublication.sign.bind(f.runtimePublication);
  f.runtimePublication.sign = async (r) => ({
    ...(await sign(r)),
    commit: "b".repeat(40),
    parent: r.publication.previous.commit,
  });
  await f.controller.publishFeature(f.delivery.id);
  await f.controller.monitorPRChecks(f.delivery.id);
  return f;
}
