import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { investigation } from "../scripts/investigation-ledger.mjs";
import {
  preparePublication,
  publishPublication,
  git,
  GitHubPublisher,
} from "../scripts/operator/publisher.mjs";
import {
  locked,
  readState,
  stateDirectory,
  writeState,
} from "../scripts/operator/state.mjs";

function operatorTest(name, options, fn) {
  if (typeof options === "function") {
    fn = options;
    options = {};
  }
  return test(
    name,
    { ...options, skip: process.platform === "win32" || options.skip },
    fn,
  );
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "operator-tools-")),
    repo = join(root, "repo"),
    directory = join(root, "state");
  mkdirSync(repo);
  mkdirSync(directory, { mode: 0o700 });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const g = (...args) => {
    const r = spawnSync("git", args, {
      cwd: repo,
      encoding: "utf8",
      timeout: 5000,
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  g("init");
  g("config", "user.name", "Fixture");
  g("config", "user.email", "fixture@example.invalid");
  g("config", "commit.gpgsign", "false");
  g("remote", "add", "origin", "https://github.com/example/project.git");
  writeFileSync(join(repo, "a.txt"), "before\n");
  g("add", "a.txt");
  g("commit", "-m", "fixture");
  const parent = g("rev-parse", "HEAD");
  g("switch", "-c", "codex/operator-test");
  writeFileSync(join(repo, "a.txt"), "after\n");
  g("add", "a.txt");
  const options = {
    repo,
    directory,
    repository: "example/project",
    branch: "codex/operator-test",
    base: "main",
    title: "Retain operator evidence",
    body: "Test proposal",
    draft: true,
  };
  const ledger = (kind, data) =>
    investigation({ repository: repo, directory, kind, data });
  return { root, repo, directory, parent, g, options, ledger };
}
function gateway(f) {
  const remote = {
    head: null,
    base: f.parent,
    commits: [],
    prs: [],
    authenticated: 0,
    closed: 0,
    writes: [],
    async ref(repository, branch) {
      assert.equal(repository, f.options.repository);
      return branch === "main" ? this.base : this.head;
    },
    async authenticate() {
      this.authenticated++;
    },
    async close() {
      this.closed++;
    },
    async createBranch(repository, branch, parent) {
      this.writes.push("branch");
      this.head = parent;
    },
    async createCommit(proposal, id) {
      this.writes.push("commit");
      const revision = "a".repeat(40);
      this.commits.push({
        sha: revision,
        author: { login: proposal.bot },
        committer: { login: "web-flow" },
        parents: [{ sha: proposal.parent }],
        commit: {
          tree: { sha: proposal.tree },
          author: { name: proposal.bot },
          committer: { name: "GitHub" },
          verification: { verified: true, reason: "valid" },
          message: `Operator-Proposal: ${id}`,
        },
      });
      this.head = revision;
      return revision;
    },
    async commit(repository, revision) {
      return this.commits.find((commit) => commit.sha === revision);
    },
    async pullRequests() {
      return this.prs;
    },
    async createPullRequest(proposal) {
      this.writes.push("pr");
      const pr = {
        number: 1,
        html_url: "https://github.com/example/project/pull/1",
        state: "open",
        user: { login: proposal.bot },
        head: {
          sha: this.head,
          ref: proposal.branch,
          repo: { full_name: proposal.repository },
        },
        base: { ref: proposal.base, repo: { full_name: proposal.repository } },
      };
      this.prs.push(pr);
      return pr;
    },
  };
  return remote;
}
async function proposal(f, remote = gateway(f)) {
  const prepared = await preparePublication(f.options, remote);
  return {
    remote,
    prepared,
    publish: () =>
      publishPublication(
        {
          ...f.options,
          digest: prepared.digest,
          approvedDigest: prepared.digest,
        },
        remote,
      ),
  };
}

operatorTest(
  "ledger persists exhaustion and refuses resets, unapproved scopes and reused operations",
  async (t) => {
    const f = fixture(t);
    await f.ledger("init", { scope: "git-timeout", minutes: 1, cycles: 1 });
    await assert.rejects(
      f.ledger("init", { scope: "reset", minutes: 100, cycles: 100 }),
    );
    await assert.rejects(f.ledger("scope", { scope: "unrelated" }));
    await assert.rejects(
      f.ledger("begin", {
        scope: "unrelated",
        operation: "other",
        repair: false,
      }),
    );
    await f.ledger("begin", {
      scope: "git-timeout",
      operation: "first",
      repair: true,
    });
    const exhausted = await f.ledger("checkpoint", {
      operation: "first",
      activeMs: 61000,
    });
    assert.equal(exhausted.remainingMs, 0);
    assert.equal(exhausted.usedMs, 61000);
    await f.ledger("end", { operation: "first", activeMs: 0 });
    await assert.rejects(
      f.ledger("begin", {
        scope: "git-timeout",
        operation: "second",
        repair: false,
      }),
    );
    await f.ledger("extend", {
      minutes: 1,
      cycles: 1,
      approval: "owner-request-2",
    });
    await assert.rejects(
      f.ledger("begin", {
        scope: "git-timeout",
        operation: "first",
        repair: true,
      }),
    );
    const state = await f.ledger("status");
    assert.equal(state.usedCycles, 1);
    assert.equal(state.remainingMs, 59000);
  },
);
operatorTest(
  "ledger interrupted operations require explicit recovery and waiting does not add reported time",
  async (t) => {
    const f = fixture(t);
    await f.ledger("init", { scope: "timeout", minutes: 1, cycles: 2 });
    await f.ledger("begin", {
      scope: "timeout",
      operation: "interrupted",
      repair: true,
    });
    await assert.rejects(
      f.ledger("begin", {
        scope: "timeout",
        operation: "overlap",
        repair: false,
      }),
    );
    await assert.rejects(
      f.ledger("recover", { operation: "interrupted", activeMs: 1000 }),
    );
    const recovered = await f.ledger("recover", {
      operation: "interrupted",
      activeMs: 1000,
      approval: "owner-reconciliation",
    });
    assert.equal(recovered.active, null);
    assert.equal(recovered.usedMs, 1000);
    assert.equal((await f.ledger("status")).usedMs, 1000);
  },
);
operatorTest(
  "ledger retains revision-bound failure fingerprints without authorizing new scope",
  async (t) => {
    const f = fixture(t);
    await f.ledger("init", { scope: "original", minutes: 1, cycles: 1 });
    const evidence = {
      repository: "example/project",
      revision: f.parent,
      check: "test",
      symptom: "deadline",
      evidence: "run/123/attempt/1",
    };
    await f.ledger("failure", evidence);
    const state = await f.ledger("failure", {
      ...evidence,
      revision: "b".repeat(40),
      evidence: "run/124/attempt/1",
    });
    assert.equal(state.failures.length, 2);
    assert.equal(state.failures[0].fingerprint, state.failures[1].fingerprint);
    assert.deepEqual(state.scopes, ["original"]);
  },
);
operatorTest(
  "state refuses concurrent mutation, modified history and unsafe storage",
  async (t) => {
    const f = fixture(t);
    await f.ledger("init", { scope: "original", minutes: 1, cycles: 1 });
    await locked(f.directory, async () => {
      await assert.rejects(f.ledger("status"), /EEXIST/);
    });
    const file = join(f.directory, "investigation.json"),
      value = JSON.parse(readFileSync(file));
    value.events[0].data.minutes = 100;
    writeFileSync(file, JSON.stringify(value));
    await assert.rejects(f.ledger("status"), /history/);
    assert.throws(
      () => stateDirectory(join(f.repo, "inside"), f.repo),
      /outside/,
    );
    if (process.platform !== "win32") {
      const link = join(f.root, "linked");
      symlinkSync(f.directory, link);
      assert.throws(() => stateDirectory(link, f.repo));
      chmodSync(f.directory, 0o755);
      assert.throws(() => stateDirectory(f.directory, f.repo), /Private/);
    }
  },
);
operatorTest(
  "public ledger CLI persists an initialization and returns status",
  (t) => {
    const f = fixture(t),
      cli = resolve("scripts/investigation-ledger.mjs");
    for (const args of [
      ["init", "--scope", "cli", "--minutes", "1", "--cycles", "1"],
      ["status"],
    ]) {
      const r = spawnSync(
        process.execPath,
        [cli, ...args, "--repo", f.repo, "--state-dir", f.directory],
        { encoding: "utf8", timeout: 5000 },
      );
      assert.equal(r.status, 0, r.stderr);
      assert.equal(JSON.parse(r.stdout).remainingMs, 60000);
    }
  },
);
operatorTest(
  "publisher binds exact staged bytes and reconciles accepted writes without duplication",
  async (t) => {
    const f = fixture(t),
      p = await proposal(f);
    const manifest = readState(
      f.directory,
      p.prepared.digest + ".proposal.json",
    );
    assert.equal(
      Buffer.from(manifest.additions[0].contents, "base64").toString(),
      "after\n",
    );
    assert.equal(manifest.tree, git(f.repo, ["write-tree"]).toString().trim());
    const first = await p.publish(),
      second = await p.publish();
    assert.equal(first.commit, second.commit);
    assert.equal(first.url, second.url);
    assert.deepEqual(p.remote.writes, ["branch", "commit", "pr"]);
    assert.equal(p.remote.closed, 2);
  },
);
operatorTest(
  "publisher refuses wrong approval, changed local tree and changed base before authentication",
  async (t) => {
    const f = fixture(t),
      p = await proposal(f);
    await assert.rejects(
      publishPublication(
        { ...f.options, digest: p.prepared.digest, approvedDigest: "wrong" },
        p.remote,
      ),
    );
    writeFileSync(join(f.repo, "a.txt"), "changed");
    await assert.rejects(p.publish());
    f.g("checkout", "--", "a.txt");
    p.remote.base = "b".repeat(40);
    await assert.rejects(p.publish(), /Base moved/);
    assert.equal(p.remote.authenticated, 0);
    assert.deepEqual(p.remote.writes, []);
  },
);
operatorTest(
  "publisher reconciles an accepted commit whose response was lost",
  async (t) => {
    const f = fixture(t),
      p = await proposal(f),
      create = p.remote.createCommit;
    p.remote.createCommit = async function (...args) {
      await create.apply(this, args);
      throw Error("response lost");
    };
    await assert.rejects(p.publish(), /response lost/);
    const result = await p.publish();
    assert.equal(result.verified, true);
    assert.deepEqual(p.remote.writes, ["branch", "commit", "pr"]);
  },
);
operatorTest(
  "publisher refuses an uncertain write with no observed acceptance",
  async (t) => {
    const f = fixture(t),
      p = await proposal(f);
    p.remote.createCommit = async function () {
      this.writes.push("commit");
      throw Error("response lost");
    };
    await assert.rejects(p.publish());
    await assert.rejects(p.publish(), /Uncertain commit/);
    assert.deepEqual(p.remote.writes, ["branch", "commit"]);
    assert.equal(p.remote.closed, 2);
  },
);
operatorTest(
  "publisher reconciles an accepted PR whose response was lost",
  async (t) => {
    const f = fixture(t),
      p = await proposal(f),
      create = p.remote.createPullRequest;
    p.remote.createPullRequest = async function (...args) {
      await create.apply(this, args);
      throw Error("response lost");
    };
    await assert.rejects(p.publish());
    const result = await p.publish();
    assert.equal(result.number, 1);
    assert.deepEqual(p.remote.writes, ["branch", "commit", "pr"]);
  },
);
operatorTest(
  "publisher refuses invalid signature, wrong bot, parent or tree before PR creation",
  async (t) => {
    for (const change of [
      (c) => {
        c.commit.verification.verified = false;
      },
      (c) => {
        c.author.login = "owner";
      },
      (c) => {
        c.parents[0].sha = "b".repeat(40);
      },
      (c) => {
        c.commit.tree.sha = "b".repeat(40);
      },
      (c) => {
        c.committer.login = "owner";
      },
    ]) {
      const f = fixture(t),
        p = await proposal(f),
        create = p.remote.createCommit;
      p.remote.createCommit = async function (...args) {
        const id = await create.apply(this, args);
        change(this.commits[0]);
        return id;
      };
      await assert.rejects(p.publish(), /signature mismatch/);
      assert.ok(!p.remote.writes.includes("pr"));
      assert.equal(p.remote.closed, 1);
    }
  },
);
operatorTest(
  "publisher refuses foreign PR identity and unsafe local Git configuration",
  async (t) => {
    const f = fixture(t),
      p = await proposal(f),
      create = p.remote.createPullRequest;
    p.remote.createPullRequest = async function (...args) {
      const pr = await create.apply(this, args);
      pr.head.repo.full_name = "foreign/project";
      return pr;
    };
    await assert.rejects(p.publish(), /PR identity/);
    f.g(
      "config",
      "url.https://elsewhere.invalid/.insteadOf",
      "https://github.com/",
    );
    await assert.rejects(
      preparePublication(f.options, p.remote),
      /Unsafe local Git/,
    );
  },
);
operatorTest(
  "publisher refreshes authority after authentication and before remote effects",
  async (t) => {
    const f = fixture(t),
      p = await proposal(f);
    p.remote.authenticate = async function () {
      this.authenticated++;
      this.base = "b".repeat(40);
    };
    await assert.rejects(p.publish(), /authority changed/);
    assert.deepEqual(p.remote.writes, []);
    assert.equal(p.remote.closed, 1);
  },
);
operatorTest(
  "publisher preserves uncertainty after a PR response that cannot be observed",
  async (t) => {
    const f = fixture(t),
      p = await proposal(f);
    p.remote.createPullRequest = async function () {
      this.writes.push("pr");
      throw Error("response lost");
    };
    await assert.rejects(p.publish());
    await assert.rejects(p.publish(), /Uncertain PR/);
    assert.deepEqual(p.remote.writes, ["branch", "commit", "pr"]);
  },
);
operatorTest(
  "publisher refuses changed proposal bytes and staged executable files",
  async (t) => {
    const f = fixture(t),
      p = await proposal(f),
      file = p.prepared.proposal;
    const manifest = JSON.parse(readFileSync(file));
    manifest.body = "changed after approval";
    writeFileSync(file, JSON.stringify(manifest));
    await assert.rejects(p.publish(), /identity changed/);
    if (process.platform !== "win32") chmodSync(join(f.repo, "a.txt"), 0o755);
    f.g("update-index", "--chmod=+x", "a.txt");
    await assert.rejects(
      preparePublication(f.options, p.remote),
      /non-executable/,
    );
  },
);
operatorTest(
  "real App gateway validates minimal scope and revokes a rejected credential",
  { skip: process.platform === "win32" },
  async (t) => {
    const f = fixture(t),
      keyPath = join(f.root, "app.pem");
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    writeFileSync(
      keyPath,
      privateKey.export({ format: "pem", type: "pkcs8" }),
      { mode: 0o600 },
    );
    const token = randomBytes(24).toString("hex");
    for (const invalidScope of [false, true]) {
      const remote = new GitHubPublisher(),
        calls = [];
      remote.request = async function (path, method, body) {
        calls.push({ path, method, body });
        if (path === "app")
          return { slug: "ajhmh-software-factory", id: 5180250 };
        if (path.endsWith("/installation")) return { id: 167664341 };
        if (path.endsWith("/access_tokens"))
          return {
            token,
            repositories: [{ full_name: f.options.repository }],
            permissions: {
              ...body.permissions,
              metadata: "read",
              ...(invalidScope ? { administration: "write" } : {}),
            },
          };
        if (path === "installation/token") {
          assert.equal(this.token, token);
          return null;
        }
        throw Error("Unexpected gateway request");
      };
      const input = {
        ...f.options,
        bot: "ajhmh-software-factory[bot]",
        appId: "5180250",
        installationId: "167664341",
        additions: [{ path: "a.txt" }],
        deletions: [],
      };
      if (invalidScope)
        await assert.rejects(remote.authenticate(input, keyPath), /scope/);
      else {
        await remote.authenticate(input, keyPath);
        await remote.close();
      }
      assert.deepEqual(
        calls.find((c) => c.path.endsWith("/access_tokens")).body.permissions,
        { contents: "write", pull_requests: "write" },
      );
      assert.equal(calls.at(-1).path, "installation/token");
      assert.equal(remote.token, undefined);
    }
  },
);

operatorTest("state size refusal preserves the last readable record", (t) => {
  const f = fixture(t);
  writeState(f.directory, "bounded.json", { previous: true });
  assert.throws(
    () =>
      writeState(f.directory, "bounded.json", {
        payload: "x".repeat(16 * 1024 * 1024),
      }),
    /size limit/,
  );
  assert.deepEqual(readState(f.directory, "bounded.json"), { previous: true });
});
operatorTest(
  "publisher refuses linked-worktree rewrites and filters before snapshot effects",
  async (t) => {
    const f = fixture(t),
      worktree = join(f.root, "worktree"),
      marker = join(f.root, "filter-ran"),
      helper = join(f.root, "filter.mjs");
    f.g("config", "extensions.worktreeConfig", "true");
    f.g("worktree", "add", "-b", "codex/worktree-test", worktree, "HEAD");
    writeFileSync(join(worktree, "a.txt"), "after\n");
    f.g("-C", worktree, "add", "a.txt");
    f.g("remote", "set-url", "origin", "git@github.com:example/project.git");
    writeFileSync(
      helper,
      "import {writeFileSync} from 'node:fs'; writeFileSync(" +
        JSON.stringify(marker) +
        ", 'ran');",
    );
    f.g(
      "-C",
      worktree,
      "config",
      "--worktree",
      "filter.probe.clean",
      '"' + process.execPath + '" "' + helper + '"',
    );
    f.g(
      "-C",
      worktree,
      "config",
      "--worktree",
      "url.https://elsewhere.invalid/.insteadOf",
      "https://github.com/",
    );
    writeFileSync(join(worktree, ".gitattributes"), "a.txt filter=probe\n");
    const remote = gateway(f);
    await assert.rejects(
      preparePublication(
        { ...f.options, repo: worktree, branch: "codex/worktree-test" },
        remote,
      ),
      /Unsafe local Git/,
    );
    assert.equal(existsSync(marker), false);
    assert.equal(remote.authenticated, 0);
  },
);
test(
  "native Windows state refuses before creating files or credentials",
  { skip: process.platform !== "win32" },
  () => {
    const root = mkdtempSync(join(tmpdir(), "operator-refusal-"));
    try {
      const state = join(root, "state");
      assert.throws(() => stateDirectory(state, root), /Windows private state/);
      assert.equal(existsSync(state), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

operatorTest(
  "local adoption imports verified objects through a private credential context",
  async (t) => {
    const f = fixture(t),
      remote = gateway(f),
      prepared = await preparePublication(f.options, remote);
    const manifest = readState(f.directory, prepared.digest + ".proposal.json"),
      writer = join(f.root, "writer");
    f.g("clone", "--no-hardlinks", f.repo, writer);
    writeFileSync(join(writer, "a.txt"), "after\n");
    f.g("-C", writer, "add", "a.txt");
    f.g(
      "-C",
      writer,
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-m",
      "remote candidate",
    );
    const revision = f.g("-C", writer, "rev-parse", "HEAD"),
      transport = new GitHubPublisher();
    transport.stateRoot = f.directory;
    transport.token = randomBytes(24).toString("hex");
    transport.fetchInto = async function (transfer, proposal, credentials) {
      assert.notEqual(transfer, f.repo);
      assert.ok(transfer.startsWith(f.directory));
      assert.equal(credentials.OPERATOR_TOKEN, this.token);
      git(transfer, [
        "-c",
        "protocol.file.allow=always",
        "fetch",
        "--depth=1",
        writer,
        "refs/heads/" + proposal.branch,
      ]);
    };
    await transport.adopt(manifest, revision);
    assert.equal(f.g("rev-parse", "HEAD"), revision);
    assert.equal(f.g("diff", "--cached", "--name-only"), "");
  },
);

operatorTest(
  "public publisher CLI refuses mismatched approval without loading credentials",
  async (t) => {
    const f = fixture(t),
      p = await proposal(f);
    const result = spawnSync(
      process.execPath,
      [
        resolve("scripts/publish-operator-proposal.mjs"),
        "publish",
        "--repo",
        f.repo,
        "--state-dir",
        f.directory,
        "--digest",
        p.prepared.digest,
        "--approve-digest",
        "wrong",
        "--private-key-path",
        join(f.root, "absent-key.pem"),
      ],
      { encoding: "utf8", timeout: 5000 },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Exact operator-approved/);
    assert.equal(f.g("rev-parse", "HEAD"), f.parent);
    assert.deepEqual(p.remote.writes, []);
  },
);

operatorTest(
  "ledger records questions and reproduction text without executing or authorizing it",
  async (t) => {
    const f = fixture(t),
      marker = join(f.root, "not-executed");
    await f.ledger("init", { scope: "original", minutes: 1, cycles: 1 });
    const plan = {
      scope: "original",
      question: "Which native phase blocks?",
      reproduction: "touch " + marker,
      evidence: "retained-reproduction",
    };
    await assert.rejects(f.ledger("plan", { ...plan, scope: "unrelated" }));
    const result = await f.ledger("plan", plan);
    assert.equal(result.plans[0].reproduction, plan.reproduction);
    assert.equal(existsSync(marker), false);
    assert.deepEqual(result.scopes, ["original"]);
  },
);
