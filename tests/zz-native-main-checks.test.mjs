// Ticket 12 (#271): the native main observer. GitHub's API is a stand-in
// serving the merged PR, main's tip, reachability and the Actions runs of the
// main workflow, each attempt's jobs. Its observations go through the
// controller's own rules for recording attempts and judging the outcome.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  nativeMainChecksRuntime,
  ownerPolicyMainChecksRuntime,
} from "../dist/native-main-checks.js";
import { hostedCheckOutcome, recordCheckAttempts } from "../dist/pr-checks.js";

const repository = "AJHMH/acceptance";
const head = "a".repeat(40);
const ci = ".github/workflows/ci.yml";
const t0 = Date.parse("2026-11-13T10:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const job = (name, conclusion = "success", extra = {}) => ({
  name,
  status: conclusion ? "completed" : "in_progress",
  conclusion,
  started_at: iso(t0),
  completed_at: conclusion ? iso(t0 + 30000) : null,
  ...extra,
});

/** GitHub for PR 7, merged by fast-forward: main's tip is the head. */
function github(changes = {}) {
  const g = {
    pr: {
      merged: true,
      merge_commit_sha: head,
      head: { sha: head },
      base: { ref: "main", repo: { full_name: repository } },
    },
    tips: [head],
    compare: "ahead",
    runs: [
      // The PR's own run on the same commit never checks main.
      {
        id: 1,
        path: ci,
        head_sha: head,
        head_branch: "aios/feature-1",
        event: "pull_request",
        attempts: [[job("pr-ci"), job("main-ci", "skipped")]],
      },
      {
        id: 2,
        path: ci,
        head_sha: head,
        head_branch: "main",
        event: "push",
        attempts: [[job("pr-ci", "skipped"), job("main-ci")]],
      },
      {
        id: 3,
        path: ".github/workflows/other.yml",
        head_sha: head,
        head_branch: "main",
        event: "push",
        attempts: [[job("main-ci", "failure")]],
      },
    ],
    unreadable: new Set(),
    calls: [],
    ...changes,
  };
  let tipReads = 0;
  const api = async (path) => {
    g.calls.push(path);
    const r = `repos/${repository}`;
    let m;
    for (const u of g.unreadable)
      if (path.includes(u)) return { status: 500, body: null };
    if (path === `${r}/pulls/7`) return { status: 200, body: g.pr };
    if (path === `${r}/git/ref/heads/main`) {
      const sha = g.tips[Math.min(tipReads++, g.tips.length - 1)];
      return { status: 200, body: { object: { sha } } };
    }
    if (
      (m = /\/compare\/([a-f0-9]{40})\.\.\.([a-f0-9]{40})\?per_page=1$/.exec(
        path,
      ))
    )
      return { status: 200, body: { status: g.compare } };
    if (
      (m = /\/actions\/runs\?head_sha=([a-f0-9]{40})&per_page=100&page=1$/.exec(
        path,
      ))
    ) {
      const runs = g.runs
        .filter((x) => x.head_sha === m[1])
        .map((x) => ({
          id: x.id,
          path: x.path,
          head_sha: x.head_sha,
          head_branch: x.head_branch,
          event: x.event,
          run_attempt: x.attempts.length,
        }));
      return {
        status: 200,
        body: { total_count: runs.length, workflow_runs: runs },
      };
    }
    if (
      (m =
        /\/actions\/runs\/(\d+)\/attempts\/(\d+)\/jobs\?per_page=100&page=1$/.exec(
          path,
        ))
    ) {
      const jobs = g.runs.find((x) => x.id === Number(m[1]))?.attempts[
        Number(m[2]) - 1
      ];
      return jobs
        ? { status: 200, body: { total_count: jobs.length, jobs } }
        : { status: 404, body: null };
    }
    return { status: 404, body: null };
  };
  return {
    g,
    api,
    runtime: () =>
      nativeMainChecksRuntime({ repository, workflows: [ci], github: api }),
  };
}
const request = {
  repository,
  number: 7,
  head,
  base: "main",
  mergeCommit: head,
};
/** The controller's verdict for main check `main-ci`. */
function verdict(o, at = t0 + 120000) {
  const run = {
    checks: [
      {
        id: "main-ci",
        kind: "build",
        scope: "main",
        stages: ["candidate"],
        command: ["workflow", "ci"],
        publisher: "github-actions",
        workflow: `${ci}@main`,
        timeoutMs: 3600000,
      },
    ],
    attempts: [],
    head: o.mainRevision,
    rejected: 0,
    startedAt: t0,
    findings: [],
    canRepair: false,
  };
  recordCheckAttempts(run, o.checks, at);
  return hostedCheckOutcome(run, at);
}

test("main's own push run of the trusted workflow, on the merge commit at main's tip, is the controller's pass", async () => {
  const s = github();
  const o = await s.runtime().observe(request);
  assert.equal(o.complete, true);
  assert.equal(o.reachable, true);
  assert.equal(o.mainRevision, head);
  assert.equal(o.mergeCommit, head);
  // Only run 2's jobs: not the PR's run, not another workflow's.
  assert.deepEqual(
    o.checks.map((c) => [
      c.runId,
      c.checkId,
      c.status,
      c.publisher,
      c.workflow,
    ]),
    [
      [2, "pr-ci", "skipped", "github-actions", `${ci}@main`],
      [2, "main-ci", "success", "github-actions", `${ci}@main`],
    ],
  );
  assert.equal(verdict(o), "passed");
  // A failing or still-running main check is the controller's failure or wait.
  s.g.runs[1].attempts = [[job("main-ci", "failure")]];
  assert.equal(verdict(await s.runtime().observe(request)), "failed");
  s.g.runs[1].attempts = [[job("main-ci", null)]];
  assert.equal(verdict(await s.runtime().observe(request)), "incomplete");
  // No push run yet: incomplete, never passed.
  s.g.runs = s.g.runs.filter((x) => x.event !== "push");
  assert.equal(verdict(await s.runtime().observe(request)), "incomplete");
});

test("main that advanced past the merge is checked at its own tip, and a merge no longer in main's history is unreachable", async () => {
  const later = "b".repeat(40);
  const s = github({ tips: [later] });
  s.g.runs.push({
    id: 4,
    path: ci,
    head_sha: later,
    head_branch: "main",
    event: "push",
    attempts: [[job("main-ci")]],
  });
  const o = await s.runtime().observe(request);
  assert.equal(o.mainRevision, later);
  assert.equal(o.reachable, true);
  assert.deepEqual(
    o.checks.map((c) => c.runId),
    [4],
  );
  s.g.compare = "diverged";
  assert.equal((await s.runtime().observe(request)).reachable, false);
  s.g.unreadable.add("/compare/");
  const unread = await s.runtime().observe(request);
  assert.equal(unread.complete, false);
  assert.equal(unread.mainRevision, later);
});

test("a main that moves while it is read, an unmerged PR, another merge commit, or an unreadable answer is incomplete", async () => {
  const moved = github({ tips: [head, "c".repeat(40)] });
  assert.equal((await moved.runtime().observe(request)).complete, false);
  for (const pr of [
    { merged: false },
    { merge_commit_sha: undefined },
    { base: { ref: "main", repo: { full_name: "someone/fork" } } },
  ]) {
    const s = github();
    s.g.pr = { ...s.g.pr, ...pr };
    const o = await s.runtime().observe(request);
    assert.equal(o.complete, false);
    assert.equal(o.reachable, false);
  }
  for (const part of [
    "/pulls/7",
    "/git/ref/heads/main",
    "/actions/runs?",
    "/attempts/1/jobs",
  ]) {
    const s = github();
    s.g.unreadable.add(part);
    assert.equal((await s.runtime().observe(request)).complete, false, part);
  }
  assert.equal(
    (
      await github()
        .runtime()
        .observe({ ...request, repository: "AJHMH/other" })
    ).complete,
    false,
  );
  // The controller rejects a different merge commit.
  const other = github();
  other.g.pr.merge_commit_sha = "d".repeat(40);
  assert.equal(
    (await other.runtime().observe(request)).mergeCommit,
    "d".repeat(40),
  );
});

test("the observer is bound to its repository and workflows, and the owner policy names them", async (t) => {
  const s = github();
  const a = s.runtime();
  assert.equal(a.mode, "controlled");
  assert.notEqual(
    nativeMainChecksRuntime({
      repository,
      workflows: [".github/workflows/x.yml"],
      github: s.api,
    }).bindingSha256,
    a.bindingSha256,
  );
  assert.throws(() => nativeMainChecksRuntime({ repository, workflows: [] }));
  assert.throws(() =>
    nativeMainChecksRuntime({ repository, workflows: ["ci.yml"] }),
  );
  assert.throws(() =>
    nativeMainChecksRuntime({ repository: "bad", workflows: [ci] }),
  );
  const dir = mkdtempSync(join(tmpdir(), "aios-main-policy-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const policy = join(dir, "policy.json");
  const write = (checks) =>
    writeFileSync(
      policy,
      JSON.stringify({
        repository,
        defaultBranch: "main",
        validationContract: { checks },
      }),
    );
  write([
    {
      id: "pr-ci",
      scope: "pr",
      publisher: "github-actions",
      workflow: `${ci}@main`,
    },
    {
      id: "main-ci",
      scope: "main",
      publisher: "github-actions",
      workflow: `${ci}@main`,
    },
    {
      id: "elsewhere",
      scope: "main",
      publisher: "trusted-ci",
      workflow: ".github/workflows/x.yml@main",
    },
  ]);
  assert.equal(
    ownerPolicyMainChecksRuntime(policy, s.api).bindingSha256,
    a.bindingSha256,
  );
  write([
    {
      id: "main-ci",
      scope: "main",
      publisher: "github-actions",
      workflow: `${ci}@trusted`,
    },
  ]);
  assert.equal(ownerPolicyMainChecksRuntime(policy, s.api), undefined);
  write([
    {
      id: "main-ci",
      scope: "main",
      publisher: "github-actions",
      workflow: "ci.yml@main",
    },
  ]);
  assert.equal(ownerPolicyMainChecksRuntime(policy, s.api), undefined);
  writeFileSync(policy, "x".repeat(70000));
  assert.equal(ownerPolicyMainChecksRuntime(policy), undefined);
  assert.equal(
    ownerPolicyMainChecksRuntime(join(dir, "missing.json")),
    undefined,
  );
});

test("monitor-main-checks takes the owner policy", async (t) => {
  const { spawnSync } = await import("node:child_process");
  const state = mkdtempSync(join(tmpdir(), "aios-main-cli-"));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  const policy = join(state, "policy.json");
  writeFileSync(
    policy,
    JSON.stringify({
      repository,
      defaultBranch: "main",
      validationContract: {
        checks: [
          {
            id: "main-ci",
            scope: "main",
            publisher: "github-actions",
            workflow: `${ci}@main`,
          },
        ],
      },
    }),
    { mode: 0o600 },
  );
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
  assert.doesNotMatch(
    cli("monitor-main-checks", ...id, "--owner-policy", policy),
    /^Use start/,
  );
  assert.match(
    cli("monitor-main-checks", ...id, "--production-admission", policy),
    /^Use start/,
  );
});
