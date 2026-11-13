// Ticket 14 (#273): native branch cleanup, against a real bare remote over
// file://, a real cloned checkout and a GitHub API stand-in for branch
// protection, rulesets and PR history.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  branchCleanupControls,
  cleanupDecision,
} from "../dist/branch-cleanup.js";
import {
  nativeBranchCleanupRuntime,
  ownerPolicyBranchCleanupRuntime,
} from "../dist/native-branch-cleanup.js";
import { defaultRunner } from "../dist/native-publication.js";

const repository = "AJHMH/acceptance";
const sh = (cwd, ...args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
const ok = (cwd, ...args) =>
  spawnSync("git", args, { cwd, encoding: "utf8" }).status === 0;
const commit = (work, text, message) => {
  writeFileSync(join(work, "index.html"), text);
  sh(work, "add", "index.html");
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

/** Main at M in the remote and the checkout, with a branch of each kind. */
function setup(t) {
  const root = mkdtempSync(join(tmpdir(), "aios-native-cleanup-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bare = join(root, "remote.git"),
    author = join(root, "author"),
    checkout = join(root, "checkout"),
    policyPath = join(root, "policy.json");
  writeFileSync(policyPath, JSON.stringify({ repository }), { mode: 0o600 });
  sh(root, "init", "-q", "--bare", "-b", "main", bare);
  sh(root, "init", "-q", "-b", "main", author);
  const base = commit(author, "<h1>Contact</h1>\n", "page");
  // merged: an ordinary ancestor of main.
  const merged = commit(author, "<h1>Contact</h1>\n<p>1</p>\n", "one");
  sh(author, "push", "-q", bare, `${merged}:refs/heads/aios/merged`);
  // squashed: its own commit, merged as a separate squash commit.
  sh(author, "switch", "-q", "-c", "squashed", base);
  const squashedTip = commit(author, "<p>squashed</p>\n", "squash me");
  sh(author, "switch", "-q", "main");
  const squash = commit(author, "<h1>Contact</h1>\n<p>2</p>\n", "squash (#2)");
  // unmerged, newer and protected tips.
  sh(author, "switch", "-q", "-c", "unmerged", squash);
  const unmergedTip = commit(author, "<p>new work</p>\n", "unmerged");
  sh(author, "switch", "-q", "main");
  sh(
    author,
    "push",
    "-q",
    bare,
    "main",
    `${squashedTip}:refs/heads/aios/squashed`,
    `${unmergedTip}:refs/heads/aios/unmerged`,
    `${unmergedTip}:refs/heads/aios/newer`,
    `${merged}:refs/heads/release`,
    `${merged}:refs/heads/feat/factory-remediation-${"a".repeat(32)}`,
  );
  sh(root, "clone", "-q", bare, checkout);
  sh(checkout, "remote", "set-url", "origin", "file://" + bare);
  sh(checkout, "branch", "aios/merged", merged);
  sh(checkout, "branch", "aios/squashed", squashedTip);
  sh(checkout, "branch", "in-worktree", merged);
  sh(checkout, "worktree", "add", "-q", join(root, "wt"), "in-worktree");
  const main = squash;
  const api = {
    calls: [],
    protected: new Set(),
    deletionRule: new Set(["release"]),
    pulls: new Map([
      [
        "aios/squashed",
        [{ head: squashedTip, merge: squash, merged_at: "2026-11-13T10:00Z" }],
      ],
      [
        "aios/newer",
        [{ head: merged, merge: merged, merged_at: "2026-11-13T09:00Z" }],
      ],
    ]),
    tipOverride: new Map(),
    fail: new Set(),
  };
  const github = async (path, method = "GET") => {
    api.calls.push(`${method} ${path}`);
    for (const f of api.fail)
      if (path.includes(f)) return { status: 502, body: null };
    const repo = `repos/${repository}/`;
    assert.ok(path.startsWith(repo), path);
    const rest = path.slice(repo.length);
    let m;
    if ((m = /^branches\?per_page=100&page=(\d+)$/.exec(rest))) {
      const all = sh(
        root,
        "--git-dir",
        bare,
        "for-each-ref",
        "--format=%(refname:strip=2) %(objectname)",
        "refs/heads",
      )
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          const [name, sha] = l.split(" ");
          return {
            name,
            commit: { sha: api.tipOverride.get(name) ?? sha },
            protected: api.protected.has(name),
          };
        });
      return { status: 200, body: m[1] === "1" ? all : [] };
    }
    if ((m = /^rules\/branches\/(.+)$/.exec(rest)))
      return {
        status: 200,
        body: api.deletionRule.has(decodeURIComponent(m[1]))
          ? [{ type: "deletion" }]
          : [{ type: "required_signatures" }],
      };
    if (
      (m =
        /^pulls\?state=closed&base=main&head=AJHMH%3A(.+)&per_page=100$/.exec(
          rest,
        ))
    ) {
      const list = api.pulls.get(decodeURIComponent(m[1])) ?? [];
      return {
        status: 200,
        body: list.map((p, i) => ({
          number: i + 1,
          merged_at: p.merged_at,
          merge_commit_sha: p.merge,
          head: { sha: p.head, ref: decodeURIComponent(m[1]) },
          base: { ref: "main", repo: { full_name: repository } },
        })),
      };
    }
    if ((m = /^compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})$/.exec(rest))) {
      const [, a, b] = m;
      const status =
        a === b
          ? "identical"
          : ok(root, "--git-dir", bare, "merge-base", "--is-ancestor", a, b)
            ? "ahead"
            : "diverged";
      return { status: 200, body: { status } };
    }
    const tipOf = (name) =>
      spawnSync(
        "git",
        [
          "--git-dir",
          bare,
          "rev-parse",
          "--verify",
          "-q",
          `refs/heads/${name}`,
        ],
        { encoding: "utf8" },
      ).stdout.trim();
    if ((m = /^git\/ref\/heads\/(.+)$/.exec(rest))) {
      const sha = api.mainOverride ?? tipOf(decodeURIComponent(m[1]));
      return sha
        ? { status: 200, body: { object: { sha } } }
        : { status: 404, body: null };
    }
    if ((m = /^branches\/(.+)$/.exec(rest))) {
      const name = decodeURIComponent(m[1]);
      const sha = api.tipOverride.get(name) ?? tipOf(name);
      return sha
        ? {
            status: 200,
            body: {
              name,
              commit: { sha },
              protected: api.protected.has(name),
            },
          }
        : { status: 404, body: null };
    }
    throw Error("Unexpected GitHub path " + path);
  };
  const runtime = (over = {}) =>
    nativeBranchCleanupRuntime({
      repository,
      policyPath,
      remoteUrl: "file://" + bare,
      github,
      ...over,
    });
  const target = {
    repository,
    checkout,
    branch: "main",
    revision: main,
    policySha256: createHash("sha256")
      .update(JSON.stringify({ repository }))
      .digest("hex"),
    mergeOperationId: randomUUID(),
  };
  const remove = (r, name, location, expectedTip, over = {}) =>
    r.remove({
      ...target,
      operationId: randomUUID(),
      name,
      location,
      expectedTip,
      controls: branchCleanupControls,
      mayDispatch: () => true,
      ...over,
    });
  const remoteHas = (name) =>
    ok(
      root,
      "--git-dir",
      bare,
      "rev-parse",
      "--verify",
      "-q",
      `refs/heads/${name}`,
    );
  const localHas = (name) =>
    ok(checkout, "rev-parse", "--verify", "-q", `refs/heads/${name}`);
  return {
    root,
    bare,
    author,
    checkout,
    api,
    github,
    runtime,
    target,
    remove,
    remoteHas,
    localHas,
    main,
    merged,
    squashedTip,
    unmergedTip,
  };
}
const decisions = (o, target) =>
  Object.fromEntries(
    o.branches
      .filter((f) => f.name !== "main")
      .map((f) => [`${f.location}:${f.name}`, cleanupDecision(f, target)]),
  );

test("the inventory covers every local and remote branch, with protection, replay, worktree and PR-history linkage", async (t) => {
  const s = setup(t);
  const o = await s.runtime().observe(s.target);
  assert.equal(o.complete, true);
  assert.equal(o.quiescent, true);
  assert.equal(o.revision, s.main);
  assert.equal(o.policySha256, s.target.policySha256);
  assert.equal(o.repository, repository);
  assert.equal(o.branch, "main");
  const mains = o.branches.filter((f) => f.name === "main");
  assert.deepEqual(mains.map((f) => [f.location, f.tip]).sort(), [
    ["local", s.main],
    ["remote", s.main],
  ]);
  assert.deepEqual(decisions(o, s.target), {
    "local:aios/merged": { decision: "eligible", reason: "integrated" },
    "local:aios/squashed": { decision: "eligible", reason: "integrated" },
    "local:in-worktree": { decision: "retained", reason: "active-worktree" },
    "remote:aios/merged": { decision: "eligible", reason: "integrated" },
    "remote:aios/squashed": { decision: "eligible", reason: "integrated" },
    "remote:aios/unmerged": { decision: "retained", reason: "unmerged" },
    "remote:aios/newer": { decision: "retained", reason: "newer-tip" },
    "remote:release": { decision: "retained", reason: "protected" },
    [`remote:feat/factory-remediation-${"a".repeat(32)}`]: {
      decision: "retained",
      reason: "replay-retained",
    },
  });
  // A squash merge is integrated only through its PR history.
  const squashed = o.branches.find(
    (f) => f.location === "remote" && f.name === "aios/squashed",
  );
  assert.equal(squashed.ancestry, "unmerged");
  assert.equal(squashed.linkage.head, s.squashedTip);
  assert.equal(squashed.linkage.complete, true);
  // Classic branch protection counts as well as a ruleset's deletion rule.
  s.api.protected.add("aios/merged");
  const again = decisions(await s.runtime().observe(s.target), s.target);
  assert.equal(again["remote:aios/merged"].reason, "protected");
  assert.equal(again["local:aios/merged"].reason, "protected");
});

test("a removal deletes exactly the evaluated tip, locally and remotely, and nothing else", async (t) => {
  const s = setup(t);
  const r = s.runtime();
  await s.remove(r, "aios/merged", "remote", s.merged);
  assert.equal(s.remoteHas("aios/merged"), false);
  assert.equal(
    ok(
      s.checkout,
      "rev-parse",
      "--verify",
      "-q",
      "refs/remotes/origin/aios/merged",
    ),
    false,
  );
  assert.equal(s.localHas("aios/merged"), true);
  await s.remove(r, "aios/merged", "local", s.merged);
  assert.equal(s.localHas("aios/merged"), false);
  await s.remove(r, "aios/squashed", "remote", s.squashedTip);
  assert.equal(s.remoteHas("aios/squashed"), false);
  // Any name Git accepts, not only plain ones.
  sh(s.author, "push", "-q", s.bare, `${s.merged}:refs/heads/fix+docs`);
  await s.remove(r, "fix+docs", "remote", s.merged);
  assert.equal(s.remoteHas("fix+docs"), false);
  // Retained branches are never deleted, whatever the caller asks.
  for (const [name, location, tip] of [
    ["aios/unmerged", "remote", s.unmergedTip],
    ["aios/newer", "remote", s.unmergedTip],
    ["release", "remote", s.merged],
    [`feat/factory-remediation-${"a".repeat(32)}`, "remote", s.merged],
    ["in-worktree", "local", s.merged],
    ["main", "remote", s.main],
  ])
    await assert.rejects(s.remove(r, name, location, tip), name);
  assert.equal(s.remoteHas("aios/unmerged"), true);
  assert.equal(s.remoteHas("release"), true);
  assert.equal(s.localHas("in-worktree"), true);
});

test("a removal refuses a moved tip, a closed fence, other controls or another target", async (t) => {
  const s = setup(t);
  const r = s.runtime();
  await assert.rejects(
    s.remove(r, "aios/merged", "remote", s.merged, {
      controls: { ...branchCleanupControls, deleteUnmerged: true },
    }),
  );
  await assert.rejects(
    s.remove(r, "aios/merged", "remote", s.merged, {
      mayDispatch: () => false,
    }),
  );
  await assert.rejects(
    s.remove(r, "aios/merged", "remote", s.merged, { revision: s.merged }),
  );
  await assert.rejects(
    s.remove(r, "aios/merged", "remote", s.merged, {
      policySha256: "0".repeat(64),
    }),
  );
  // The remote branch moved on after it was evaluated.
  sh(s.author, "push", "-q", "-f", s.bare, `${s.main}:refs/heads/aios/merged`);
  await assert.rejects(s.remove(r, "aios/merged", "remote", s.merged));
  assert.equal(s.remoteHas("aios/merged"), true);
  // The fence closes between the recheck and the write.
  let calls = 0;
  await assert.rejects(
    s.remove(r, "aios/squashed", "remote", s.squashedTip, {
      mayDispatch: () => ++calls < 2,
    }),
  );
  assert.equal(s.remoteHas("aios/squashed"), true);
});

test("racing, unavailable or ambiguous facts make the inventory incomplete or the linkage ambiguous", async (t) => {
  const s = setup(t);
  // GitHub and the fetch disagree on a tip: a race, so incomplete.
  s.api.tipOverride.set("aios/merged", s.main);
  assert.equal((await s.runtime().observe(s.target)).complete, false);
  s.api.tipOverride.clear();
  for (const part of ["branches?", "rules/branches/", "pulls?", "compare/"]) {
    s.api.fail = new Set([part]);
    const o = await s.runtime().observe(s.target);
    if (part === "pulls?" || part === "compare/") {
      // PR history unavailable: the squash merge is ambiguous, never eligible.
      assert.equal(o.complete, true, part);
      assert.equal(
        decisions(o, s.target)["remote:aios/squashed"].reason,
        "ambiguous-merge-linkage",
        part,
      );
    } else assert.equal(o.complete, false, part);
  }
  s.api.fail = new Set();
  // A full page of PR history may hide more: ambiguous.
  s.api.pulls.set(
    "aios/squashed",
    Array.from({ length: 100 }, () => ({
      head: s.squashedTip,
      merge: s.main,
      merged_at: "2026-11-13T10:00Z",
    })),
  );
  assert.equal(
    decisions(await s.runtime().observe(s.target), s.target)[
      "remote:aios/squashed"
    ].reason,
    "ambiguous-merge-linkage",
  );
  // A held lock is not quiescent.
  writeFileSync(join(s.checkout, ".git", "index.lock"), "");
  assert.equal((await s.runtime().observe(s.target)).quiescent, false);
});

test("a checkout with helpers in its configuration, another origin or another repository is refused", async (t) => {
  const s = setup(t);
  sh(s.checkout, "config", "filter.x.clean", "cat");
  assert.equal((await s.runtime().observe(s.target)).complete, false);
  sh(s.checkout, "config", "--unset", "filter.x.clean");
  sh(s.checkout, "remote", "set-url", "origin", "file:///elsewhere.git");
  assert.equal((await s.runtime().observe(s.target)).complete, false);
  sh(s.checkout, "remote", "set-url", "origin", "file://" + s.bare);
  assert.equal(
    (await s.runtime().observe({ ...s.target, repository: "other/repo" }))
      .complete,
    false,
  );
  assert.throws(() => s.runtime({ repository: "not a slug" }));
  assert.throws(() => s.runtime({ remoteUrl: "ssh://example/x.git" }));
});

test("the owner policy names the repository; the binding is stable", (t) => {
  const s = setup(t);
  const a = s.runtime(),
    b = s.runtime();
  assert.equal(a.mode, "controlled");
  assert.match(a.bindingSha256, /^[a-f0-9]{64}$/);
  assert.equal(a.bindingSha256, b.bindingSha256);
  const policy = join(s.root, "policy.json");
  assert.ok(ownerPolicyBranchCleanupRuntime(policy));
  writeFileSync(join(s.root, "bad.json"), "{");
  assert.equal(
    ownerPolicyBranchCleanupRuntime(join(s.root, "bad.json")),
    undefined,
  );
  assert.equal(
    ownerPolicyBranchCleanupRuntime(join(s.root, "none.json")),
    undefined,
  );
  writeFileSync(join(s.root, "noslug.json"), JSON.stringify({}));
  assert.equal(
    ownerPolicyBranchCleanupRuntime(join(s.root, "noslug.json")),
    undefined,
  );
});

test("cleanup-branches and reconcile-cleanup take the owner policy", (t) => {
  const state = mkdtempSync(join(tmpdir(), "aios-cleanup-cli-"));
  t.after(() => rmSync(state, { recursive: true, force: true }));
  const policy = join(state, "policy.json");
  writeFileSync(policy, JSON.stringify({ repository }), { mode: 0o600 });
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
  for (const name of ["cleanup-branches", "reconcile-cleanup"]) {
    assert.doesNotMatch(
      cli(name, ...id, "--owner-policy", policy),
      /^Use start/,
      name,
    );
    assert.match(
      cli(name, ...id, "--production-admission", policy),
      /^Use start/,
      name,
    );
  }
});

test("an unreadable policy, a vanished checkout or a branch list that never ends gives no inventory", async (t) => {
  const s = setup(t);
  const policyPath = join(s.root, "policy.json");
  // The policy missing, a folder, or too large.
  for (const path of [
    join(s.root, "none.json"),
    s.root,
    (() => {
      const big = join(s.root, "big.json");
      writeFileSync(big, "x".repeat(70000));
      return big;
    })(),
  ])
    assert.equal(
      (await s.runtime({ policyPath: path }).observe(s.target)).complete,
      false,
      path,
    );
  assert.equal(
    (
      await s
        .runtime({ policyPath })
        .observe({ ...s.target, checkout: join(s.root, "gone") })
    ).complete,
    false,
  );
  // Full pages forever: more branches than it will read.
  const endless = async (path) =>
    path.includes("/branches?")
      ? {
          status: 200,
          body: Array.from({ length: 100 }, (_, i) => ({
            name: `b${i}`,
            commit: { sha: s.main },
            protected: false,
          })),
        }
      : { status: 404, body: null };
  assert.equal(
    (await s.runtime({ github: endless }).observe(s.target)).complete,
    false,
  );
  // A malformed branch entry.
  const malformed = async (path) =>
    path.includes("/branches?")
      ? { status: 200, body: [{ name: "main", commit: { sha: "x" } }] }
      : { status: 404, body: null };
  assert.equal(
    (await s.runtime({ github: malformed }).observe(s.target)).complete,
    false,
  );
});

test("malformed PR history is ambiguous, a failed ancestry check is unknown, and a refused deletion throws", async (t) => {
  const s = setup(t);
  // A merged PR whose head names another branch.
  s.api.pulls.set("aios/squashed", [
    { head: s.squashedTip, merge: s.main, merged_at: "2026-11-13T10:00Z" },
  ]);
  const wrongRef = async (path, method) =>
    path.includes("/pulls?")
      ? {
          status: 200,
          body: [
            {
              merged_at: "2026-11-13T10:00Z",
              merge_commit_sha: s.main,
              head: { sha: s.squashedTip, ref: "elsewhere" },
              base: { ref: "main", repo: { full_name: repository } },
            },
          ],
        }
      : s.github(path, method);
  assert.equal(
    decisions(
      await s.runtime({ github: wrongRef }).observe(s.target),
      s.target,
    )["remote:aios/squashed"].reason,
    "ambiguous-merge-linkage",
  );
  // Git can't answer whether a tip is in main's history.
  const failing = (executable, args, options) =>
    args.includes("merge-base") && args.includes(s.squashedTip)
      ? { status: 128, stdout: "", stderr: "" }
      : defaultRunner(executable, args, options);
  assert.equal(
    decisions(await s.runtime({ run: failing }).observe(s.target), s.target)[
      "remote:aios/squashed"
    ].reason,
    "integration-unknown",
  );
  // The remote refuses every update: the deletion throws, the branch stays.
  writeFileSync(join(s.bare, "hooks", "pre-receive"), "#!/bin/sh\nexit 1\n", {
    mode: 0o755,
  });
  await assert.rejects(
    s.remove(s.runtime(), "aios/merged", "remote", s.merged),
    /refused/,
  );
  assert.equal(s.remoteHas("aios/merged"), true);
});

test("an owner policy that is too large or names no valid repository installs nothing", (t) => {
  const s = setup(t);
  const big = join(s.root, "big-policy.json");
  writeFileSync(big, JSON.stringify({ repository, pad: "x".repeat(70000) }));
  assert.equal(ownerPolicyBranchCleanupRuntime(big), undefined);
  const bad = join(s.root, "bad-slug.json");
  writeFileSync(bad, JSON.stringify({ repository: "not a slug" }));
  assert.equal(ownerPolicyBranchCleanupRuntime(bad), undefined);
});

test("a removal re-checks only its own branch, and refuses whatever changed or is unavailable", async (t) => {
  const s = setup(t);
  const r = s.runtime();
  s.api.calls.length = 0;
  await s.remove(r, "aios/merged", "remote", s.merged);
  // No full inventory: no branch listing, one ruleset call.
  assert.equal(s.api.calls.filter((c) => c.includes("/branches?")).length, 0);
  assert.equal(
    s.api.calls.filter((c) => c.includes("/rules/branches/")).length,
    1,
  );
  const refused = async (name, location, tip, over = {}) => {
    await assert.rejects(s.remove(r, name, location, tip, over), name);
  };
  // Gone from GitHub already, or never there.
  await refused("aios/merged", "remote", s.merged);
  await refused("no-such", "local", s.merged);
  // GitHub and the fetch disagree: it moved in between.
  s.api.tipOverride.set("aios/squashed", s.main);
  await refused("aios/squashed", "remote", s.squashedTip);
  s.api.tipOverride.clear();
  // Main moved on GitHub since it was verified.
  s.api.mainOverride = s.merged;
  await refused("aios/squashed", "remote", s.squashedTip);
  delete s.api.mainOverride;
  // Protected since the inventory, classically or by a ruleset.
  s.api.protected.add("aios/squashed");
  await refused("aios/squashed", "remote", s.squashedTip);
  await refused("aios/squashed", "local", s.squashedTip);
  s.api.protected.clear();
  s.api.deletionRule.add("aios/squashed");
  await refused("aios/squashed", "remote", s.squashedTip);
  s.api.deletionRule.delete("aios/squashed");
  // GitHub unavailable for the branch, the main tip or the rules.
  for (const part of ["branches/", "git/ref/", "rules/branches/"]) {
    s.api.fail = new Set([part]);
    await refused("aios/squashed", "remote", s.squashedTip);
  }
  s.api.fail = new Set();
  // Another repository, a vanished checkout, another policy.
  await refused("aios/squashed", "remote", s.squashedTip, {
    repository: "other/repo",
  });
  await refused("aios/squashed", "remote", s.squashedTip, {
    checkout: join(s.root, "gone"),
  });
  // A held lock on that branch.
  const lock = join(
    s.checkout,
    ".git",
    "refs",
    "heads",
    "aios",
    "squashed.lock",
  );
  writeFileSync(lock, "");
  await refused("aios/squashed", "local", s.squashedTip);
  rmSync(lock);
  // The checkout's configuration selects a helper.
  sh(s.checkout, "config", "filter.x.clean", "cat");
  await refused("aios/squashed", "local", s.squashedTip);
  sh(s.checkout, "config", "--unset", "filter.x.clean");
  // With everything restored, both still delete.
  await s.remove(r, "aios/squashed", "remote", s.squashedTip);
  await s.remove(r, "aios/squashed", "local", s.squashedTip);
  assert.equal(s.remoteHas("aios/squashed"), false);
  assert.equal(s.localHas("aios/squashed"), false);
});
