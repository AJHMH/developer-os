// Ticket 11 (#270): the native fast-forward merge. The remote is a real bare
// Git repository over file://, and GitHub's API a stand-in that reads it: the
// PR, main's tip, reachability, the owner's permission and the branch rules.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  mergeSettleMs,
  nativeMergeRuntime,
  ownerPolicyMergeRuntime,
} from "../dist/native-merge.js";
import { defaultRunner } from "../dist/native-publication.js";

const repository = "AJHMH/acceptance";
const owner = "aaron-howard";

function sh(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
const commit = (work, file, text, message) => {
  writeFileSync(join(work, file), text);
  sh(work, "add", file);
  sh(
    work,
    "-c",
    "user.name=Owner",
    "-c",
    "user.email=owner@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=/nonexistent",
    "commit",
    "-q",
    "-m",
    message,
  );
  return sh(work, "rev-parse", "HEAD");
};

/** A bare remote with `main` at A and PR 7's head B, a child of A. */
function remote(t, changes = {}) {
  const root = mkdtempSync(join(tmpdir(), "aios-native-merge-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const work = join(root, "work"),
    bare = join(root, "remote.git");
  sh(root, "init", "-q", "-b", "main", work);
  const a = commit(work, "index.html", "<h1>Contact</h1>\n", "base");
  sh(work, "switch", "-q", "-c", "feature");
  const b = commit(
    work,
    "index.html",
    "<h1>Contact</h1>\n<p>Hint</p>\n",
    "hint",
  );
  sh(root, "init", "-q", "--bare", "-b", "main", bare);
  sh(work, "push", "-q", bare, "main", "feature");
  sh(bare, "update-ref", "refs/pull/7/head", b);
  const policyPath = join(root, "policy.json");
  writeFileSync(
    policyPath,
    JSON.stringify({
      repository,
      publicationLogin: owner,
      requiredChecks: ["pr-ci"],
    }),
  );
  const g = {
    user: owner,
    permission: { permission: "admin", role_name: "admin" },
    rules: [
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
    headRepo: repository,
    unreadable: new Set(),
    ...changes,
  };
  const tip = () => sh(bare, "rev-parse", "refs/heads/main");
  const contains = (main, head) =>
    spawnSync("git", ["merge-base", "--is-ancestor", head, main], { cwd: bare })
      .status === 0;
  const api = async (path) => {
    if (g.unreadable.has(path.split("?")[0].split("/").slice(-1)[0]))
      return { status: 500, body: null };
    const r = `repos/${repository}`;
    let m;
    if (path === `${r}/pulls/7`) {
      const head = sh(bare, "rev-parse", "refs/pull/7/head");
      const merged = contains(tip(), head);
      return {
        status: 200,
        body: {
          state: merged ? "closed" : "open",
          merged,
          head: { sha: head, repo: { full_name: g.headRepo } },
          base: { ref: "main", repo: { full_name: repository } },
        },
      };
    }
    if (path === "user") return { status: 200, body: { login: g.user } };
    if (path === `${r}/collaborators/${owner}/permission`)
      return { status: 200, body: g.permission };
    if (path === `${r}/git/ref/heads/main`)
      return { status: 200, body: { object: { sha: tip() } } };
    if (path === `${r}/rules/branches/main`)
      return { status: 200, body: g.rules };
    if (
      (m =
        /^repos\/.+\/compare\/([a-f0-9]{40})\.\.\.([a-f0-9]{40})\?per_page=1$/.exec(
          path,
        ))
    ) {
      const [head, main] = [m[1], m[2]];
      return {
        status: 200,
        body: {
          status:
            head === main
              ? "identical"
              : contains(main, head)
                ? "ahead"
                : contains(head, main)
                  ? "behind"
                  : "diverged",
        },
      };
    }
    return { status: 404, body: null };
  };
  const metadata = join(root, "metadata");
  let now = Date.parse("2026-11-13T10:00:00Z");
  const commands = [];
  const runtime = (over = {}) =>
    nativeMergeRuntime({
      repository,
      login: owner,
      policyPath,
      requiredChecks: ["pr-ci"],
      metadata,
      remoteUrl: "file://" + bare,
      github: api,
      run: (cmd, args, opts) => {
        commands.push(args);
        return (over.run ?? defaultRunner)(cmd, args, opts);
      },
      clock: () => now,
      sleep: async () => {},
      ...over,
    });
  const attempt = (changes = {}) => ({
    operationId: randomUUID(),
    publicationId: randomUUID(),
    bindingSha256: "0".repeat(64),
    policySha256: "1".repeat(64),
    repository,
    number: 7,
    head: b,
    base: "main",
    baseRevision: a,
    fence: 1,
    state: "dispatched",
    mayDispatch: () => true,
    ...changes,
  });
  return {
    root,
    work,
    bare,
    a,
    b,
    g,
    api,
    tip,
    policyPath,
    metadata,
    commands,
    runtime,
    attempt,
    tick: (ms) => (now += ms),
  };
}

test("an observation reports main's revision, the policy digest, the owner as actor and GitHub's enforcement", async (t) => {
  const s = remote(t);
  const o = await s.runtime().observe({ repository, number: 7, head: s.b });
  assert.deepEqual(o, {
    repository,
    number: 7,
    head: s.b,
    base: "main",
    baseRevision: s.a,
    policySha256: createHash("sha256")
      .update(
        JSON.stringify({
          repository,
          publicationLogin: owner,
          requiredChecks: ["pr-ci"],
        }),
      )
      .digest("hex"),
    complete: true,
    state: "open",
    actor: owner,
    mergeAllowed: true,
    protectionsEnforced: true,
    conditionalHead: true,
    conditionalBase: true,
    gatesEnforced: true,
  });
  // Weaker rules, another login, read-only access, a fork, or an unreadable
  // answer never authorize a merge.
  s.g.rules = s.g.rules.filter((r) => r.type !== "required_signatures");
  assert.equal(
    (await s.runtime().observe({ repository, number: 7, head: s.b }))
      .protectionsEnforced,
    false,
  );
  s.g.rules = [
    { type: "deletion" },
    { type: "non_fast_forward" },
    { type: "required_signatures" },
  ];
  assert.equal(
    (await s.runtime().observe({ repository, number: 7, head: s.b }))
      .gatesEnforced,
    false,
  );
  s.g.user = "someone";
  assert.equal(
    (await s.runtime().observe({ repository, number: 7, head: s.b }))
      .mergeAllowed,
    false,
  );
  s.g.user = owner;
  s.g.permission = { permission: "read", role_name: "read" };
  assert.equal(
    (await s.runtime().observe({ repository, number: 7, head: s.b }))
      .mergeAllowed,
    false,
  );
  s.g.headRepo = "someone/fork";
  assert.equal(
    (await s.runtime().observe({ repository, number: 7, head: s.b })).complete,
    false,
  );
  s.g.headRepo = repository;
  s.g.unreadable.add("main");
  assert.equal(
    (await s.runtime().observe({ repository, number: 7, head: s.b })).complete,
    false,
  );
  assert.equal(
    (
      await s
        .runtime()
        .observe({ repository: "AJHMH/other", number: 7, head: s.b })
    ).complete,
    false,
  );
  // The policy's digest is read each time, so an edit shows.
  s.g.unreadable.clear();
  writeFileSync(s.policyPath, "{}");
  const changed = await s
    .runtime()
    .observe({ repository, number: 7, head: s.b });
  assert.equal(
    changed.policySha256,
    createHash("sha256").update("{}").digest("hex"),
  );
});

test("a merge fast-forwards main to exactly the head, recorded before the push, and is confirmed by GitHub", async (t) => {
  const s = remote(t);
  const a = s.attempt();
  const r = await s.runtime().merge(a);
  assert.deepEqual(r, {
    operationId: a.operationId,
    state: "merged",
    head: s.b,
    baseRevision: s.a,
    mergeCommit: s.b,
    mainRevision: s.b,
    reachable: true,
  });
  assert.equal(s.tip(), s.b);
  assert.ok(existsSync(join(s.metadata, `merge-${a.operationId}.json`)));
  // The push named the exact head and leased main's expected revision.
  const push = s.commands.find((c) => c.includes("push"));
  assert.ok(push.includes(`--force-with-lease=refs/heads/main:${s.a}`));
  assert.ok(push.includes(`${s.b}:refs/heads/main`));
  // Reconciling finds the same merge, with no second write.
  const pushes = s.commands.filter((c) => c.includes("push")).length;
  assert.deepEqual(await s.runtime().reconcile(a), r);
  assert.equal(s.commands.filter((c) => c.includes("push")).length, pushes);
});

test("a moved main, a moved head, a non-fast-forward or a closed fence never pushes", async (t) => {
  const s = remote(t);
  // Main advanced past the expected revision.
  const other = join(s.root, "other");
  sh(s.root, "clone", "-q", s.bare, other);
  const advanced = commit(other, "README", "x\n", "elsewhere");
  sh(other, "push", "-q", "origin", "main");
  await assert.rejects(s.runtime().merge(s.attempt()), /fast-forward/);
  assert.equal(s.tip(), advanced);
  // A head GitHub no longer has for the PR.
  await assert.rejects(
    s
      .runtime()
      .merge(s.attempt({ head: "c".repeat(40), baseRevision: advanced })),
    /fast-forward/,
  );
  // The PR head doesn't descend from main: not a fast-forward.
  await assert.rejects(
    s.runtime().merge(s.attempt({ baseRevision: advanced })),
    /fast-forward/,
  );
  assert.equal(s.tip(), advanced);
  // Fenced before or after the fetch.
  const fresh = remote(t);
  await assert.rejects(
    fresh.runtime().merge(fresh.attempt({ mayDispatch: () => false })),
  );
  let calls = 0;
  await assert.rejects(
    fresh.runtime().merge(fresh.attempt({ mayDispatch: () => calls++ === 0 })),
    /fenced/,
  );
  assert.equal(fresh.tip(), fresh.a);
  assert.ok(!fresh.commands.some((c) => c.includes("push")));
  await assert.rejects(
    fresh.runtime().merge(fresh.attempt({ operationId: "../x" })),
    /Invalid merge operation/,
  );
  await assert.rejects(
    fresh.runtime().merge(fresh.attempt({ base: "main; rm" })),
    /invalid/,
  );
});

test("a push that loses the race to main is absent, and settled only after it can no longer land", async (t) => {
  const s = remote(t);
  const other = join(s.root, "other");
  sh(s.root, "clone", "-q", s.bare, other);
  // Main moves between the fetch and the push: the lease refuses it.
  const racing = (cmd, args, opts) => {
    if (args.includes("push")) {
      commit(other, "README", "x\n", "race");
      sh(other, "push", "-q", "origin", "main");
    }
    return defaultRunner(cmd, args, opts);
  };
  const a = s.attempt();
  const r = await s.runtime({ run: racing }).merge(a);
  assert.deepEqual(r, {
    operationId: a.operationId,
    state: "absent",
    quiescent: false,
  });
  assert.notEqual(s.tip(), s.b);
  s.tick(mergeSettleMs + 1);
  assert.deepEqual(await s.runtime().reconcile(a), {
    operationId: a.operationId,
    state: "absent",
    quiescent: true,
  });
  // Unreadable GitHub answers are unknown, never absent.
  s.g.unreadable.add("7");
  assert.deepEqual(await s.runtime().reconcile(a), { state: "unknown" });
  assert.deepEqual(
    await s.runtime().reconcile({ ...a, repository: "AJHMH/other" }),
    { state: "unknown" },
  );
});

test("the merge is bound to its identity, and the owner policy names it", async (t) => {
  const s = remote(t);
  const a = s.runtime();
  assert.equal(a.mode, "controlled");
  assert.match(a.bindingSha256, /^[a-f0-9]{64}$/);
  assert.notEqual(
    s.runtime({ login: "someone" }).bindingSha256,
    a.bindingSha256,
  );
  assert.throws(
    () => s.runtime({ requiredChecks: [] }),
    /Invalid merge identity/,
  );
  assert.throws(
    () => s.runtime({ remoteUrl: "ssh://x" }),
    /Invalid merge remote/,
  );
  const state = join(s.root, "state");
  const fromPolicy = ownerPolicyMergeRuntime(s.policyPath, state, s.api);
  assert.equal(
    fromPolicy.bindingSha256,
    nativeMergeRuntime({
      repository,
      login: owner,
      policyPath: s.policyPath,
      requiredChecks: ["pr-ci"],
      metadata: join(state, "m"),
    }).bindingSha256,
  );
  writeFileSync(s.policyPath, JSON.stringify({ repository }));
  assert.equal(ownerPolicyMergeRuntime(s.policyPath, state, s.api), undefined);
  assert.equal(
    ownerPolicyMergeRuntime(join(s.root, "missing.json"), state),
    undefined,
  );
  writeFileSync(
    s.policyPath,
    JSON.stringify({
      repository,
      publicationLogin: owner,
      requiredChecks: ["pr-ci"],
    }),
  );
  writeFileSync(join(s.root, "file"), "");
  assert.equal(
    ownerPolicyMergeRuntime(s.policyPath, join(s.root, "file"), s.api),
    undefined,
  );
});

test("the merge commands take the owner policy, and merge also the validation runtime and production admission", async (t) => {
  const state = mkdtempSync(join(tmpdir(), "aios-merge-cli-"));
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
  // A policy naming the repository, merge identity and a GitHub Actions PR
  // check, so the CLI builds each runtime before the controller refuses.
  writeFileSync(
    policy,
    JSON.stringify({
      repository,
      defaultBranch: "main",
      publicationLogin: owner,
      requiredChecks: ["pr-ci"],
      validationContract: {
        checks: [
          {
            id: "pr-ci",
            scope: "pr",
            publisher: "github-actions",
            workflow: ".github/workflows/ci.yml@main",
          },
        ],
      },
    }),
    { mode: 0o600 },
  );
  for (const args of [
    ["merge-feature", ...id, "--owner-policy", policy],
    [
      "merge-feature",
      ...id,
      "--owner-policy",
      policy,
      "--podman-machine",
      "aios-test",
      "--validation-admission",
      join(state, "v.json"),
      "--production-admission",
      join(state, "p.json"),
    ],
    ["reconcile-merge", ...id, "--owner-policy", policy],
    [
      "refresh-merge-base",
      ...id,
      "--owner-policy",
      policy,
      "--publication-identity",
      join(state, "i.json"),
    ],
  ])
    assert.doesNotMatch(cli(...args), /^Use start/, args[0]);
  for (const args of [
    ["reconcile-merge", ...id, "--production-admission", "x"],
    ["merge-feature", ...id, "--auth-directory", state],
  ])
    assert.match(cli(...args), /^Use start/, args[0]);
});

test("a merge waits for GitHub to link the PR, and an unlinked or unreadable merge is unknown, never absent", async (t) => {
  // GitHub marks the PR merged a few reads after the push.
  const s = remote(t);
  let reads = 0;
  const lagging = async (path, ...rest) => {
    const r = await s.api(path, ...rest);
    if (path === `repos/${repository}/pulls/7` && r.body.merged && reads++ < 2)
      return { ...r, body: { ...r.body, merged: false } };
    return r;
  };
  const slept = [];
  const a = s.attempt();
  const r = await s
    .runtime({ github: lagging, sleep: async (ms) => slept.push(ms) })
    .merge(a);
  assert.equal(r.state, "merged");
  assert.deepEqual(slept, [2000, 2000]);
  // Never linked within the wait: unknown, so the controller keeps it uncertain.
  const never = async (path, ...rest) => {
    const r = await s.api(path, ...rest);
    return path === `repos/${repository}/pulls/7`
      ? { ...r, body: { ...r.body, merged: false } }
      : r;
  };
  let clock = 0;
  const b = remote(t);
  const unlinked = await b
    .runtime({
      github: async (path, ...rest) => {
        const r = await b.api(path, ...rest);
        return path === `repos/${repository}/pulls/7`
          ? { ...r, body: { ...r.body, merged: false } }
          : r;
      },
      clock: () => clock,
      sleep: async () => (clock += 10000),
    })
    .merge(b.attempt());
  assert.deepEqual(unlinked, { state: "unknown" });
  assert.deepEqual(await s.runtime({ github: never }).reconcile(a), {
    state: "unknown",
  });
  // An unreadable comparison is unknown too.
  const c = remote(t);
  const behind = c.attempt();
  const noCompare = async (path, ...rest) =>
    path.includes("/compare/")
      ? { status: 500, body: null }
      : c.api(path, ...rest);
  assert.deepEqual(await c.runtime({ github: noCompare }).reconcile(behind), {
    state: "unknown",
  });
});

test("a missing policy, rules without check lists, or a Git that won't run never authorize a merge", async (t) => {
  const s = remote(t);
  rmSync(s.policyPath);
  s.g.rules = [
    { type: "deletion" },
    { type: "non_fast_forward" },
    { type: "required_signatures" },
    { type: "required_status_checks" },
  ];
  const o = await s.runtime().observe({ repository, number: 7, head: s.b });
  assert.equal(o.policySha256, "");
  assert.equal(o.gatesEnforced, false);
  // GitHub over HTTPS, with a Git that fails: no metadata, then no fetch.
  const failing = () => ({ status: 1, stdout: "", stderr: "" });
  const https = s.runtime({
    remoteUrl: undefined,
    run: failing,
    metadata: join(s.root, "m1"),
  });
  await assert.rejects(https.merge(s.attempt()), /metadata unavailable/);
  let calls = 0;
  const fetchFails = (cmd, args, opts) =>
    calls++ === 0 ? defaultRunner(cmd, args, opts) : failing();
  await assert.rejects(
    s
      .runtime({
        remoteUrl: undefined,
        run: fetchFails,
        metadata: join(s.root, "m2"),
      })
      .merge(s.attempt()),
    /fast-forward/,
  );
  // A policy that isn't a small file is refused.
  writeFileSync(s.policyPath, "x".repeat(70000));
  assert.equal(
    ownerPolicyMergeRuntime(s.policyPath, join(s.root, "state")),
    undefined,
  );
});
