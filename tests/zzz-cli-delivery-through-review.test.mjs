import "./helpers/owner-host-stand-in.mjs";
// The first real delivery (--through-review): the owner-run CLI delivery
// acceptance on a clone of the owner's publication repository, with its facts
// read live from GitHub, through publication, PR checks and review. GitHub is
// a stand-in and the repository a local one, with a commit signed by a
// throwaway key; the VM steps are simulated.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { offlineValidationEnvironment } from "../dist/native-validation.js";
import {
  budgetDollars,
  cliDeliveryAcceptance,
  cliRunner,
  ownerInputs,
  privateRoot,
  prChecksIntervalMs,
  realContract,
  repositoryFacts,
  request,
  reviewPassingOutcome,
  reviewStageNames,
} from "../scripts/run-native-cli-delivery-acceptance.mjs";

const imageSha256 = "a".repeat(64);
const codingPins = {
  cliVersion: "2.1.311",
  cliSha256: "1".repeat(64),
  policySha256: "3".repeat(64),
  bindingSha256: "4".repeat(64),
};
const validationPins = {
  imageSha256,
  policySha256: "5".repeat(64),
  bindingSha256: "6".repeat(64),
};
const repository = "AJHMH/acceptance";
const owner = "aaron-howard";
const bot = "ajhmh-software-factory[bot]";
const productionSha256 = "7".repeat(64);
const option = (args, name) => args[args.indexOf(name) + 1];

/** A local repository standing in for GitHub's: `index.html` on `main`, in a
 * commit signed by a throwaway SSH key. */
async function signedRemote(t) {
  const root = await privateRoot("aios-through-review-remote-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sh = (cmd, args, cwd = root) => {
    const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  sh("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "t", "-f", "key"]);
  sh("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "t", "-f", "other"]);
  sh("git", ["init", "-q", "-b", "main", "work"]);
  writeFileSync(join(root, "work", "index.html"), "<h1>Contact</h1>\n");
  const work = join(root, "work");
  sh("git", ["add", "index.html"], work);
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
    url: join(root, "remote.git"),
    commit,
    key: join(root, "key.pub"),
    otherKey: join(root, "other.pub"),
  };
}
const factsFor = (remote, changes = {}) => ({
  repository,
  defaultBranch: "main",
  appLogin: bot,
  approver: owner,
  publicationLogin: owner,
  signedCommit: remote.commit,
  signingKey: remote.key,
  email: "owner@example.invalid",
  requiredChecks: ["pr-ci"],
  pullRequest: 8,
  ...changes,
});

/** GitHub's answers for the repository's facts; `changes` replaces some. */
function factsGitHub(remote, changes = {}) {
  const r = `repos/${repository}`;
  const answers = {
    [r]: { full_name: repository, default_branch: "main" },
    [`${r}/rules/branches/main`]: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      { type: "required_signatures" },
      {
        type: "required_status_checks",
        parameters: {
          required_status_checks: [{ context: "pr-ci", integration_id: 15368 }],
        },
      },
    ],
    [`${r}/collaborators?affiliation=all&permission=push&per_page=100`]: [
      { login: owner, type: "User" },
    ],
    [`${r}/collaborators/${owner}/permission`]: {
      permission: "admin",
      role_name: "admin",
    },
    [`${r}/pulls?state=all&per_page=20`]: [
      { number: 9, user: { login: "someone" }, head: { sha: "9".repeat(40) } },
      { number: 8, user: { login: bot }, head: { sha: remote.commit } },
    ],
    [`${r}/commits/${remote.commit}`]: {
      committer: { login: owner },
      commit: { verification: { verified: true, reason: "valid" } },
    },
    ...changes,
  };
  return async (path) =>
    path in answers && answers[path] !== null
      ? { status: 200, body: answers[path] }
      : { status: 404, body: null };
}
const identity = {
  repository,
  login: owner,
  approver: owner,
  botLogin: bot,
  email: "owner@example.invalid",
};

test("the repository's facts are read live, and a missing rule or identity names itself", async (t) => {
  const remote = await signedRemote(t);
  const found = await repositoryFacts(factsGitHub(remote), {
    ...identity,
    signingKey: remote.key,
  });
  assert.deepEqual(found, factsFor(remote));
  const rules = `repos/${repository}/rules/branches/main`;
  for (const [changes, missing] of [
    [{ [rules]: [] }, /required signed commits/],
    [{ [rules]: [{ type: "required_signatures" }] }, /blocked force pushes/],
    [
      {
        [rules]: [
          { type: "required_signatures" },
          { type: "non_fast_forward" },
        ],
      },
      /blocked deletion/,
    ],
    [
      {
        [rules]: [
          { type: "required_signatures" },
          { type: "non_fast_forward" },
          { type: "deletion" },
        ],
      },
      /required pr-ci/,
    ],
    [
      {
        [rules]: [
          { type: "required_signatures" },
          { type: "non_fast_forward" },
          { type: "deletion" },
          {
            type: "required_status_checks",
            parameters: {
              required_status_checks: [{ context: "pr-ci", integration_id: 1 }],
            },
          },
        ],
      },
      /from GitHub Actions/,
    ],
    [
      {
        [rules]: [
          { type: "required_signatures" },
          { type: "non_fast_forward" },
          { type: "deletion" },
          {
            type: "required_status_checks",
            parameters: {
              required_status_checks: [
                { context: "pr-ci", integration_id: 15368 },
              ],
            },
          },
          {
            type: "pull_request",
            parameters: { required_approving_review_count: 1 },
          },
        ],
      },
      /no required review count/,
    ],
    [
      {
        [`repos/${repository}/collaborators?affiliation=all&permission=push&per_page=100`]:
          [
            { login: owner, type: "User" },
            { login: "other", type: "User" },
          ],
      },
      /only person who can push/,
    ],
    [
      {
        [`repos/${repository}/collaborators/${owner}/permission`]: {
          permission: "read",
          role_name: "read",
        },
      },
      /push access/,
    ],
    [
      { [`repos/${repository}/pulls?state=all&per_page=20`]: [] },
      /a PR the App opened/,
    ],
    [
      {
        [`repos/${repository}/commits/${remote.commit}`]: {
          committer: { login: "web-flow" },
          commit: { verification: { verified: true, reason: "valid" } },
        },
      },
      /Verified commit signed by the owner/,
    ],
    [
      {
        [`repos/${repository}`]: {
          full_name: "AJHMH/other",
          default_branch: "main",
        },
      },
      /record's name/,
    ],
    [{ [`repos/${repository}`]: null }, /GitHub refused/],
  ])
    await assert.rejects(
      repositoryFacts(factsGitHub(remote, changes), identity),
      missing,
    );
});

test("the real owner inputs clone the repository, verify the owner's signature, and start a delivery ready from real facts", async (t) => {
  const remote = await signedRemote(t);
  const root = await privateRoot("aios-through-review-owner-");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const environment = offlineValidationEnvironment(imageSha256);
  // Another key never verifies the owner's commit.
  const bad = await privateRoot("aios-through-review-bad-");
  t.after(() => rmSync(bad, { recursive: true, force: true }));
  assert.throws(
    () =>
      ownerInputs(bad, environment, {
        real: {
          facts: factsFor(remote, { signingKey: remote.otherKey }),
          factoryCommit: "f".repeat(40),
          cloneUrl: remote.url,
        },
      }),
    /doesn't verify against the owner's key/,
  );
  const inputs = ownerInputs(root, environment, {
    real: {
      facts: factsFor(remote),
      factoryCommit: "f".repeat(40),
      cloneUrl: remote.url,
    },
  });
  assert.equal(inputs.revision, remote.commit);
  // On the owner's Mac the clone's origin is GitHub's URL.
  inputs.git(
    "remote",
    "set-url",
    "origin",
    `https://github.com/${repository}.git`,
  );
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
    request,
    "--owner-policy",
    inputs.policyPath,
    "--onboarding-attestation",
    inputs.attestationPath,
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
  // The contract's hosted checks are the GitHub Actions workflow's.
  const hosted = realContract(environment).checks.filter(
    (c) => c.scope !== "local",
  );
  assert.deepEqual(
    hosted.map((c) => [c.id, c.scope, c.publisher, c.workflow]),
    [
      ["pr-ci", "pr", "github-actions", ".github/workflows/ci.yml@main"],
      ["main-ci", "main", "github-actions", ".github/workflows/ci.yml@main"],
    ],
  );
});

/** A CLI whose VM and GitHub steps are simulated through review. */
function simulatedCli(faults = {}) {
  const calls = [];
  let delivery, repo;
  const head = "e".repeat(40);
  const ok = (value) => ({
    status: 0,
    stdout: JSON.stringify(value),
    stderr: "",
  });
  let polls = 0;
  const commands = {
    start(args) {
      repo = option(args, "--repo");
      delivery = {
        id: randomUUID(),
        phase: "blocked",
        onboarding: { ready: true, attestation: { source: "owner-attested" } },
        blocker: { code: "DELIVERY_NOT_ENABLED" },
      };
      return ok(delivery);
    },
    "plan-feature"() {
      delivery.feature = { outcome: "planned", criteria: ["c"] };
      return ok(delivery);
    },
    "validate-baseline"() {
      delivery.validation = {
        attempts: [
          {
            stage: "baseline",
            state: "stopped",
            outcome: "passed",
            bindingSha256: "b".repeat(64),
            results: [],
          },
        ],
      };
      return ok(delivery);
    },
    "code-feature"() {
      const branch = `aios/feature-${delivery.id}`;
      spawnSync("git", ["-C", repo, "branch", branch, "main"]);
      Object.assign(delivery.feature, {
        outcome: "admitted",
        branch,
        candidate: { validation: "not-run" },
        session: {
          state: "stopped",
          provider: "claude",
          threadStarted: true,
          threadId: randomUUID(),
          route: {
            deliveryId: delivery.id,
            decisionSha256: createHash("sha256")
              .update("aios-spend-budget-route-v1:" + delivery.id)
              .digest("hex"),
          },
        },
      });
      delivery.spend = {
        model: "claude-opus-5-5",
        budget: budgetDollars * 1e12,
        spent: 1e8,
        charges: 2,
      };
      return ok(delivery);
    },
    "validate-candidate"() {
      delivery.validation.attempts.push({
        stage: "candidate",
        state: "stopped",
        outcome: "passed",
        results: [],
      });
      delivery.feature.candidate.validation = "passed";
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
        outcome: faults.publication ?? "published",
        pullRequest: { number: 9 },
        commit: head,
        branch: delivery.feature.branch,
        productionSha256: faults.productionSha256 ?? productionSha256,
      };
      return ok(delivery);
    },
    "monitor-pr-checks"() {
      polls++;
      delivery.prChecks = {
        runs: [
          {
            // Not started, then running, then done.
            outcome:
              polls === 1
                ? "incomplete"
                : polls === 2
                  ? "pending"
                  : polls === 3
                    ? "unavailable"
                    : (faults.checks ?? "passed"),
            head,
            polls,
            attempts: [
              {
                checkId: "pr-ci",
                runId: 1,
                attempt: 1,
                status: "success",
                publisher: "github-actions",
                workflow: ".github/workflows/ci.yml@main",
              },
            ],
          },
        ],
      };
      return ok(delivery);
    },
    "monitor-review"() {
      const approved = !faults.review;
      delivery.phase = approved ? "ready-to-merge" : "waiting-review";
      delivery.blocker = {
        nextAction: approved ? "merge" : "Wait for approval",
      };
      delivery.review = {
        runs: [
          {
            outcome: approved ? "approved" : "waiting",
            head,
            ...(approved
              ? {
                  approval: {
                    kind: "ungated",
                    head,
                    contractSha256: "0".repeat(64),
                  },
                }
              : {}),
            gate: {
              gated: !approved,
              destructive: [],
              wideImpact: approved ? [] : ["touches .github"],
            },
          },
        ],
      };
      return ok(delivery);
    },
    status() {
      return ok(delivery);
    },
  };
  return {
    calls,
    cli: async (args) => {
      calls.push(args);
      return commands[args[0]](args);
    },
  };
}

test("the real delivery publishes, waits for its GitHub Actions check, and stops ready to merge", async (t) => {
  const remote = await signedRemote(t);
  const production = (pins = codingPins) => ({
    path: "/owner/production.json",
    admitted: () => ({
      coding: pins,
      validationBindingSha256: "6".repeat(64),
      productionSha256,
    }),
  });
  const host = (sim, changes = {}) => ({
    cli: sim.cli,
    pins: {
      coding: { admitted: codingPins, fresh: async () => codingPins },
      validation: {
        admitted: validationPins,
        fresh: async () => validationPins,
      },
    },
    machine: "aios-test",
    codingAdmission: "/owner/coding-admission.json",
    validationAdmission: "/owner/validation-admission.json",
    authDirectory: "/owner/auth",
    imageSha256,
    cleanupCodingSession: async () => ({ cleaned: 1 }),
    through: {
      identityPath: "/owner/identity.json",
      identity: { ...identity, signingKey: remote.key },
      productionAdmission: production(),
      github: factsGitHub(remote),
      factoryCommit: "f".repeat(40),
      cloneUrl: remote.url,
      ...changes,
    },
  });
  const slept = [];
  const options = { sleep: async (ms) => slept.push(ms), now: () => 0 };
  const sim = simulatedCli();
  const report = await cliDeliveryAcceptance(host(sim), options);
  assert.equal(report.outcome, reviewPassingOutcome, report.error);
  assert.deepEqual(
    report.stages.map((s) => [s.name, s.outcome]),
    reviewStageNames.map((name) => [name, "passed"]),
  );
  assert.equal(report.scope, "native-delivery-through-review");
  assert.deepEqual(report.synthetic, ["criteria"]);
  assert.equal(report.repository.baseRevision, remote.commit);
  assert.equal(report.publication.number, 9);
  assert.equal(report.prChecks.outcome, "passed");
  assert.equal(report.review.approval.kind, "ungated");
  assert.equal(report.review.phase, "ready-to-merge");
  assert.deepEqual(slept, [
    prChecksIntervalMs,
    prChecksIntervalMs,
    prChecksIntervalMs,
  ]);
  assert.deepEqual(
    sim.calls.map((a) => a[0]),
    [
      "start",
      "plan-feature",
      "validate-baseline",
      "code-feature",
      "validate-candidate",
      "publish-feature",
      "monitor-pr-checks",
      "monitor-pr-checks",
      "monitor-pr-checks",
      "monitor-pr-checks",
      "monitor-review",
      "status",
    ],
  );
  // The PR steps re-check the publication's validation, so they name the
  // validation runtime with the owner policy: without it a native delivery's
  // monitor always refused (the first real run, 12 November).
  for (const args of sim.calls.filter((a) => a[0].startsWith("monitor-"))) {
    assert.deepEqual(
      args.slice(3).filter((a) => a.startsWith("--")),
      [
        "--owner-policy",
        "--onboarding-attestation",
        "--podman-machine",
        "--validation-admission",
      ],
    );
    assert.equal(
      option(args, "--validation-admission"),
      "/owner/validation-admission.json",
    );
  }

  // A production record for other pins stops it before any CLI step.
  const early = simulatedCli();
  const refused = await cliDeliveryAcceptance(
    host(early, {
      productionAdmission: production({ ...codingPins, cliVersion: "9.9.9" }),
    }),
    options,
  );
  assert.equal(refused.outcome, "blocked");
  assert.equal(refused.stages.at(-1).name, "repository-facts");
  assert.deepEqual(early.calls, []);
  // Failing checks, a gated head waiting for review, a publication that
  // didn't land or records another admission: each blocks where it happens.
  for (const [faults, stage] of [
    [{ checks: "failed" }, "cli-monitor-pr-checks"],
    [{ review: true }, "cli-monitor-review"],
    [{ publication: "uncertain" }, "cli-publish-feature"],
    [{ productionSha256: "8".repeat(64) }, "cli-publish-feature"],
  ]) {
    const r = await cliDeliveryAcceptance(host(simulatedCli(faults)), options);
    assert.equal(r.outcome, "blocked", stage);
    assert.equal(r.stages.at(-1).name, stage, r.error);
  }
  // Checks that never finish time out.
  let clock = 0;
  const pending = simulatedCli({ checks: "pending" });
  const timed = await cliDeliveryAcceptance(host(pending), {
    sleep: async () => {},
    now: () => (clock += 60000),
  });
  assert.match(timed.error, /in time/);
});
