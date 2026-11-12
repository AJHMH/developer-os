// Ticket 09 (#268): the native PR check monitor. GitHub's API is a stand-in
// serving the PR, its Actions runs, each attempt's jobs and the workflow
// file's blob at each ref. Its observations go through the controller's own
// rules for recording attempts and judging the outcome.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  actionsPublisher,
  nativePRChecksRuntime,
  rerunSettleMs,
  workflowIdentity,
} from "../dist/native-pr-checks.js";
import { hostedCheckOutcome, recordCheckAttempts } from "../dist/pr-checks.js";

const head = "a".repeat(40);
const ci = ".github/workflows/ci.yml";
const t0 = Date.parse("2026-11-12T10:00:00Z");
const iso = (ms) => new Date(ms).toISOString();

/** A GitHub stand-in for one PR on `head`, with `runs` of workflow runs,
 * each `{id, path, attempts: [[job, ...], ...]}`. */
function github(t, changes = {}) {
  const state = mkdtempSync(join(tmpdir(), "aios-native-pr-checks-"));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  const g = {
    pr: {
      state: "open",
      head: { sha: head, repo: { full_name: "AJHMH/acceptance" } },
      base: { ref: "main", repo: { full_name: "AJHMH/acceptance" } },
      user: { login: "ajhmh-software-factory[bot]" },
    },
    blobs: { [head]: "w".repeat(40), main: "w".repeat(40) },
    runs: [
      {
        id: 101,
        path: ci,
        head_sha: head,
        attempts: [
          [
            {
              name: "pr-ci",
              status: "completed",
              conclusion: "success",
              started_at: iso(t0),
              completed_at: iso(t0 + 30000),
            },
          ],
        ],
      },
    ],
    calls: [],
    posts: [],
    rerunStatus: 201,
    ...changes,
  };
  const api = async (path, method = "GET") => {
    g.calls.push([method, path]);
    let m;
    if (method === "POST") {
      g.posts.push(path);
      m =
        /^repos\/AJHMH\/acceptance\/actions\/runs\/(\d+)\/rerun-failed-jobs$/.exec(
          path,
        );
      return { status: m ? g.rerunStatus : 404, body: null };
    }
    if (path === "repos/AJHMH/acceptance/pulls/7")
      return g.pr ? { status: 200, body: g.pr } : { status: 404, body: null };
    m = /^repos\/AJHMH\/acceptance\/contents\/(.+)\?ref=(.+)$/.exec(path);
    if (m) {
      const sha = g.blobs[decodeURIComponent(m[2])];
      return sha && m[1] === ci
        ? { status: 200, body: { sha } }
        : { status: 404, body: null };
    }
    m =
      /^repos\/AJHMH\/acceptance\/actions\/runs\?head_sha=([a-f0-9]{40})&per_page=100&page=(\d+)$/.exec(
        path,
      );
    if (m) {
      if (g.runsUnreadable) return { status: 500, body: null };
      const all = g.runs
        .filter((r) => r.head_sha === m[1])
        .map((r) => ({
          id: r.id,
          path: r.path,
          head_sha: r.head_sha,
          run_attempt: r.attempts.length,
        }));
      const page = Number(m[2]);
      return {
        status: 200,
        body: {
          total_count: all.length,
          workflow_runs: all.slice((page - 1) * 100, page * 100),
        },
      };
    }
    m =
      /^repos\/AJHMH\/acceptance\/actions\/runs\/(\d+)\/attempts\/(\d+)\/jobs\?per_page=100&page=1$/.exec(
        path,
      );
    if (m) {
      const run = g.runs.find((r) => r.id === Number(m[1]));
      const jobs = run?.attempts[Number(m[2]) - 1];
      return jobs
        ? { status: 200, body: { total_count: jobs.length, jobs } }
        : { status: 404, body: null };
    }
    return { status: 404, body: null };
  };
  let now = t0 + 60000;
  const runtime = (over = {}) =>
    nativePRChecksRuntime({
      repository: "AJHMH/acceptance",
      workflows: [ci],
      state,
      github: api,
      clock: () => now,
      ...over,
    });
  return { g, api, state, runtime, tick: (ms) => (now += ms), now: () => now };
}
const request = { repository: "AJHMH/acceptance", number: 7, head };
/** The controller's verdict on an observation, for check `pr-ci`. */
function verdict(observation, at = t0 + 120000) {
  const run = {
    checks: [
      {
        id: "pr-ci",
        kind: "build",
        scope: "pr",
        stages: ["candidate"],
        command: ["workflow", "ci"],
        publisher: actionsPublisher,
        workflow: workflowIdentity(ci, "main"),
        timeoutMs: 3600000,
      },
    ],
    attempts: [],
    head,
    rejected: 0,
    startedAt: t0,
    findings: [],
    canRepair: false,
  };
  recordCheckAttempts(run, observation.checks, at);
  return { outcome: hostedCheckOutcome(run, at), run };
}

test("a passing check of the trusted workflow on the exact head is the controller's pass", async (t) => {
  const w = github(t);
  const o = await w.runtime().observe(request);
  assert.equal(o.complete, true);
  assert.equal(o.head, head);
  assert.equal(o.base, "main");
  assert.equal(o.author, "ajhmh-software-factory[bot]");
  assert.equal(o.state, "open");
  assert.deepEqual(o.checks, [
    {
      runId: 101,
      attempt: 1,
      checkId: "pr-ci",
      publisher: "github-actions",
      workflow: ".github/workflows/ci.yml@main",
      head,
      status: "success",
      startedAt: t0,
      completedAt: t0 + 30000,
    },
  ]);
  assert.equal(verdict(o).outcome, "passed");
  // It only ever read.
  assert.deepEqual(w.g.posts, []);
});

test("every attempt stays in the history, so a rerun that passes after a failure is flaky, not green", async (t) => {
  const w = github(t);
  w.g.runs[0].attempts = [
    [
      {
        name: "pr-ci",
        status: "completed",
        conclusion: "failure",
        started_at: iso(t0),
        completed_at: iso(t0 + 20000),
      },
    ],
    [
      {
        name: "pr-ci",
        status: "completed",
        conclusion: "success",
        started_at: iso(t0 + 40000),
        completed_at: iso(t0 + 60000),
      },
    ],
  ];
  const o = await w.runtime().observe(request);
  assert.deepEqual(
    o.checks.map((c) => [c.attempt, c.status]),
    [
      [1, "failure"],
      [2, "success"],
    ],
  );
  assert.equal(verdict(o).outcome, "flaky");
  // A failure alone is the controller's failure.
  w.g.runs[0].attempts = [w.g.runs[0].attempts[0]];
  assert.equal(verdict(await w.runtime().observe(request)).outcome, "failed");
});

test("a workflow file the PR changed, another workflow, or another head never counts", async (t) => {
  const w = github(t);
  w.g.blobs[head] = "x".repeat(40);
  const changed = await w.runtime().observe(request);
  assert.equal(changed.checks[0].publisher, "untrusted-workflow-change");
  assert.equal(verdict(changed).outcome, "incomplete");
  // Missing at the head: untrusted too.
  delete w.g.blobs[head];
  assert.equal(
    (await w.runtime().observe(request)).checks[0].publisher,
    "untrusted-workflow-change",
  );
  w.g.blobs[head] = "w".repeat(40);
  w.g.runs = [
    { ...w.g.runs[0], id: 201, path: ".github/workflows/other.yml" },
    { ...w.g.runs[0], id: 202, head_sha: "b".repeat(40) },
  ];
  const none = await w.runtime().observe(request);
  assert.deepEqual(none.checks, []);
  assert.equal(verdict(none).outcome, "incomplete");
});

test("pending, cancelled, skipped, timed-out and unknown jobs are what the controller expects", async (t) => {
  const w = github(t);
  const job = (status, conclusion) => ({
    name: "pr-ci",
    status,
    conclusion,
    started_at: iso(t0),
    completed_at: status === "completed" ? iso(t0 + 1000) : null,
  });
  for (const [j, expected] of [
    [job("in_progress", null), "pending"],
    [job("queued", null), "pending"],
    [job("completed", "cancelled"), "cancelled"],
    [job("completed", "skipped"), "skipped"],
    [job("completed", "neutral"), "neutral"],
    [job("completed", "timed_out"), "timeout"],
    [job("completed", "startup_failure"), "missing"],
  ]) {
    w.g.runs[0].attempts = [[j]];
    const c = (await w.runtime().observe(request)).checks[0];
    assert.equal(c.status, expected, JSON.stringify(j));
    assert.equal("completedAt" in c, expected !== "pending");
  }
  // A job not started yet carries no attempt.
  w.g.runs[0].attempts = [
    [{ name: "pr-ci", status: "queued", conclusion: null, started_at: null }],
  ];
  assert.deepEqual((await w.runtime().observe(request)).checks, []);
});

test("an unreadable or closed PR, a fork, or unreadable runs are not a complete observation", async (t) => {
  const w = github(t);
  w.g.runsUnreadable = true;
  assert.equal((await w.runtime().observe(request)).complete, false);
  w.g.runsUnreadable = false;
  w.g.runs[0].attempts.push(undefined);
  w.g.runs[0].attempts = [w.g.runs[0].attempts[0], undefined];
  assert.equal(
    (await w.runtime().observe(request)).complete,
    false,
    "a missing attempt's jobs",
  );
  w.g.runs[0].attempts = [w.g.runs[0].attempts[0]];
  w.g.pr.state = "closed";
  assert.equal((await w.runtime().observe(request)).state, "closed");
  w.g.pr.head.repo.full_name = "someone/acceptance";
  assert.equal((await w.runtime().observe(request)).complete, false);
  w.g.pr = null;
  assert.deepEqual(await w.runtime().observe(request), {
    repository: "AJHMH/acceptance",
    number: 7,
    head: "",
    base: "",
    author: "",
    state: "closed",
    complete: false,
    checks: [],
    reruns: [],
  });
  assert.equal(
    (await w.runtime().observe({ ...request, repository: "AJHMH/other" }))
      .complete,
    false,
  );
  w.g.pr = { ...github(t).g.pr };
  w.g.runs = [{ ...w.g.runs[0], run_attempt: undefined, attempts: [] }];
  w.g.runs[0].id = "not-a-number";
  assert.equal((await w.runtime().observe(request)).complete, false);
});

test("listings read every page", async (t) => {
  const w = github(t);
  const runs = [];
  for (let i = 0; i < 150; i++)
    runs.push({
      ...w.g.runs[0],
      id: 1000 + i,
      path: i === 149 ? ci : ".github/workflows/other.yml",
    });
  w.g.runs = runs;
  const o = await w.runtime().observe(request);
  assert.equal(o.complete, true);
  assert.deepEqual(
    o.checks.map((c) => c.runId),
    [1149],
  );
  assert.ok(w.g.calls.some(([, p]) => p.includes("&page=2")));
});

test("a rerun is recorded before dispatch and reconciled by the run's attempt number", async (t) => {
  const w = github(t);
  w.g.runs[0].attempts = [
    [
      {
        name: "pr-ci",
        status: "completed",
        conclusion: "failure",
        started_at: iso(t0),
        completed_at: iso(t0 + 20000),
      },
    ],
  ];
  const runtime = w.runtime();
  const operationId = randomUUID();
  const rerun = {
    ...request,
    operationId,
    checkId: "pr-ci",
    runId: 101,
    attempt: 1,
    state: "dispatched",
  };
  const before = w.g.posts.length;
  assert.deepEqual(await runtime.rerun({ ...rerun, mayDispatch: () => true }), {
    operationId,
    accepted: true,
  });
  assert.deepEqual(w.g.posts.slice(before), [
    "repos/AJHMH/acceptance/actions/runs/101/rerun-failed-jobs",
  ]);
  const marker = JSON.parse(
    readFileSync(join(w.state, "rerun-" + operationId + ".json"), "utf8"),
  );
  assert.deepEqual(marker, { runId: 101, attempt: 1, at: w.now() });
  // Not yet a new attempt, and too soon to be settled.
  assert.deepEqual((await runtime.observe(request)).reruns, [
    { operationId, state: "absent", quiescent: false },
  ]);
  w.tick(rerunSettleMs + 1);
  assert.deepEqual((await runtime.observe(request)).reruns, [
    { operationId, state: "absent", quiescent: true },
  ]);
  // The new attempt is the receipt.
  w.g.runs[0].attempts.push([
    {
      name: "pr-ci",
      status: "in_progress",
      conclusion: null,
      started_at: iso(t0 + 90000),
    },
  ]);
  assert.deepEqual((await runtime.observe(request)).reruns, [
    { operationId, state: "accepted" },
  ]);
  // Refused rerun.
  w.g.rerunStatus = 403;
  const refused = randomUUID();
  assert.equal(
    (
      await runtime.rerun({
        ...rerun,
        operationId: refused,
        mayDispatch: () => true,
      })
    ).accepted,
    false,
  );
  for (const bad of [
    { mayDispatch: () => false },
    { repository: "AJHMH/other", mayDispatch: () => true },
    { runId: 0, mayDispatch: () => true },
    { attempt: 0, mayDispatch: () => true },
  ])
    await assert.rejects(
      runtime.rerun({ ...rerun, operationId: randomUUID(), ...bad }),
      /Fenced or invalid rerun/,
    );
  await assert.rejects(
    runtime.rerun({ ...rerun, operationId: "../x", mayDispatch: () => true }),
    /Invalid rerun operation/,
  );
  assert.equal(existsSync(join(w.state, "rerun-../x.json")), false);
});

test("the monitor names its repository and trusted workflows, and is bound to them", async (t) => {
  const w = github(t);
  for (const bad of [
    { repository: "not a repo" },
    { workflows: [] },
    { workflows: ["ci.yml"] },
    { workflows: [".github/workflows/../x.yml"] },
  ])
    assert.throws(() => w.runtime(bad), /Invalid PR check monitor/);
  assert.match(w.runtime().bindingSha256, /^[a-f0-9]{64}$/);
  assert.equal(
    w.runtime().bindingSha256,
    w.runtime({ workflows: [ci] }).bindingSha256,
  );
  assert.notEqual(
    w.runtime().bindingSha256,
    w.runtime({ workflows: [ci, ".github/workflows/e2e.yml"] }).bindingSha256,
  );
  assert.equal(w.runtime().mode, "controlled");
});

test("the owner policy names the monitor: its repository and its GitHub Actions PR checks on the default branch", async (t) => {
  const { writeFileSync, mkdirSync, statSync } = await import("node:fs");
  const { ownerPolicyPRChecksRuntime } = await import(
    "../dist/native-pr-checks.js"
  );
  const root = mkdtempSync(join(tmpdir(), "aios-pr-checks-policy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const policy = (checks, extra = {}) => {
    const path = join(root, randomUUID() + ".json");
    writeFileSync(
      path,
      JSON.stringify({
        repository: "AJHMH/acceptance",
        defaultBranch: "main",
        validationContract: { checks },
        ...extra,
      }),
    );
    return path;
  };
  const check = (over) => ({
    id: "pr-ci",
    scope: "pr",
    publisher: "github-actions",
    workflow: ci + "@main",
    ...over,
  });
  const state = join(root, "state");
  const runtime = ownerPolicyPRChecksRuntime(
    policy([
      check(),
      check({ id: "pr-e2e" }),
      check({ id: "lint", scope: "local" }),
    ]),
    state,
  );
  assert.equal(
    runtime.bindingSha256,
    nativePRChecksRuntime({
      repository: "AJHMH/acceptance",
      workflows: [ci],
      state,
    }).bindingSha256,
  );
  const folder = join(state, "pr-checks");
  const [made] = (await import("node:fs")).readdirSync(folder);
  assert.equal(statSync(join(folder, made)).mode & 0o777, 0o700);
  // None declared for GitHub Actions on the default branch: no monitor.
  for (const checks of [
    [check({ publisher: "trusted-ci" })],
    [check({ workflow: ci + "@trusted" })],
    [check({ scope: "main" })],
    [],
  ])
    assert.equal(
      ownerPolicyPRChecksRuntime(policy(checks), state),
      undefined,
      JSON.stringify(checks),
    );
  assert.equal(
    ownerPolicyPRChecksRuntime(join(root, "missing.json"), state),
    undefined,
  );
  assert.equal(
    ownerPolicyPRChecksRuntime(policy([check()], { repository: 7 }), state),
    undefined,
  );
  mkdirSync(join(root, "a-folder"));
  assert.equal(
    ownerPolicyPRChecksRuntime(join(root, "a-folder"), state),
    undefined,
  );
  // It reads through the owner's gh login it is given.
  const seen = [];
  const monitor = ownerPolicyPRChecksRuntime(
    policy([check()]),
    state,
    async (p) => (seen.push(p), { status: 404, body: null }),
  );
  assert.equal((await monitor.observe(request)).complete, false);
  assert.deepEqual(seen, ["repos/AJHMH/acceptance/pulls/7"]);
});

test("the PR check commands take the owner policy, and repair also the coding and publication records", async (t) => {
  const { spawnSync } = await import("node:child_process");
  const state = mkdtempSync(join(tmpdir(), "aios-pr-checks-cli-"));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  const cli = (...args) => {
    const r = spawnSync(
      process.execPath,
      [
        new URL("../dist/cli.js", import.meta.url).pathname,
        ...args,
        "--state-dir",
        state,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, AIOS_TEST_HOST_PLATFORM: "darwin" },
      },
    );
    return JSON.parse(
      r.stderr
        .split("\n")
        .reverse()
        .find((l) => l.startsWith("{")),
    ).error;
  };
  const id = ["--id", randomUUID()];
  const policy = join(state, "policy.json");
  for (const args of [
    ["monitor-pr-checks", ...id, "--owner-policy", policy],
    ["rerun-pr-check", ...id, "--check-id", "pr-ci", "--owner-policy", policy],
    [
      "repair-pr-checks",
      ...id,
      "--owner-policy",
      policy,
      "--publication-identity",
      join(state, "p.json"),
    ],
  ])
    assert.doesNotMatch(cli(...args), /^Use start/, args[0]);
  for (const args of [
    ["monitor-pr-checks", ...id, "--auth-directory", state],
    [
      "rerun-pr-check",
      ...id,
      "--check-id",
      "pr-ci",
      "--publication-identity",
      "x",
    ],
  ])
    assert.match(cli(...args), /^Use start/, args[0]);
});

test("the owner-run acceptance needs a pass, a failure, and a rerun whose new attempt keeps the failure in the history", async (t) => {
  const { prChecksAcceptance, passingOutcome, stageNames } = await import(
    "../scripts/run-native-pr-checks-acceptance.mjs"
  );
  const identity = { repository: "AJHMH/acceptance" };
  const attempt = (head, runId, n, status) => ({
    runId,
    attempt: n,
    checkId: "pr-ci",
    publisher: "github-actions",
    workflow: ".github/workflows/ci.yml@main",
    head,
    status,
    startedAt: t0 + n * 1000,
    ...(status === "pending" ? {} : { completedAt: t0 + n * 1000 + 500 }),
  });
  /** A monitor stand-in: PR 1 passes, PR 2 fails, and a rerun of PR 2 adds
   * attempt 2 after one pending look. */
  const world = (faults = {}) => {
    let reruns = [],
      looks = 0;
    const monitor = {
      async observe(pr) {
        looks++;
        const base = {
          repository: "AJHMH/acceptance",
          number: pr.number,
          head: pr.head,
          base: "main",
          author: "bot",
          state: "open",
          complete: true,
        };
        if (pr.number === 1)
          return {
            ...base,
            checks:
              looks === 1
                ? [attempt(pr.head, 11, 1, "pending")]
                : [attempt(pr.head, 11, 1, faults.passingStatus ?? "success")],
            reruns: [],
          };
        const checks = [
          attempt(pr.head, 22, 1, faults.failingStatus ?? "failure"),
        ];
        if (reruns.length && !faults.noNewAttempt)
          checks.push(attempt(pr.head, 22, 2, "failure"));
        return {
          ...base,
          checks: faults.dropFirst && reruns.length ? checks.slice(1) : checks,
          reruns: reruns.map((id) => ({ operationId: id, state: "accepted" })),
        };
      },
      async rerun(r) {
        assert.equal(r.runId, 22);
        assert.equal(r.attempt, 1);
        assert.equal(r.mayDispatch(), true);
        if (!faults.refuseRerun) reruns.push(r.operationId);
        return { operationId: r.operationId, accepted: !faults.refuseRerun };
      },
    };
    let n = 0;
    const publish = async (extraFiles) => ({
      repository: "AJHMH/acceptance",
      number: ++n,
      head: (extraFiles.length ? "f" : "p").repeat(40),
    });
    let clock = Date.now();
    return {
      monitor,
      publish,
      options: {
        publish,
        sleep: async () => (clock += 1000),
        now: () => clock,
        limitMs: 60000,
        intervalMs: 1000,
      },
    };
  };
  const w = world();
  const report = await prChecksAcceptance(
    { monitor: w.monitor, identity },
    w.options,
  );
  assert.equal(report.outcome, passingOutcome, report.error);
  assert.deepEqual(
    report.stages.map((s) => [s.name, s.outcome]),
    stageNames.map((n) => [n, "passed"]),
  );
  assert.equal(report.passing.verdict, "passed");
  assert.equal(report.failing.verdict, "failed");
  assert.deepEqual(
    report.rerun.checks.map((c) => [c.attempt, c.status]),
    [
      [1, "failure"],
      [2, "failure"],
    ],
  );
  for (const [faults, blocked, error] of [
    [
      { passingStatus: "failure" },
      "observe-pass",
      /passing PR's verdict is failed/,
    ],
    [
      { failingStatus: "success" },
      "observe-failure",
      /failing PR's verdict is passed/,
    ],
    [{ refuseRerun: true }, "rerun", /didn't accept the rerun/],
    [{ noNewAttempt: true }, "observe-rerun", /new attempt didn't finish/],
    [{ dropFirst: true }, "observe-rerun", /first failure left the history/],
  ]) {
    const f = world(faults);
    const r = await prChecksAcceptance(
      { monitor: f.monitor, identity },
      f.options,
    );
    assert.equal(r.outcome, "blocked", JSON.stringify(faults));
    assert.equal(r.stages.at(-1).name, blocked, JSON.stringify(faults));
    assert.match(r.error, error);
  }
});
