#!/usr/bin/env node
// The observed pilot (#275): one agreed feature on a real repository,
// delivered through the whole native path, from the owner's records, and only
// while the production admission qualifies the complete controller.
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { arch, platform, release } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  cliRunner,
  cloneSignedRepository,
  pinFields,
  privateRoot,
  sourceEvidence,
} from "./run-native-cli-delivery-acceptance.mjs";

const usage =
  "Usage: node scripts/run-native-pilot.mjs <aios-machine> <owner-coding-admission.json> <owner-validation-admission.json> <owner-auth-directory> <owner-publication-identity.json> <owner-production-admission.json> <owner-pilot.json> <new-report.json> --approve-metered-native-run";
export const pilotScope = "aios-pilot-v1";
export const passingOutcome = "observed-native-pilot-delivery";
/** GitHub Actions' App ID: only its runs can satisfy a required check. */
const actionsAppId = 15368;
const sha40 = /^[a-f0-9]{40}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
/** Every stage, in order. */
export const stageNames = Object.freeze([
  "production-admits-complete",
  "owner-records-name-fresh-pins",
  "repository-facts",
  "owner-inputs",
  "cli-start",
  "cli-plan-feature",
  "cli-validate-baseline",
  "cli-code-feature",
  "cli-validate-candidate",
  "cli-publish-feature",
  "cli-monitor-pr-checks",
  "cli-monitor-review",
  "cli-merge-feature",
  "cli-monitor-main-checks",
  "cli-sync-main",
  "cli-cleanup-branches",
  "coding-session-cleanup",
]);

const object = (value) =>
  !!value && typeof value === "object" && !Array.isArray(value);
const texts = (value, max) =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= max &&
  value.every((v) => typeof v === "string" && v.length > 0 && v.length <= 2000);
const minutes = (value, max) =>
  Number.isSafeInteger(value) && value >= 1 && value <= max;

/** The owner's private pilot record: the repository, the agreed request and
 * its criteria, the owner-signed commit onboarding verifies, the delivery's
 * limits, and the owner policy's repository rules and validation contract
 * (without its environment, which the validation record decides). */
export function readPilot(path) {
  if (!isAbsolute(path))
    throw Error("The pilot record must be an absolute path");
  const st = lstatSync(path);
  if (!st.isFile() || st.isSymbolicLink() || (st.mode & 0o077) !== 0)
    throw Error("The pilot record must be a private file");
  const r = JSON.parse(readFileSync(path, "utf8"));
  const contract = r?.validationContract;
  if (
    r?.scope !== pilotScope ||
    !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(r.repository ?? "") ||
    !sha40.test(r.signedCommit ?? "") ||
    typeof r.request !== "string" ||
    !r.request ||
    r.request.length > 2000 ||
    !texts(r.criteria, 20) ||
    !texts(r.verification, 20) ||
    !texts(r.requiredChecks, 20) ||
    !(r.excludedPaths === undefined || Array.isArray(r.excludedPaths)) ||
    !(r.libc === undefined || ["glibc", "musl"].includes(r.libc)) ||
    typeof r.database !== "boolean" ||
    typeof r.browser !== "boolean" ||
    !(
      Number.isSafeInteger(r.budgetDollars) &&
      r.budgetDollars >= 1 &&
      r.budgetDollars <= 1000
    ) ||
    !minutes(r.codingMinutes, 1440) ||
    !(
      Number.isSafeInteger(r.repairCycles) &&
      r.repairCycles >= 0 &&
      r.repairCycles <= 100
    ) ||
    !minutes(r.checksWaitMinutes, 1440) ||
    !minutes(r.reviewWaitMinutes, 10080) ||
    typeof r.requireOwnerApproval !== "boolean" ||
    !object(contract) ||
    contract.environment !== undefined ||
    !Array.isArray(contract.checks)
  )
    throw Error("Invalid owner pilot record");
  return r;
}

/** The pilot's validation contract under the validation record's
 * `environment`: prepared npm, plus the database, browser and C library the
 * pilot record declares. */
export function pilotContract(environment, pilot) {
  return {
    ...pilot.validationContract,
    environment: {
      ...environment,
      database: pilot.database,
      browser: pilot.browser,
      ...(pilot.libc ? { libc: pilot.libc } : {}),
    },
  };
}

/** The real repository's onboarding facts, read live from GitHub through the
 * owner's API. Its default branch must refuse unsigned commits, force pushes
 * and deletion, require exactly the pilot's checks from GitHub Actions, and
 * have no pull request rule, because the controller merges by fast-forwarding
 * main to the reviewed head (ADR 0005). The owner must be the only person who
 * can push, and the pilot's signed commit must be the owner's, Verified. It
 * throws naming the first fact that doesn't hold. */
export async function pilotFacts(github, identity, pilot) {
  const repo = `repos/${identity.repository}`;
  const read = async (path) => {
    const r = await github(path);
    if (r.status !== 200) throw Error(`GitHub refused ${path} (${r.status})`);
    return r.body;
  };
  const need = (condition, fact) => {
    if (!condition) throw Error(`The repository doesn't have: ${fact}`);
  };
  need(
    identity.repository === pilot.repository,
    "the pilot's repository in the publication record",
  );
  const about = await read(repo);
  need(about.full_name === identity.repository, "the record's name");
  const defaultBranch = about.default_branch;
  const rules = await read(`${repo}/rules/branches/${defaultBranch}`);
  const rule = (type) => rules.filter((r) => r.type === type);
  need(rule("required_signatures").length > 0, "required signed commits");
  need(rule("non_fast_forward").length > 0, "blocked force pushes");
  need(rule("deletion").length > 0, "blocked deletion");
  need(
    rule("pull_request").length === 0,
    "no pull request rule (the controller merges by fast-forward; its review decides)",
  );
  const statusChecks = rule("required_status_checks").flatMap(
    (r) => r.parameters?.required_status_checks ?? [],
  );
  const contexts = [...new Set(statusChecks.map((c) => c.context))].sort();
  need(
    JSON.stringify(contexts) ===
      JSON.stringify([...pilot.requiredChecks].sort()),
    `exactly the pilot's required checks (${pilot.requiredChecks.join("; ")})`,
  );
  need(
    statusChecks.every((c) => c.integration_id === actionsAppId),
    "required checks from GitHub Actions only",
  );
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
  const commit = await read(`${repo}/commits/${pilot.signedCommit}`);
  need(
    commit.sha === pilot.signedCommit &&
      commit.commit?.verification?.verified === true &&
      commit.commit.verification.reason === "valid" &&
      commit.committer?.login === identity.login,
    "the pilot's commit, Verified and signed by the owner",
  );
  return {
    repository: identity.repository,
    defaultBranch,
    appLogin: identity.botLogin,
    approver: identity.approver,
    publicationLogin: identity.login,
    signedCommit: pilot.signedCommit,
    signingKey: identity.signingKey,
    email: identity.email,
    requiredChecks: [...pilot.requiredChecks],
  };
}

/** The owner inputs: a verified clone, the owner policy and the attestation
 * of `facts`, and `criteria(id)`, which writes the pilot's criteria for the
 * started delivery. */
export function pilotOwnerInputs(
  root,
  environment,
  { facts, factoryCommit, pilot, cloneUrl },
) {
  const { repository, revision, git, owner } = cloneSignedRepository(root, {
    facts,
    ...(cloneUrl ? { cloneUrl } : {}),
  });
  const policy = {
    repository: facts.repository,
    defaultBranch: facts.defaultBranch,
    factoryCommit,
    approver: facts.approver,
    appLogin: facts.appLogin,
    publicationLogin: facts.publicationLogin,
    requiredChecks: facts.requiredChecks,
    validation: ["isolated-offline"],
    validationContract: pilotContract(environment, pilot),
    ...(pilot.excludedPaths ? { excludedPaths: pilot.excludedPaths } : {}),
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
    policySha256: createHash("sha256")
      .update(readFileSync(policyPath))
      .digest("hex"),
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
        request: pilot.request,
        criteria: pilot.criteria,
        verification: pilot.verification,
        ambiguity: null,
      });
      return criteriaPath;
    },
  };
}

const bounded = (text) => String(text).slice(0, 300);
const results = (attempt) =>
  attempt && {
    stage: attempt.stage,
    state: attempt.state,
    outcome: attempt.outcome,
    results: (attempt.results ?? []).map((r) => ({
      checkId: r.checkId,
      status: r.status,
    })),
  };
const hosted = (attempts = []) =>
  attempts.map((a) => ({
    checkId: a.checkId,
    runId: a.runId,
    attempt: a.attempt,
    status: a.status,
    workflow: a.workflow,
  }));
/** Outcomes a monitor reports while GitHub hasn't settled. */
const unsettled = ["pending", "incomplete", "unavailable"];

/** Deliver the pilot through `cli` (one CLI process per call) from the
 * owner's records, through cleanup. It refuses to start unless the
 * production admission qualifies the complete controller at exactly the
 * admission records' pins. `notify` tells the owner what to do while the run
 * waits, such as reviewing the PR. `persist` receives the report after every
 * stage. */
export async function pilotDelivery(
  {
    cli,
    pins,
    machine,
    codingAdmission,
    validationAdmission,
    authDirectory,
    environment,
    validationBindingSha256,
    productionAdmission,
    identityPath,
    identity,
    github,
    factoryCommit,
    pilot,
    cleanupCodingSession,
    cloneUrl,
  },
  options = {},
) {
  const persist = options.persist ?? (() => {});
  const notify = options.notify ?? (() => {});
  const sleep =
    options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = options.now ?? Date.now;
  const interrupted = options.interrupted ?? (() => false);
  const intervalMs = options.intervalMs ?? 30000;
  const report = {
    scope: "native-pilot-delivery",
    pilot: {
      repository: pilot.repository,
      request: pilot.request,
      criteria: pilot.criteria,
      budgetDollars: pilot.budgetDollars,
      repairCycles: pilot.repairCycles,
      requireOwnerApproval: pilot.requireOwnerApproval,
    },
    outcome: "running",
    stages: [],
  };
  const check = (condition, message) => {
    if (!condition) throw Error(message);
  };
  const origin = now(),
    elapsed = () => now() - origin;
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
  /** `look()` until `settled(answer)`, at most `waitMs`. */
  async function poll(look, settled, waitMs, late) {
    const start = now();
    for (;;) {
      const answer = await look();
      if (settled(answer)) return answer;
      check(!interrupted(), "Interrupted");
      check(now() - start < waitMs, late);
      await sleep(intervalMs);
    }
  }

  const root = await privateRoot("aios-pilot-");
  let inputs, id, last;
  const sessions = [];
  const vm = ["--podman-machine", machine];
  const validation = [...vm, "--validation-admission", validationAdmission];
  const turn = [
    ...validation,
    "--coding-admission",
    codingAdmission,
    "--auth-directory",
    authDirectory,
  ];
  const checksWaitMs = pilot.checksWaitMinutes * 60000;
  try {
    await stage("production-admits-complete", async () => {
      const admitted = productionAdmission.admitted();
      report.production = {
        level: admitted.level,
        productionSha256: admitted.productionSha256,
      };
      check(
        admitted.level === "complete",
        `The production admission is at the ${admitted.level} level; the pilot needs complete`,
      );
      check(
        pinFields.coding.every(
          (f) => admitted.coding[f] === pins.coding.admitted[f],
        ),
        "The production admission doesn't name the coding admission's pins",
      );
      check(
        admitted.validationBindingSha256 ===
          validationBindingSha256(pins.validation.admitted),
        "The production admission doesn't name the validation admission's binding",
      );
    });
    await stage("owner-records-name-fresh-pins", async () => {
      report.freshPins = {
        coding: await pins.coding.fresh(),
        validation: await pins.validation.fresh(),
      };
      for (const kind of ["coding", "validation"])
        check(
          pinFields[kind].every(
            (f) => pins[kind].admitted[f] === report.freshPins[kind][f],
          ),
          `The owner ${kind} admission does not name the fresh pins`,
        );
    });
    const facts = await stage("repository-facts", async () => {
      const found = await pilotFacts(github, identity, pilot);
      report.repository = {
        name: found.repository,
        defaultBranch: found.defaultBranch,
        signedCommit: found.signedCommit,
      };
      return found;
    });
    inputs = await stage("owner-inputs", () =>
      pilotOwnerInputs(root, environment, {
        facts,
        factoryCommit,
        pilot,
        ...(cloneUrl ? { cloneUrl } : {}),
      }),
    );
    report.repository.baseRevision = inputs.revision;
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
        pilot.request,
        ...owner,
        "--coding-minutes",
        String(pilot.codingMinutes),
        "--budget-dollars",
        String(pilot.budgetDollars),
        ...(pilot.repairCycles > 0
          ? ["--repair-cycles", String(pilot.repairCycles)]
          : []),
      );
      check(uuid.test(started.id ?? ""), "The CLI started no delivery");
      check(
        started.onboarding?.ready === true,
        `Onboarding is not ready: ${bounded(JSON.stringify(started.onboarding?.missing ?? started.blocker ?? ""))}`,
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
        planned.feature?.outcome === "planned",
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
      report.baseline = results(attempt);
      check(
        attempt?.stage === "baseline" && attempt.outcome === "passed",
        "The baseline did not pass: main must pass the contract before any change",
      );
      return validated;
    });
    last = await stage("cli-code-feature", async () => {
      const coded = await run(
        "code-feature",
        "--id",
        id,
        ...owner,
        ...turn,
        "--coding-minutes",
        String(pilot.codingMinutes),
      );
      const feature = coded.feature,
        session = feature?.session;
      if (session) sessions.push(session);
      report.coding = {
        outcome: feature?.outcome ?? null,
        provider: session?.provider ?? null,
        state: session?.state ?? null,
        branch: feature?.branch ?? null,
        blocker: coded.blocker?.code ?? null,
      };
      report.spend = coded.spend && {
        budget: coded.spend.budget,
        spent: coded.spend.spent,
        charges: coded.spend.charges,
      };
      check(
        session?.state === "stopped",
        "The coding session was not stopped exactly",
      );
      check(
        !coded.spend?.interruption,
        "The spend budget interrupted the turn: extend it, then run the pilot again",
      );
      check(
        feature?.outcome === "admitted" && feature.candidate,
        `The turn admitted no candidate: ${bounded(coded.blocker?.nextAction ?? "")}`,
      );
      return coded;
    });
    last = await stage("cli-validate-candidate", async () => {
      let validated = await run(
        "validate-candidate",
        "--id",
        id,
        ...owner,
        ...validation,
      );
      report.candidate = results(validated.validation?.attempts.at(-1));
      report.repairs = [];
      // A failed candidate is repaired within the owner's allowance; each
      // repair turn revalidates.
      while (validated.feature?.candidate?.validation !== "passed") {
        check(
          report.repairs.length < pilot.repairCycles,
          `The candidate did not pass, and the ${pilot.repairCycles}-cycle repair allowance is spent`,
        );
        validated = await run("repair-feature", "--id", id, ...owner, ...turn);
        const attempt = validated.repair?.attempts.at(-1);
        if (attempt?.codingSession) sessions.push(attempt.codingSession);
        report.repairs.push({
          outcome: attempt?.outcome ?? null,
          findings: (attempt?.findings ?? []).map(bounded),
          revalidation: results(validated.validation?.attempts.at(-1)),
        });
        report.spend = validated.spend && {
          budget: validated.spend.budget,
          spent: validated.spend.spent,
          charges: validated.spend.charges,
        };
        check(
          !validated.spend?.interruption,
          "The spend budget interrupted the repair: extend it, then run the pilot again",
        );
        check(
          attempt?.state === "stopped",
          `The repair stopped the delivery: ${bounded(validated.blocker?.nextAction ?? "")}`,
        );
      }
      return validated;
    });
    const publishing = [
      ...owner,
      ...validation,
      "--production-admission",
      productionAdmission.path,
    ];
    last = await stage("cli-publish-feature", async () => {
      const published = await run(
        "publish-feature",
        "--id",
        id,
        ...publishing,
        "--publication-identity",
        identityPath,
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
          sha40.test(p.commit ?? ""),
        "The delivery was not published",
      );
      return published;
    });
    const pr = `${pilot.repository}#${report.publication.number}`;
    last = await stage("cli-monitor-pr-checks", async () => {
      const watched = await poll(
        () => run("monitor-pr-checks", "--id", id, ...owner, ...validation),
        (w) => !unsettled.includes(w.prChecks?.runs.at(-1)?.outcome),
        checksWaitMs,
        "The PR checks didn't finish in time",
      );
      const r = watched.prChecks?.runs.at(-1);
      report.prChecks = r && {
        outcome: r.outcome,
        head: r.head,
        attempts: hosted(r.attempts),
      };
      check(
        r?.outcome === "passed" && r.head === report.publication.commit,
        `The PR checks are ${r?.outcome ?? "missing"} on ${pr}`,
      );
      return watched;
    });
    last = await stage("cli-monitor-review", async () => {
      let told = false;
      const approved = (reviewed) => {
        const a = reviewed.review?.runs.at(-1)?.approval;
        return (
          reviewed.phase === "ready-to-merge" &&
          a?.head === report.publication.commit &&
          (!pilot.requireOwnerApproval || a.kind !== "ungated")
        );
      };
      const reviewed = await poll(
        async () => {
          const r = await run(
            "monitor-review",
            "--id",
            id,
            ...owner,
            ...validation,
          );
          const outcome = r.review?.runs.at(-1)?.outcome;
          check(
            !["blocked", "repairing"].includes(outcome),
            `Review needs action on ${pr}: ${bounded(r.blocker?.nextAction ?? outcome)}`,
          );
          if (!approved(r) && !told) {
            told = true;
            notify(
              `Review ${pr} and approve its head ${report.publication.commit.slice(0, 12)} on GitHub; the pilot waits up to ${pilot.reviewWaitMinutes} minutes.`,
            );
          }
          return r;
        },
        approved,
        pilot.reviewWaitMinutes * 60000,
        `No owner approval of ${pr}'s head in time`,
      );
      const r = reviewed.review.runs.at(-1);
      report.review = {
        approval: r.approval.kind === "ungated" ? "ungated" : "owner",
        head: r.approval.head,
        gate: r.gate
          ? {
              gated: r.gate.gated,
              reasons: [...r.gate.destructive, ...r.gate.wideImpact],
            }
          : null,
      };
      return reviewed;
    });
    last = await stage("cli-merge-feature", async () => {
      const merged = await run("merge-feature", "--id", id, ...publishing);
      const a = merged.merge?.attempts.at(-1);
      report.merge = a && {
        state: a.state,
        head: a.head,
        baseRevision: a.baseRevision,
        mergeCommit: a.mergeCommit ?? null,
        mainRevision: a.mainRevision ?? null,
      };
      check(
        merged.phase === "merged" &&
          a?.state === "merged" &&
          a.mergeCommit === report.publication.commit,
        `Merge left the delivery ${merged.phase}: ${bounded(merged.blocker?.nextAction ?? "")}`,
      );
      const again = await run("reconcile-merge", "--id", id, ...owner);
      check(
        again.phase === "merged" && again.merge?.attempts.length === 1,
        "Reconciling didn't find the same single merge",
      );
      return again;
    });
    last = await stage("cli-monitor-main-checks", async () => {
      const watched = await poll(
        () => run("monitor-main-checks", "--id", id, ...owner),
        (w) => !unsettled.includes(w.mainChecks?.outcome),
        checksWaitMs,
        "The main checks didn't finish in time",
      );
      const m = watched.mainChecks;
      const r = m?.runs.find((x) => x.revision === m.revision);
      report.mainChecks = m && {
        outcome: m.outcome,
        revision: m.revision ?? null,
        attempts: hosted(r?.attempts),
      };
      check(
        watched.phase === "main-verified" && m?.outcome === "passed",
        `Main verification is ${m?.outcome ?? "missing"}: ${bounded(watched.blocker?.nextAction ?? "")}`,
      );
      return watched;
    });
    last = await stage("cli-sync-main", async () => {
      const synced = await run("sync-main", "--id", id, ...owner);
      const a = synced.mainSync?.attempts.at(-1);
      report.mainSync = a && {
        state: a.state,
        from: a.from,
        revision: a.revision,
      };
      check(
        synced.phase === "main-synchronized" &&
          a?.state === "aligned" &&
          a.revision === report.mainChecks.revision,
        `Sync left the delivery ${synced.phase}: ${bounded(synced.blocker?.nextAction ?? "")}`,
      );
      const again = await run("reconcile-main-sync", "--id", id, ...owner);
      check(
        again.phase === "main-synchronized",
        "Reconciling didn't find the same aligned sync",
      );
      return again;
    });
    last = await stage("cli-cleanup-branches", async () => {
      const done = await run("cleanup-branches", "--id", id, ...owner);
      const round = done.cleanup?.rounds.at(-1);
      const named = (e) => `${e.fact.location}:${e.fact.name}`;
      const entries = round?.entries ?? [];
      report.cleanup = round && {
        state: round.state,
        revision: round.target.revision,
        deleted: entries
          .filter((e) => e.state === "deleted")
          .map(named)
          .sort(),
        retained: entries
          .filter((e) => e.state === "retained")
          .map((e) => ({ branch: named(e), reason: e.reason }))
          .sort((a, b) => a.branch.localeCompare(b.branch)),
      };
      check(
        done.phase === "completed" && round?.state === "completed",
        `Cleanup left the delivery ${done.phase}: ${bounded(done.blocker?.nextAction ?? "")}`,
      );
      const again = await run("reconcile-cleanup", "--id", id, ...owner);
      check(
        again.phase === "completed",
        "Reconciling didn't find the same completed cleanup",
      );
      return again;
    });
    await stage("coding-session-cleanup", async () => {
      for (const session of sessions) {
        const receipt = await cleanupCodingSession(session);
        check(receipt.cleaned === 1, "Expected one cleaned session");
      }
    });
    report.outcome = passingOutcome;
  } catch (error) {
    report.error = bounded(error?.message);
    report.outcome = "blocked";
  } finally {
    // An unsettled session or attempt is stopped by its exact identity.
    if (id)
      try {
        const open = (d) =>
          (d.feature?.session && d.feature.session.state !== "stopped") ||
          d.validation?.attempts.some((a) => a.state !== "stopped") ||
          d.repair?.attempts.some((a) => a.state !== "stopped");
        if (open(await run("status", "--id", id)))
          await stage("final-exact-stop", async () => {
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
            check(
              !open(await run("status", "--id", id)),
              "Exact stop is uncertain",
            );
          });
      } catch {
        report.outcome = "uncertain";
      }
    // A pilot that stops keeps its clone, which the delivery's state names,
    // so the owner can continue it with the CLI.
    if (report.outcome === passingOutcome)
      rmSync(root, { recursive: true, force: true });
    else report.checkout = inputs?.repository ?? null;
    persist(report);
  }
  return report;
}

async function main() {
  const [
    machine,
    codingAdmission,
    validationAdmission,
    authDirectory,
    identityPath,
    productionPath,
    pilotPath,
    reportPath,
    approval,
    ...extra
  ] = process.argv.slice(2);
  if (
    !/^aios-[a-z0-9-]+$/.test(machine ?? "") ||
    !codingAdmission ||
    !validationAdmission ||
    !authDirectory ||
    !identityPath ||
    !productionPath ||
    !pilotPath ||
    !reportPath ||
    approval !== "--approve-metered-native-run" ||
    extra.length
  ) {
    console.error(usage);
    process.exitCode = 1;
    return;
  }
  // The build must be what this source compiles to, before anything from it
  // runs or any record, repository or VM is touched.
  const source = sourceEvidence(fileURLToPath(new URL("..", import.meta.url)));
  const pilot = readPilot(pilotPath);
  const {
    ownerValidationAdmission,
    preparedNpmValidationEnvironment,
    validationBindingSha256,
  } = await import("../dist/native-validation.js");
  const { ownerCodingWorker } = await import(
    "../dist/native-coding-runtime.js"
  );
  const codingTransport = () => {
    const worker = ownerCodingWorker(machine, codingAdmission);
    if (worker.agent !== "claude")
      throw Error("The coding admission is not the owner's Claude Code record");
    return worker;
  };
  const codingPins = codingTransport().admission.pins();
  const validationPins = ownerValidationAdmission(validationAdmission).pins();
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
  const { readPublicationIdentity } = await import(
    "../dist/publication-identity.js"
  );
  const { ownerProductionAdmission } = await import(
    "../dist/production-admission.js"
  );
  const { ghApi, signingKeyLoaded } = await import(
    "../dist/native-publication.js"
  );
  const identity = readPublicationIdentity(identityPath);
  const productionAdmission = ownerProductionAdmission(productionPath);
  productionAdmission.admitted();
  // Publication signs through ssh-agent: a key that isn't loaded would stop
  // the pilot at publish-feature, after the model spend.
  if (!signingKeyLoaded(identity.signingKey))
    throw Error(
      `The signing key isn't loaded in ssh-agent. Add it with ssh-add --apple-use-keychain ${identity.signingKey.replace(/\.pub$/, "")}, then run again. Nothing was spent.`,
    );
  // Refuse overwriting retained evidence before any worker effect.
  closeSync(openSync(reportPath, "wx", 0o600));
  // The delivery's state outlives the run, so a stopped pilot can continue.
  const state = await privateRoot(
    "aios-pilot-state-",
    join(process.env.HOME, ".developer-os"),
  );
  const context = {
    host: { platform: platform(), arch: arch(), release: release(), machine },
    imageSha256,
    ...source,
  };
  let interrupted = false;
  const interrupt = () => (interrupted = true);
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  const report = await pilotDelivery(
    {
      cli: cliRunner(state),
      pins,
      machine,
      codingAdmission,
      validationAdmission,
      authDirectory,
      environment: preparedNpmValidationEnvironment(imageSha256),
      validationBindingSha256,
      productionAdmission,
      identityPath,
      identity,
      github: ghApi(),
      factoryCommit: source.sourceRevision,
      pilot,
      cleanupCodingSession: (session) =>
        codingTransport().transport.cleanupSupersededLineage(session),
    },
    {
      interrupted: () => interrupted,
      notify: (message) => console.error(message),
      persist: (r) =>
        writeFileSync(
          reportPath,
          JSON.stringify({ ...context, ...r, state, interrupted }, null, 2),
        ),
    },
  );
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);
  const passed = report.outcome === passingOutcome;
  console.log(
    JSON.stringify({
      outcome: report.outcome,
      reportPath,
      state,
      ...(report.publication?.number
        ? { pullRequest: report.publication.number }
        : {}),
      ...(passed ? {} : { error: report.error ?? null }),
    }),
  );
  if (!passed) process.exitCode = 1;
}

// Compare real paths, so a symlinked checkout still runs.
const invoked = process.argv[1] && realpathSync(process.argv[1]);
if (invoked && import.meta.url === pathToFileURL(invoked).href)
  main().catch((error) => {
    console.error(String(error?.message).slice(0, 300));
    process.exitCode = 1;
  });
