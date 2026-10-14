import { DeliveryController } from "../../dist/controller.js";
import assert from "node:assert/strict";
import { codingFixture } from "./feature-fixture.mjs";

export async function fixture(t) {
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
