// Ticket 13 (#272): the native fast-forward-only main sync, against a real
// bare remote over file:// and a real cloned checkout.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { mainSyncControls } from "../dist/main-sync.js";
import {
  nativeMainSyncRuntime,
  ownerPolicyMainSyncRuntime,
} from "../dist/native-main-sync.js";

const repository = "AJHMH/acceptance";
const sh = (cwd, ...args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
};
const commit = (work, file, text, message) => {
  mkdirSync(join(work, file, ".."), { recursive: true });
  writeFileSync(join(work, file), text);
  // Forced, so a test can track a file under an ignored folder.
  sh(work, "add", "-f", file);
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

/** Main at A in the checkout; the remote's main has moved on to B. */
function setup(t) {
  const root = mkdtempSync(join(tmpdir(), "aios-native-main-sync-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bare = join(root, "remote.git"),
    author = join(root, "author"),
    checkout = join(root, "checkout");
  sh(root, "init", "-q", "--bare", "-b", "main", bare);
  sh(root, "init", "-q", "-b", "main", author);
  commit(author, ".gitignore", "node_modules/\n", "ignore");
  const a = commit(author, "index.html", "<h1>Contact</h1>\n", "page");
  sh(author, "push", "-q", bare, "main");
  sh(root, "clone", "-q", bare, checkout);
  sh(checkout, "remote", "set-url", "origin", "file://" + bare);
  const b = commit(
    author,
    "index.html",
    "<h1>Contact</h1>\n<p>Hint</p>\n",
    "hint",
  );
  sh(author, "push", "-q", bare, "main");
  const runtime = (over = {}) =>
    nativeMainSyncRuntime({ repository, remoteUrl: "file://" + bare, ...over });
  const target = {
    repository,
    checkout,
    branch: "main",
    revision: b,
    policySha256: "1".repeat(64),
    mergeOperationId: randomUUID(),
  };
  const sync = async (r, expected, over = {}) =>
    r.synchronize({
      ...target,
      operationId: randomUUID(),
      expected,
      controls: mainSyncControls,
      mayDispatch: () => true,
      ...over,
    });
  return { root, bare, author, checkout, a, b, runtime, target, sync };
}

test("an observation fetches main and reports the checkout, its cleanliness and whether main fast-forwards", async (t) => {
  const s = setup(t);
  const o = await s.runtime().observe(s.target);
  assert.deepEqual(
    { ...o, checkout: undefined },
    {
      repository,
      checkout: undefined,
      branch: "main",
      remoteMain: s.b,
      localMain: s.a,
      currentBranch: "main",
      head: s.a,
      clean: true,
      fastForward: true,
      mainCheckedOutElsewhere: false,
      complete: true,
      quiescent: true,
    },
  );
  // Ignored files are allowed, as the owner chose.
  mkdirSync(join(s.checkout, "node_modules"));
  writeFileSync(join(s.checkout, "node_modules", "x.js"), "x");
  assert.equal((await s.runtime().observe(s.target)).clean, true);
  // Untracked, modified or staged work is not.
  writeFileSync(join(s.checkout, "notes.txt"), "mine");
  assert.equal((await s.runtime().observe(s.target)).clean, false);
  rmSync(join(s.checkout, "notes.txt"));
  writeFileSync(join(s.checkout, "index.html"), "edited\n");
  assert.equal((await s.runtime().observe(s.target)).clean, false);
  sh(s.checkout, "add", "index.html");
  assert.equal((await s.runtime().observe(s.target)).clean, false);
});

test("a sync fast-forwards local main to exactly the verified revision, and refuses anything else", async (t) => {
  const s = setup(t);
  const r = s.runtime();
  const expected = await r.observe(s.target);
  // Wrong controls, a closed fence or another target: no write.
  await assert.rejects(
    s.sync(r, expected, { controls: { ...mainSyncControls, reset: true } }),
  );
  await assert.rejects(s.sync(r, expected, { mayDispatch: () => false }));
  await assert.rejects(s.sync(r, expected, { revision: "not-a-sha" }));
  let calls = 0;
  await assert.rejects(
    s.sync(r, expected, { mayDispatch: () => calls++ === 0 }),
    /fenced/,
  );
  assert.equal(sh(s.checkout, "rev-parse", "main"), s.a);
  await s.sync(r, expected);
  assert.equal(sh(s.checkout, "rev-parse", "main"), s.b);
  assert.equal(sh(s.checkout, "rev-parse", "HEAD"), s.b);
  assert.equal(
    readFileSync(join(s.checkout, "index.html"), "utf8"),
    "<h1>Contact</h1>\n<p>Hint</p>\n",
  );
  const after = await r.observe(s.target);
  assert.equal(after.localMain, s.b);
  assert.equal(after.clean, true);
});

test("a remote that moved since the observation, another branch, or a non-fast-forward never writes", async (t) => {
  const s = setup(t);
  const r = s.runtime();
  const expected = await r.observe(s.target);
  // The remote moves on after the observation.
  const c = commit(s.author, "README", "x\n", "more");
  sh(s.author, "push", "-q", s.bare, "main");
  await assert.rejects(s.sync(r, expected), /changed or is unsafe/);
  assert.equal(sh(s.checkout, "rev-parse", "main"), s.a);
  // On another branch: the sync never switches.
  sh(s.checkout, "switch", "-q", "-c", "work");
  const elsewhere = await r.observe({ ...s.target, revision: c });
  assert.equal(elsewhere.currentBranch, "work");
  await assert.rejects(
    s.sync(r, elsewhere, { revision: c }),
    /changed or is unsafe/,
  );
  sh(s.checkout, "switch", "-q", "main");
  // A local-only commit on main: not a fast-forward.
  commit(s.checkout, "local.txt", "mine\n", "local");
  const diverged = await r.observe({ ...s.target, revision: c });
  assert.equal(diverged.fastForward, false);
  await assert.rejects(
    s.sync(r, diverged, { revision: c }),
    /changed or is unsafe/,
  );
});

test("an ignored file the new main would overwrite stops Git's own fast-forward, and nothing is lost", async (t) => {
  const s = setup(t);
  // The next main tracks a file under the ignored folder.
  const c = commit(s.author, "node_modules/keep.js", "tracked\n", "track it");
  sh(s.author, "push", "-q", s.bare, "main");
  mkdirSync(join(s.checkout, "node_modules"));
  writeFileSync(join(s.checkout, "node_modules", "keep.js"), "mine\n");
  const r = s.runtime();
  const expected = await r.observe({ ...s.target, revision: c });
  assert.equal(expected.clean, true);
  await assert.rejects(s.sync(r, expected, { revision: c }), /refused/);
  assert.equal(sh(s.checkout, "rev-parse", "main"), s.a);
  assert.equal(
    readFileSync(join(s.checkout, "node_modules", "keep.js"), "utf8"),
    "mine\n",
  );
});

test("helpers in the checkout's configuration, another origin, main checked out elsewhere, or a held lock are never safe", async (t) => {
  const s = setup(t);
  const r = s.runtime();
  sh(s.checkout, "config", "filter.x.smudge", "cat");
  assert.equal((await r.observe(s.target)).complete, false);
  sh(s.checkout, "config", "--unset", "filter.x.smudge");
  sh(s.checkout, "config", "include.path", "/tmp/elsewhere");
  assert.equal((await r.observe(s.target)).complete, false);
  sh(s.checkout, "config", "--unset", "include.path");
  sh(
    s.checkout,
    "remote",
    "set-url",
    "origin",
    "https://github.com/someone/else.git",
  );
  assert.equal((await r.observe(s.target)).complete, false);
  sh(s.checkout, "remote", "set-url", "origin", "file://" + s.bare);
  // Main in a second worktree.
  sh(s.checkout, "switch", "-q", "-c", "side");
  sh(s.checkout, "worktree", "add", "-q", join(s.root, "second"), "main");
  assert.equal((await r.observe(s.target)).mainCheckedOutElsewhere, true);
  sh(s.checkout, "worktree", "remove", join(s.root, "second"));
  sh(s.checkout, "switch", "-q", "main");
  // A Git process mid-write holds the index lock.
  const lock = join(s.checkout, ".git", "index.lock");
  writeFileSync(lock, "");
  assert.equal((await r.observe(s.target)).quiescent, false);
  rmSync(lock);
  assert.equal((await r.observe(s.target)).quiescent, true);
  // The wrong repository or branch, or a missing checkout.
  assert.equal(
    (await r.observe({ ...s.target, repository: "AJHMH/other" })).complete,
    false,
  );
  assert.equal(
    (await r.observe({ ...s.target, branch: "main; rm" })).complete,
    false,
  );
  assert.equal(
    (await r.observe({ ...s.target, checkout: join(s.root, "missing") }))
      .complete,
    false,
  );
  // An unreachable remote.
  const offline = s.runtime({
    remoteUrl: "file://" + join(s.root, "gone.git"),
  });
  sh(
    s.checkout,
    "remote",
    "set-url",
    "origin",
    "file://" + join(s.root, "gone.git"),
  );
  assert.equal((await offline.observe(s.target)).complete, false);
});

test("the sync is bound to its repository, and the owner policy names it", async (t) => {
  const s = setup(t);
  const a = s.runtime();
  assert.equal(a.mode, "controlled");
  assert.notEqual(
    nativeMainSyncRuntime({ repository: "AJHMH/other" }).bindingSha256,
    a.bindingSha256,
  );
  assert.equal(
    nativeMainSyncRuntime({ repository }).bindingSha256,
    a.bindingSha256,
  );
  assert.throws(() => nativeMainSyncRuntime({ repository: "bad" }));
  assert.throws(() =>
    nativeMainSyncRuntime({ repository, remoteUrl: "ssh://x" }),
  );
  // GitHub's own origin forms match the default remote.
  for (const url of [
    `https://github.com/${repository}.git`,
    `git@github.com:${repository}.git`,
  ]) {
    sh(s.checkout, "remote", "set-url", "origin", url);
    const failing = () => ({ status: 1, stdout: "", stderr: "" });
    let first = true;
    const run = (cmd, args, opts) => {
      if (args.includes("remote.origin.url") && first) {
        first = false;
        return spawnSync(cmd, args, { encoding: "utf8", env: opts.env });
      }
      return args.includes("fetch")
        ? failing()
        : spawnSync(cmd, args, { encoding: "utf8", env: opts.env });
    };
    const o = await nativeMainSyncRuntime({ repository, run }).observe(
      s.target,
    );
    // Origin matched, so it got as far as the fetch, which fails offline.
    assert.equal(o.complete, false);
  }
  const policy = join(s.root, "policy.json");
  writeFileSync(policy, JSON.stringify({ repository }));
  assert.equal(
    ownerPolicyMainSyncRuntime(policy).bindingSha256,
    a.bindingSha256,
  );
  writeFileSync(policy, JSON.stringify({ repository: "bad" }));
  assert.equal(ownerPolicyMainSyncRuntime(policy), undefined);
  writeFileSync(policy, "{}");
  assert.equal(ownerPolicyMainSyncRuntime(policy), undefined);
  assert.equal(
    ownerPolicyMainSyncRuntime(join(s.root, "missing.json")),
    undefined,
  );
  assert.ok(existsSync(s.checkout));
});

test("sync-main and reconcile-main-sync take the owner policy", async (t) => {
  const state = mkdtempSync(join(tmpdir(), "aios-sync-cli-"));
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
            workflow: ".github/workflows/ci.yml@main",
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
  for (const name of ["sync-main", "reconcile-main-sync"]) {
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
