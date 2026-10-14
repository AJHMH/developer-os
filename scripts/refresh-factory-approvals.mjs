import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const repository = "AJHMH/developer-os";
const factoryRevision = "cc5913bfe31a386d8105f84a7f42556548fe353c";
// Immutable blob from the independently approved Factory policy at that revision.
const policyBlob = "164c8371ce4239120a554203bed3448877fe1684";
const jobNames = [
  "validation / Enforce Factory human approval",
  "validation / Enforce Factory trusted human approval",
];
const numericId = (value) =>
  Number.isSafeInteger(Number(value)) && /^[1-9][0-9]*$/.test(String(value));
const revision = (value) => /^[a-f0-9]{40}$/.test(value ?? "");
function requireEvidence(condition) {
  if (!condition) throw Error("Unavailable refresh authority");
}
function git(...args) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    timeout: 10000,
    maxBuffer: 65536,
  });
  requireEvidence(result.status === 0);
  return result.stdout;
}
function time(value) {
  const parsed = Date.parse(value);
  requireEvidence(Number.isFinite(parsed) && parsed <= Date.now() + 60000);
  return parsed;
}
function blob(text) {
  return createHash("sha1")
    .update(`blob ${Buffer.byteLength(text)}\0`)
    .update(text)
    .digest("hex");
}
function fileContent(value) {
  requireEvidence(
    value?.type === "file" &&
      value.encoding === "base64" &&
      value.size <= 65536 &&
      typeof value.content === "string" &&
      value.content.length <= 90000,
  );
  const text = Buffer.from(value.content, "base64").toString("utf8");
  requireEvidence(
    Buffer.byteLength(text) === value.size && blob(text) === value.sha,
  );
  return text;
}
async function api(path, method = "GET") {
  requireEvidence(Boolean(process.env.FACTORY_GITHUB_TOKEN));
  const response = await fetch(`https://api.github.com/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.FACTORY_GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10",
    },
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (method === "POST") {
    requireEvidence(response.status === 201);
    return;
  }
  requireEvidence(response.ok);
  const reader = response.body.getReader(),
    chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      requireEvidence(length <= 8 * 1024 * 1024);
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function checkRun(run, workflow, expected, event, title) {
  requireEvidence(
    numericId(run.id) &&
      numericId(workflow.id) &&
      run.workflow_id === workflow.id &&
      run.path === workflow.path &&
      workflow.state === "active" &&
      run.event === event &&
      run.head_sha === expected.head &&
      run.head_branch === expected.branch &&
      run.repository?.full_name === repository &&
      run.display_title === title,
  );
  time(run.created_at);
}
function checkPr(pr, expected) {
  requireEvidence(
    pr.number === expected.pull &&
      pr.state === "open" &&
      pr.base?.ref === "main" &&
      pr.base.sha === expected.base &&
      pr.head?.sha === expected.head &&
      pr.head.ref === expected.branch &&
      pr.head.repo?.full_name === repository &&
      pr.base.repo?.full_name === repository,
  );
}
async function reviewDigest(prefix) {
  const normalized = [];
  for (let page = 1; page <= 10; page++) {
    const entries = await api(`${prefix}/reviews?per_page=100&page=${page}`);
    requireEvidence(Array.isArray(entries));
    for (const review of entries) {
      requireEvidence(
        numericId(review.id) &&
          typeof review.user?.login === "string" &&
          [
            "APPROVED",
            "CHANGES_REQUESTED",
            "DISMISSED",
            "COMMENTED",
            "PENDING",
          ].includes(review.state),
      );
      normalized.push([
        review.id,
        review.user.login,
        review.user.type,
        review.state,
        review.commit_id,
        review.submitted_at,
      ]);
    }
    if (entries.length < 100)
      return createHash("sha256")
        .update(JSON.stringify(normalized))
        .digest("hex");
  }
  throw Error("Review history exceeds bound");
}

/** Public command: request fresh evaluations, never supply an approval verdict. */
async function refresh(options) {
  const requests = [];
  try {
    requireEvidence(
      options["--repository"] === repository &&
        revision(options["--trusted-revision"]) &&
        numericId(options["--trigger-run"]) &&
        ["inspect", "apply"].includes(options["--mode"]) &&
        options["--approved-factory-revision"] === factoryRevision,
    );
    const base = options["--trusted-revision"];
    requireEvidence(git("rev-parse", "HEAD").trim() === base);
    const lock = git("show", `${base}:factory.lock.yaml`);
    requireEvidence(
      lock.includes(
        `repository: AJHMH/software-factory\n  revision: ${factoryRevision}\n`,
      ),
    );
    const adoption = git(
      "show",
      `${base}:.github/workflows/factory-adoption.yml`,
    );
    requireEvidence(
      adoption.includes("run-name: factory-consumer-review:") &&
        adoption.includes(
          `uses: AJHMH/software-factory/.github/workflows/factory-consumer-validation.yml@${factoryRevision}`,
        ),
    );
    const policy = await api(
      `repos/AJHMH/software-factory/contents/policies/human-review.yaml?ref=${factoryRevision}`,
    );
    requireEvidence(policy.sha === policyBlob);
    const policyText = fileContent(policy),
      match = /^  human_approvers: (\[[^\n]+\])$/m.exec(policyText);
    requireEvidence(Boolean(match));
    const owners = JSON.parse(match[1]);
    requireEvidence(
      Array.isArray(owners) &&
        owners.length > 0 &&
        owners.every((owner) => /^[A-Za-z0-9-]{1,39}$/.test(owner)),
    );
    const prefix = `repos/${repository}`,
      trigger = await api(`${prefix}/actions/runs/${options["--trigger-run"]}`);
    const tuple =
      /^factory-review-event:([1-9][0-9]*):([a-f0-9]{40}):([a-f0-9]{40}):(submitted|edited|dismissed)$/.exec(
        trigger.display_title ?? "",
      );
    requireEvidence(
      tuple &&
        numericId(tuple[1]) &&
        Number(trigger.id) === Number(options["--trigger-run"]) &&
        trigger.status === "completed" &&
        tuple[3] === base &&
        typeof trigger.head_branch === "string",
    );
    const expected = {
      pull: Number(tuple[1]),
      head: tuple[2],
      base,
      branch: trigger.head_branch,
    };
    const observer = await api(
      `${prefix}/actions/workflows/factory-review-event.yml`,
    );
    requireEvidence(
      observer.path === ".github/workflows/factory-review-event.yml",
    );
    checkRun(trigger, observer, expected, "pull_request_review", tuple[0]);
    const prPath = `${prefix}/pulls/${expected.pull}`,
      pr = await api(prPath);
    checkPr(pr, expected);
    const checkCallers = async () => {
      for (const actor of [trigger.actor, trigger.triggering_actor]) {
        requireEvidence(
          actor?.type === "User" &&
            owners.includes(actor.login) &&
            actor.login !== pr.user.login,
        );
        const permission = await api(
          `${prefix}/collaborators/${actor.login}/permission`,
        );
        requireEvidence(
          ["write", "maintain", "admin"].includes(permission.permission),
        );
      }
    };
    await checkCallers();
    const digest = await reviewDigest(prPath);
    const revalidate = async () => {
      checkPr(await api(prPath), expected);
      requireEvidence((await reviewDigest(prPath)) === digest);
      await checkCallers();
    };
    // Original consumer run must execute the exact trusted caller, including its pin.
    const candidate = await api(
      `${prefix}/contents/.github/workflows/factory-adoption.yml?ref=${expected.head}`,
    );
    requireEvidence(fileContent(candidate) === adoption);
    if (options["--mode"] === "inspect") {
      await revalidate();
      if (process.env.GITHUB_OUTPUT)
        appendFileSync(
          process.env.GITHUB_OUTPUT,
          `pull_request=${expected.pull}\nbase_revision=${base}\n`,
        );
      return {
        operation: "refresh-approvals",
        outcome: "ready",
        ...expected,
        reviewDigest: digest,
        requests,
      };
    }
    const workflow = await api(
      `${prefix}/actions/workflows/factory-adoption.yml`,
    );
    requireEvidence(workflow.path === ".github/workflows/factory-adoption.yml");
    const inventory = await api(
      `${prefix}/actions/workflows/factory-adoption.yml/runs?event=pull_request&head_sha=${expected.head}&per_page=100`,
    );
    requireEvidence(
      Array.isArray(inventory.workflow_runs) &&
        inventory.total_count === inventory.workflow_runs.length &&
        new Set(inventory.workflow_runs.map((run) => run.id)).size ===
          inventory.workflow_runs.length,
    );
    const title = `factory-consumer-review:${expected.pull}:${expected.head}:${base}`;
    const runs = inventory.workflow_runs.filter(
      (run) =>
        run.display_title === title && run.head_branch === expected.branch,
    );
    requireEvidence(runs.length > 0 && runs.length <= 10);
    const planned = [],
      eventTime = time(trigger.created_at);
    const readJobs = async (runId, allowMissing) => {
      const data = await api(
        `${prefix}/actions/runs/${runId}/jobs?filter=latest&per_page=100`,
      );
      requireEvidence(
        Array.isArray(data.jobs) && data.total_count === data.jobs.length,
      );
      const jobs = jobNames.map((name) => {
        const entries = data.jobs.filter((job) => job.name === name);
        requireEvidence(
          entries.length === 1 || (allowMissing && entries.length === 0),
        );
        if (entries.length === 0) return undefined;
        const job = entries[0];
        requireEvidence(
          numericId(job.id) &&
            job.run_id === runId &&
            job.head_sha === expected.head &&
            numericId(job.run_attempt),
        );
        return job;
      });
      requireEvidence(
        new Set(jobs.filter(Boolean).map((job) => job.id)).size ===
          jobs.filter(Boolean).length,
      );
      return jobs;
    };
    const settledRun = async (runId, minimumAttempt, deadline) => {
      while (true) {
        const live = await api(`${prefix}/actions/runs/${runId}`);
        checkRun(live, workflow, expected, "pull_request", title);
        requireEvidence(numericId(live.run_attempt));
        // GitHub can briefly return an empty or partial inventory while
        // recreating jobs after our successful rerun request. Never dispatch
        // until both exact jobs exist in the completed new attempt.
        const jobs = await readJobs(runId, minimumAttempt > 1);
        if (
          live.status === "completed" &&
          live.run_attempt >= minimumAttempt &&
          jobs.every(
            (job) =>
              job !== undefined &&
              job.status === "completed" &&
              job.run_attempt === live.run_attempt,
          )
        )
          return { live, jobs };
        requireEvidence(Date.now() < deadline);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    };
    const isCurrent = (job) =>
      ["success", "failure"].includes(job.conclusion) &&
      job.started_at !== null &&
      time(job.started_at) > eventTime;
    const deadline = Date.now() + 180000;
    for (const run of runs) {
      checkRun(run, workflow, expected, "pull_request", title);
      const { jobs } = await settledRun(run.id, 1, deadline);
      for (const job of jobs) {
        if (isCurrent(job))
          requests.push({
            runId: run.id,
            jobId: job.id,
            status: "already-current",
          });
        else planned.push({ runId: run.id, name: job.name });
      }
    }
    if (planned.length === 0) await revalidate();
    const minimumAttempts = new Map(),
      dispatchDeadline = Date.now() + 360000;
    for (const request of planned) {
      // Rerunning one reusable job advances the shared run attempt and recreates
      // sibling job IDs. Wait for that attempt, then resolve the current ID.
      const { live, jobs } = await settledRun(
        request.runId,
        minimumAttempts.get(request.runId) ?? 1,
        dispatchDeadline,
      );
      const current = jobs.find((job) => job.name === request.name);
      await revalidate();
      if (isCurrent(current)) {
        requests.push({
          runId: request.runId,
          jobId: current.id,
          status: "already-current",
        });
        continue;
      }
      const dispatched = {
        runId: request.runId,
        jobId: current.id,
        status: "unconfirmed",
      };
      requests.push(dispatched);
      await api(`${prefix}/actions/jobs/${current.id}/rerun`, "POST");
      dispatched.status = "requested";
      minimumAttempts.set(request.runId, live.run_attempt + 1);
    }
    return {
      operation: "refresh-approvals",
      outcome: requests.some((request) => request.status === "requested")
        ? "requested"
        : "not-required",
      ...expected,
      reviewDigest: digest,
      requests,
    };
  } catch {
    return {
      operation: "refresh-approvals",
      outcome: "blocked",
      requests,
      reason:
        "Current trusted authority, review metadata or original job evidence is unavailable. No approval granted.",
    };
  }
}
const args = process.argv.slice(2),
  keys = [
    "--mode",
    "--repository",
    "--trigger-run",
    "--trusted-revision",
    "--approved-factory-revision",
  ];
const options = Object.fromEntries(keys.map((key) => [key, undefined]));
let valid = args.length === keys.length * 2;
for (let i = 0; i < args.length; i += 2) {
  if (!keys.includes(args[i]) || options[args[i]] !== undefined) valid = false;
  options[args[i]] = args[i + 1];
}
const report = valid
  ? await refresh(options)
  : {
      operation: "refresh-approvals",
      outcome: "blocked",
      requests: [],
      reason: "Provide the exact refresh command arguments.",
    };
process.stdout.write(JSON.stringify(report) + "\n");
if (report.outcome === "blocked") process.exitCode = 1;
