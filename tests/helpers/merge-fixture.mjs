import assert from "node:assert/strict";
import { DeliveryController } from "../../dist/controller.js";
import { reviewed } from "./review-fixture.mjs";

export async function mergeFixture(t, configurePolicy) {
  const f = await reviewed(t, configurePolicy);
  f.merges = [];
  f.mergeSnapshot = () => {
    const d = f.controller.status(f.delivery.id);
    const p = d.publication ?? d.publicationHistory.at(-1);
    return {
      repository: p.repository,
      number: p.pullRequest.number,
      head: p.commit,
      base: p.defaultBranch,
      baseRevision: p.sourceRevision,
      policySha256: p.policySha256,
      complete: true,
      state: "open",
      mergeAllowed: true,
      protectionsEnforced: true,
      conditionalHead: true,
      conditionalBase: true,
      gatesEnforced: true,
      actor: p.publicationLogin,
    };
  };
  f.mergeRuntime = {
    mode: "controlled",
    bindingSha256: "7".repeat(64),
    async observe() {
      return f.mergeSnapshot();
    },
    async merge(r) {
      assert.equal(r.mayDispatch(), true);
      await f.beforeMerge?.();
      const remote = f.mergeSnapshot(),
        review = f.reviewSnapshot(),
        checks = f.snapshot();
      if (
        remote.head !== r.head ||
        remote.baseRevision !== r.baseRevision ||
        !remote.mergeAllowed ||
        !remote.protectionsEnforced ||
        review.reviews[0].state !== "APPROVED" ||
        review.requiredChanges ||
        review.threads.some((t) => !t.resolved) ||
        checks.checks.some((c) => c.status !== "success")
      )
        return { operationId: r.operationId, state: "absent", quiescent: true };
      f.merges.push({
        head: r.head,
        baseRevision: r.baseRevision,
        operationId: r.operationId,
      });
      return {
        operationId: r.operationId,
        state: "merged",
        head: r.head,
        baseRevision: r.baseRevision,
        mergeCommit: "c".repeat(40),
        mainRevision: "c".repeat(40),
        reachable: true,
      };
    },
    async reconcile() {
      return { state: "unknown" };
    },
  };
  f.reopenMerge = () =>
    new DeliveryController(f.state, f.options, {
      featurePlanner: f.criteria,
      featureRuntime: f.runtime,
      validationRuntime: f.validation,
      publicationRuntime: f.runtimePublication,
      prChecksRuntime: f.checks,
      reviewRuntime: f.reviewRuntime,
      mergeRuntime: f.mergeRuntime,
      clock: () => f.time,
      observationTimeoutMs: f.mergeTimeout ?? 100,
    });
  f.controller = f.reopenMerge();
  return f;
}
