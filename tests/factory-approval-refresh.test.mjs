import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const root = fileURLToPath(new URL("../", import.meta.url)),
  pin = "cc5913bfe31a386d8105f84a7f42556548fe353c";
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "aios-refresh-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git("init");
  mkdirSync(join(directory, ".github/workflows"), { recursive: true });
  const adoption = readFileSync(
    join(root, ".github/workflows/factory-adoption.yml"),
    "utf8",
  ).replace(/\r\n/g, "\n");
  writeFileSync(
    join(directory, ".github/workflows/factory-adoption.yml"),
    adoption,
  );
  writeFileSync(
    join(directory, "factory.lock.yaml"),
    readFileSync(join(root, "factory.lock.yaml")),
  );
  git("add", ".");
  git(
    "-c",
    "commit.gpgsign=false",
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "trusted consumer",
  );
  const base = git("rev-parse", "HEAD"),
    head = "b".repeat(40),
    repository = "AJHMH/developer-os",
    branch = "codex/example";
  const timestamp = (seconds) =>
    new Date(Date.now() - seconds * 1000).toISOString();
  const run = {
    id: 100,
    workflow_id: 1,
    path: ".github/workflows/factory-adoption.yml",
    event: "pull_request",
    head_sha: head,
    head_branch: branch,
    status: "completed",
    run_attempt: 1,
    repository: { full_name: repository },
    display_title: `factory-consumer-review:7:${head}:${base}`,
    created_at: timestamp(30),
  };
  const content = (text) => ({
    type: "file",
    encoding: "base64",
    content: Buffer.from(text).toString("base64"),
    size: Buffer.byteLength(text),
    sha: createHash("sha1")
      .update(`blob ${Buffer.byteLength(text)}\0`)
      .update(text)
      .digest("hex"),
  });
  const state = {
    pr: {
      number: 7,
      state: "open",
      user: { login: "ajhmh-software-factory[bot]" },
      head: { sha: head, ref: branch, repo: { full_name: repository } },
      base: { sha: base, ref: "main", repo: { full_name: repository } },
    },
    trigger: {
      ...run,
      id: 900,
      workflow_id: 2,
      path: ".github/workflows/factory-review-event.yml",
      event: "pull_request_review",
      display_title: `factory-review-event:7:${head}:${base}:submitted`,
      created_at: timestamp(10),
      actor: { login: "aaron-howard", type: "User" },
      triggering_actor: { login: "aaron-howard", type: "User" },
    },
    observer: {
      id: 2,
      path: ".github/workflows/factory-review-event.yml",
      state: "active",
    },
    workflow: { id: 1, path: run.path, state: "active" },
    runs: [run],
    jobs: ["human approval", "trusted human approval"].map((name, i) => ({
      id: 501 + i,
      run_id: 100,
      run_attempt: 1,
      head_sha: head,
      name: "validation / Enforce Factory " + name,
      status: "completed",
      conclusion: "failure",
      started_at: timestamp(20),
    })),
    reviews: [
      {
        id: 1,
        user: { login: "aaron-howard", type: "User" },
        state: "APPROVED",
        commit_id: head,
        submitted_at: timestamp(12),
        body: "private review body",
      },
    ],
    policy: content(
      readFileSync(
        join(root, "tests/fixtures/factory-human-review.txt"),
        "utf8",
      ).replace(/\r\n/g, "\n"),
    ),
    adoption: content(adoption),
  };
  const runCli = (mode = "apply", extra = []) => {
    const file = join(directory, "rest.json");
    writeFileSync(file, JSON.stringify(state));
    const output = join(directory, "output");
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        pathToFileURL(join(root, "tests/fixtures/refresh-factory-api.mjs"))
          .href,
        join(root, "scripts/refresh-factory-approvals.mjs"),
        "--mode",
        mode,
        "--repository",
        repository,
        "--trigger-run",
        "900",
        "--trusted-revision",
        base,
        "--approved-factory-revision",
        state.approvedFactoryRevision ?? pin,
        ...extra,
      ],
      {
        cwd: directory,
        encoding: "utf8",
        timeout: 10000,
        env: {
          ...process.env,
          AIOS_REFRESH_FIXTURE: file,
          FACTORY_GITHUB_TOKEN: "fixture credential",
          GITHUB_OUTPUT: output,
        },
      },
    );
    return {
      ...result,
      report: result.stdout ? JSON.parse(result.stdout) : null,
      rest: JSON.parse(readFileSync(file, "utf8")),
    };
  };
  return { state, runCli, base, head };
}
test("owner review reruns only the two original consumer approval jobs and never grants approval", (t) => {
  const f = fixture(t),
    r = f.runCli();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.report.outcome, "requested");
  assert.deepEqual(r.rest.writes, [
    "/repos/AJHMH/developer-os/actions/jobs/501/rerun",
    "/repos/AJHMH/developer-os/actions/jobs/502/rerun",
  ]);
  assert.equal(r.stdout.includes("private review body"), false);
  assert.equal(r.stdout.includes("fixture credential"), false);
});

test("inspection is read-only and returns only bounded identifiers", (t) => {
  const f = fixture(t),
    r = f.runCli("inspect");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.report.outcome, "ready");
  assert.deepEqual(r.rest.writes ?? [], []);
});

for (const [name, change] of [
  [
    "fork",
    (s) => {
      s.pr.head.repo.full_name = "outside/fork";
    },
  ],
  [
    "stale head",
    (s) => {
      s.pr.head.sha = "c".repeat(40);
    },
  ],
  [
    "stale base",
    (s) => {
      s.pr.base.sha = "c".repeat(40);
    },
  ],
  [
    "wrong target",
    (s) => {
      s.pr.base.ref = "release";
    },
  ],
  [
    "closed PR",
    (s) => {
      s.pr.state = "closed";
    },
  ],
  [
    "bot caller",
    (s) => {
      s.trigger.actor.type = "Bot";
    },
  ],
  [
    "unauthorized caller",
    (s) => {
      s.trigger.actor.login = "other-human";
    },
  ],
  [
    "self caller",
    (s) => {
      s.pr.user.login = "aaron-howard";
    },
  ],
  [
    "unauthorized triggering actor",
    (s) => {
      s.trigger.triggering_actor.login = "other-human";
    },
  ],
  [
    "forged workflow identity",
    (s) => {
      s.trigger.workflow_id = 99;
    },
  ],
  [
    "forged observer path",
    (s) => {
      s.observer.path = ".github/workflows/other.yml";
    },
  ],
  [
    "unfinished observer",
    (s) => {
      s.trigger.status = "in_progress";
    },
  ],
  [
    "forged event title",
    (s) => {
      s.trigger.display_title += ":extra";
    },
  ],
  [
    "unapproved policy",
    (s) => {
      s.policy.sha = "c".repeat(40);
    },
  ],
  [
    "altered policy body",
    (s) => {
      s.policy.content = Buffer.from("untrusted").toString("base64");
    },
  ],
  [
    "changed adoption workflow",
    (s) => {
      s.adoption.content = Buffer.from("untrusted").toString("base64");
    },
  ],
  [
    "missing original run",
    (s) => {
      s.runs = [];
    },
  ],
  [
    "incomplete run inventory",
    (s) => {
      s.runCount = 101;
    },
  ],
  [
    "wrong original event",
    (s) => {
      s.runs[0].event = "push";
    },
  ],
  [
    "wrong original head",
    (s) => {
      s.runs[0].head_sha = "c".repeat(40);
    },
  ],
  [
    "wrong original workflow",
    (s) => {
      s.runs[0].workflow_id = 99;
    },
  ],
  [
    "missing original job",
    (s) => {
      s.jobs.pop();
    },
  ],
  [
    "incomplete job inventory",
    (s) => {
      s.jobCount = 101;
    },
  ],
  [
    "ambiguous original job",
    (s) => {
      s.jobs.push({ ...s.jobs[0], id: 599 });
    },
  ],
  [
    "wrong job head",
    (s) => {
      s.jobs[0].head_sha = "c".repeat(40);
    },
  ],
  [
    "wrong job run",
    (s) => {
      s.jobs[0].run_id = 99;
    },
  ],
  [
    "missing permission",
    (s) => {
      s.revokeAt = 1;
    },
  ],
  [
    "head drift before dispatch",
    (s) => {
      s.changeHeadAt = 2;
    },
  ],
  [
    "review drift before dispatch",
    (s) => {
      s.changeReviewAt = 2;
    },
  ],
  [
    "permission revoked before dispatch",
    (s) => {
      s.revokeAt = 3;
    },
  ],
  [
    "API failure",
    (s) => {
      s.apiFailurePath = "/repos/AJHMH/developer-os/pulls/7";
    },
  ],
]) {
  test(`refresh refuses ${name} before any mutation`, (t) => {
    const f = fixture(t);
    change(f.state);
    const r = f.runCli();
    assert.equal(r.status, 1);
    assert.equal(r.report.outcome, "blocked");
    assert.deepEqual(r.rest.writes ?? [], []);
  });
}

test("a dismissal refreshes previously successful approval jobs", (t) => {
  const f = fixture(t);
  f.state.trigger.display_title = f.state.trigger.display_title.replace(
    /submitted$/,
    "dismissed",
  );
  f.state.reviews[0].state = "DISMISSED";
  f.state.jobs.forEach((job) => {
    job.conclusion = "success";
  });
  const r = f.runCli();
  assert.equal(r.status, 0, r.stdout);
  assert.equal(r.rest.writes.length, 2);
});

test("a replay skips jobs evaluated after the review event", (t) => {
  const f = fixture(t);
  f.state.jobs.forEach((job) => {
    job.started_at = new Date(Date.now() - 5000).toISOString();
  });
  const r = f.runCli();
  assert.equal(r.status, 0, r.stdout);
  assert.equal(r.report.outcome, "not-required");
  assert.deepEqual(r.rest.writes ?? [], []);
  assert.equal(r.report.requests.length, 2);
});

test("timestamp ties are refreshed conservatively", (t) => {
  const f = fixture(t);
  f.state.jobs.forEach((job) => {
    job.started_at = f.state.trigger.created_at;
  });
  const r = f.runCli();
  assert.equal(r.status, 0, r.stdout);
  assert.equal(r.rest.writes.length, 2);
});

test("a failed second request preserves confirmed and unconfirmed dispatch evidence", (t) => {
  const f = fixture(t);
  f.state.writeFailure = 2;
  const r = f.runCli();
  assert.equal(r.status, 1);
  assert.equal(r.report.outcome, "blocked");
  assert.deepEqual(r.report.requests, [
    { runId: 100, jobId: 501, status: "requested" },
    { runId: 100, jobId: 502, status: "unconfirmed" },
  ]);
});

test("head drift between requests blocks the second mutation", (t) => {
  const f = fixture(t);
  f.state.changeHeadAt = 3;
  const r = f.runCli();
  assert.equal(r.status, 1);
  assert.deepEqual(r.rest.writes, [
    "/repos/AJHMH/developer-os/actions/jobs/501/rerun",
  ]);
});

test("inspection refuses drift before producing trusted outputs", (t) => {
  const f = fixture(t);
  f.state.changeHeadAt = 2;
  const r = f.runCli("inspect");
  assert.equal(r.status, 1);
  assert.deepEqual(r.rest.writes ?? [], []);
});

test("wrong approved distribution and duplicate arguments cannot request a rerun", (t) => {
  const f = fixture(t);
  const r = f.runCli("apply", ["--mode", "apply"]);
  assert.equal(r.status, 1);
  assert.deepEqual(r.rest.writes ?? [], []);
});

for (const [name, change] of [
  [
    "duplicate run IDs",
    (s) => {
      s.runs.push(structuredClone(s.runs[0]));
    },
  ],
  [
    "duplicate job IDs",
    (s) => {
      s.jobs[1].id = s.jobs[0].id;
    },
  ],
  [
    "changed approved distribution",
    (s) => {
      s.approvedFactoryRevision = "c".repeat(40);
    },
  ],
  [
    "oversized API response",
    (s) => {
      s.oversizePath = "/repos/AJHMH/developer-os/pulls/7";
    },
  ],
  [
    "job never settles",
    (s) => {
      s.virtualClock = true;
      s.pendingPolls = 100;
    },
  ],
])
  test(`refresh refuses ${name} without mutation`, (t) => {
    const f = fixture(t);
    change(f.state);
    const r = f.runCli();
    assert.equal(r.status, 1, r.stdout);
    assert.deepEqual(r.rest.writes ?? [], []);
  });

test("running approval jobs settle within one shared bounded wait before refresh", (t) => {
  const f = fixture(t);
  f.state.virtualClock = true;
  f.state.pendingPolls = 2;
  const r = f.runCli();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.rest.writes.length, 2);
});

test("permission revoked between requests blocks further dispatch", (t) => {
  const f = fixture(t);
  f.state.revokeAt = 5;
  const r = f.runCli();
  assert.equal(r.status, 1);
  assert.deepEqual(r.rest.writes, [
    "/repos/AJHMH/developer-os/actions/jobs/501/rerun",
  ]);
});

test("shared consumer run settles and uses new attempt job IDs before the second rerun", (t) => {
  const f = fixture(t);
  f.state.serialReruns = true;
  f.state.virtualClock = true;
  const r = f.runCli();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.rest.writes, [
    "/repos/AJHMH/developer-os/actions/jobs/501/rerun",
    "/repos/AJHMH/developer-os/actions/jobs/602/rerun",
  ]);
});

test("dispatch waits for unrelated original jobs even when approval jobs are already completed", (t) => {
  const f = fixture(t);
  f.state.serialReruns = true;
  f.state.virtualClock = true;
  f.state.initialRootPolls = 2;
  const r = f.runCli();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.rest.writes, [
    "/repos/AJHMH/developer-os/actions/jobs/501/rerun",
    "/repos/AJHMH/developer-os/actions/jobs/602/rerun",
  ]);
});

test("old completed run metadata cannot release the next rerun before its new attempt is visible", (t) => {
  const f = fixture(t);
  f.state.serialReruns = true;
  f.state.virtualClock = true;
  f.state.rootLagAfterRerun = 2;
  const r = f.runCli();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.rest.writes, [
    "/repos/AJHMH/developer-os/actions/jobs/501/rerun",
    "/repos/AJHMH/developer-os/actions/jobs/602/rerun",
  ]);
});

test("an original workflow that never completes blocks every rerun within the wait budget", (t) => {
  const f = fixture(t);
  f.state.virtualClock = true;
  f.state.initialRootPolls = 100;
  const r = f.runCli();
  assert.equal(r.status, 1);
  assert.deepEqual(r.rest.writes ?? [], []);
});

test("temporary empty job inventory during attempt creation waits before sibling refresh", (t) => {
  const f = fixture(t);
  f.state.serialReruns = true;
  f.state.virtualClock = true;
  f.state.jobGapAfterRerun = 2;
  const r = f.runCli();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(r.rest.writes, [
    "/repos/AJHMH/developer-os/actions/jobs/501/rerun",
    "/repos/AJHMH/developer-os/actions/jobs/602/rerun",
  ]);
});

test("job inventory missing throughout the new-attempt wait blocks the second request", (t) => {
  const f = fixture(t);
  f.state.serialReruns = true;
  f.state.virtualClock = true;
  f.state.jobGapAfterRerun = 100;
  const r = f.runCli();
  assert.equal(r.status, 1);
  assert.deepEqual(r.rest.writes, [
    "/repos/AJHMH/developer-os/actions/jobs/501/rerun",
  ]);
});
