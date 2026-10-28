// A synthetic delivery for offline native runs (Issue 04): a disposable
// repository, onboarding facts and policy, a planner, and a validation
// stand-in that reports success without executing anything. Shared by the
// coding admission acceptance and the usage canary.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

/** A disposable repository with synthetic onboarding facts and policy. */
export function syntheticDelivery(root) {
  const repository = join(root, "repository");
  mkdirSync(repository);
  const git = (...args) => {
    const r = spawnSync("git", ["-C", repository, ...args], {
      encoding: "utf8",
      timeout: 10000,
    });
    if (r.status !== 0) throw Error("Synthetic repository setup failed");
    return r.stdout.trim();
  };
  git("init", "-q", "-b", "main");
  writeFileSync(join(repository, "index.html"), "<h1>Contact</h1>\n");
  git("add", "index.html");
  git(
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=/nonexistent",
    "-c",
    "user.name=Acceptance",
    "-c",
    "user.email=acceptance@example.invalid",
    "commit",
    "-q",
    "-m",
    "base",
  );
  const revision = git("rev-parse", "HEAD");
  const contract = {
    version: 1,
    mutablePaths: ["index.html"],
    environment: {
      imageSha256: "1".repeat(64),
      networkPolicySha256: "2".repeat(64),
      registries: ["https://registry.npmjs.org"],
      caches: [],
      browser: false,
      database: false,
      synthetic: true,
    },
    checks: ["format", "lint", "type", "coverage", "build", "acceptance"]
      .map((kind) => ({
        id: kind,
        kind,
        scope: "local",
        stages:
          kind === "acceptance" ? ["candidate"] : ["baseline", "candidate"],
        command: ["npm", "run", kind],
        publisher: "isolated-checker",
        timeoutMs: 1000,
      }))
      .concat(
        [
          ["pr-ci", "build", "pr", "ci"],
          ["main-e2e", "e2e", "main", "e2e"],
        ].map(([id, kind, scope, workflow]) => ({
          id,
          kind,
          scope,
          stages: ["candidate"],
          command: ["workflow", workflow],
          publisher: "trusted-ci",
          workflow: ".github/workflows/ci.yml@trusted",
          timeoutMs: 120000,
        })),
      ),
  };
  const facts = {
    repository: "AJHMH/acceptance-page",
    defaultBranch: "main",
    factoryCommit: "a".repeat(40),
    approver: "acceptance-owner",
    appLogin: "factory[bot]",
    publicationLogin: "acceptance-owner",
    requiredChecks: ["pr-ci"],
    validation: ["isolated-node"],
    validationContract: contract,
  };
  const policyPath = join(root, "owner-policy.json");
  writeFileSync(policyPath, JSON.stringify(facts));
  const options = {
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
  const planner = {
    async plan() {
      return {
        criteria: ["Contact page displays a visible hint."],
        verification: ["Check the visible hint in the isolated page."],
        ambiguity: null,
      };
    },
  };
  // Validation stand-in: reports success without executing anything.
  const validation = {
    mode: "controlled",
    bindingSha256: "3".repeat(64),
    async inspect() {
      return {
        mode: this.mode,
        bindingSha256: this.bindingSha256,
        environment: contract.environment,
      };
    },
    async execute(request) {
      if (!request.mayDispatch()) throw Error("Fenced");
      return {
        checkId: request.check.id,
        status: "success",
        publisher: request.check.publisher,
        treeSha256: request.treeSha256,
        environmentSha256: request.environmentSha256,
        artifacts: [],
      };
    },
    async stop(request) {
      return {
        operationId: request.operationId,
        fence: request.fence,
        stopped: true,
        remainingProcesses: 0,
        treeSha256: request.treeSha256,
      };
    },
  };
  // Usage stand-in: a fresh, healthy model-only observation; no account.
  const subscription = async () => {
    const at = Date.now();
    return {
      observedAt: new Date(at).toISOString(),
      accountId: sha256("aios-native-coding-admission-acceptance"),
      authMode: "chatgpt",
      windows: [
        {
          id: "primary",
          usedPercent: 10,
          resetsAt: Math.floor(at / 1000) + 3600,
        },
      ],
      exhausted: false,
    };
  };
  return { repository, options, planner, validation, subscription };
}
