import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { test } from "node:test";
import { realpathSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DeliveryController } from "../dist/controller.js";

test("intake records unknown onboarding prerequisites without enabling delivery", (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-onboarding-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "repository");
  mkdirSync(repository);
  const controller = new DeliveryController(join(root, "state"));
  const delivery = controller.start({
    repository,
    request: "Add a contact hint",
  });
  assert.equal(delivery.onboarding.ready, false);
  assert.ok(
    delivery.onboarding.checklist.some(
      (item) => item.requirement === "repositoryIdentity",
    ),
  );
  assert.ok(
    delivery.onboarding.checklist.some(
      (item) => item.requirement === "signing",
    ),
  );
  assert.deepEqual(
    controller.status(delivery.id).onboarding,
    delivery.onboarding,
  );
  assert.equal(delivery.phase, "blocked");
});

import { writeFileSync, symlinkSync } from "node:fs";

function onboarded(t, change = {}, policyInRepository = false) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-onboarding-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "repository");
  mkdirSync(repository);
  const policyPath = join(
    policyInRepository ? repository : root,
    "owner-policy.json",
  );
  const policy = {
    repository: "AJHMH/profile-page",
    defaultBranch: "main",
    factoryCommit: "a".repeat(40),
    approver: "aaron-howard",
    appLogin: "factory[bot]",
    publicationLogin: "aaron-howard",
    requiredChecks: ["lint"],
    validation: ["node", "disposable-db"],
  };
  writeFileSync(policyPath, JSON.stringify(policy));
  const observation = {
    localRepository: "AJHMH/profile-page",
    localDefaultBranch: "main",
    repository: "AJHMH/profile-page",
    defaultBranch: "main",
    factoryCommit: "a".repeat(40),
    appLogin: "factory[bot]",
    appRepositoryAccess: true,
    eligibleApprovers: ["aaron-howard"],
    protectionsEnforced: true,
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
    validation: ["node", "disposable-db"],
    ...change,
  };
  const controller = new DeliveryController(join(root, "state"), {
    policyPath,
    inspect: () => observation,
  });
  return { controller, repository, policyPath };
}

test("verified owner policy and boundary evidence establish onboarding but cannot enable execution", (t) => {
  const f = onboarded(t);
  const delivery = f.controller.start({
    repository: f.repository,
    request: "Add contact hint",
  });
  assert.equal(delivery.onboarding.ready, true);
  assert.deepEqual(delivery.onboarding.checklist, []);
  assert.equal(delivery.onboarding.policy.source, f.policyPath);
  assert.match(delivery.onboarding.policy.sha256, /^[a-f0-9]{64}$/);
  assert.equal(delivery.onboarding.policy.factoryCommit, "a".repeat(40));
  assert.equal(delivery.phase, "blocked");
});

test("a saved remote discrepancy blocks onboarding and preserves the policy snapshot", (t) => {
  const f = onboarded(t, { localRepository: "aaron-howard/profile-page" });
  const delivery = f.controller.start({
    repository: f.repository,
    request: "Add contact hint",
  });
  assert.equal(delivery.onboarding.ready, false);
  assert.equal(
    delivery.onboarding.facts.find(
      (f) => f.requirement === "repositoryIdentity",
    ).status,
    "conflict",
  );
  writeFileSync(f.policyPath, "{}");
  assert.deepEqual(
    f.controller.status(delivery.id).onboarding,
    delivery.onboarding,
  );
});

test("candidate policy and request-supplied evidence cannot relax onboarding", (t) => {
  const f = onboarded(t, {}, true);
  const delivery = f.controller.start({
    repository: f.repository,
    request: "Add contact hint",
    onboarding: { ready: true },
  });
  assert.equal(delivery.onboarding.ready, false);
  assert.equal(
    delivery.onboarding.facts.find((f) => f.requirement === "policy").status,
    "conflict",
  );
  assert.equal(delivery.onboarding.policy, undefined);
});

test("unreachable inspection and signing configuration alone stay unknown without leaking errors", (t) => {
  const f = onboarded(t, { githubSignature: undefined });
  const delivery = f.controller.start({
    repository: f.repository,
    request: "Add contact hint",
  });
  assert.equal(
    delivery.onboarding.facts.find((f) => f.requirement === "signing").status,
    "unknown",
  );
  const unreachable = new DeliveryController(
    join(f.repository, "..", "other-state"),
    {
      policyPath: f.policyPath,
      inspect: () => {
        throw new Error("password=canary-no-leak");
      },
    },
  );
  const blocked = unreachable.start({
    repository: f.repository,
    request: "Add contact hint",
  });
  assert.equal(blocked.onboarding.ready, false);
  assert.equal(JSON.stringify(blocked).includes("canary-no-leak"), false);
});

test("known local identity conflict remains visible when live evidence is unavailable", (t) => {
  const f = onboarded(t, {
    localRepository: "aaron-howard/profile-page",
    repository: undefined,
  });
  const delivery = f.controller.start({
    repository: f.repository,
    request: "Add contact hint",
  });
  assert.equal(
    delivery.onboarding.facts.find(
      (f) => f.requirement === "repositoryIdentity",
    ).status,
    "conflict",
  );
});

test("CLI accepts external owner policy and reports a real saved remote mismatch without rewriting it", (t) => {
  const f = onboarded(t);
  const git = (...args) => {
    const result = spawnSync("git", ["-C", f.repository, ...args], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init");
  git(
    "config",
    "remote.origin.url",
    "https://github.com/aaron-howard/profile-page.git",
  );
  git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  const result = spawnSync(
    process.execPath,
    [
      resolve("dist/cli.js"),
      "start",
      "--repo",
      f.repository,
      "--request",
      "Add hint",
      "--state-dir",
      join(f.repository, "..", "cli-state"),
      "--owner-policy",
      f.policyPath,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout).onboarding;
  assert.equal(
    report.facts.find((f) => f.requirement === "repositoryIdentity").status,
    "conflict",
  );
  assert.equal(report.ready, false);
  assert.equal(
    git("config", "remote.origin.url"),
    "https://github.com/aaron-howard/profile-page.git",
  );
});

test("a candidate-controlled directory link cannot select an external owner policy", (t) => {
  const f = onboarded(t);
  const link = join(f.repository, "linked-owner-storage");
  symlinkSync(
    join(f.repository, ".."),
    link,
    process.platform === "win32" ? "junction" : "dir",
  );
  const controller = new DeliveryController(
    join(f.repository, "..", "linked-policy-state"),
    { policyPath: join(link, "owner-policy.json") },
  );
  const delivery = controller.start({
    repository: f.repository,
    request: "Add hint",
  });
  assert.equal(
    delivery.onboarding.facts.find((f) => f.requirement === "policy").status,
    "conflict",
  );
});

test("a repository alias cannot hide candidate-controlled policy redirection", (t) => {
  const f = onboarded(t);
  const alias = join(f.repository, "..", "repository-alias");
  symlinkSync(
    f.repository,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  symlinkSync(
    join(f.repository, ".."),
    join(f.repository, "external"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const controller = new DeliveryController(
    join(f.repository, "..", "alias-state"),
    { policyPath: join(alias, "external", "owner-policy.json") },
  );
  const delivery = controller.start({ repository: alias, request: "Add hint" });
  assert.equal(
    delivery.onboarding.facts.find((f) => f.requirement === "policy").status,
    "conflict",
  );
});

// ADR 0004: the owner attests what the CLI cannot observe locally.
async function attestedOnboarding(t, facts, fields = {}, inspected = {}) {
  const { inspectOnboarding } = await import("../dist/onboarding.js");
  const { ownWindowsFixturePaths } = await import(
    "./helpers/windows-fixture-owner.mjs"
  );
  const { createHash } = await import("node:crypto");
  const { chmodSync, readFileSync } = await import("node:fs");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-attested-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  chmodSync(root, 0o700);
  const repository = join(root, "repository");
  mkdirSync(repository);
  const policyPath = join(root, "owner-policy.json");
  writeFileSync(
    policyPath,
    JSON.stringify({
      repository: "AJHMH/profile-page",
      defaultBranch: "main",
      factoryCommit: "a".repeat(40),
      approver: "aaron-howard",
      appLogin: "factory[bot]",
      publicationLogin: "aaron-howard",
      requiredChecks: ["lint"],
      validation: ["node"],
    }),
  );
  const policySha256 = createHash("sha256")
    .update(readFileSync(policyPath))
    .digest("hex");
  const attestationPath = join(root, "onboarding-attestation.json");
  writeFileSync(
    attestationPath,
    JSON.stringify({
      scope: "aios-onboarding-attestation-v1",
      policySha256,
      attestedAt: "2026-10-31T12:00:00.000Z",
      facts,
      ...fields,
    }),
    { mode: 0o600 },
  );
  ownWindowsFixturePaths([root, attestationPath]);
  return inspectOnboarding(repository, {
    policyPath,
    attestationPath,
    inspect: () => ({
      localRepository: "AJHMH/profile-page",
      localDefaultBranch: "main",
      ...inspected,
    }),
  });
}
const attestable = {
  repository: "AJHMH/profile-page",
  defaultBranch: "main",
  factoryCommit: "a".repeat(40),
  appLogin: "factory[bot]",
  appRepositoryAccess: true,
  eligibleApprovers: ["aaron-howard"],
  protectionsEnforced: true,
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

test("an owner attestation for exactly the pinned policy makes onboarding ready, labelled as attested", async (t) => {
  const report = await attestedOnboarding(t, attestable);
  assert.equal(report.ready, true);
  assert.equal(report.attestation.source, "owner-attested");
  assert.match(report.attestation.sha256, /^[a-f0-9]{64}$/);
  const status = Object.fromEntries(
    report.facts.map((f) => [f.requirement, f.status]),
  );
  assert.equal(status.policy, "verified");
  for (const requirement of [
    "repositoryIdentity",
    "factory",
    "app",
    "approver",
    "protections",
    "signing",
    "publication",
    "validation",
  ])
    assert.equal(status[requirement], "attested", requirement);
  assert.ok(
    report.facts
      .filter((f) => f.status === "attested")
      .every((f) => /not live verification/.test(f.detail)),
  );
  assert.deepEqual(report.canonicalRepository, {
    name: "AJHMH/profile-page",
    defaultBranch: "main",
  });
});

test("inspected facts outrank attested ones, and missing or wrong facts are not ready", async (t) => {
  const conflicting = await attestedOnboarding(
    t,
    attestable,
    {},
    {
      appLogin: "someone-else[bot]",
      appRepositoryAccess: true,
    },
  );
  assert.equal(conflicting.ready, false);
  assert.equal(
    conflicting.facts.find((f) => f.requirement === "app").status,
    "conflict",
  );
  const { localSignature, githubSignature, ...partial } = attestable;
  const missing = await attestedOnboarding(t, partial);
  assert.equal(missing.ready, false);
  assert.deepEqual(
    missing.checklist.map((c) => c.requirement),
    ["signing"],
  );
  const wrong = await attestedOnboarding(t, {
    ...attestable,
    eligibleApprovers: ["aaron-howard", "another"],
  });
  assert.equal(wrong.ready, false);
  assert.equal(
    wrong.facts.find((f) => f.requirement === "approver").status,
    "conflict",
  );
});

test("an attestation for another policy, with local hints or malformed is refused entirely", async (t) => {
  for (const [name, facts, fields] of [
    ["another policy", attestable, { policySha256: "f".repeat(64) }],
    ["another scope", attestable, { scope: "aios-feature-criteria-v1" }],
    ["a future date", attestable, { attestedAt: "2999-01-01T00:00:00.000Z" }],
    [
      "an unknown field",
      attestable,
      { approvedAt: "2026-10-31T00:00:00.000Z" },
    ],
    [
      "a local hint",
      { ...attestable, localRepository: "AJHMH/profile-page" },
      {},
    ],
    ["facts that are not an object", [], {}],
  ]) {
    const report = await attestedOnboarding(t, facts, fields);
    assert.equal(report.ready, false, name);
    assert.equal(report.attestation, undefined, name);
    assert.equal(
      report.facts.find((f) => f.requirement === "policy").status,
      "conflict",
      name,
    );
    assert.ok(
      report.facts.every((f) => f.status !== "attested"),
      name,
    );
  }
});
