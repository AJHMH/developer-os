import {
  ownerValidationContract,
  controlledValidationRuntime,
} from "./validation-fixture.mjs";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { DeliveryController } from "../../dist/controller.js";

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-candidate-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "repository"),
    state = join(root, "state");
  mkdirSync(repository);
  const git = (...args) => {
    const r = spawnSync("git", ["-C", repository, ...args], {
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git("init", "-b", "main");
  writeFileSync(join(repository, "index.html"), "<h1>Contact</h1>\n");
  git("add", "index.html");
  git(
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=/nonexistent",
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "base",
  );
  const criteria = {
    async plan() {
      return {
        criteria: ["Contact page displays a visible hint."],
        verification: ["Check the visible hint in the isolated page."],
        ambiguity: null,
      };
    },
  };
  const controller = new DeliveryController(
    state,
    {},
    { featurePlanner: criteria },
  );
  const delivery = controller.start({
    repository,
    request: "Add a visible contact hint.",
  });
  return { root, repository, state, git, criteria, controller, delivery };
}

function codingFixture(t, configurePolicy = () => {}) {
  const f = fixture(t),
    revision = f.git("rev-parse", "HEAD");
  const policyPath = join(f.root, "owner-policy.json");
  const facts = {
    repository: "AJHMH/profile-page",
    defaultBranch: "main",
    factoryCommit: "a".repeat(40),
    approver: "aaron-howard",
    appLogin: "factory[bot]",
    publicationLogin: "aaron-howard",
    requiredChecks: ["pr-ci"],
    validation: ["isolated-node"],
    validationContract: ownerValidationContract(),
  };
  configurePolicy(facts);
  writeFileSync(policyPath, JSON.stringify(facts));
  f.options = {
    policyPath,
    inspect: () => ({
      ...facts,
      localRepository: facts.repository,
      localDefaultBranch: "main",
      appRepositoryAccess: true,
      eligibleApprovers: [facts.approver],
      protectionsEnforced: true,
      trustedCheckPublishers: true,
      publicationAccess: true,
      localSignature: { commit: revision, valid: true, login: facts.approver },
      githubSignature: { commit: revision, valid: true, login: facts.approver },
    }),
  };
  f.validation = controlledValidationRuntime(facts.validationContract);
  f.now = 1000;
  f.runtime = {
    mode: "controlled",
    pins: {
      cliSha256: "c".repeat(64),
      cliVersion: "0.161.0",
      policySha256: "d".repeat(64),
      bindingSha256: "e".repeat(64),
    },
    async execute(request) {
      this.request = request;
      f.now += 50;
      request.checkpoint();
      return {
        operationId: request.operationId,
        fence: request.fence,
        exitCode: 0,
        events: [
          {
            type: "thread.started",
            thread_id: "11111111-1111-4111-8111-111111111111",
          },
          { type: "turn.started" },
          {
            type: "turn.completed",
            usage: { input_tokens: 1, output_tokens: 1 },
          },
        ],
      };
    },
    async stop(request) {
      return {
        operationId: request.operationId,
        fence: request.fence,
        stopped: true,
        remainingProcesses: 0,
      };
    },
    async collect(request) {
      const { createHash } = await import("node:crypto");
      const bytes = Buffer.from("<h1>Contact</h1><p>Say hello</p>\n"),
        hash = createHash("sha256").update(bytes).digest("hex");
      return {
        complete: true,
        operationId: request.operationId,
        fence: request.fence,
        files: [
          {
            path: "index.html",
            bytes,
            ordinary: true,
            links: 1,
            beforeSha256: hash,
            afterSha256: hash,
          },
        ],
      };
    },
  };
  // A fresh, healthy model-only subscription observation at the fixture clock.
  f.usedPercent = 10;
  // Stamp it with the observing controller's clock (the fixture clock by default).
  f.subscription = async (at = f.now) => ({
    observedAt: new Date(at).toISOString(),
    accountId: "account-1",
    authMode: "chatgpt",
    windows: [
      {
        id: "primary",
        usedPercent: f.usedPercent,
        resetsAt: Math.floor(at / 1000) + 3600,
      },
    ],
    exhausted: f.usedPercent >= 100,
  });
  f.controller = new DeliveryController(f.state, f.options, {
    featurePlanner: f.criteria,
    featureRuntime: f.runtime,
    subscription: () => f.subscription(),
    validationRuntime: f.validation,
    clock: () => f.now,
  });
  f.delivery = f.controller.start({
    repository: f.repository,
    request: "Add a visible contact hint.",
  });
  return f;
}

export { fixture, codingFixture };
