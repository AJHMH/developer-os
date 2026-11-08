import "./helpers/owner-host-stand-in.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  changeGateContractSha256,
  defaultChangeGateContract,
} from "../dist/change-gate.js";
import { inspectOnboarding, ownerChangeGate } from "../dist/onboarding.js";
import { reviewed } from "./helpers/review-fixture.mjs";

const policy = {
  repository: "AJHMH/profile-page",
  defaultBranch: "main",
  factoryCommit: "a".repeat(40),
  approver: "aaron-howard",
  appLogin: "factory[bot]",
  publicationLogin: "aaron-howard",
  requiredChecks: ["lint"],
  validation: ["node"],
};
const observed = {
  localRepository: "AJHMH/profile-page",
  localDefaultBranch: "main",
  repository: "AJHMH/profile-page",
  defaultBranch: "main",
  factoryCommit: "a".repeat(40),
  appLogin: "factory[bot]",
  appRepositoryAccess: true,
  eligibleApprovers: ["aaron-howard"],
  protectionsEnforced: true,
  forcePushBlocked: true,
  signedCommitsRequired: true,
  everyPullRequestReviewRequired: false,
  requiredChecks: ["lint"],
  trustedCheckPublishers: true,
  publicationLogin: "aaron-howard",
  publicationAccess: true,
  localSignature: {
    commit: "b".repeat(40),
    valid: true,
    login: "aaron-howard",
  },
  githubSignature: {
    commit: "b".repeat(40),
    valid: true,
    login: "aaron-howard",
  },
  validation: ["node"],
};
function root(t) {
  const r = realpathSync(mkdtempSync(join(tmpdir(), "aios-gate-onboarding-")));
  t.after(() => rmSync(r, { recursive: true, force: true }));
  chmodSync(r, 0o700);
  mkdirSync(join(r, "repository"));
  return r;
}
function onboard(t, policyFields = {}, observation = {}) {
  const r = root(t),
    policyPath = join(r, "owner-policy.json");
  writeFileSync(policyPath, JSON.stringify({ ...policy, ...policyFields }));
  return {
    policyPath,
    report: inspectOnboarding(join(r, "repository"), {
      policyPath,
      inspect: () => ({ ...observed, ...observation }),
    }),
  };
}
const protections = (report) =>
  report.facts.find((f) => f.requirement === "protections").status;

test("protections verify only with force pushes blocked, signed commits required and no blanket review rule", (t) => {
  assert.equal(onboard(t).report.ready, true);
  for (const change of [
    { everyPullRequestReviewRequired: true },
    { forcePushBlocked: false },
    { signedCommitsRequired: false },
    { everyPullRequestReviewRequired: undefined },
    { forcePushBlocked: undefined },
  ]) {
    const { report } = onboard(t, {}, change);
    assert.notEqual(protections(report), "verified");
    assert.equal(report.ready, false);
    assert.ok(
      report.checklist.some(
        (c) => c.requirement === "protections" && /change gate/.test(c.action),
      ),
    );
  }
});

test("onboarding records the declared change gate, or the default, and refuses an invalid one", (t) => {
  const declared = {
    maxFiles: 5,
    maxLines: 100,
    authorityPaths: [".github/**", "src/auth/**"],
    dataPaths: ["data/**"],
  };
  assert.deepEqual(onboard(t, { changeGate: declared }).report.changeGate, {
    sha256: changeGateContractSha256(declared),
    declared: true,
  });
  assert.deepEqual(onboard(t).report.changeGate, {
    sha256: changeGateContractSha256(defaultChangeGateContract()),
    declared: false,
  });
  const invalid = onboard(t, { changeGate: { ...declared, maxFiles: 0 } });
  assert.equal(invalid.report.ready, false);
  assert.equal(invalid.report.changeGate, undefined);
  assert.ok(invalid.report.checklist.some((c) => c.requirement === "policy"));
});

test("the controller reads the change gate from the exact pinned policy", (t) => {
  const declared = {
    maxFiles: 2,
    maxLines: 50,
    authorityPaths: [],
    dataPaths: [],
  };
  const { policyPath, report } = onboard(t, { changeGate: declared });
  assert.deepEqual(ownerChangeGate(policyPath, report.policy.sha256), declared);
  const plain = onboard(t);
  assert.deepEqual(
    ownerChangeGate(plain.policyPath, plain.report.policy.sha256),
    defaultChangeGateContract(),
  );
  assert.throws(() => ownerChangeGate(policyPath, "f".repeat(64)), /Changed/);
  assert.throws(
    () => ownerChangeGate(undefined, report.policy.sha256),
    /Missing/,
  );
  assert.throws(() => ownerChangeGate(policyPath, null), /Missing/);
  // An invalid contract in a policy pinned by digest is still refused at use.
  const bad = JSON.stringify({
    ...policy,
    changeGate: { ...declared, maxLines: -1 },
  });
  writeFileSync(policyPath, bad);
  const digest = createHash("sha256")
    .update(readFileSync(policyPath))
    .digest("hex");
  assert.throws(
    () => ownerChangeGate(policyPath, digest),
    /Invalid change gate/,
  );
});

test("a review applies the repository's declared contract, not the default", async (t) => {
  const f = await reviewed(t, (p) => {
    p.changeGate = {
      maxFiles: 1,
      maxLines: 600,
      authorityPaths: [],
      dataPaths: [],
    };
  });
  const original = f.reviewSnapshot;
  f.reviewSnapshot = () => ({
    ...original(),
    reviews: [],
    changes: {
      base: "e".repeat(40),
      complete: true,
      baseIsAncestor: true,
      files: [
        { path: "src/a.ts", status: "modified", additions: 1, deletions: 0 },
        { path: "src/b.ts", status: "modified", additions: 1, deletions: 0 },
      ],
    },
  });
  const run = (await f.controller.monitorReview(f.delivery.id)).review.runs.at(
    -1,
  );
  assert.equal(run.gate.gated, true);
  assert.deepEqual(run.gate.wideImpact, [
    "changes 2 files, over the limit of 1",
  ]);
  assert.equal(run.outcome, "waiting");
});
