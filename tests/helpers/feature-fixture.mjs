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
import { claudeAgent } from "../../dist/coding-agent.js";
import { claudeEvents, firstThread } from "./coding-turns.mjs";

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

/** A controlled coding fixture. Coding runs on Claude Code, metered through
 * a stand-in Messages session (ADR 0008). */
function codingFixture(t, configurePolicy = () => {}, startOptions = {}) {
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
      forcePushBlocked: true,
      signedCommitsRequired: true,
      everyPullRequestReviewRequired: false,
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
    agent: claudeAgent,
    pins: {
      cliSha256: "c".repeat(64),
      cliVersion: "2.1.311",
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
        events: claudeEvents(request.threadId ?? firstThread, true),
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
  // Each metered turn's stand-in Messages session; a turn that sends a
  // request through it fails.
  f.messagesTurns = [];
  f.messagesSessions = (turn, budget) => {
    const gateway = {
      capability: "f".repeat(64),
      respond: async () => {
        throw Error("unused");
      },
      revoke: (reason) => gateway.revoked.push(reason),
      revoked: [],
    };
    f.messagesTurns.push({ turn, budget, gateway });
    return gateway;
  };
  f.controller = new DeliveryController(f.state, f.options, {
    featurePlanner: f.criteria,
    featureRuntime: f.runtime,
    messagesSessions: f.messagesSessions,
    validationRuntime: f.validation,
    clock: () => f.now,
  });
  f.delivery = f.controller.start({
    repository: f.repository,
    request: "Add a visible contact hint.",
    ...startOptions,
  });
  return f;
}

export { fixture, codingFixture };
