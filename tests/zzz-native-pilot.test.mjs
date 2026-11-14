import "./helpers/owner-host-stand-in.mjs";
// The observed pilot (#275): the owner's pilot record, the real repository's
// facts read live from GitHub, the owner inputs the real CLI must accept,
// and the delivery through cleanup. GitHub is a stand-in, the repository a
// local one with a commit signed by a throwaway key, and the CLI's VM and
// GitHub steps are simulated.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmodSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { validationContract } from "../dist/isolated-validation.js";
import { preparedNpmValidationEnvironment } from "../dist/native-validation.js";
import {
  cliRunner,
  privateRoot,
} from "../scripts/run-native-cli-delivery-acceptance.mjs";
import {
  passingOutcome,
  pilotContract,
  pilotDelivery,
  pilotFacts,
  pilotOwnerInputs,
  readPilot,
  stageNames,
} from "../scripts/run-native-pilot.mjs";

const repository = "AJHMH/profile-page";
const owner = "aaron-howard";
const bot = "ajhmh-software-factory[bot]";
const environment = preparedNpmValidationEnvironment("a".repeat(64));
const example = () =>
  JSON.parse(
    readFileSync(
      new URL("../docs/pilot/profile-page-pilot.json", import.meta.url),
      "utf8",
    ),
  );
const option = (args, name) => args[args.indexOf(name) + 1];

/** A local repository standing in for GitHub's, with `main` in a commit
 * signed by a throwaway SSH key. */
async function signedRemote(t) {
  const root = await privateRoot("aios-pilot-remote-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sh = (cmd, args, cwd = root) => {
    const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  sh("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "t", "-f", "key"]);
  sh("git", ["init", "-q", "-b", "main", "work"]);
  const work = join(root, "work");
  writeFileSync(join(work, "package.json"), '{"name":"site"}\n');
  sh("git", ["add", "package.json"], work);
  sh(
    "git",
    [
      "-c",
      "user.name=Owner",
      "-c",
      "user.email=owner@example.invalid",
      "-c",
      "gpg.format=ssh",
      "-c",
      `user.signingkey=${join(root, "key")}`,
      "-c",
      "core.hooksPath=/nonexistent",
      "commit",
      "-q",
      "-S",
      "-m",
      "base",
    ],
    work,
  );
  const commit = sh("git", ["rev-parse", "HEAD"], work);
  sh("git", ["init", "-q", "--bare", "-b", "main", "remote.git"]);
  sh("git", ["push", "-q", join(root, "remote.git"), "main"], work);
  return {
    root,
    url: join(root, "remote.git"),
    commit,
    key: join(root, "key.pub"),
  };
}
const identityFor = (remote, changes = {}) => ({
  repository,
  login: owner,
  name: "Owner",
  email: "owner@example.invalid",
  signingKey: remote?.key ?? "/owner/key.pub",
  botLogin: bot,
  approver: owner,
  ...changes,
});
const pilotFor = (commit, changes = {}) => ({
  ...example(),
  signedCommit: commit,
  ...changes,
});

/** GitHub's answers for the repository's facts; `changes` replaces some. */
function factsGitHub(commit, changes = {}) {
  const r = `repos/${repository}`;
  const answers = {
    [r]: { full_name: repository, default_branch: "main" },
    [`${r}/rules/branches/main`]: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      { type: "required_signatures" },
      { type: "required_linear_history" },
      {
        type: "required_status_checks",
        parameters: {
          required_status_checks: example().requiredChecks.map((context) => ({
            context,
            integration_id: 15368,
          })),
        },
      },
    ],
    [`${r}/collaborators?affiliation=all&permission=push&per_page=100`]: [
      { login: owner, type: "User" },
      { login: bot, type: "Bot" },
    ],
    [`${r}/collaborators/${owner}/permission`]: {
      permission: "admin",
      role_name: "admin",
    },
    [`${r}/commits/${commit}`]: {
      sha: commit,
      committer: { login: owner },
      commit: { verification: { verified: true, reason: "valid" } },
    },
    ...changes,
  };
  return async (path) =>
    path in answers
      ? { status: 200, body: answers[path] }
      : { status: 404, body: {} };
}

test("the pilot record is private, complete, and leaves the environment to the validation record", async (t) => {
  const root = await privateRoot("aios-pilot-record-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "pilot.json");
  const write = (value, mode = 0o600) => {
    writeFileSync(path, JSON.stringify(value));
    chmodSync(path, mode);
  };
  write(pilotFor("1".repeat(40)));
  assert.equal(readPilot(path).repository, repository);
  assert.throws(() => readPilot("pilot.json"), /absolute/);
  write(pilotFor("1".repeat(40)), 0o644);
  assert.throws(() => readPilot(path), /private file/);
  for (const changes of [
    { scope: "other" },
    { signedCommit: "x" },
    { criteria: [] },
    { requiredChecks: [] },
    { budgetDollars: 0 },
    { reviewWaitMinutes: 0 },
    { requireOwnerApproval: "yes" },
    { libc: "bionic" },
    {
      validationContract: {
        ...example().validationContract,
        environment: environment,
      },
    },
  ]) {
    write(pilotFor("1".repeat(40), changes));
    assert.throws(() => readPilot(path), /Invalid owner pilot record/);
  }
  // The contract takes the validation record's image and the pilot's
  // database, browser and C library.
  const contract = pilotContract(environment, example());
  assert.deepEqual(contract.environment, {
    ...environment,
    database: true,
    browser: true,
    libc: "glibc",
  });
  assert.deepEqual(
    contract.checks.filter((c) => c.scope === "pr").map((c) => c.id),
    example().requiredChecks,
  );
});

test("the repository facts hold only with the pilot's checks, no pull request rule and the owner's signed commit", async () => {
  const commit = "c".repeat(40);
  const identity = identityFor(undefined);
  const facts = await pilotFacts(
    factsGitHub(commit),
    identity,
    pilotFor(commit),
  );
  assert.deepEqual(facts.requiredChecks, example().requiredChecks);
  assert.equal(facts.signedCommit, commit);
  const r = `repos/${repository}`;
  const rules = (await factsGitHub(commit)(`${r}/rules/branches/main`)).body;
  for (const [changes, reason, pilot = pilotFor(commit), id = identity] of [
    [
      {
        [`${r}/rules/branches/main`]: [
          ...rules,
          {
            type: "pull_request",
            parameters: { required_approving_review_count: 0 },
          },
        ],
      },
      /no pull request rule/,
    ],
    [
      {
        [`${r}/rules/branches/main`]: rules.filter(
          (x) => x.type !== "required_signatures",
        ),
      },
      /signed commits/,
    ],
    [
      {},
      /exactly the pilot's required checks/,
      pilotFor(commit, { requiredChecks: ["e2e"] }),
    ],
    [
      {
        [`${r}/rules/branches/main`]: rules.map((x) =>
          x.type === "required_status_checks"
            ? {
                ...x,
                parameters: {
                  required_status_checks:
                    x.parameters.required_status_checks.map((c) => ({
                      ...c,
                      integration_id: 1,
                    })),
                },
              }
            : x,
        ),
      },
      /GitHub Actions only/,
    ],
    [
      {
        [`${r}/collaborators?affiliation=all&permission=push&per_page=100`]: [
          { login: owner, type: "User" },
          { login: "someone", type: "User" },
        ],
      },
      /only person who can push/,
    ],
    [
      {
        [`${r}/commits/${commit}`]: {
          sha: commit,
          committer: { login: "web-flow" },
          commit: { verification: { verified: true, reason: "valid" } },
        },
      },
      /signed by the owner/,
    ],
    [{}, /pilot's repository/, pilotFor(commit, { repository: "AJHMH/other" })],
  ])
    await assert.rejects(
      pilotFacts(factsGitHub(commit, changes), id, pilot),
      reason,
    );
});

test("the real CLI is ready to deliver the example pilot record", async (t) => {
  const remote = await signedRemote(t);
  const identity = identityFor(remote);
  const pilot = pilotFor(remote.commit);
  const facts = await pilotFacts(factsGitHub(remote.commit), identity, pilot);
  const root = await privateRoot("aios-pilot-inputs-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const inputs = pilotOwnerInputs(root, environment, {
    facts,
    factoryCommit: "f".repeat(40),
    pilot,
    cloneUrl: remote.url,
  });
  assert.equal(inputs.revision, remote.commit);
  inputs.git(
    "remote",
    "set-url",
    "origin",
    `https://github.com/${repository}.git`,
  );
  const policy = JSON.parse(readFileSync(inputs.policyPath, "utf8"));
  assert.deepEqual(policy.excludedPaths, pilot.excludedPaths);
  assert.deepEqual(policy.requiredChecks, pilot.requiredChecks);
  // Validation loads the contract, so its checks are valid and distinct.
  const contract = validationContract(
    inputs.policyPath,
    createHash("sha256").update(readFileSync(inputs.policyPath)).digest("hex"),
  );
  assert.equal(contract.checks.length, pilot.validationContract.checks.length);
  const cli = cliRunner(join(root, "state"));
  const run = async (...args) => {
    const result = await cli(args);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const started = await run(
    "start",
    "--repo",
    inputs.repository,
    "--request",
    pilot.request,
    "--owner-policy",
    inputs.policyPath,
    "--onboarding-attestation",
    inputs.attestationPath,
    "--budget-dollars",
    String(pilot.budgetDollars),
    "--repair-cycles",
    String(pilot.repairCycles),
  );
  assert.equal(
    started.onboarding.ready,
    true,
    JSON.stringify(started.onboarding),
  );
  const planned = await run(
    "plan-feature",
    "--id",
    started.id,
    "--feature-criteria",
    inputs.criteria(started.id),
  );
  assert.equal(planned.feature.outcome, "planned");
  assert.deepEqual(planned.feature.criteria, pilot.criteria);
});

const codingPins = {
  cliVersion: "2.1.311",
  cliSha256: "1".repeat(64),
  policySha256: "3".repeat(64),
  bindingSha256: "4".repeat(64),
};
const validationPins = {
  imageSha256: "a".repeat(64),
  policySha256: "5".repeat(64),
  bindingSha256: "6".repeat(64),
};
const pins = {
  coding: { admitted: codingPins, fresh: async () => codingPins },
  validation: { admitted: validationPins, fresh: async () => validationPins },
};
const production = (level = "complete", changes = {}) => ({
  path: "/owner/production.json",
  admitted: () => ({
    level,
    coding: codingPins,
    validationBindingSha256: "binding",
    productionSha256: "7".repeat(64),
    ...changes,
  }),
});

/** A CLI whose VM and GitHub steps are simulated through cleanup. */
function simulatedCli(faults = {}) {
  const calls = [];
  const head = "e".repeat(40);
  let delivery,
    reviewPolls = 0,
    checkPolls = 0;
  const ok = (value) => ({
    status: 0,
    stdout: JSON.stringify(value),
    stderr: "",
  });
  const session = () => ({
    state: "stopped",
    provider: "claude",
    threadId: randomUUID(),
  });
  const commands = {
    start() {
      delivery = {
        id: randomUUID(),
        phase: "blocked",
        onboarding: { ready: true },
      };
      return ok(delivery);
    },
    "plan-feature"() {
      delivery.feature = { outcome: "planned" };
      return ok(delivery);
    },
    "validate-baseline"() {
      delivery.validation = {
        attempts: [
          {
            stage: "baseline",
            state: "stopped",
            outcome: "passed",
            results: [],
          },
        ],
      };
      return ok(delivery);
    },
    "code-feature"() {
      Object.assign(delivery.feature, {
        outcome: "admitted",
        branch: "aios/feature",
        candidate: { validation: "not-run" },
        session: session(),
      });
      delivery.spend = { budget: 10e12, spent: 1e11, charges: 3 };
      return ok(delivery);
    },
    "validate-candidate"() {
      const passed = !faults.failCandidate;
      delivery.validation.attempts.push({
        stage: "candidate",
        state: "stopped",
        outcome: passed ? "passed" : "failed",
        results: [
          { checkId: "skip-link", status: passed ? "success" : "failure" },
        ],
      });
      delivery.feature.candidate.validation = passed ? "passed" : "failed";
      return ok(delivery);
    },
    "repair-feature"() {
      delivery.repair ??= { attempts: [] };
      const passed =
        delivery.repair.attempts.length + 1 >= (faults.repairsToPass ?? 1);
      delivery.repair.attempts.push({
        state: "stopped",
        outcome: passed ? "passed" : "failed",
        findings: ["Candidate check skip-link: failure"],
        codingSession: session(),
      });
      delivery.feature.candidate.validation = passed ? "passed" : "failed";
      return ok(delivery);
    },
    "publish-feature"(args) {
      assert.equal(
        option(args, "--production-admission"),
        "/owner/production.json",
      );
      assert.equal(
        option(args, "--publication-identity"),
        "/owner/identity.json",
      );
      delivery.publication = {
        outcome: "published",
        pullRequest: { number: 125 },
        commit: head,
        branch: "aios/feature",
      };
      return ok(delivery);
    },
    "monitor-pr-checks"() {
      checkPolls++;
      delivery.prChecks = {
        runs: [
          {
            outcome: checkPolls === 1 ? "pending" : (faults.checks ?? "passed"),
            head,
            attempts: [
              {
                checkId: "e2e",
                runId: 1,
                attempt: 1,
                status: "success",
                workflow: ".github/workflows/e2e.yml@main",
              },
            ],
          },
        ],
      };
      return ok(delivery);
    },
    "monitor-review"() {
      reviewPolls++;
      // Ungated at once; the owner's approval arrives on the third look.
      const owned = reviewPolls >= (faults.ownerOnPoll ?? 3);
      delivery.phase = "ready-to-merge";
      delivery.review = {
        runs: [
          {
            outcome: faults.review ?? "approved",
            head,
            approval: owned
              ? { reviewId: 1, head, owner }
              : { kind: "ungated", head, contractSha256: "9".repeat(64) },
            gate: { gated: false, destructive: [], wideImpact: [] },
          },
        ],
      };
      if (faults.review === "blocked")
        delivery.blocker = { nextAction: "Resolve the review findings" };
      return ok(delivery);
    },
    "merge-feature"() {
      delivery.phase = "merged";
      delivery.merge = {
        attempts: [
          {
            state: "merged",
            head,
            baseRevision: "b".repeat(40),
            mergeCommit: head,
            mainRevision: head,
          },
        ],
      };
      return ok(delivery);
    },
    "reconcile-merge"() {
      return ok(delivery);
    },
    "monitor-main-checks"() {
      delivery.phase = "main-verified";
      delivery.mainChecks = {
        outcome: "passed",
        revision: head,
        runs: [{ revision: head, attempts: [] }],
      };
      return ok(delivery);
    },
    "sync-main"() {
      delivery.phase = "main-synchronized";
      delivery.mainSync = {
        attempts: [{ state: "aligned", from: "b".repeat(40), revision: head }],
      };
      return ok(delivery);
    },
    "reconcile-main-sync"() {
      return ok(delivery);
    },
    "cleanup-branches"() {
      delivery.phase = "completed";
      delivery.cleanup = {
        rounds: [
          {
            state: "completed",
            target: { revision: head },
            entries: [
              {
                state: "deleted",
                fact: { location: "remote", name: "aios/feature" },
              },
              {
                state: "retained",
                reason: "unmerged",
                fact: { location: "remote", name: "aios/signing" },
              },
            ],
          },
        ],
      };
      return ok(delivery);
    },
    "reconcile-cleanup"() {
      return ok(delivery);
    },
    status() {
      return ok(delivery);
    },
    cancel() {
      return ok(delivery);
    },
  };
  return {
    calls,
    cli: async (args) => {
      calls.push(args[0]);
      return commands[args[0]](args);
    },
  };
}

async function runPilot(t, { faults, pilotChanges, productionAdmission } = {}) {
  const remote = await signedRemote(t);
  const sim = simulatedCli(faults);
  const notices = [];
  const cleaned = [];
  let clock = 0;
  const report = await pilotDelivery(
    {
      cli: sim.cli,
      pins,
      machine: "aios-test",
      codingAdmission: "/owner/coding-admission.json",
      validationAdmission: "/owner/validation-admission.json",
      authDirectory: "/owner/auth",
      environment,
      validationBindingSha256: () => "binding",
      productionAdmission: productionAdmission ?? production(),
      identityPath: "/owner/identity.json",
      identity: identityFor(remote),
      github: factsGitHub(remote.commit),
      factoryCommit: "f".repeat(40),
      pilot: pilotFor(remote.commit, pilotChanges),
      cleanupCodingSession: async (session) => {
        cleaned.push(session.threadId);
        return { cleaned: 1 };
      },
      cloneUrl: remote.url,
    },
    {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      notify: (message) => notices.push(message),
    },
  );
  return { report, sim, notices, cleaned };
}

test("the pilot delivers through cleanup, waiting for the owner's approval of the exact head", async (t) => {
  const { report, sim, notices, cleaned } = await runPilot(t);
  assert.equal(report.outcome, passingOutcome, report.error);
  assert.deepEqual(
    report.stages.map((s) => s.name),
    stageNames,
  );
  assert.ok(report.stages.every((s) => s.outcome === "passed"));
  // The ungated head waited for the owner, who was told once.
  assert.equal(sim.calls.filter((c) => c === "monitor-review").length, 3);
  assert.equal(notices.length, 1);
  assert.match(
    notices[0],
    /Review AJHMH\/profile-page#125 and approve its head eeeeeeeeeeee/,
  );
  assert.equal(report.review.approval, "owner");
  assert.equal(report.production.level, "complete");
  assert.deepEqual(report.cleanup.deleted, ["remote:aios/feature"]);
  assert.equal(cleaned.length, 1);
  assert.equal(report.checkout, undefined);
  // The report carries no credentials: only owner text and public facts.
  assert.doesNotMatch(JSON.stringify(report), /BEGIN|PRIVATE|token|ghp_/i);
});

test("the change gate's approval is enough when the owner's isn't required", async (t) => {
  const { report, sim } = await runPilot(t, {
    pilotChanges: { requireOwnerApproval: false },
  });
  assert.equal(report.outcome, passingOutcome, report.error);
  assert.equal(sim.calls.filter((c) => c === "monitor-review").length, 1);
  assert.equal(report.review.approval, "ungated");
});

test("a failed candidate is repaired within the owner's allowance, and each repair session is cleaned", async (t) => {
  const repaired = await runPilot(t, {
    faults: { failCandidate: true, repairsToPass: 2 },
  });
  assert.equal(repaired.report.outcome, passingOutcome, repaired.report.error);
  assert.equal(repaired.report.repairs.length, 2);
  assert.equal(repaired.cleaned.length, 3);
  const spent = await runPilot(t, {
    faults: { failCandidate: true, repairsToPass: 3 },
  });
  assert.equal(spent.report.outcome, "blocked");
  assert.match(spent.report.error, /2-cycle repair allowance is spent/);
  assert.equal(spent.sim.calls.includes("publish-feature"), false);
  // A stopped pilot keeps its clone for the owner to continue.
  assert.match(spent.report.checkout, /repository$/);
});

test("a validation contract validation would refuse stops the pilot before any delivery", async (t) => {
  const contract = example().validationContract;
  const { report, sim } = await runPilot(t, {
    pilotChanges: {
      validationContract: {
        ...contract,
        // Two checks named e2e: the local one and the hosted PR check.
        checks: contract.checks.map((c) =>
          c.id === "e2e-local" ? { ...c, id: "e2e" } : c,
        ),
      },
    },
  });
  assert.equal(report.outcome, "blocked");
  assert.match(
    report.error,
    /validation contract is refused: Invalid validation check/,
  );
  assert.equal(report.stages.at(-1).name, "owner-inputs");
  assert.deepEqual(sim.calls, []);
});

test("the pilot refuses before any CLI step unless production qualifies the complete controller at these pins", async (t) => {
  for (const [admission, reason] of [
    [production("worker"), /worker level; the pilot needs complete/],
    [
      production("complete", {
        coding: { ...codingPins, policySha256: "0".repeat(64) },
      }),
      /coding admission's pins/,
    ],
    [
      production("complete", { validationBindingSha256: "other" }),
      /validation admission's binding/,
    ],
  ]) {
    const { report, sim } = await runPilot(t, {
      productionAdmission: admission,
    });
    assert.equal(report.outcome, "blocked");
    assert.match(report.error, reason);
    assert.deepEqual(sim.calls, []);
  }
});

test("failed PR checks, a blocked review or a review that never comes stop the pilot before merge", async (t) => {
  for (const [faults, reason] of [
    [{ checks: "failed" }, /PR checks are failed/],
    [{ review: "blocked" }, /Review needs action on AJHMH\/profile-page#125/],
    [{ ownerOnPoll: Infinity }, /No owner approval/],
  ]) {
    const { report, sim } = await runPilot(t, { faults });
    assert.equal(report.outcome, "blocked");
    assert.match(report.error, reason);
    assert.equal(sim.calls.includes("merge-feature"), false);
  }
});
