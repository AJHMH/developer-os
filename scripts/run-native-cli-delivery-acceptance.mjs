#!/usr/bin/env node
// Owner-run acceptance of one metered delivery through the real CLI on a real
// dedicated VM (ADR 0004 slice 6, ADR 0008). Every step is a `dist/cli.js`
// process with only the owner inputs the CLI names: `start` with a $5 spend
// budget, `plan-feature`, `validate-baseline` and `code-feature` on the
// owner-admitted Claude Code and validation runtimes, then
// `validate-candidate`. The repository, owner policy, onboarding attestation
// and criteria file are synthetic and written here, private and outside every
// repository. The coding turn is Claude Code's, metered through the owner's
// Anthropic key against the delivery's spend budget, so it sends real, paid
// model requests and spends at most the budget. It must admit a candidate that
// passes validation. A passing run then removes its coding session, because no
// CLI step can reach a finished turn's session; a blocked run keeps it for
// diagnosis. It never provisions or starts the VM, loads images or reads the
// key itself, and it never enables production or claims qualification. Run it
// through scripts/run-native-acceptance.mjs.
//
// With --with-repair (#266) the delivery starts with a one-cycle repair
// allowance, and the owner contract adds a candidate check the first turn
// can't know about: the hint must carry an E2E test hook,
// `data-testid="contact-hint"`. The candidate must fail exactly that check.
// One metered `repair-feature` turn, told only the failed check's ID, must
// then add the hook and pass revalidation, with its cycle,
// active time and spend recorded. A second `repair-feature` must be refused as
// exhausted without spending, and `extend-repair` recorded.
//
// With --through-review (the first real delivery) the repository is a clone of
// the owner's publication repository, and the policy and attestation name its
// real facts, each first read live from GitHub: its rules, approvers, App and
// a Verified owner-signed commit. A missing fact stops the run before `start`.
// After validation the delivery publishes (`publish-feature`, under the
// owner's production admission and publication records), waits for its
// GitHub Actions `pr-ci` check (`monitor-pr-checks`) and reads its review
// (`monitor-review`). It must reach `ready-to-merge` and stop there: merge is
// #270. It writes one signed branch and one App PR to that repository.
//
// --through-merge (#270) takes the same records and continues: `merge-feature`
// must fast-forward the default branch to the PR's exact head, which GitHub
// must then show as main's tip with the PR merged, and `reconcile-merge` must
// find that same merge without a second write.
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { arch, platform, release, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { freshBuild } from "./fresh-build.mjs";
import { acceptanceContract } from "./run-native-validation-admission-acceptance.mjs";

const usage =
  "Usage: node scripts/run-native-cli-delivery-acceptance.mjs <aios-machine> <owner-coding-admission.json> <owner-validation-admission.json> <owner-auth-directory> <new-report.json> --approve-metered-native-run [--with-repair | --through-review|--through-merge <owner-publication-identity.json> <owner-production-admission.json>]";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const passingOutcome = "observed-metered-cli-delivery-acceptance";
export const repairPassingOutcome = "observed-metered-cli-repair-acceptance";
export const reviewPassingOutcome = "observed-native-delivery-through-review";
export const mergePassingOutcome = "observed-native-delivery-through-merge";
/** How long the delivery waits for its PR checks, and how often it looks. */
export const prChecksWaitMs = 15 * 60000;
export const prChecksIntervalMs = 20000;
/** The test hook the repair must add, and the candidate check that needs it.
 * Its ID is all the repair turn is told. A test hook is a requirement a
 * careful agent accepts; an arbitrary marker it rightly refuses as gaming the
 * check (the first native run, 11 November). */
export const repairHook = 'data-testid="contact-hint"';
export const repairCheckId = "page-has-data-testid-contact-hint";
export const request = "Add a visible contact hint.";
/** Enough for Claude Code to make the one-line change. */
export const codingMinutes = 10;
/** The delivery's spend budget: the most the run may spend on the model. */
export const budgetDollars = 5;
const budgetPicodollars = budgetDollars * 1e12;
/** Every stage, in order. */
export const stageNames = Object.freeze([
  "owner-records-name-fresh-pins",
  "owner-inputs",
  "cli-start",
  "cli-plan-feature",
  "cli-validate-baseline",
  "cli-code-feature",
  "cli-validate-candidate",
  "host-checkout-unchanged",
  "coding-session-cleanup",
]);
/** Every stage of a real delivery through review, in order. */
export const reviewStageNames = Object.freeze([
  "owner-records-name-fresh-pins",
  "repository-facts",
  ...stageNames.slice(1, 7),
  "cli-publish-feature",
  "cli-monitor-pr-checks",
  "cli-monitor-review",
  ...stageNames.slice(7),
]);
/** Every stage of a real delivery through merge, in order. */
export const mergeStageNames = Object.freeze([
  ...reviewStageNames.slice(0, 11),
  "cli-merge-feature",
  "cli-reconcile-merge",
  ...reviewStageNames.slice(11),
]);
/** Every stage of a run with repair, in order. */
export const repairStageNames = Object.freeze([
  ...stageNames.slice(0, 7),
  "cli-repair-feature",
  "cli-repair-exhausted",
  "cli-extend-repair",
  ...stageNames.slice(7),
]);

const pinFields = {
  coding: ["cliVersion", "cliSha256", "policySha256", "bindingSha256"],
  validation: ["imageSha256", "policySha256", "bindingSha256"],
};

/** The synthetic owner inputs under the private `root`: a disposable
 * repository with the local hints the CLI reads, an owner policy validating
 * under `environment`, the attestation of every fact the CLI cannot observe,
 * and `criteria(id)`, which writes the criteria file for a started delivery. */
export function ownerInputs(root, environment, { repair = false, real } = {}) {
  if (real) return realOwnerInputs(root, environment, real);
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
  // The only facts the CLI observes: the origin and its default branch.
  git(
    "remote",
    "add",
    "origin",
    "https://github.com/AJHMH/acceptance-page.git",
  );
  git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  const owner = join(root, "owner");
  mkdirSync(owner, { mode: 0o700 });
  const policy = {
    repository: "AJHMH/acceptance-page",
    defaultBranch: "main",
    factoryCommit: "a".repeat(40),
    approver: "acceptance-owner",
    appLogin: "factory[bot]",
    publicationLogin: "acceptance-owner",
    requiredChecks: ["pr-ci"],
    validation: ["isolated-offline"],
    validationContract: repair
      ? withRepairCheck(acceptanceContract(environment))
      : acceptanceContract(environment),
  };
  const policyPath = join(owner, "owner-policy.json"),
    attestationPath = join(owner, "onboarding-attestation.json"),
    criteriaPath = join(owner, "criteria.json");
  const write = (path, value) =>
    writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
  write(policyPath, policy);
  const signature = { commit: revision, valid: true, login: policy.approver };
  write(attestationPath, {
    scope: "aios-onboarding-attestation-v1",
    policySha256: sha256(readFileSync(policyPath)),
    attestedAt: new Date(Date.now() - 60_000).toISOString(),
    facts: {
      repository: policy.repository,
      defaultBranch: policy.defaultBranch,
      factoryCommit: policy.factoryCommit,
      appLogin: policy.appLogin,
      appRepositoryAccess: true,
      eligibleApprovers: [policy.approver],
      protectionsEnforced: true,
      forcePushBlocked: true,
      signedCommitsRequired: true,
      everyPullRequestReviewRequired: false,
      requiredChecks: policy.requiredChecks,
      trustedCheckPublishers: true,
      publicationLogin: policy.publicationLogin,
      publicationAccess: true,
      localSignature: signature,
      githubSignature: signature,
      validation: policy.validation,
    },
  });
  // One owner setup for the records, as the CLI's private-file checks need.
  return {
    repository,
    revision,
    git,
    policyPath,
    attestationPath,
    criteria(deliveryId) {
      write(criteriaPath, {
        scope: "aios-feature-criteria-v1",
        deliveryId,
        request,
        criteria: ["The contact page shows a visible hint."],
        verification: ["Check the visible hint in the isolated page."],
        ambiguity: null,
      });
      return criteriaPath;
    },
  };
}

/** The owner contract for the real repository: the probe checks, the
 * candidate acceptance check, and its GitHub Actions `pr-ci` check from the
 * default branch's workflow (#268). The main check names the same workflow
 * for the later main observer (#271). */
export function realContract(environment) {
  const contract = acceptanceContract(environment);
  return {
    ...contract,
    checks: contract.checks
      .filter((c) => c.scope === "local")
      .concat(
        [
          ["pr-ci", "pr"],
          ["main-ci", "main"],
        ].map(([id, scope]) => ({
          id,
          kind: "build",
          scope,
          stages: ["candidate"],
          command: ["workflow", "ci"],
          publisher: "github-actions",
          workflow: ".github/workflows/ci.yml@main",
          timeoutMs: prChecksWaitMs,
        })),
      ),
  };
}

/** The real repository's onboarding facts, each read live from GitHub through
 * the owner's API, for the publication record `identity`. It throws naming
 * the first fact that doesn't hold, so nothing false is ever attested. */
export async function repositoryFacts(github, identity) {
  const repo = `repos/${identity.repository}`;
  const read = async (path) => {
    const r = await github(path);
    if (r.status !== 200) throw Error(`GitHub refused ${path} (${r.status})`);
    return r.body;
  };
  const need = (condition, fact) => {
    if (!condition) throw Error(`The repository doesn't have: ${fact}`);
  };
  const about = await read(repo);
  need(about.full_name === identity.repository, "the record's name");
  const defaultBranch = about.default_branch;
  const rules = await read(`${repo}/rules/branches/${defaultBranch}`);
  const rule = (type) => rules.filter((r) => r.type === type);
  const statusChecks = rule("required_status_checks").flatMap(
    (r) => r.parameters?.required_status_checks ?? [],
  );
  const reviews = rule("pull_request").some(
    (r) => (r.parameters?.required_approving_review_count ?? 0) > 0,
  );
  need(rule("required_signatures").length > 0, "required signed commits");
  need(rule("non_fast_forward").length > 0, "blocked force pushes");
  need(rule("deletion").length > 0, "blocked deletion");
  need(
    statusChecks.some((c) => c.context === "pr-ci"),
    "a required pr-ci status check",
  );
  // GitHub Actions' App ID: only its pr-ci can satisfy the rule.
  need(
    statusChecks
      .filter((c) => c.context === "pr-ci")
      .every((c) => c.integration_id === 15368),
    "pr-ci required from GitHub Actions",
  );
  need(!reviews, "no required review count (the change gate decides)");
  const collaborators = await read(
    `${repo}/collaborators?affiliation=all&permission=push&per_page=100`,
  );
  const approvers = collaborators
    .filter((c) => c.type === "User")
    .map((c) => c.login);
  need(
    approvers.length === 1 && approvers[0] === identity.approver,
    "the owner as the only person who can push",
  );
  const permission = await read(
    `${repo}/collaborators/${identity.login}/permission`,
  );
  need(
    ["admin", "maintain", "write"].includes(permission.role_name) ||
      ["admin", "write"].includes(permission.permission),
    "push access for the publication login",
  );
  // The App's latest PR here, and its head: owner-signed and Verified.
  const pulls = await read(`${repo}/pulls?state=all&per_page=20`);
  const latest = pulls.find((p) => p.user?.login === identity.botLogin);
  need(latest, "a PR the App opened");
  const commit = await read(`${repo}/commits/${latest.head.sha}`);
  need(
    commit.commit?.verification?.verified === true &&
      commit.commit.verification.reason === "valid" &&
      commit.committer?.login === identity.login,
    "a Verified commit signed by the owner",
  );
  return {
    repository: identity.repository,
    defaultBranch,
    appLogin: identity.botLogin,
    approver: identity.approver,
    publicationLogin: identity.login,
    signedCommit: latest.head.sha,
    signingKey: identity.signingKey,
    email: identity.email,
    requiredChecks: ["pr-ci"],
    pullRequest: latest.number,
  };
}

/** The owner inputs for the real repository: a clone of it, read through the
 * owner's `gh` login, and a policy and attestation of `facts`, which
 * `repositoryFacts` read live. */
function realOwnerInputs(
  root,
  environment,
  {
    facts,
    factoryCommit,
    // Tests stand in a local repository for GitHub.
    cloneUrl = `https://github.com/${facts.repository}.git`,
  },
) {
  const repository = join(root, "repository");
  const run = (args, cwd) => {
    const r = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: 60000,
    });
    if (r.status !== 0)
      throw Error(
        args.includes("verify-commit")
          ? "The owner-signed commit doesn't verify against the owner's key"
          : "The repository clone failed",
      );
    return r.stdout.trim();
  };
  run(
    [
      "-c",
      "credential.helper=",
      "-c",
      "credential.helper=!gh auth git-credential",
      "clone",
      "-q",
      "--branch",
      facts.defaultBranch,
      cloneUrl,
      repository,
    ],
    root,
  );
  const git = (...args) => run(["-C", repository, ...args], root);
  const revision = git("rev-parse", "HEAD");
  const owner = join(root, "owner");
  mkdirSync(owner, { mode: 0o700 });
  // The signed commit verifies here too, against the owner's public key.
  const signers = join(owner, "allowed-signers");
  writeFileSync(
    signers,
    `${facts.email} ${readFileSync(facts.signingKey, "utf8").trim()}\n`,
    { mode: 0o600 },
  );
  git(
    "-c",
    "credential.helper=",
    "-c",
    "credential.helper=!gh auth git-credential",
    "fetch",
    "-q",
    "origin",
    facts.signedCommit,
  );
  git(
    "-c",
    "gpg.format=ssh",
    "-c",
    `gpg.ssh.allowedSignersFile=${signers}`,
    "verify-commit",
    facts.signedCommit,
  );
  const policy = {
    repository: facts.repository,
    defaultBranch: facts.defaultBranch,
    factoryCommit,
    approver: facts.approver,
    appLogin: facts.appLogin,
    publicationLogin: facts.publicationLogin,
    requiredChecks: facts.requiredChecks,
    validation: ["isolated-offline"],
    validationContract: realContract(environment),
  };
  const policyPath = join(owner, "owner-policy.json"),
    attestationPath = join(owner, "onboarding-attestation.json"),
    criteriaPath = join(owner, "criteria.json");
  const write = (path, value) =>
    writeFileSync(path, JSON.stringify(value), { mode: 0o600 });
  write(policyPath, policy);
  const signature = {
    commit: facts.signedCommit,
    valid: true,
    login: facts.publicationLogin,
  };
  write(attestationPath, {
    scope: "aios-onboarding-attestation-v1",
    policySha256: sha256(readFileSync(policyPath)),
    attestedAt: new Date(Date.now() - 60_000).toISOString(),
    facts: {
      repository: policy.repository,
      defaultBranch: policy.defaultBranch,
      factoryCommit,
      appLogin: policy.appLogin,
      appRepositoryAccess: true,
      eligibleApprovers: [policy.approver],
      protectionsEnforced: true,
      forcePushBlocked: true,
      signedCommitsRequired: true,
      everyPullRequestReviewRequired: false,
      requiredChecks: policy.requiredChecks,
      trustedCheckPublishers: true,
      publicationLogin: policy.publicationLogin,
      publicationAccess: true,
      localSignature: signature,
      githubSignature: signature,
      validation: policy.validation,
    },
  });
  return {
    repository,
    revision,
    git,
    policyPath,
    attestationPath,
    criteria(deliveryId) {
      write(criteriaPath, {
        scope: "aios-feature-criteria-v1",
        deliveryId,
        request,
        criteria: ["The contact page shows a visible hint."],
        verification: ["Check the visible hint in the isolated page."],
        ambiguity: null,
      });
      return criteriaPath;
    },
  };
}

/** `contract` with the candidate-only check the first turn can't know about. */
export function withRepairCheck(contract) {
  return {
    ...contract,
    checks: [
      ...contract.checks,
      {
        id: repairCheckId,
        kind: "acceptance",
        scope: "local",
        stages: ["candidate"],
        command: [
          "grep",
          "-qE",
          "data-testid=[\"']contact-hint[\"']",
          "index.html",
        ],
        publisher: "isolated-checker",
        timeoutMs: 60000,
      },
    ],
  };
}

/** A new private folder under `parent`. The CLI refuses owner records and
 * decision state that anyone else can reach; a new temp folder is private. */
export async function privateRoot(prefix, parent = tmpdir()) {
  return realpathSync(mkdtempSync(join(parent, prefix)));
}

/** One CLI process: its parsed result, or its bounded refusal as an error. */
export function cliRunner(state) {
  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
  return (args) =>
    new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [cli, ...args, "--state-dir", state],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      const out = [],
        err = [];
      child.stdout.on("data", (chunk) => out.push(chunk));
      child.stderr.on("data", (chunk) => err.push(chunk));
      child.once("error", reject);
      child.once("close", (status) =>
        resolve({
          status,
          stdout: Buffer.concat(out).toString("utf8"),
          stderr: Buffer.concat(err).toString("utf8"),
        }),
      );
    });
}

/** Run the delivery through `cli` (one CLI process per call, from
 * `cliRunner`) on `machine`, with the owner's admission records, the auth
 * directory holding the owner's Anthropic key and the validation image
 * `imageSha256`. `pins` holds, for coding and
 * validation, the record's `admitted` pins and `fresh()`, the VM's own; a
 * record that does not name them stops the run before any CLI step.
 * `cleanupCodingSession` removes the stopped session it is given from the VM.
 * `persist` receives the report after every stage. */
export async function cliDeliveryAcceptance(
  {
    cli,
    pins,
    machine,
    codingAdmission,
    validationAdmission,
    authDirectory,
    imageSha256,
    cleanupCodingSession,
    repair = false,
    through,
  },
  options = {},
) {
  const persist = options.persist ?? (() => {});
  const sleep =
    options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  const interrupted = options.interrupted ?? (() => false);
  const { offlineValidationEnvironment } = await import(
    "../dist/native-validation.js"
  );
  const report = {
    scope: through
      ? through.merge
        ? "native-delivery-through-merge"
        : "native-delivery-through-review"
      : repair
        ? "native-cli-metered-repair-acceptance"
        : "native-cli-metered-delivery-acceptance",
    productionEnabled: false,
    qualified: false,
    // Paid inference, bounded by the delivery's spend budget.
    inferenceAuthorized: true,
    budgetDollars,
    synthetic: through
      ? ["criteria"]
      : ["repository", "owner-policy", "attestation", "criteria"],
    outcome: "running",
    stages: [],
  };
  const check = (condition, message) => {
    if (!condition) throw Error(message);
  };
  const bounded = (text) => String(text).slice(0, 300);
  const origin = performance.now(),
    elapsed = () => Math.round(performance.now() - origin);
  async function stage(name, action) {
    const entry = { name, outcome: "running", startedMs: elapsed() };
    report.stages.push(entry);
    persist(report);
    try {
      const result = await action();
      check(!interrupted(), "Interrupted");
      entry.outcome = "passed";
      return result;
    } catch (error) {
      entry.outcome = "blocked";
      entry.error = bounded(error?.message);
      throw error;
    } finally {
      entry.finishedMs = elapsed();
      persist(report);
    }
  }
  // A refusal is the CLI's own bounded message, never its environment: the
  // last stderr line that is its JSON error. Node may warn before or after it.
  const refusal = (result) => {
    for (const line of result.stderr.split("\n").reverse())
      try {
        const error = JSON.parse(line).error;
        if (typeof error === "string") return bounded(error);
      } catch {}
    return `The CLI exited with ${result.status}`;
  };
  async function run(...args) {
    const result = await cli(args);
    if (result.status !== 0) throw Error(refusal(result));
    return JSON.parse(result.stdout);
  }

  const root = await privateRoot("aios-cli-delivery-acceptance-");
  let inputs, id, last;
  const vm = ["--podman-machine", machine];
  const validation = [...vm, "--validation-admission", validationAdmission];
  try {
    await stage("owner-records-name-fresh-pins", async () => {
      report.freshPins = {
        coding: await pins.coding.fresh(),
        validation: await pins.validation.fresh(),
      };
      for (const kind of ["coding", "validation"])
        check(
          pinFields[kind].every(
            (field) =>
              pins[kind].admitted[field] === report.freshPins[kind][field],
          ),
          `The owner ${kind} admission does not name the fresh pins`,
        );
    });
    let facts;
    if (through)
      facts = await stage("repository-facts", async () => {
        // The production record must admit exactly the pins this run uses.
        const admitted = through.productionAdmission.admitted();
        check(
          pinFields.coding.every(
            (field) => admitted.coding[field] === pins.coding.admitted[field],
          ),
          "The production admission doesn't name the coding admission's pins",
        );
        report.productionSha256 = admitted.productionSha256;
        const found = await repositoryFacts(through.github, through.identity);
        report.repository = {
          name: found.repository,
          defaultBranch: found.defaultBranch,
          signedCommit: found.signedCommit,
          signedPullRequest: found.pullRequest,
        };
        return found;
      });
    inputs = await stage("owner-inputs", () =>
      ownerInputs(root, offlineValidationEnvironment(imageSha256), {
        repair,
        ...(through
          ? {
              real: {
                facts,
                factoryCommit: through.factoryCommit,
                ...(through.cloneUrl ? { cloneUrl: through.cloneUrl } : {}),
              },
            }
          : {}),
      }),
    );
    if (through) report.repository.baseRevision = inputs.revision;
    const owner = [
      "--owner-policy",
      inputs.policyPath,
      "--onboarding-attestation",
      inputs.attestationPath,
    ];
    last = await stage("cli-start", async () => {
      const started = await run(
        "start",
        "--repo",
        inputs.repository,
        "--request",
        request,
        ...owner,
        "--coding-minutes",
        String(codingMinutes),
        "--budget-dollars",
        String(budgetDollars),
        ...(repair ? ["--repair-cycles", "1"] : []),
      );
      check(uuid.test(started.id ?? ""), "The CLI started no delivery");
      check(
        started.blocker?.code === "DELIVERY_NOT_ENABLED",
        "Production delivery is not disabled",
      );
      check(
        started.onboarding?.ready === true &&
          started.onboarding.attestation?.source === "owner-attested",
        "Onboarding is not ready from the local hints and the attestation",
      );
      return started;
    });
    id = last.id;
    report.deliveryId = id;
    last = await stage("cli-plan-feature", async () => {
      const planned = await run(
        "plan-feature",
        "--id",
        id,
        "--feature-criteria",
        inputs.criteria(id),
      );
      check(
        planned.feature?.outcome === "planned" &&
          planned.feature.criteria.length === 1,
        "The owner's criteria were not planned",
      );
      return planned;
    });
    last = await stage("cli-validate-baseline", async () => {
      const validated = await run(
        "validate-baseline",
        "--id",
        id,
        ...owner,
        ...validation,
      );
      const attempt = validated.validation?.attempts.at(-1);
      report.baseline = attempt && {
        stage: attempt.stage,
        state: attempt.state,
        outcome: attempt.outcome,
        bindingSha256: attempt.bindingSha256,
        results: attempt.results.map((r) => ({
          checkId: r.checkId,
          status: r.status,
        })),
      };
      check(
        attempt?.stage === "baseline" &&
          attempt.state === "stopped" &&
          attempt.outcome === "passed",
        "The baseline did not pass on the admitted validation runtime",
      );
      return validated;
    });
    last = await stage("cli-code-feature", async () => {
      const coded = await run(
        "code-feature",
        "--id",
        id,
        ...owner,
        ...validation,
        "--coding-admission",
        codingAdmission,
        "--auth-directory",
        authDirectory,
        "--coding-minutes",
        String(codingMinutes),
      );
      const feature = coded.feature,
        session = feature?.session,
        spend = coded.spend;
      report.coding = {
        outcome: feature?.outcome ?? null,
        state: session?.state ?? null,
        provider: session?.provider ?? null,
        threadStarted: session?.threadStarted === true,
        budgetRouted:
          session?.route?.deliveryId === id &&
          session.route.decisionSha256 ===
            sha256("aios-spend-budget-route-v1:" + id),
        candidate: Boolean(feature?.candidate),
        branch: feature?.branch ?? null,
        blocker: coded.blocker?.code ?? null,
      };
      report.spend = spend && {
        model: spend.model,
        budget: spend.budget,
        spent: spend.spent,
        charges: spend.charges,
        interrupted: Boolean(spend.interruption),
      };
      check(
        session?.state === "stopped",
        "The coding session was not stopped exactly",
      );
      check(
        report.coding.provider === "claude",
        "The turn was not Claude Code",
      );
      // A request the budget can't cover is refused before it is sent, so an
      // interruption explains whatever else the turn is missing.
      check(
        !spend?.interruption,
        `The $${budgetDollars} budget interrupted the turn: one request could cost up to $${(spend?.interruption?.needed / 1e12).toFixed(2)}`,
      );
      check(
        report.coding.threadStarted && uuid.test(session.threadId ?? ""),
        "The turn reported no session",
      );
      check(
        report.coding.budgetRouted,
        "The turn was not authorized by the delivery's spend budget",
      );
      check(
        spend?.budget === budgetPicodollars &&
          spend.spent > 0 &&
          spend.spent <= spend.budget &&
          spend.charges > 0,
        "The turn's requests were not charged within the budget",
      );
      check(!spend.reserved, "A model request was left reserved");
      check(
        feature.outcome === "admitted" && report.coding.candidate,
        "The turn admitted no candidate",
      );
      return coded;
    });
    last = await stage("cli-validate-candidate", async () => {
      const validated = await run(
        "validate-candidate",
        "--id",
        id,
        ...owner,
        ...validation,
      );
      const attempt = validated.validation?.attempts.at(-1);
      report.candidate = attempt && {
        stage: attempt.stage,
        state: attempt.state,
        outcome: attempt.outcome,
        results: attempt.results.map((r) => ({
          checkId: r.checkId,
          status: r.status,
        })),
      };
      if (repair)
        // The first turn never knew the hook, so only its check fails.
        check(
          attempt?.stage === "candidate" &&
            attempt.state === "stopped" &&
            attempt.outcome === "failed" &&
            attempt.results.every(
              (r) => (r.checkId === repairCheckId) === (r.status !== "success"),
            ) &&
            attempt.results.some((r) => r.checkId === repairCheckId),
          `The candidate did not fail exactly the ${repairCheckId} check`,
        );
      else
        check(
          attempt?.stage === "candidate" &&
            attempt.state === "stopped" &&
            attempt.outcome === "passed" &&
            validated.feature?.candidate?.validation === "passed",
          "The candidate did not pass on the admitted validation runtime",
        );
      return validated;
    });
    if (repair) {
      const turn = [
        ...owner,
        ...validation,
        "--coding-admission",
        codingAdmission,
        "--auth-directory",
        authDirectory,
      ];
      const before = last.spend;
      last = await stage("cli-repair-feature", async () => {
        const repaired = await run("repair-feature", "--id", id, ...turn);
        const r = repaired.repair,
          attempt = r?.attempts.at(-1),
          session = attempt?.codingSession,
          spend = repaired.spend,
          revalidated = repaired.validation?.attempts.at(-1);
        report.repair = {
          allowanceCycles: r?.allowanceCycles ?? null,
          allowanceMs: r?.allowanceMs ?? null,
          activeMs: r?.activeMs ?? null,
          attempts: r?.attempts.length ?? 0,
          outcome: attempt?.outcome ?? null,
          state: attempt?.state ?? null,
          findings: attempt?.findings ?? [],
          remainingCycles: attempt?.remainingCycles ?? null,
          remainingMs: attempt?.remainingMs ?? null,
          provider: session?.provider ?? null,
          sessionState: session?.state ?? null,
          budgetRouted:
            session?.route?.deliveryId === id &&
            session.route.decisionSha256 ===
              sha256("aios-spend-budget-route-v1:" + id),
          revalidation: revalidated && {
            stage: revalidated.stage,
            outcome: revalidated.outcome,
            results: revalidated.results.map((x) => ({
              checkId: x.checkId,
              status: x.status,
            })),
          },
        };
        report.repairSpend = spend && {
          spent: spend.spent,
          charges: spend.charges,
          interrupted: Boolean(spend.interruption),
        };
        check(
          !spend?.interruption,
          `The $${budgetDollars} budget interrupted the repair turn`,
        );
        check(
          r?.allowanceCycles === 1 &&
            r.attempts.length === 1 &&
            attempt.state === "stopped" &&
            attempt.remainingCycles === 0,
          "The repair did not spend the one owner-set cycle",
        );
        check(
          attempt.findings.includes(
            "Candidate check " + repairCheckId + ": failure",
          ),
          "The repair was not given the failed check",
        );
        check(
          r.activeMs > 0 && r.activeMs < r.allowanceMs,
          "The repair's active time was not recorded within its allowance",
        );
        check(
          report.repair.provider === "claude" &&
            report.repair.sessionState === "stopped" &&
            report.repair.budgetRouted,
          "The repair turn was not a stopped Claude Code session on the delivery's budget",
        );
        check(
          spend.spent > before.spent &&
            spend.spent <= spend.budget &&
            spend.charges > before.charges &&
            !spend.reserved,
          "The repair turn's requests were not charged within the budget",
        );
        check(
          attempt.outcome === "passed" &&
            revalidated?.stage === "candidate" &&
            revalidated.outcome === "passed" &&
            repaired.feature?.candidate?.validation === "passed",
          "The repaired candidate did not pass revalidation",
        );
        return repaired;
      });
      last = await stage("cli-repair-exhausted", async () => {
        const refused = await run("repair-feature", "--id", id, ...turn);
        check(
          refused.repair?.attempts.length === 1 &&
            /Repair allowance exhausted/.test(
              refused.blocker?.nextAction ?? "",
            ),
          "A spent allowance was not reported as exhausted",
        );
        check(
          refused.spend?.spent === last.spend.spent &&
            refused.spend.charges === last.spend.charges,
          "The refused repair spent the budget",
        );
        report.exhausted = refused.blocker.nextAction;
        return refused;
      });
      last = await stage("cli-extend-repair", async () => {
        const extended = await run(
          "extend-repair",
          "--id",
          id,
          "--cycles",
          "1",
        );
        check(
          extended.repair?.allowanceCycles === 2 &&
            extended.repair.extensions.length === 1 &&
            extended.repair.extensions[0].addedCycles === 1 &&
            extended.repair.attempts.length === 1,
          "The owner extension was not recorded",
        );
        return extended;
      });
    }
    if (through) {
      last = await stage("cli-publish-feature", async () => {
        const published = await run(
          "publish-feature",
          "--id",
          id,
          ...owner,
          ...validation,
          "--production-admission",
          through.productionAdmission.path,
          "--publication-identity",
          through.identityPath,
        );
        const p = published.publication;
        report.publication = p && {
          outcome: p.outcome,
          number: p.pullRequest?.number ?? null,
          commit: p.commit ?? null,
          branch: p.branch ?? null,
          productionSha256: p.productionSha256 ?? null,
        };
        check(
          p?.outcome === "published" &&
            Number.isSafeInteger(p.pullRequest?.number) &&
            /^[a-f0-9]{40}$/.test(p.commit ?? ""),
          "The delivery was not published",
        );
        check(
          p.productionSha256 === report.productionSha256,
          "The publication doesn't record the production admission",
        );
        return published;
      });
      last = await stage("cli-monitor-pr-checks", async () => {
        const start = now();
        for (;;) {
          const watched = await run(
            "monitor-pr-checks",
            "--id",
            id,
            ...owner,
            ...validation,
          );
          const r = watched.prChecks?.runs.at(-1);
          report.prChecks = r && {
            outcome: r.outcome,
            head: r.head,
            polls: r.polls,
            attempts: r.attempts.map((a) => ({
              checkId: a.checkId,
              runId: a.runId,
              attempt: a.attempt,
              status: a.status,
              publisher: a.publisher,
              workflow: a.workflow,
            })),
          };
          // Until the check's deadline, a run not yet started or finished is
          // incomplete and a failed read unavailable: neither is final. The
          // first real run gave up on its first look, two seconds after the
          // push, before GitHub had started pr-ci (12 November).
          if (!["pending", "incomplete", "unavailable"].includes(r?.outcome)) {
            check(
              r?.outcome === "passed" && r.head === report.publication.commit,
              `The PR checks are ${r?.outcome ?? "missing"}`,
            );
            return watched;
          }
          check(
            now() - start < prChecksWaitMs,
            "The PR checks didn't finish in time",
          );
          await sleep(prChecksIntervalMs);
        }
      });
      last = await stage("cli-monitor-review", async () => {
        const reviewed = await run(
          "monitor-review",
          "--id",
          id,
          ...owner,
          ...validation,
        );
        const r = reviewed.review?.runs.at(-1);
        report.review = r && {
          outcome: r.outcome,
          head: r.head,
          approval: r.approval ?? null,
          gate: r.gate
            ? {
                gated: r.gate.gated,
                reasons: [...r.gate.destructive, ...r.gate.wideImpact],
              }
            : null,
          phase: reviewed.phase,
        };
        check(
          reviewed.phase === "ready-to-merge" &&
            r?.approval?.head === report.publication.commit,
          `Review left the delivery ${reviewed.phase}: ${reviewed.blocker?.nextAction ?? ""}`,
        );
        return reviewed;
      });
      if (through.merge) {
        last = await stage("cli-merge-feature", async () => {
          const merged = await run(
            "merge-feature",
            "--id",
            id,
            ...owner,
            ...validation,
            "--production-admission",
            through.productionAdmission.path,
          );
          const a = merged.merge?.attempts.at(-1);
          report.merge = a && {
            state: a.state,
            head: a.head,
            baseRevision: a.baseRevision,
            mergeCommit: a.mergeCommit ?? null,
            mainRevision: a.mainRevision ?? null,
            phase: merged.phase,
          };
          check(
            merged.phase === "merged" &&
              a?.state === "merged" &&
              a.mergeCommit === report.publication.commit &&
              a.baseRevision === report.repository.baseRevision,
            `Merge left the delivery ${merged.phase}: ${merged.blocker?.nextAction ?? ""}`,
          );
          // GitHub's own view: main is the head, and the PR is merged.
          const repo = `repos/${report.repository.name}`;
          const main = await through.github(
            `${repo}/git/ref/heads/${report.repository.defaultBranch}`,
          );
          const pr = await through.github(
            `${repo}/pulls/${report.publication.number}`,
          );
          report.merge.github = {
            main: main.body?.object?.sha ?? null,
            merged: pr.body?.merged === true,
          };
          check(
            report.merge.github.main === report.publication.commit &&
              report.merge.github.merged,
            "GitHub doesn't show main at the head with the PR merged",
          );
          return merged;
        });
        last = await stage("cli-reconcile-merge", async () => {
          const reconciled = await run("reconcile-merge", "--id", id, ...owner);
          check(
            reconciled.phase === "merged" &&
              reconciled.merge?.attempts.length === 1 &&
              reconciled.merge.attempts[0].state === "merged",
            "Reconciling didn't find the same single merge",
          );
          return reconciled;
        });
      }
    }
    await stage("host-checkout-unchanged", () => {
      check(
        inputs.git("branch", "--show-current") === "main" &&
          inputs.git("rev-parse", "HEAD") === inputs.revision &&
          inputs.git("status", "--porcelain") === "",
        "The host checkout changed",
      );
      check(
        inputs.git("rev-parse", `refs/heads/${last.feature.branch}`) ===
          inputs.revision,
        "The feature branch moved from the baseline revision",
      );
    });
    await stage("coding-session-cleanup", async () => {
      // The coding turn's session, then the repair turn's own.
      for (const session of [
        last.feature.session,
        ...(repair ? [last.repair.attempts[0].codingSession] : []),
      ]) {
        const receipt = await cleanupCodingSession(session);
        check(receipt.cleaned === 1, "Expected one cleaned session");
      }
    });
    report.outcome = through
      ? through.merge
        ? mergePassingOutcome
        : reviewPassingOutcome
      : repair
        ? repairPassingOutcome
        : passingOutcome;
  } catch (error) {
    report.error = bounded(error?.message);
    report.outcome = "blocked";
  } finally {
    // An unsettled session or attempt is stopped by its exact identity.
    if (id)
      try {
        let current = await run("status", "--id", id);
        const open = (d) =>
          (d.feature?.session && d.feature.session.state !== "stopped") ||
          d.validation?.attempts.some((a) => a.state !== "stopped") ||
          d.repair?.attempts.some((a) => a.state !== "stopped");
        if (open(current))
          current = await stage("final-exact-stop", async () => {
            await cli([
              "cancel",
              "--id",
              id,
              ...vm,
              "--coding-admission",
              codingAdmission,
              "--validation-admission",
              validationAdmission,
            ]);
            const after = await run("status", "--id", id);
            check(!open(after), "Exact stop is uncertain");
            return after;
          });
      } catch {
        report.outcome = "uncertain";
      }
    rmSync(root, { recursive: true, force: true });
    persist(report);
  }
  return report;
}

function sourceEvidence(root) {
  const git = (...args) =>
    spawnSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      timeout: 5000,
    });
  const build = freshBuild(root);
  return {
    ...build,
    sourceRevision: git("rev-parse", "HEAD").stdout.trim(),
    sourceDirty: git("status", "--porcelain").stdout.trim() !== "",
    runnerSha256: sha256(readFileSync(new URL(import.meta.url))),
    buildSha256: Object.fromEntries(
      [
        "cli",
        "cli-commands",
        "controller",
        "onboarding",
        "feature-criteria",
      ].map((name) => [
        name,
        sha256(readFileSync(new URL(`../dist/${name}.js`, import.meta.url))),
      ]),
    ),
  };
}

async function main() {
  const [
    machine,
    codingAdmission,
    validationAdmission,
    authDirectory,
    reportPath,
    approval,
    ...extra
  ] = process.argv.slice(2);
  if (
    !/^aios-[a-z0-9-]+$/.test(machine ?? "") ||
    !codingAdmission ||
    !validationAdmission ||
    !authDirectory ||
    !reportPath ||
    approval !== "--approve-metered-native-run" ||
    !(
      extra.length === 0 ||
      (extra.length === 1 && extra[0] === "--with-repair") ||
      (extra.length === 3 &&
        ["--through-review", "--through-merge"].includes(extra[0]))
    )
  ) {
    console.error(usage);
    process.exitCode = 1;
    return;
  }
  // The build must be what this source compiles to, before anything from it
  // runs or any evidence, record or VM is touched.
  const source = sourceEvidence(fileURLToPath(new URL("..", import.meta.url)));
  const { ownerValidationAdmission } = await import(
    "../dist/native-validation.js"
  );
  const { ownerCodingWorker } = await import(
    "../dist/native-coding-runtime.js"
  );
  // The worker the owner's record names, which must be Claude Code's.
  const codingTransport = () => {
    const worker = ownerCodingWorker(machine, codingAdmission);
    if (worker.agent !== "claude")
      throw Error("The coding admission is not the owner's Claude Code record");
    return worker;
  };
  // Both records must admit pins before any worker effect; the CLI re-reads
  // them at each step.
  const codingPins = codingTransport().admission.pins();
  const validationPins = ownerValidationAdmission(validationAdmission).pins();
  // The stored key's non-secret account record, so a missing key stops the
  // run before any VM effect. The key itself is read only by the CLI.
  const { anthropicAccount } = await import("../dist/anthropic-key.js");
  let account;
  try {
    account = anthropicAccount(authDirectory);
  } catch {}
  if (!account)
    throw Error(
      "No Anthropic key is stored in the auth directory: run prepare-auth, then store-anthropic-key, with that --auth-directory",
    );
  const { imageSha256 } = validationPins;
  const { NativePodmanValidationTransport } = await import(
    "../dist/podman-validation.js"
  );
  const { nativeValidationAuthority } = await import(
    "../dist/native-validation-runtime.js"
  );
  // The VM's own pins, read without starting any session or check.
  const pins = {
    coding: {
      admitted: codingPins,
      fresh: () =>
        codingTransport().transport.inspect({
          operationId: randomUUID(),
          fence: 1,
          state: "running",
          intent: "start",
        }),
    },
    validation: {
      admitted: validationPins,
      // With the database and browser images the record admits, which its
      // binding names.
      fresh: () =>
        new NativePodmanValidationTransport(
          machine,
          nativeValidationAuthority(machine),
          imageSha256,
          Object.fromEntries(
            ["databaseImageSha256", "browserImageSha256"]
              .filter((field) => validationPins[field])
              .map((field) => [field, validationPins[field]]),
          ),
        ).inspect(),
    },
  };
  // The real delivery's records, read before any worker effect.
  let through;
  if (["--through-review", "--through-merge"].includes(extra[0])) {
    const { readPublicationIdentity } = await import(
      "../dist/publication-identity.js"
    );
    const { ownerProductionAdmission } = await import(
      "../dist/production-admission.js"
    );
    const { ghApi } = await import("../dist/native-publication.js");
    through = {
      identityPath: extra[1],
      identity: readPublicationIdentity(extra[1]),
      productionAdmission: ownerProductionAdmission(extra[2]),
      github: ghApi(),
      factoryCommit: source.sourceRevision,
      merge: extra[0] === "--through-merge",
    };
    through.productionAdmission.admitted();
  }
  // Refuse overwriting retained evidence before any worker effect.
  closeSync(openSync(reportPath, "wx", 0o600));
  const state = await privateRoot("aios-cli-delivery-state-");
  const context = {
    host: { platform: platform(), arch: arch(), release: release(), machine },
    imageSha256,
    ...source,
  };
  // A signal never abandons a step: the CLI process ends its own effects,
  // then any open session is stopped before the run reports interrupted.
  let interrupted = false;
  const interrupt = () => (interrupted = true);
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  const report = await cliDeliveryAcceptance(
    {
      cli: cliRunner(state),
      pins,
      machine,
      codingAdmission,
      validationAdmission,
      authDirectory,
      imageSha256,
      cleanupCodingSession: (session) =>
        codingTransport().transport.cleanupSupersededLineage(session),
      repair: extra[0] === "--with-repair",
      ...(through ? { through } : {}),
    },
    {
      interrupted: () => interrupted,
      persist: (r) =>
        writeFileSync(
          reportPath,
          JSON.stringify({ ...context, ...r, interrupted }, null, 2),
        ),
    },
  );
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
  console.log(
    JSON.stringify({
      outcome: report.outcome,
      reportPath,
      state,
      // Fresh pins, so the owner can write or check the records.
      ...(report.publication?.number
        ? { pullRequest: report.publication.number }
        : {}),
      ...(report.outcome === passingOutcome ||
      report.outcome === repairPassingOutcome ||
      report.outcome === reviewPassingOutcome ||
      report.outcome === mergePassingOutcome
        ? {}
        : { freshPins: report.freshPins ?? null }),
    }),
  );
  if (
    report.outcome !== passingOutcome &&
    report.outcome !== repairPassingOutcome &&
    report.outcome !== reviewPassingOutcome &&
    report.outcome !== mergePassingOutcome
  )
    process.exitCode = 1;
}

// Compare real paths, so a symlinked checkout still runs.
const invoked = process.argv[1] && realpathSync(process.argv[1]);
if (invoked && import.meta.url === pathToFileURL(invoked).href)
  main().catch((error) => {
    console.error(String(error?.message).slice(0, 300));
    process.exitCode = 1;
  });
