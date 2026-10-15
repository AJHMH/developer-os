import assert from "node:assert/strict";
import { DeliveryController } from "../../dist/controller.js";
import { fixture } from "./publication-controller-fixture.mjs";

export async function monitored(t, configure, setup) {
  const f = await fixture(t, configure);
  if (setup) {
    await setup(f);
    f.controller = f.reopen();
  }
  await f.controller.publishFeature(f.delivery.id);
  f.time = 100000;
  f.reads = 0;
  f.reruns = [];
  f.snapshot = () => {
    const p = f.controller.status(f.delivery.id).publication;
    return {
      repository: p.repository,
      number: p.pullRequest.number,
      head: p.commit,
      base: p.defaultBranch,
      author: p.appLogin,
      state: "open",
      complete: true,
      checks: [
        {
          runId: 1,
          attempt: 1,
          checkId: "pr-ci",
          publisher: "trusted-ci",
          workflow: ".github/workflows/ci.yml@trusted",
          head: p.commit,
          status: "success",
          startedAt: 100000,
          completedAt: 100000,
        },
      ],
      reruns: [],
    };
  };
  f.checks = {
    mode: "controlled",
    bindingSha256: "9".repeat(64),
    async observe() {
      f.reads++;
      return f.snapshot();
    },
    async rerun(r) {
      assert.equal(r.mayDispatch(), true);
      f.reruns.push(r);
      return { operationId: r.operationId, accepted: true };
    },
  };
  f.reopenChecks = () =>
    new DeliveryController(f.state, f.options, {
      featurePlanner: f.criteria,
      featureRuntime: f.runtime,
      validationRuntime: f.validation,
      publicationRuntime: f.runtimePublication,
      prChecksRuntime: f.checks,
      clock: () => f.time,
    });
  f.controller = f.reopenChecks();
  return f;
}
