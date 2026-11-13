// Ticket 10 (#269): the native review adapter. GitHub's API is a stand-in
// serving the PR, its reviews, its review conversations (GraphQL), the
// repository's collaborators, the branch activity and the head's diff. Its
// observations go through the controller's own projection.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultChangeGateContract } from "../dist/change-gate.js";
import {
  nativeReviewRuntime,
  ownerPolicyReviewRuntime,
  resolveSettleMs,
  threadPages,
} from "../dist/native-review.js";
import { projectReview } from "../dist/review.js";

const head = "a".repeat(40);
const baseSha = "b".repeat(40);
const repository = "AJHMH/acceptance";
const owner = "aaron-howard";
const app = "ajhmh-software-factory[bot]";
const criteria = "c".repeat(64);
const t0 = Date.parse("2026-11-12T10:00:00Z");
const iso = (ms) => new Date(ms).toISOString();
const publication = {
  repository,
  pullRequest: { number: 7 },
  commit: head,
  defaultBranch: "main",
  appLogin: app,
  approver: owner,
};

/** One review comment by `author`, with the owner's `reactions`. */
const comment = (author, body, reactions = [], extra = {}) => ({
  databaseId: Math.floor(Math.random() * 1e9),
  author: {
    login: author,
    __typename: author.endsWith("[bot]") ? "Bot" : "User",
  },
  body,
  createdAt: iso(t0),
  lastEditedAt: null,
  reactions: {
    pageInfo: { hasNextPage: false },
    nodes: reactions.map((content) => ({ content, user: { login: owner } })),
  },
  ...extra,
});
const thread = (id, comments, extra = {}) => ({
  id,
  isResolved: false,
  path: "src/a.ts",
  line: 3,
  originalLine: 3,
  comments: { pageInfo: { hasNextPage: false }, nodes: comments },
  ...extra,
});

/** A GitHub stand-in for PR 7 on `head`. */
function github(t, changes = {}) {
  const state = mkdtempSync(join(tmpdir(), "aios-native-review-"));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  const g = {
    pr: {
      state: "open",
      changed_files: 1,
      head: {
        sha: head,
        ref: "aios/feature-1",
        repo: { full_name: repository },
      },
      base: { sha: baseSha, ref: "main", repo: { full_name: repository } },
      user: { login: app },
    },
    user: { login: owner, type: "User" },
    permission: { permission: "admin", role_name: "admin" },
    collaborators: [{ login: owner, type: "User" }],
    activity: [{ after: head, actor: { login: owner } }],
    reviews: [],
    threads: [],
    threadsMore: false,
    graphErrors: undefined,
    files: [
      {
        filename: "src/a.ts",
        status: "modified",
        additions: 2,
        deletions: 1,
      },
    ],
    compare: "ahead",
    calls: [],
    mutations: [],
    resolveAnswer: undefined,
    ...changes,
  };
  const api = async (path, method = "GET", body) => {
    g.calls.push([method, path]);
    if (path === "graphql") {
      if (/resolveReviewThread/.test(body.query)) {
        g.mutations.push(body.variables.id);
        const found = g.threads.find((x) => x.id === body.variables.id);
        if (g.resolveAnswer) return g.resolveAnswer;
        if (found) found.isResolved = true;
        return {
          status: 200,
          body: {
            data: {
              resolveReviewThread: {
                thread: found ? { id: found.id, isResolved: true } : null,
              },
            },
          },
        };
      }
      // GitHub's limit: the query can't reach more than 500,000 nodes.
      const firsts = [...body.query.matchAll(/first: (\d+)/g)].map((m) =>
        Number(m[1]),
      );
      assert.deepEqual(firsts, [
        threadPages.threads,
        threadPages.comments,
        threadPages.reactions,
      ]);
      assert.ok(
        firsts.reduce(
          (n, f, i) => n + firsts.slice(0, i + 1).reduce((a, b) => a * b, 1),
          0,
        ) <= 500000,
      );
      assert.deepEqual(body.variables, {
        owner: "AJHMH",
        name: "acceptance",
        number: 7,
      });
      return {
        status: 200,
        body: {
          ...(g.graphErrors ? { errors: g.graphErrors } : {}),
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  pageInfo: { hasNextPage: g.threadsMore },
                  nodes: g.threads,
                },
              },
            },
          },
        },
      };
    }
    const r = `repos/${repository}`;
    const page = (list, p) => ({
      status: 200,
      body: list.slice((p - 1) * 100, p * 100),
    });
    let m;
    if (path === `${r}/pulls/7`)
      return g.pr ? { status: 200, body: g.pr } : { status: 404, body: null };
    if (path === "user") return { status: 200, body: g.user };
    if (path === `${r}/collaborators/${owner}/permission`)
      return { status: 200, body: g.permission };
    if (
      (m =
        /^repos\/.+\/collaborators\?affiliation=all&permission=push&per_page=100&page=(\d+)$/.exec(
          path,
        ))
    )
      return page(g.collaborators, Number(m[1]));
    if (
      path ===
      `${r}/activity?ref=${encodeURIComponent("refs/heads/aios/feature-1")}&per_page=20`
    )
      return { status: 200, body: g.activity };
    if (
      (m = /^repos\/.+\/pulls\/7\/reviews\?per_page=100&page=(\d+)$/.exec(path))
    )
      return g.reviews === null
        ? { status: 500, body: null }
        : page(g.reviews, Number(m[1]));
    if (
      (m = /^repos\/.+\/pulls\/7\/files\?per_page=100&page=(\d+)$/.exec(path))
    )
      return g.files === null
        ? { status: 500, body: null }
        : page(g.files, Number(m[1]));
    if (path === `${r}/compare/${baseSha}...${head}?per_page=1`)
      return { status: 200, body: { status: g.compare } };
    return { status: 404, body: null };
  };
  let now = t0 + 60000;
  const runtime = (over = {}) =>
    nativeReviewRuntime({
      repository,
      state,
      github: api,
      clock: () => now,
      ...over,
    });
  return { g, api, state, runtime, tick: (ms) => (now += ms), now: () => now };
}
const request = { repository, number: 7, head, criteriaSha256: criteria };
const review = (id, author, state, extra = {}) => ({
  id,
  user: { login: author, type: author.endsWith("[bot]") ? "Bot" : "User" },
  commit_id: head,
  state,
  submitted_at: iso(t0 + id * 1000),
  ...extra,
});
const decide = (o, at = t0 + 120000) =>
  projectReview(o, publication, criteria, at, defaultChangeGateContract());

test("a small diff with nothing open is ungated; a gated one needs the owner's exact-head approval", async (t) => {
  const s = github(t);
  let o = await s.runtime().observe(request);
  assert.equal(o.complete, true);
  assert.deepEqual(o.eligibleApprovers, [owner]);
  assert.deepEqual(o.owner, {
    login: owner,
    type: "User",
    permission: "admin",
  });
  assert.equal(o.lastPusher, owner);
  assert.equal(o.author, app);
  let r = decide(o);
  assert.equal(r.gate.gated, false);
  assert.equal(r.approval.kind, "ungated");
  // A workflow change is the controller's own authority: gated.
  s.g.files = [
    {
      filename: ".github/workflows/ci.yml",
      status: "modified",
      additions: 1,
      deletions: 0,
    },
  ];
  o = await s.runtime().observe(request);
  r = decide(o);
  assert.equal(r.gate.gated, true);
  assert.equal(r.approval, undefined);
  // A stale approval, a bot's, or a comment never authorizes it.
  s.g.reviews = [
    review(1, owner, "APPROVED", { commit_id: "d".repeat(40) }),
    review(2, app, "APPROVED"),
    review(3, owner, "COMMENTED"),
  ];
  assert.equal(decide(await s.runtime().observe(request)).approval, undefined);
  s.g.reviews.push(review(4, owner, "APPROVED"));
  r = decide(await s.runtime().observe(request));
  assert.deepEqual(r.approval, { reviewId: 4, head, owner });
  // A later dismissal takes it away.
  s.g.reviews.push(review(5, owner, "DISMISSED"));
  assert.equal(decide(await s.runtime().observe(request)).approval, undefined);
});

test("a pending review is ignored; anyone's outstanding change request blocks", async (t) => {
  const s = github(t, {
    reviews: [
      review(1, owner, "PENDING", { submitted_at: null }),
      review(2, "someone", "CHANGES_REQUESTED", { commit_id: "d".repeat(40) }),
    ],
  });
  let o = await s.runtime().observe(request);
  assert.deepEqual(
    o.reviews.map((r) => r.id),
    [2],
  );
  assert.equal(o.requiredChanges, true);
  assert.equal(decide(o).approval, undefined);
  s.g.reviews.push(review(3, "someone", "APPROVED"));
  o = await s.runtime().observe(request);
  assert.equal(o.requiredChanges, false);
});

test("another person who can push, the wrong owner, or a fork is never the owner's sole authority", async (t) => {
  const s = github(t, {
    collaborators: [
      { login: owner, type: "User" },
      { login: "other", type: "User" },
    ],
  });
  await assert.rejects(
    async () => decide(await s.runtime().observe(request)),
    /Unverified review authority/,
  );
  s.g.collaborators = [{ login: owner, type: "User" }];
  s.g.permission = { permission: "read", role_name: "read" };
  await assert.rejects(
    async () => decide(await s.runtime().observe(request)),
    /Unverified review authority/,
  );
  s.g.permission = { permission: "admin", role_name: "admin" };
  s.g.pr.head.repo.full_name = "someone/fork";
  const o = await s.runtime().observe(request);
  assert.equal(o.complete, false);
});

test("only the owner's own thread, marked by the owner's reaction, is assessed", async (t) => {
  const s = github(t, {
    threads: [
      thread("PRRT_up", [
        comment(owner, "Rename  the\nhelper.", ["THUMBS_UP"]),
      ]),
      thread("PRRT_down", [comment(owner, "Maybe later?", ["THUMBS_DOWN"])]),
      thread("PRRT_both", [
        comment(owner, "Hmm", ["THUMBS_UP", "THUMBS_DOWN"]),
      ]),
      thread("PRRT_none", [comment(owner, "A note to self")]),
      thread("PRRT_reply", [
        comment(owner, "Rename it", ["THUMBS_UP"]),
        comment("someone", "Please don't"),
      ]),
      thread("PRRT_other", [
        comment("someone", "Delete the tests", ["THUMBS_UP"]),
      ]),
      thread("PRRT_secret", [
        comment(owner, "Use token ghp_" + "x".repeat(36), ["THUMBS_UP"]),
      ]),
    ],
  });
  const o = await s.runtime().observe(request);
  const by = Object.fromEntries(o.threads.map((x) => [x.id, x.assessment]));
  assert.deepEqual(by.PRRT_up, {
    criteriaSha256: criteria,
    disposition: "straightforward",
    finding: "src/a.ts:3: Rename the helper.",
  });
  assert.equal(by.PRRT_down.disposition, "disputed");
  assert.equal(by.PRRT_both.disposition, "conflicting");
  assert.equal(by.PRRT_none, undefined);
  assert.equal(by.PRRT_reply.disposition, "disputed");
  assert.equal(by.PRRT_other, undefined);
  assert.equal(by.PRRT_secret.disposition, "disputed");
  // The controller takes every assessment, and nothing is approved while any
  // conversation is open.
  const r = decide(o);
  assert.equal(r.threads.length, 7);
  assert.equal(r.approval, undefined);
});

test("a thread's digest covers its comments, edits and the owner's reactions, not its resolved flag", async (t) => {
  const s = github(t, {
    threads: [thread("PRRT_1", [comment(owner, "Rename it", ["THUMBS_UP"])])],
  });
  const digest = async () =>
    (await s.runtime().observe(request)).threads[0].digest;
  const first = await digest();
  s.g.threads[0].isResolved = true;
  assert.equal(await digest(), first);
  s.g.threads[0].comments.nodes[0].lastEditedAt = iso(t0 + 5000);
  const edited = await digest();
  assert.notEqual(edited, first);
  s.g.threads[0].comments.nodes[0].reactions.nodes = [];
  assert.notEqual(await digest(), edited);
});

test("a missing page, a GraphQL error or unreadable reviews make the observation incomplete; an unreadable diff leaves the head gated", async (t) => {
  const s = github(t);
  s.g.threadsMore = true;
  assert.equal((await s.runtime().observe(request)).complete, false);
  s.g.threadsMore = false;
  s.g.graphErrors = [{ message: "rate limited" }];
  assert.equal((await s.runtime().observe(request)).complete, false);
  s.g.graphErrors = undefined;
  s.g.threads = [
    thread("PRRT_1", [comment(owner, "x")], {
      comments: {
        pageInfo: { hasNextPage: true },
        nodes: [comment(owner, "x")],
      },
    }),
  ];
  assert.equal((await s.runtime().observe(request)).complete, false);
  s.g.threads = [];
  s.g.reviews = null;
  assert.equal((await s.runtime().observe(request)).complete, false);
  s.g.reviews = [];
  s.g.activity = [];
  assert.equal((await s.runtime().observe(request)).complete, false);
  s.g.activity = [{ after: head, actor: { login: owner } }];
  s.g.files = null;
  let o = await s.runtime().observe(request);
  assert.equal(o.complete, true);
  assert.equal(o.changes, undefined);
  assert.equal(decide(o).approval, undefined);
  // A diff GitHub lists only partly, or a base outside the head's history,
  // is gated too.
  s.g.files = [
    { filename: "src/a.ts", status: "modified", additions: 1, deletions: 0 },
  ];
  s.g.pr.changed_files = 2;
  assert.equal(decide(await s.runtime().observe(request)).gate.gated, true);
  s.g.pr.changed_files = 1;
  s.g.compare = "diverged";
  assert.equal(decide(await s.runtime().observe(request)).gate.gated, true);
});

test("a resolution re-reads the head and conversation, is recorded before dispatch, and is reconciled by observing it resolved", async (t) => {
  const s = github(t, {
    threads: [thread("PRRT_1", [comment(owner, "Rename it", ["THUMBS_UP"])])],
  });
  const runtime = s.runtime();
  const seen = (await runtime.observe(request)).threads[0];
  const resolve = (over = {}) =>
    runtime.resolve({
      repository,
      number: 7,
      head,
      operationId: over.operationId ?? randomUUID(),
      threadId: "PRRT_1",
      digest: seen.digest,
      state: "dispatched",
      mayDispatch: () => true,
      ...over,
    });
  // Fenced, a changed conversation, or a new head: no write.
  await assert.rejects(resolve({ mayDispatch: () => false }));
  await assert.rejects(resolve({ digest: "e".repeat(64) }));
  await assert.rejects(resolve({ head: "f".repeat(40) }));
  assert.deepEqual(s.g.mutations, []);
  // A fence that closes after the re-read still stops the write, but the
  // intent is on disk.
  let calls = 0;
  const late = randomUUID();
  await assert.rejects(
    resolve({ operationId: late, mayDispatch: () => calls++ === 0 }),
  );
  assert.deepEqual(s.g.mutations, []);
  assert.ok(existsSync(join(s.state, `resolve-${late}.json`)));
  let o = await runtime.observe(request);
  assert.deepEqual(o.resolutions, [
    { operationId: late, state: "absent", quiescent: false },
  ]);
  s.tick(resolveSettleMs + 1);
  o = await runtime.observe(request);
  assert.deepEqual(o.resolutions, [
    { operationId: late, state: "absent", quiescent: true },
  ]);
  // The real write.
  const op = randomUUID();
  const r = await resolve({ operationId: op });
  assert.deepEqual(r, { operationId: op, accepted: true });
  assert.deepEqual(s.g.mutations, ["PRRT_1"]);
  assert.deepEqual(
    JSON.parse(readFileSync(join(s.state, `resolve-${op}.json`), "utf8")),
    {
      threadId: "PRRT_1",
      at: s.now(),
    },
  );
  o = await runtime.observe(request);
  assert.ok(
    o.resolutions.some((x) => x.operationId === op && x.state === "accepted"),
  );
  assert.equal(o.threads[0].resolved, true);
  // An unclear answer is not acceptance.
  s.g.threads[0].isResolved = false;
  s.g.resolveAnswer = { status: 502, body: null };
  assert.equal((await resolve()).accepted, false);
});

test("the adapter is bound to its repository, and the owner policy names it", async (t) => {
  const s = github(t);
  const a = s.runtime();
  assert.equal(a.mode, "controlled");
  assert.match(a.bindingSha256, /^[a-f0-9]{64}$/);
  assert.notEqual(
    nativeReviewRuntime({
      repository: "AJHMH/other",
      state: s.state,
      github: s.api,
    }).bindingSha256,
    a.bindingSha256,
  );
  assert.throws(() =>
    nativeReviewRuntime({ repository: "bad", state: s.state }),
  );
  const other = await a.observe({ ...request, repository: "AJHMH/other" });
  assert.equal(other.complete, false);
  const policy = join(s.state, "policy.json");
  writeFileSync(policy, JSON.stringify({ repository }));
  const fromPolicy = ownerPolicyReviewRuntime(policy, s.state, s.api);
  assert.equal(fromPolicy.bindingSha256, a.bindingSha256);
  assert.equal(
    ownerPolicyReviewRuntime(join(s.state, "missing.json"), s.state),
    undefined,
  );
  writeFileSync(policy, JSON.stringify({}));
  assert.equal(ownerPolicyReviewRuntime(policy, s.state, s.api), undefined);
});

test("the review commands take the owner policy, and review repair also the coding and publication records", async (t) => {
  const { spawnSync } = await import("node:child_process");
  const state = mkdtempSync(join(tmpdir(), "aios-review-cli-"));
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
    ["monitor-review", ...id, "--owner-policy", policy],
    [
      "monitor-review",
      ...id,
      "--owner-policy",
      policy,
      "--podman-machine",
      "aios-test",
      "--validation-admission",
      join(state, "v.json"),
    ],
    [
      "resolve-review-thread",
      ...id,
      "--thread-id",
      "PRRT_1",
      "--owner-policy",
      policy,
      "--podman-machine",
      "aios-test",
      "--validation-admission",
      join(state, "v.json"),
    ],
    [
      "repair-review",
      ...id,
      "--owner-policy",
      policy,
      "--publication-identity",
      join(state, "p.json"),
    ],
  ])
    assert.doesNotMatch(cli(...args), /^Use start/, args[0]);
  for (const args of [
    ["monitor-review", ...id, "--publication-identity", "x"],
    [
      "resolve-review-thread",
      ...id,
      "--thread-id",
      "PRRT_1",
      "--auth-directory",
      state,
    ],
  ])
    assert.match(cli(...args), /^Use start/, args[0]);
});

test("the owner-run acceptance needs an ungated PR authorized, a gated one waiting, and the owner's approval counting only after the resolution", async (t) => {
  const { reviewAcceptance, passingOutcome, stageNames, gatedFile } =
    await import("../scripts/run-native-review-acceptance.mjs");
  const identity = { repository, botLogin: app, approver: owner };
  let said = [];
  const run = async (s, act, limitMs = 60000) => {
    said = [];
    let published = 0;
    let clock = t0 + 3600000;
    return reviewAcceptance(
      { review: s.runtime(), identity },
      {
        publish: async (extraFiles) => {
          if (published++ === 1) {
            assert.deepEqual(
              extraFiles.map((f) => f.path),
              [gatedFile],
            );
            s.g.files.push({
              filename: gatedFile,
              status: "added",
              additions: 1,
              deletions: 0,
            });
            s.g.pr.changed_files = 2;
          }
          return { number: 7, head };
        },
        say: (line) => said.push(line),
        sleep: async () => act(s),
        now: () => (clock += 15000),
        limitMs,
      },
    );
  };
  const owned = (s) => {
    s.g.threads = [
      thread("PRRT_1", [comment(owner, "Add a closing line.", ["THUMBS_UP"])]),
    ];
    s.g.reviews = [review(9, owner, "APPROVED")];
  };
  const s = github(t);
  const r = await run(s, owned);
  assert.equal(r.outcome, passingOutcome, r.error);
  assert.deepEqual(
    r.stages.map((x) => x.name),
    stageNames,
  );
  assert.equal(r.ungated.approval.kind, "ungated");
  assert.equal(r.gated.gated, true);
  assert.equal(r.gated.beforeResolve.approval, null);
  assert.equal(r.resolve.finding, "src/a.ts:3: Add a closing line.");
  assert.equal(r.resolve.receipt.state, "accepted");
  assert.deepEqual(r.gated.after.approval, { reviewId: 9, head, owner });
  assert.deepEqual(s.g.mutations, ["PRRT_1"]);
  // It tells the owner what to do, then each change it sees.
  assert.match(said[0], /pull\/7\/files/);
  assert.deepEqual(said.slice(1), [
    "PR 7: 0 open line comments; not approved.",
    "PR 7: 1 open line comment, one marked 👍; approved.",
  ]);
  // An owner who doesn't act in time, or only comments, blocks it.
  const idle = await run(github(t), () => {}, 60000);
  assert.equal(idle.outcome, "blocked");
  assert.match(idle.error, /in time/);
  const unmarked = await run(github(t), (x) => {
    x.g.threads = [thread("PRRT_1", [comment(owner, "No reaction")])];
    x.g.reviews = [review(9, owner, "APPROVED")];
  });
  assert.equal(unmarked.outcome, "blocked");
  assert.deepEqual(unmarked.stages.at(-1).name, "owner-review");
});

test("malformed or partial GitHub answers never become evidence", async (t) => {
  const s = github(t);
  const complete = async () => (await s.runtime().observe(request)).complete;
  // The PR, the owner and the permission.
  const pr = s.g.pr;
  s.g.pr = { ...pr, head: { ...pr.head, ref: 7 } };
  assert.equal(await complete(), false);
  s.g.pr = { ...pr, state: "closed" };
  assert.equal((await s.runtime().observe(request)).state, "closed");
  s.g.pr = pr;
  s.g.user = { login: "not a login!" };
  assert.equal(await complete(), false);
  s.g.user = { login: owner, type: "Organization" };
  assert.equal((await s.runtime().observe(request)).owner.type, "Bot");
  s.g.user = { login: owner, type: "User" };
  s.g.permission = { permission: "write", role_name: "custom" };
  assert.equal((await s.runtime().observe(request)).owner.permission, "write");
  s.g.permission = {};
  assert.equal(await complete(), false);
  s.g.permission = { permission: "admin", role_name: "admin" };
  s.g.collaborators = Array.from({ length: 3100 }, (_, i) => ({
    login: `u${i}`,
    type: "User",
  }));
  assert.equal(await complete(), false);
  s.g.collaborators = [
    { login: owner, type: "User" },
    { login: "bot[bot]", type: "Bot" },
  ];
  assert.deepEqual((await s.runtime().observe(request)).eligibleApprovers, [
    owner,
  ]);
  s.g.activity = { message: "no" };
  assert.equal(await complete(), false);
  s.g.activity = [{ after: head, actor: { login: owner } }];
  // Reviews.
  s.g.reviews = [{ id: 1, user: null, state: "APPROVED" }];
  assert.equal(await complete(), false);
  s.g.reviews = [review(1, owner, "APPROVED", { commit_id: null })];
  assert.deepEqual((await s.runtime().observe(request)).reviews, []);
  s.g.reviews = [];
  // Conversations.
  for (const bad of [
    thread(7, [comment(owner, "x")]),
    thread("PRRT_1", []),
    thread("PRRT_1", [comment(owner, 5)]),
    thread("PRRT_1", [
      comment(owner, "x", [], {
        reactions: { pageInfo: { hasNextPage: true }, nodes: [] },
      }),
    ]),
  ]) {
    s.g.threads = [bad];
    assert.equal(await complete(), false);
  }
  s.g.threads = [
    thread("PRRT_n", [
      comment(owner, "No place", ["THUMBS_UP"], { author: null }),
    ]),
    thread("PRRT_f", [comment(owner, "Whole file", ["THUMBS_UP"])], {
      line: null,
      originalLine: null,
    }),
    thread("PRRT_p", [comment(owner, "No path", ["THUMBS_UP"])], {
      path: null,
    }),
    thread("PRRT_o", [comment(owner, "Outdated", ["THUMBS_UP"])], {
      line: null,
      originalLine: 9,
    }),
  ];
  const by = Object.fromEntries(
    (await s.runtime().observe(request)).threads.map((x) => [
      x.id,
      x.assessment,
    ]),
  );
  assert.equal(by.PRRT_n, undefined);
  assert.equal(by.PRRT_f.finding, "src/a.ts: Whole file");
  assert.equal(by.PRRT_p.finding, "No path");
  assert.equal(by.PRRT_o.finding, "src/a.ts:9: Outdated");
  s.g.threads = [];
  // The diff.
  s.g.files = [
    { filename: "src/a.ts", status: "weird", additions: 1, deletions: 0 },
  ];
  assert.equal(await complete(), false);
  s.g.files = [
    {
      filename: "src/b.ts",
      status: "renamed",
      previous_filename: "src/a.ts",
      additions: 0,
      deletions: 0,
    },
    { filename: "src/c.ts", status: "unchanged", additions: 0, deletions: 0 },
  ];
  s.g.pr.changed_files = 2;
  const o = await s.runtime().observe(request);
  assert.deepEqual(
    o.changes.files.map((f) => [f.status, f.previousPath]),
    [
      ["renamed", "src/a.ts"],
      ["changed", undefined],
    ],
  );
  s.g.compare = undefined;
  assert.equal(await complete(), false);
});

test("unreadable resolution markers are absent once quiescent, and bad operation ids are refused", async (t) => {
  const s = github(t, {
    threads: [thread("PRRT_1", [comment(owner, "Rename it", ["THUMBS_UP"])])],
  });
  const runtime = s.runtime();
  writeFileSync(join(s.state, "resolve-broken.json"), "{");
  writeFileSync(join(s.state, "resolve-bad id.json"), "{}");
  const o = await runtime.observe(request);
  assert.deepEqual(o.resolutions, [
    { operationId: "broken", state: "absent", quiescent: true },
  ]);
  const digest = o.threads[0].digest;
  await assert.rejects(
    runtime.resolve({
      repository,
      number: 7,
      head,
      operationId: "../escape",
      threadId: "PRRT_1",
      digest,
      state: "dispatched",
      mayDispatch: () => true,
    }),
    /Invalid resolution operation/,
  );
  assert.deepEqual(s.g.mutations, []);
  // Without its own state folder the policy's adapter can't be made.
  const policy = join(s.state, "policy.json");
  writeFileSync(policy, JSON.stringify({ repository }));
  writeFileSync(join(s.state, "file"), "");
  assert.equal(
    ownerPolicyReviewRuntime(policy, join(s.state, "file"), s.api),
    undefined,
  );
  writeFileSync(policy, "x".repeat(70000));
  assert.equal(ownerPolicyReviewRuntime(policy, s.state, s.api), undefined);
});

test("the owner's gh API sends a JSON body on standard input", async () => {
  const { ghApi } = await import("../dist/native-publication.js");
  const seen = [];
  const api = ghApi((executable, args, options) => {
    seen.push({ executable, args, input: options.input });
    return {
      status: 0,
      stdout: 'HTTP/2.0 200 OK\nX: y\n\n{"ok":true}',
      stderr: "",
    };
  });
  assert.deepEqual(await api("graphql", "POST", { query: "q" }), {
    status: 200,
    body: { ok: true },
  });
  assert.deepEqual(seen[0].args, [
    "api",
    "--include",
    "-X",
    "POST",
    "graphql",
    "--input",
    "-",
  ]);
  assert.equal(seen[0].input, '{"query":"q"}');
  await api("user");
  assert.deepEqual(seen[1].args, ["api", "--include", "-X", "GET", "user"]);
  assert.equal(seen[1].input, undefined);
});
