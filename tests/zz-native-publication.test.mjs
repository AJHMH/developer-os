// Ticket 08 (#267): the native Git signer and pusher, and the App PR author.
// Git, ssh-keygen and ssh-agent are real: a throwaway key in a throwaway
// agent signs, and a local bare repository stands in for GitHub's remote.
// GitHub's API is a stand-in that answers from that remote.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  defaultRunner,
  ghApi,
  nativeGitPublicationPort,
  signingKeyLoaded,
} from "../dist/native-publication.js";
import {
  githubFetch,
  nativeAppPullRequestPort,
} from "../dist/native-app-pr.js";
import { SplitPublicationAdapter } from "../dist/publication-adapter.js";
import { publicationTree } from "../dist/publication.js";
import {
  passingOutcome,
  publicationAcceptance,
  readIdentity,
  stageNames,
} from "../scripts/run-native-publication-acceptance.mjs";

const run = (exe, args, options = {}) => {
  const r = spawnSync(exe, args, {
    encoding: "utf8",
    timeout: 20000,
    ...options,
  });
  assert.equal(r.status, 0, `${exe} ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const clean = { ...process.env };
for (const k of Object.keys(clean)) if (k.startsWith("GIT_")) delete clean[k];

/** A throwaway agent holding a throwaway key, a GitHub stand-in remote with
 * one commit on main, and the owner's identity. */
function world(t) {
  const root = mkdtempSync(join(tmpdir(), "aios-native-publication-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const key = join(root, "signing");
  run("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "", "-f", key]);
  const socket = join(root, "agent.sock");
  const started = run("ssh-agent", ["-s", "-a", socket]);
  const pid = /SSH_AGENT_PID=(\d+)/.exec(started)[1];
  const previous = process.env.SSH_AUTH_SOCK;
  process.env.SSH_AUTH_SOCK = socket;
  t.after(() => {
    process.kill(Number(pid));
    if (previous === undefined) delete process.env.SSH_AUTH_SOCK;
    else process.env.SSH_AUTH_SOCK = previous;
  });
  const addKey = () =>
    run("ssh-add", ["-q", key], { env: { ...clean, SSH_AUTH_SOCK: socket } });
  addKey();
  const remote = join(root, "remote.git");
  run("git", ["init", "--bare", "-q", "-b", "main", remote], { env: clean });
  const seed = join(root, "seed");
  run("git", ["init", "-q", "-b", "main", seed], { env: clean });
  writeFileSync(join(seed, "index.html"), "<h1>Contact</h1>\n");
  const g = (args) =>
    run(
      "git",
      [
        "-C",
        seed,
        "-c",
        "user.name=Seed",
        "-c",
        "user.email=seed@example.invalid",
        "-c",
        "commit.gpgSign=false",
        ...args,
      ],
      { env: { ...clean, GIT_CONFIG_GLOBAL: "/dev/null" } },
    );
  g(["add", "index.html"]);
  g(["commit", "-q", "-m", "base"]);
  g(["push", "-q", remote, "main"]);
  const base = g(["rev-parse", "HEAD"]);
  const remoteGit = (args) =>
    spawnSync("git", ["--git-dir", remote, ...args], {
      encoding: "utf8",
      env: clean,
    });
  // Who pushed each branch head, as GitHub's activity records it.
  const pushes = [];
  const github = {
    verified: true,
    pusher: "aaron-howard",
    login: "aaron-howard",
    push: true,
  };
  const api = async (path) => {
    if (path === "user") return { status: 200, body: { login: github.login } };
    if (path === "repos/AJHMH/acceptance")
      return {
        status: 200,
        body: {
          full_name: "AJHMH/acceptance",
          permissions: { push: github.push },
        },
      };
    let m = /^repos\/AJHMH\/acceptance\/branches\/(.+)$/.exec(path);
    if (m) {
      const r = remoteGit([
        "rev-parse",
        "--verify",
        "--quiet",
        "refs/heads/" + decodeURIComponent(m[1]),
      ]);
      return r.status === 0
        ? { status: 200, body: { commit: { sha: r.stdout.trim() } } }
        : { status: 404, body: null };
    }
    m = /^repos\/AJHMH\/acceptance\/commits\/([a-f0-9]{40})$/.exec(path);
    if (m)
      return {
        status: 200,
        body: {
          sha: m[1],
          commit: {
            tree: {
              sha: remoteGit(["show", "-s", "--format=%T", m[1]]).stdout.trim(),
            },
            verification: {
              verified: github.verified,
              reason: github.verified ? "valid" : "unknown_key",
            },
          },
          committer: { login: "aaron-howard" },
        },
      };
    m = /^repos\/AJHMH\/acceptance\/activity\?ref=(.+)&per_page=20$/.exec(path);
    if (m) {
      const ref = decodeURIComponent(m[1]);
      const head = remoteGit([
        "rev-parse",
        "--verify",
        "--quiet",
        ref,
      ]).stdout.trim();
      if (head && !pushes.some((p) => p.after === head))
        pushes.unshift({ after: head, actor: { login: github.pusher } });
      return { status: 200, body: pushes };
    }
    m =
      /^repos\/AJHMH\/acceptance\/git\/trees\/([a-f0-9]{40})\?recursive=1$/.exec(
        path,
      );
    if (m) {
      // Like GitHub, the answer's sha is the SHA asked for, commit or tree.
      const tree = m[1];
      const entries = remoteGit(["ls-tree", "-r", "-t", m[1]])
        .stdout.trim()
        .split("\n")
        .map((line) => {
          const [meta, name] = line.split("\t");
          const [mode, type, sha] = meta.split(" ");
          return { path: name, mode, type, sha };
        });
      return {
        status: 200,
        body: { sha: tree, truncated: false, tree: entries },
      };
    }
    m = /^repos\/AJHMH\/acceptance\/git\/blobs\/([a-f0-9]{40})$/.exec(path);
    if (m) {
      const bytes = spawnSync(
        "git",
        ["--git-dir", remote, "cat-file", "blob", m[1]],
        { env: clean },
      ).stdout;
      return {
        status: 200,
        body: { encoding: "base64", content: bytes.toString("base64") },
      };
    }
    return { status: 404, body: null };
  };
  const metadata = join(root, "metadata");
  const port = (changes = {}) =>
    nativeGitPublicationPort({
      repository: "AJHMH/acceptance",
      login: "aaron-howard",
      name: "Aaron Howard",
      email: "owner@example.invalid",
      signingKey: key + ".pub",
      metadata,
      remoteUrl: "file://" + remote,
      github: api,
      ...changes,
    });
  return {
    root,
    key,
    socket,
    addKey,
    remote,
    remoteGit,
    base,
    github,
    api,
    port,
    metadata,
  };
}

/** The App stand-in: GitHub's App, token and pulls endpoints. */
function appWorld(t, w) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const keyPath = join(w.root, "app.pem");
  writeFileSync(keyPath, privateKey.export({ type: "pkcs1", format: "pem" }), {
    mode: 0o600,
  });
  const calls = [];
  const prs = [];
  const app = {
    scope: { pull_requests: "write", contents: "read", metadata: "read" },
    slug: "ajhmh-software-factory",
  };
  const fetch = async (path, init) => {
    calls.push([init.method, path, init.body]);
    if (path === "app")
      return { status: 200, body: { id: 5180250, slug: app.slug } };
    if (path === "app/installations/167664341/access_tokens") {
      assert.deepEqual(init.body, {
        repositories: ["acceptance"],
        permissions: { pull_requests: "write", contents: "read" },
      });
      return {
        status: 201,
        body: {
          token: "ghs_" + randomUUID(),
          permissions: app.scope,
          repositories: [{ full_name: "AJHMH/acceptance" }],
        },
      };
    }
    if (path === "installation/token") return { status: 204, body: null };
    if (path === "repos/AJHMH/acceptance/pulls" && init.method === "POST") {
      const head = w
        .remoteGit(["rev-parse", "refs/heads/" + init.body.head])
        .stdout.trim();
      prs.push({
        number: prs.length + 1,
        user: { login: "ajhmh-software-factory[bot]" },
        head: {
          ref: init.body.head,
          sha: head,
          repo: { full_name: "AJHMH/acceptance" },
        },
        base: { ref: init.body.base, repo: { full_name: "AJHMH/acceptance" } },
        body: init.body.body,
      });
      return { status: 201, body: prs.at(-1) };
    }
    const m =
      /^repos\/AJHMH\/acceptance\/pulls\?state=all&per_page=100&head=AJHMH%3A(.+)$/.exec(
        path,
      );
    if (m)
      return {
        status: 200,
        body: prs.filter((p) => p.head.ref === decodeURIComponent(m[1])),
      };
    return { status: 404, body: null };
  };
  const port = (changes = {}) =>
    nativeAppPullRequestPort({
      repository: "AJHMH/acceptance",
      appId: "5180250",
      installationId: "167664341",
      botLogin: "ajhmh-software-factory[bot]",
      keyPath,
      approver: "aaron-howard",
      state: join(w.root, "app-state"),
      fetch,
      ...changes,
    });
  return { port, calls, prs, app, keyPath };
}

/** A publication of `files` on a new branch from main. */
function request(w, files, changes = {}) {
  const publication = {
    id: randomUUID(),
    mode: "controlled",
    bindingSha256: "f".repeat(64),
    repository: "AJHMH/acceptance",
    defaultBranch: "main",
    branch: "aios/feature-" + randomUUID(),
    sourceRevision: w.base,
    candidateSha256: "c".repeat(64),
    treeSha1: publicationTree(files),
    policySha256: "p".repeat(64),
    validationOperationId: randomUUID(),
    publicationLogin: "aaron-howard",
    appLogin: "ajhmh-software-factory[bot]",
    approver: "aaron-howard",
    outcome: "pending",
    effects: [],
    ...changes,
  };
  const effect = (kind) => ({
    id: randomUUID(),
    runId: randomUUID(),
    kind,
    fence: 1,
    state: "dispatched",
    startedAt: new Date().toISOString(),
  });
  return { publication, effect, files, mayDispatch: () => true };
}
const page = [
  {
    path: "index.html",
    bytes: Buffer.from(
      '<h1>Contact</h1>\n<p data-testid="contact-hint">Hi</p>\n',
    ),
    executable: false,
  },
  {
    path: "scripts/check.sh",
    bytes: Buffer.from("#!/bin/sh\ntrue\n"),
    executable: true,
  },
];

test("the owner's key signs the exact admitted tree through the agent, the branch is pushed only when absent, and the App opens the PR", async (t) => {
  const w = world(t);
  const a = appWorld(t, w);
  const adapter = new SplitPublicationAdapter(
    "f".repeat(64),
    w.port(),
    a.port(),
  );
  const authority = await adapter.inspect();
  assert.equal(authority.publicationLogin, "aaron-howard");
  assert.equal(authority.signingAvailable, true);
  assert.equal(authority.publicationAllowed, true);
  assert.equal(authority.appLogin, "ajhmh-software-factory[bot]");
  assert.deepEqual(authority.appPermissions, ["pull_requests:write"]);
  assert.match(authority.signingKeySha256, /^[a-f0-9]{64}$/);
  assert.match(authority.appKeySha256, /^[a-f0-9]{64}$/);
  assert.notEqual(authority.signingKeySha256, authority.appKeySha256);
  // Every App token was revoked after use.
  assert.equal(
    a.calls.filter(([m, p]) => m === "POST" && p.endsWith("access_tokens"))
      .length,
    a.calls.filter(([m, p]) => m === "DELETE" && p === "installation/token")
      .length,
  );

  const r = request(w, page);
  r.effect = r.effect("sign");
  const signed = await adapter.sign(r);
  assert.equal(signed.localVerified, true);
  assert.equal(signed.signer, "aaron-howard");
  assert.equal(signed.tree, r.publication.treeSha1);
  assert.equal(signed.parent, w.base);
  // The signature is a real SSH signature by the throwaway key.
  const raw = spawnSync(
    "git",
    ["--git-dir", w.metadata, "cat-file", "commit", signed.commit],
    { encoding: "utf8", env: clean },
  ).stdout;
  assert.match(raw, /-----BEGIN SSH SIGNATURE-----/);
  assert.match(raw, /author Aaron Howard <owner@example.invalid>/);
  assert.equal((await w.port().findSigned(r)).result.commit, signed.commit);

  const pushed = {
    ...r,
    publication: {
      ...r.publication,
      commit: signed.commit,
      localSignature: signed,
    },
  };
  pushed.effect = { ...r.effect, kind: "push", id: randomUUID() };
  const remote = await adapter.push(pushed);
  assert.equal(remote.commit, signed.commit);
  assert.equal(remote.githubVerified, true);
  assert.equal(remote.publisher, "aaron-howard");
  assert.equal(remote.signer, "aaron-howard");
  assert.equal(
    w
      .remoteGit(["rev-parse", "refs/heads/" + r.publication.branch])
      .stdout.trim(),
    signed.commit,
  );

  const pr = {
    ...pushed,
    publication: { ...pushed.publication, remoteSignature: remote },
  };
  pr.effect = { ...pushed.effect, kind: "pr", id: randomUUID() };
  const opened = await adapter.createPullRequest(pr);
  assert.equal(opened.author, "ajhmh-software-factory[bot]");
  assert.equal(opened.head, signed.commit);
  assert.equal(opened.branch, r.publication.branch);
  assert.equal(opened.base, "main");
  assert.match(a.prs[0].body, new RegExp("AIOS-Operation: " + pr.effect.id));
  // Reconciliation finds each effect without another write.
  const before = a.prs.length;
  assert.equal(
    (
      await adapter.reconcile({
        publication: pr.publication,
        effect: pr.effect,
      })
    ).result.number,
    opened.number,
  );
  assert.equal(
    (
      await adapter.reconcile({
        publication: pushed.publication,
        effect: pushed.effect,
      })
    ).result.commit,
    signed.commit,
  );
  assert.equal(
    (await adapter.reconcile({ publication: r.publication, effect: r.effect }))
      .result.localVerified,
    true,
  );
  assert.equal(a.prs.length, before);
  // No token ever asked for more than pull requests.
  for (const [m, p, body] of a.calls)
    if (m === "POST" && p.endsWith("access_tokens"))
      assert.deepEqual(body.permissions, {
        pull_requests: "write",
        contents: "read",
      });
});

test("signing blocks when the agent doesn't hold the key, and never prompts or reads the private key", async (t) => {
  const w = world(t);
  run("ssh-add", ["-D", "-q"], { env: { ...clean, SSH_AUTH_SOCK: w.socket } });
  const port = w.port();
  assert.equal((await port.inspect()).signingAvailable, false);
  // The private key is there on disk, but signing still fails without the agent.
  const r = request(w, page);
  r.effect = r.effect("sign");
  r.controls = {
    hooks: false,
    filters: false,
    includes: false,
    candidateConfiguration: false,
    signWithAppPem: false,
  };
  await assert.rejects(port.sign(r), /Publication Git step failed/);
});

test("a tree that differs from the admitted one is never signed", async (t) => {
  const w = world(t);
  const r = request(w, page, { treeSha1: "0".repeat(40) });
  r.effect = r.effect("sign");
  r.controls = {
    hooks: false,
    filters: false,
    includes: false,
    candidateConfiguration: false,
    signWithAppPem: false,
  };
  await assert.rejects(w.port().sign(r), /differs from the admitted tree/);
  assert.equal((await w.port().findSigned(r)).state, "absent");
});

test("a branch that already exists is never overwritten, and GitHub's own verification and pusher are what count", async (t) => {
  const w = world(t);
  const a = appWorld(t, w);
  const adapter = new SplitPublicationAdapter(
    "f".repeat(64),
    w.port(),
    a.port(),
  );
  const r = request(w, page);
  r.effect = r.effect("sign");
  const signed = await adapter.sign(r);
  const pushed = {
    ...r,
    publication: {
      ...r.publication,
      commit: signed.commit,
      localSignature: signed,
    },
  };
  pushed.effect = { ...r.effect, kind: "push", id: randomUUID() };
  // Someone else creates the branch first.
  w.remoteGit(["update-ref", "refs/heads/" + r.publication.branch, w.base]);
  await assert.rejects(adapter.push(pushed), /precondition is unverified/);
  assert.equal(
    w
      .remoteGit(["rev-parse", "refs/heads/" + r.publication.branch])
      .stdout.trim(),
    w.base,
  );
  // A raced push is refused by the remote itself: the lease expects absence.
  w.remoteGit(["update-ref", "-d", "refs/heads/" + r.publication.branch]);
  const port = w.port();
  w.remoteGit(["update-ref", "refs/heads/" + r.publication.branch, w.base]);
  await assert.rejects(
    port.push({
      ...pushed,
      controls: { forcePush: false },
      expectedRemoteHead: null,
    }),
    /Publication Git step failed/,
  );
  assert.equal(
    w
      .remoteGit(["rev-parse", "refs/heads/" + r.publication.branch])
      .stdout.trim(),
    w.base,
  );
  await assert.rejects(
    port.push({
      ...pushed,
      controls: { forcePush: true },
      expectedRemoteHead: null,
    }),
    /forced/,
  );
  // Unverified on GitHub, or pushed by someone else: not the owner's.
  w.remoteGit([
    "update-ref",
    "refs/heads/" + r.publication.branch,
    signed.commit,
  ]);
  w.github.verified = false;
  const unverified = await port.observeRemote(pushed);
  assert.equal(unverified.result.githubVerified, false);
  assert.equal(unverified.result.signer, "");
});

test("an unanswered push or PR is never reported absent until it can no longer land", async (t) => {
  const w = world(t);
  const a = appWorld(t, w);
  let now = 1_000_000;
  const port = w.port({
    clock: () => now,
    remoteUrl: "file://" + join(w.root, "missing.git"),
  });
  const r = request(w, page);
  r.effect = r.effect("push");
  r.publication.commit = w.base;
  await assert.rejects(
    port.push({
      ...r,
      controls: { forcePush: false },
      expectedRemoteHead: null,
    }),
  );
  assert.deepEqual(await port.observeRemote(r), {
    state: "absent",
    quiescent: false,
  });
  now += 120001;
  assert.deepEqual(await port.observeRemote(r), {
    state: "absent",
    quiescent: true,
  });
  // Before any dispatch, absence is settled.
  const fresh = request(w, page);
  fresh.effect = fresh.effect("push");
  assert.deepEqual(await w.port().observeRemote(fresh), {
    state: "absent",
    quiescent: true,
  });

  let clock = 5_000_000;
  const app = a.port({
    clock: () => clock,
    fetch: async (path, init) =>
      path.endsWith("/pulls") && init.method === "POST"
        ? { status: 502, body: null }
        : await (async () => {
            if (path === "app")
              return {
                status: 200,
                body: { id: 5180250, slug: "ajhmh-software-factory" },
              };
            if (path.endsWith("access_tokens"))
              return {
                status: 201,
                body: {
                  token: "ghs_x",
                  permissions: { pull_requests: "write", contents: "read" },
                  repositories: [{ full_name: "AJHMH/acceptance" }],
                },
              };
            if (path.includes("/pulls?")) return { status: 200, body: [] };
            return { status: 204, body: null };
          })(),
  });
  const pr = {
    repository: "AJHMH/acceptance",
    branch: "aios/feature-x",
    base: "main",
    head: w.base,
    operationId: randomUUID(),
    approver: "aaron-howard",
  };
  await assert.rejects(
    app.create({ ...pr, mayDispatch: () => true }),
    /^Error: PR creation refused \(HTTP 502\)$/,
  );
  assert.deepEqual(await app.observe(pr), {
    state: "absent",
    quiescent: false,
  });
  clock += 120001;
  assert.deepEqual(await app.observe(pr), { state: "absent", quiescent: true });
});

test("an App token wider than pull requests, another App, or several PRs on the branch are refused", async (t) => {
  const w = world(t);
  const a = appWorld(t, w);
  a.app.scope = { pull_requests: "write", contents: "write", metadata: "read" };
  await assert.rejects(a.port().inspect(), /Unexpected App credential scope/);
  // The wider token is still revoked.
  assert.ok(
    a.calls.some(([m, p]) => m === "DELETE" && p === "installation/token"),
  );
  a.app.scope = { pull_requests: "write", contents: "read", metadata: "read" };
  a.app.slug = "other-app";
  await assert.rejects(a.port().inspect(), /Wrong GitHub App/);
  a.app.slug = "ajhmh-software-factory";
  const pr = {
    repository: "AJHMH/acceptance",
    branch: "aios/feature-y",
    base: "main",
    head: w.base,
    operationId: randomUUID(),
    approver: "aaron-howard",
  };
  for (const n of [1, 2])
    a.prs.push({
      number: n,
      user: { login: "x" },
      head: {
        ref: "aios/feature-y",
        sha: w.base,
        repo: { full_name: "AJHMH/acceptance" },
      },
      base: { ref: "main", repo: { full_name: "AJHMH/acceptance" } },
    });
  assert.deepEqual(await a.port().observe(pr), { state: "unknown" });
  assert.throws(
    () => a.port({ botLogin: "not a bot" }),
    /Invalid App publication identity/,
  );
  assert.throws(
    () => w.port({ email: "nope" }),
    /Invalid publication identity/,
  );
  assert.throws(
    () => w.port({ remoteUrl: "ssh://host/repo" }),
    /Invalid publication remote/,
  );
});

test("the private App key never appears in what the ports report", async (t) => {
  const w = world(t);
  const a = appWorld(t, w);
  const authority = await new SplitPublicationAdapter(
    "f".repeat(64),
    w.port(),
    a.port(),
  ).inspect();
  const pem = readFileSync(a.keyPath, "utf8");
  const text = JSON.stringify(authority);
  assert.ok(!text.includes(pem.split("\n")[1]));
  assert.ok(!text.includes(readFileSync(w.key, "utf8").split("\n")[1]));
  mkdirSync(join(w.root, "unused"));
});

test("the owner-run acceptance publishes one signed candidate from main and opens the App's PR, and blocks on what isn't the owner's", async (t) => {
  const w = world(t);
  const a = appWorld(t, w);
  const identity = {
    repository: "AJHMH/acceptance",
    login: "aaron-howard",
    botLogin: "ajhmh-software-factory[bot]",
    approver: "aaron-howard",
    sha256: "e".repeat(64),
  };
  const adapter = () =>
    new SplitPublicationAdapter("e".repeat(64), w.port(), a.port());
  const report = await publicationAcceptance({
    adapter: adapter(),
    github: w.api,
    identity,
  });
  assert.equal(report.outcome, passingOutcome, report.error);
  assert.deepEqual(
    report.stages.map((s) => [s.name, s.outcome]),
    stageNames.map((n) => [n, "passed"]),
  );
  assert.equal(report.base, w.base);
  assert.equal(report.remote.githubVerified, true);
  assert.equal(report.pullRequest.author, "ajhmh-software-factory[bot]");
  // One branch and one PR, though the run wrote each twice.
  assert.equal(a.prs.length, 1);
  const files = w
    .remoteGit(["ls-tree", "-r", "--name-only", report.commit])
    .stdout.trim()
    .split("\n");
  assert.deepEqual(files, ["acceptance/" + report.runId + ".md", "index.html"]);
  assert.equal(
    w.remoteGit(["rev-parse", "refs/heads/main"]).stdout.trim(),
    w.base,
    "main is untouched",
  );

  // GitHub doesn't verify the signature: blocked before any PR.
  w.github.verified = false;
  const unverified = await publicationAcceptance({
    adapter: adapter(),
    github: w.api,
    identity,
  });
  assert.equal(unverified.outcome, "blocked");
  assert.equal(unverified.stages.at(-1).name, "push");
  assert.match(unverified.error, /Verified|signer/);
  assert.equal(a.prs.length, 1);
  w.github.verified = true;
  // Someone else's gh login, or a key the agent doesn't hold: blocked first.
  w.github.login = "someone-else";
  const other = await publicationAcceptance({
    adapter: adapter(),
    github: w.api,
    identity,
  });
  assert.equal(other.stages.length, 1);
  assert.match(other.error, /gh login is someone-else/);
  w.github.login = "aaron-howard";
  spawnSync("ssh-add", ["-D", "-q"], {
    env: { ...clean, SSH_AUTH_SOCK: w.socket },
  });
  const locked = await publicationAcceptance({
    adapter: adapter(),
    github: w.api,
    identity,
  });
  assert.match(locked.error, /ssh-add --apple-use-keychain/);
});

test("the owner publication record is a private file naming every identity and a public signing key", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "aios-publication-record-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const record = {
    scope: "aios-publication-identity-v1",
    repository: "AJHMH/aios-publication-acceptance",
    login: "aaron-howard",
    name: "Aaron Howard",
    email: "owner@example.invalid",
    signingKey: "/Users/owner/.ssh/id_ed25519.pub",
    appId: "5180250",
    installationId: "167664341",
    botLogin: "ajhmh-software-factory[bot]",
    appKeyPath: "/Users/owner/keystore/app.pem",
    approver: "aaron-howard",
  };
  const path = join(root, "publication-identity.json");
  writeFileSync(path, JSON.stringify(record), { mode: 0o600 });
  assert.equal((await readIdentity(path)).login, "aaron-howard");
  assert.match((await readIdentity(path)).sha256, /^[a-f0-9]{64}$/);
  writeFileSync(
    path,
    JSON.stringify({ ...record, signingKey: "/Users/owner/.ssh/id_ed25519" }),
    { mode: 0o600 },
  );
  await assert.rejects(readIdentity(path), /Invalid owner publication record/);
  writeFileSync(path, JSON.stringify(record), { mode: 0o644 });
  spawnSync("chmod", ["644", path]);
  await assert.rejects(readIdentity(path), /private file/);
});

const controls = {
  hooks: false,
  filters: false,
  includes: false,
  candidateConfiguration: false,
  signWithAppPem: false,
};

test("an update is signed on the exact previous head and pushed only from it", async (t) => {
  const w = world(t);
  const a = appWorld(t, w);
  const adapter = new SplitPublicationAdapter(
    "f".repeat(64),
    w.port(),
    a.port(),
  );
  const first = request(w, page);
  first.effect = first.effect("sign");
  const s1 = await adapter.sign(first);
  const p1 = {
    ...first,
    publication: {
      ...first.publication,
      commit: s1.commit,
      localSignature: s1,
    },
  };
  p1.effect = { ...first.effect, kind: "push", id: randomUUID() };
  await adapter.push(p1);
  const files = [
    ...page,
    { path: "notes.md", bytes: Buffer.from("more\n"), executable: false },
  ];
  const second = request(w, files, {
    branch: first.publication.branch,
    previous: { commit: s1.commit, number: 1 },
  });
  second.effect = second.effect("sign");
  const s2 = await adapter.sign(second);
  assert.equal(s2.parent, s1.commit);
  const p2 = {
    ...second,
    publication: {
      ...second.publication,
      commit: s2.commit,
      localSignature: s2,
    },
  };
  p2.effect = { ...second.effect, kind: "push", id: randomUUID() };
  assert.equal((await adapter.push(p2)).commit, s2.commit);
  // A push whose lease isn't the branch's current head is refused, even one
  // that would rewind the branch.
  const port = w.port();
  await assert.rejects(
    port.push({
      ...p1,
      controls: { forcePush: false },
      expectedRemoteHead: w.base,
    }),
    /Publication Git step failed/,
  );
  assert.equal(
    w
      .remoteGit(["rev-parse", "refs/heads/" + first.publication.branch])
      .stdout.trim(),
    s2.commit,
  );
  await assert.rejects(
    port.push({
      ...p2,
      controls: { forcePush: false },
      expectedRemoteHead: "nope",
    }),
    /Invalid push/,
  );
  await assert.rejects(
    port.push({
      ...p2,
      publication: { ...p2.publication, commit: undefined },
      controls: { forcePush: false },
      expectedRemoteHead: null,
    }),
    /Invalid push/,
  );
});

test("signing refuses fenced or uncontrolled requests, a bad parent, a bad effect, and an unsigned or foreign commit fails verification", async (t) => {
  const w = world(t);
  const port = w.port();
  const r = request(w, page);
  r.effect = r.effect("sign");
  await assert.rejects(
    port.sign({ ...r, controls, mayDispatch: () => false }),
    /Fenced or uncontrolled/,
  );
  await assert.rejects(
    port.sign({ ...r, controls: { ...controls, hooks: true } }),
    /Fenced or uncontrolled/,
  );
  await assert.rejects(
    port.sign({ ...r, controls: { ...controls, signWithAppPem: true } }),
    /Fenced or uncontrolled/,
  );
  await assert.rejects(
    port.sign({
      ...r,
      controls,
      publication: { ...r.publication, sourceRevision: "base" },
    }),
    /Invalid publication parent/,
  );
  await assert.rejects(
    port.findSigned({ ...r, effect: { ...r.effect, id: "../x" } }),
    /Invalid publication effect/,
  );
  await assert.rejects(
    port.verifyLocal({ ...r, commit: "x" }),
    /Invalid commit/,
  );
  // The base commit is unsigned: not the owner's.
  const fetched = await port.sign({ ...r, controls });
  assert.ok(fetched.commit);
  const unsigned = await port.verifyLocal({ ...r, commit: w.base });
  assert.equal(unsigned.localVerified, false);
  assert.equal(unsigned.signer, "");
  // Signing with a run that yields no commit is refused.
  const odd = w.port({
    run: (exe, args, o) =>
      args.includes("commit-tree")
        ? { status: 0, stdout: "not a commit", stderr: "" }
        : defaultRunner(exe, args, o),
  });
  const r2 = request(w, page);
  r2.effect = r2.effect("sign");
  await assert.rejects(odd.sign({ ...r2, controls }), /no commit/);
});

test("a remote that isn't GitHub's word is unknown, and a missing user or bad key is never the owner's", async (t) => {
  const w = world(t);
  const r = request(w, page);
  r.effect = r.effect("push");
  const answer = (over) => async (path) => over(path) ?? w.api(path);
  w.remoteGit(["update-ref", "refs/heads/" + r.publication.branch, w.base]);
  for (const over of [
    (p) => (p.includes("/branches/") ? { status: 500, body: null } : undefined),
    (p) => (p.includes("/commits/") ? { status: 500, body: null } : undefined),
    (p) =>
      p.includes("/activity")
        ? { status: 200, body: { not: "a list" } }
        : undefined,
  ])
    assert.deepEqual(await w.port({ github: answer(over) }).observeRemote(r), {
      state: "unknown",
    });
  const bare = await w
    .port({
      github: answer((p) =>
        p.includes("/commits/")
          ? {
              status: 200,
              body: {
                sha: w.base,
                commit: { verification: { verified: true, reason: "valid" } },
                committer: null,
              },
            }
          : undefined,
      ),
    })
    .observeRemote(r);
  assert.equal(bare.result.tree, "");
  assert.equal(bare.result.signer, "");
  const nobody = await w
    .port({
      github: answer((p) =>
        p === "user" ? { status: 401, body: null } : undefined,
      ),
    })
    .inspect();
  assert.equal(nobody.login, "");
  writeFileSync(join(w.root, "bad.pub"), "not-a-key\n");
  await assert.rejects(
    w.port({ signingKey: join(w.root, "bad.pub") }).inspect(),
    /Invalid publication signing key/,
  );
  writeFileSync(join(w.root, "a-file"), "x");
  await assert.rejects(
    w.port({ metadata: join(w.root, "a-file", "git") }).inspect(),
    /metadata unavailable/,
  );
});

test("over HTTPS the push uses the owner's gh credential helper, inside the isolated configuration", async (t) => {
  const w = world(t);
  const seen = [];
  const port = w.port({
    remoteUrl: undefined,
    run: (exe, args, o) => {
      if (exe === "git" && args.includes("fetch")) {
        seen.push({ args, env: o.env });
        return { status: 1, stdout: "", stderr: "offline" };
      }
      return defaultRunner(exe, args, o);
    },
  });
  const r = request(w, page);
  r.effect = r.effect("sign");
  await assert.rejects(
    port.sign({ ...r, controls }),
    /Publication Git step failed/,
  );
  const { args, env } = seen[0];
  assert.ok(args.includes("https://github.com/AJHMH/acceptance.git"));
  assert.ok(args.includes("credential.helper=!gh auth git-credential"));
  assert.ok(args.includes("protocol.https.allow=always"));
  assert.ok(args.includes("protocol.allow=never"));
  assert.ok(!args.includes("protocol.file.allow=always"));
  assert.ok(
    args.some((a) => a.startsWith("user.signingKey=key::ssh-ed25519 ")),
  );
  assert.equal(env.GIT_CONFIG_GLOBAL, "/dev/null");
  assert.equal(env.GIT_CONFIG_NOSYSTEM, "1");
  assert.equal(env.SSH_ASKPASS_REQUIRE, "never");
  assert.ok(
    !Object.keys(env).some(
      (k) =>
        k.startsWith("GIT_") &&
        ![
          "GIT_CONFIG_NOSYSTEM",
          "GIT_CONFIG_GLOBAL",
          "GIT_TERMINAL_PROMPT",
          "GIT_AUTHOR_NAME",
          "GIT_AUTHOR_EMAIL",
          "GIT_COMMITTER_NAME",
          "GIT_COMMITTER_EMAIL",
        ].includes(k),
    ),
  );
});

test("the owner's gh api and the App's REST calls answer with status and body", async (t) => {
  const answers = [
    {
      status: 0,
      stdout:
        'HTTP/2.0 200 OK\nContent-Type: application/json\n\n{"login":"aaron-howard"}',
      stderr: "",
    },
    { status: 1, stdout: "HTTP/2.0 404 Not Found\n\n", stderr: "" },
    { status: 1, stdout: "", stderr: "no network" },
    { status: 0, stdout: "HTTP/2.0 200 OK\n\n{not json", stderr: "" },
  ];
  const calls = [];
  const api = ghApi(
    (exe, args, o) => (
      calls.push([exe, args, o.env.GH_PROMPT_DISABLED]),
      answers.shift()
    ),
  );
  assert.deepEqual(await api("user"), {
    status: 200,
    body: { login: "aaron-howard" },
  });
  assert.deepEqual(await api("repos/x/y"), { status: 404, body: null });
  await assert.rejects(api("user"), /GitHub observation failed/);
  await assert.rejects(api("user"), /GitHub observation failed/);
  assert.deepEqual(calls[0], [
    "gh",
    ["api", "--include", "-X", "GET", "user"],
    "1",
  ]);
  // A missing executable is a failed command, not a crash.
  assert.equal(
    defaultRunner("aios-missing-executable", [], { env: {}, timeoutMs: 1000 })
      .status,
    null,
  );

  const real = globalThis.fetch;
  t.after(() => (globalThis.fetch = real));
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push([url, init]);
    return new Response(url.endsWith("/app") ? '{"id":1}' : "not json", {
      status: url.endsWith("/app") ? 200 : 502,
    });
  };
  assert.deepEqual(await githubFetch("app", { method: "GET", token: "jwt" }), {
    status: 200,
    body: { id: 1 },
  });
  assert.deepEqual(
    await githubFetch("repos/x/y/pulls", {
      method: "POST",
      token: "t",
      body: { a: 1 },
    }),
    { status: 502, body: null },
  );
  assert.equal(sent[0][0], "https://api.github.com/app");
  assert.equal(sent[0][1].headers.Authorization, "Bearer jwt");
  assert.equal(sent[0][1].redirect, "error");
  assert.equal(sent[1][1].body, '{"a":1}');
  assert.equal(sent[1][1].headers["Content-Type"], "application/json");
});

test("the App port refuses a non-RSA key, a token without permissions, a fenced or foreign PR, and unreadable PR lists", async (t) => {
  const w = world(t);
  const a = appWorld(t, w);
  const { privateKey } = generateKeyPairSync("ed25519");
  const ed = join(w.root, "ed.pem");
  writeFileSync(ed, privateKey.export({ type: "pkcs8", format: "pem" }));
  await assert.rejects(a.port({ keyPath: ed }).inspect(), /Invalid App key/);
  const fake = (over) => async (path, init) => {
    if (path === "app")
      return {
        status: 200,
        body: { id: 5180250, slug: "ajhmh-software-factory" },
      };
    if (path.endsWith("access_tokens"))
      return (
        over.token ?? {
          status: 201,
          body: {
            token: "ghs_x",
            permissions: { pull_requests: "write", contents: "read" },
            repositories: [{ full_name: "AJHMH/acceptance" }],
          },
        }
      );
    if (path.includes("/pulls?")) return over.pulls;
    return { status: 204, body: null };
  };
  await assert.rejects(
    a
      .port({
        fetch: fake({ token: { status: 201, body: { repositories: [] } } }),
      })
      .inspect(),
    /credential scope/,
  );
  const pr = {
    repository: "AJHMH/acceptance",
    branch: "aios/feature-z",
    base: "main",
    head: w.base,
    operationId: randomUUID(),
    approver: "aaron-howard",
  };
  await assert.rejects(
    a.port().create({ ...pr, mayDispatch: () => false }),
    /Fenced PR creation/,
  );
  await assert.rejects(
    a
      .port()
      .create({ ...pr, repository: "AJHMH/other", mayDispatch: () => true }),
    /Fenced PR creation/,
  );
  await assert.rejects(
    a.port().create({ ...pr, operationId: "../x", mayDispatch: () => true }),
    /Invalid publication operation/,
  );
  assert.deepEqual(
    await a
      .port({ fetch: fake({ pulls: { status: 500, body: null } }) })
      .observe(pr),
    { state: "unknown" },
  );
  assert.deepEqual(
    await a
      .port({
        fetch: fake({
          pulls: {
            status: 200,
            body: [
              { number: 1, head: { repo: { full_name: "fork/acceptance" } } },
            ],
          },
        }),
      })
      .observe(pr),
    { state: "unknown" },
  );
});

test("a refused PR creation says GitHub's status and short reason", async (t) => {
  const w = world(t);
  const a = appWorld(t, w);
  const refuse = (body) => async (path, init) =>
    path.endsWith("/pulls") && init.method === "POST"
      ? { status: 422, body }
      : path === "app"
        ? { status: 200, body: { id: 5180250, slug: "ajhmh-software-factory" } }
        : path.endsWith("access_tokens")
          ? {
              status: 201,
              body: {
                token: "ghs_x",
                permissions: { pull_requests: "write", contents: "read" },
                repositories: [{ full_name: "AJHMH/acceptance" }],
              },
            }
          : { status: 204, body: null };
  const pr = {
    repository: "AJHMH/acceptance",
    branch: "aios/feature-r",
    base: "main",
    head: w.base,
    operationId: randomUUID(),
    approver: "aaron-howard",
    mayDispatch: () => true,
  };
  await assert.rejects(
    a
      .port({
        fetch: refuse({
          message: "Validation Failed",
          errors: [
            { message: "No commits between main and aios/feature-r" },
            { code: "invalid" },
          ],
        }),
      })
      .create(pr),
    /^Error: PR creation refused \(HTTP 422: Validation Failed; No commits between main and aios\/feature-r; invalid\)$/,
  );
  await assert.rejects(
    a
      .port({ fetch: refuse({ message: "x".repeat(500) + "\n" }) })
      .create({ ...pr, operationId: randomUUID() }),
    (e) => e.message.length < 240 && !e.message.includes("\n"),
  );
});

test("an App token without contents read, or with any write beyond pull requests, is refused", async (t) => {
  const w = world(t);
  const a = appWorld(t, w);
  for (const scope of [
    { pull_requests: "write", metadata: "read" },
    { pull_requests: "write", contents: "write", metadata: "read" },
    {
      pull_requests: "write",
      contents: "read",
      issues: "write",
      metadata: "read",
    },
  ]) {
    a.app.scope = scope;
    await assert.rejects(
      a.port().inspect(),
      /Unexpected App credential scope/,
      JSON.stringify(scope),
    );
  }
});

test("signingKeyLoaded reads the agent's keys for the owner's public key", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "aios-signing-loaded-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pub = join(dir, "id.pub");
  writeFileSync(pub, "ssh-ed25519 AAAAkey owner\n");
  const agent = (status, stdout) => () => ({ status, stdout, stderr: "" });
  assert.equal(
    signingKeyLoaded(
      pub,
      agent(0, "ssh-ed25519 AAAAother x\nssh-ed25519 AAAAkey y\n"),
    ),
    true,
  );
  assert.equal(
    signingKeyLoaded(pub, agent(0, "ssh-ed25519 AAAAother x\n")),
    false,
  );
  // "The agent has no identities" exits 1.
  assert.equal(signingKeyLoaded(pub, agent(1, "")), false);
  assert.equal(signingKeyLoaded(join(dir, "none.pub"), agent(0, "")), false);
  writeFileSync(pub, "not-a-key\n");
  assert.equal(signingKeyLoaded(pub, agent(0, "not-a-key\n")), false);
  writeFileSync(pub, "ssh-ed25519\n");
  assert.equal(signingKeyLoaded(pub, agent(0, "ssh-ed25519\n")), false);
});
