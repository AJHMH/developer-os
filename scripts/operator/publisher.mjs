import { spawnSync } from "node:child_process";
import { createPrivateKey, createSign } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { devNull } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import {
  digest,
  locked,
  readPrivateFile,
  readState,
  requireValue as check,
  stateDirectory,
  trustedAncestors,
  within,
  writeState,
} from "./state.mjs";

// GitHub's pulls listing can trail a branch update; bound the wait for it.
const PR_HEAD_OBSERVATIONS = 5,
  PR_HEAD_DELAY_MS = 2000;
const sha = (value) => /^[a-f0-9]{40}$/.test(value ?? "");
const safePath = (path) =>
  path &&
  !path.startsWith("/") &&
  !/[\\\x00-\x1f]/.test(path) &&
  path
    .split("/")
    .every((part) => part && ![".", "..", ".git"].includes(part.toLowerCase()));
function environment(extra = {}) {
  const env = Object.fromEntries(
    ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG"]
      .filter((key) => process.env[key])
      .map((key) => [key, process.env[key]]),
  );
  return {
    ...env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_NO_REPLACE_OBJECTS: "1",
    ...extra,
  };
}
export function git(repo, args, extra = {}, input) {
  const result = spawnSync(
    "git",
    [
      "-c",
      "core.hooksPath=" + devNull,
      "-c",
      "core.fsmonitor=false",
      "-c",
      "credential.helper=",
      ...args,
    ],
    {
      cwd: repo,
      env: environment(extra),
      timeout: 30000,
      maxBuffer: 16 * 1024 * 1024,
      input,
    },
  );
  check(result.status === 0, "Trusted Git operation failed");
  return result.stdout;
}
function snapshot(repo, branch) {
  check(
    git(repo, ["rev-parse", "--show-toplevel"]).toString().trim() ===
      realpathSync(repo),
    "Repository root required",
  );
  check(
    git(repo, ["symbolic-ref", "--short", "HEAD"]).toString().trim() === branch,
    "Check out the explicit proposal branch",
  );
  check(
    git(repo, ["diff", "--no-ext-diff", "--no-textconv", "--name-only", "-z"])
      .length === 0,
    "Unstaged tracked changes refuse publication",
  );
  const parent = git(repo, ["rev-parse", "HEAD"]).toString().trim();
  const tree = git(repo, ["write-tree"]).toString().trim();
  check(sha(parent) && sha(tree), "SHA-1 Git repository required");
  return { parent, tree };
}
function identity(options) {
  check(
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository),
    "Explicit GitHub repository required",
  );
  check(
    /^codex\/[a-z0-9][a-z0-9/-]{0,150}$/.test(options.branch) &&
      !options.branch.includes(".."),
    "Explicit codex branch required",
  );
  check(
    /^[A-Za-z0-9][A-Za-z0-9_./-]{0,100}$/.test(options.base) &&
      !options.base.includes(".."),
    "Explicit base branch required",
  );
  git(options.repo, ["check-ref-format", "refs/heads/" + options.branch]);
  git(options.repo, ["check-ref-format", "refs/heads/" + options.base]);
  const config = git(options.repo, [
    "config",
    "--no-includes",
    "--show-scope",
    "--name-only",
    "--list",
  ])
    .toString()
    .split("\n")
    .filter((line) => /^(local|worktree)\t/.test(line))
    .map((line) => line.slice(line.indexOf("\t") + 1));
  check(
    !config.some((key) =>
      /^(include\.|includeif\.|url\.|http\.|credential\.|filter\.)/i.test(key),
    ),
    "Unsafe local Git configuration",
  );
  const origin = git(options.repo, ["remote", "get-url", "origin"])
    .toString()
    .trim();
  check(
    [
      `https://github.com/${options.repository}.git`,
      `https://github.com/${options.repository}`,
      `git@github.com:${options.repository}.git`,
    ].includes(origin),
    "Origin does not match the explicit repository",
  );
}
export async function preparePublication(options, remote) {
  const repo = realpathSync(options.repo),
    root = stateDirectory(options.directory, repo);
  return locked(root, async () => {
    identity({ ...options, repo });
    check(
      typeof options.title === "string" &&
        options.title.length > 0 &&
        options.title.length <= 200 &&
        !/[\r\n]/.test(options.title),
      "Bounded title required",
    );
    check(
      typeof options.body === "string" &&
        Buffer.byteLength(options.body) <= 50000,
      "Bounded PR description required",
    );
    const source = snapshot(repo, options.branch);
    const baseRevision = await remote.ref(options.repository, options.base);
    const branchRevision = await remote.ref(options.repository, options.branch);
    check(
      sha(baseRevision) && source.parent === (branchRevision ?? baseRevision),
      "Source parent differs from current remote authority",
    );
    const paths = git(repo, [
      "diff",
      "--cached",
      "--name-only",
      "--no-renames",
      "-z",
    ])
      .toString()
      .split("\0")
      .filter(Boolean);
    check(
      paths.length > 0 && paths.length <= 100,
      "Stage between one and 100 changed files",
    );
    const additions = [],
      deletions = [];
    let bytes = 0;
    for (const path of paths) {
      check(
        safePath(path) && !/(^|\/)\.env($|\.)|\.(pem|p12|pfx|key)$/i.test(path),
        "Unsupported or sensitive proposal path",
      );
      const entry = git(repo, ["ls-tree", source.tree, "--", path]).toString();
      if (!entry) {
        deletions.push({ path });
        continue;
      }
      check(
        entry.startsWith("100644 blob "),
        "Only ordinary non-executable changed files are supported",
      );
      const value = git(repo, ["show", `${source.tree}:${path}`]);
      bytes += value.length;
      check(
        value.length <= 2 * 1024 * 1024 && bytes <= 8 * 1024 * 1024,
        "Proposal byte limit exceeded",
      );
      check(
        !/-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}/.test(
          value.toString(),
        ),
        "Credential-like proposal content refused",
      );
      additions.push({ path, contents: value.toString("base64") });
    }
    const proposal = {
      schemaVersion: 1,
      repository: options.repository,
      repo,
      branch: options.branch,
      base: options.base,
      baseRevision,
      bot: options.bot ?? "ajhmh-software-factory[bot]",
      appId: String(options.appId ?? "5180250"),
      installationId: String(options.installationId ?? "167664341"),
      ...source,
      title: options.title,
      body: options.body,
      draft: options.draft === true,
      additions,
      deletions,
    };
    check(
      JSON.stringify(snapshot(repo, options.branch)) === JSON.stringify(source),
      "Candidate changed while preparing",
    );
    check(
      /^[a-z0-9-]+\[bot\]$/.test(proposal.bot) &&
        /^\d+$/.test(proposal.appId) &&
        /^\d+$/.test(proposal.installationId),
      "Explicit App identity required",
    );
    const id = digest(proposal),
      name = id + ".proposal.json";
    if (existsSync(join(root, name)))
      check(digest(readState(root, name)) === id, "Existing proposal differs");
    else writeState(root, name, proposal);
    return {
      digest: id,
      tree: source.tree,
      parent: source.parent,
      proposal: join(root, name),
      changedFiles: paths.length,
    };
  });
}
function verifyCommit(commit, proposal, id) {
  check(
    sha(commit?.sha) &&
      commit.commit?.tree?.sha === proposal.tree &&
      commit.parents?.length === 1 &&
      commit.parents[0].sha === proposal.parent &&
      commit.author?.login === proposal.bot &&
      commit.commit.author.name === proposal.bot &&
      commit.commit.verification?.verified === true &&
      commit.commit.verification.reason === "valid" &&
      commit.committer?.login === "web-flow" &&
      commit.commit.committer.name === "GitHub" &&
      commit.commit.message.includes(`Operator-Proposal: ${id}`),
    "Remote commit tree, parent, bot identity or platform signature mismatch",
  );
  return commit.sha;
}
export async function publishPublication(options, remote) {
  const repo = realpathSync(options.repo),
    root = stateDirectory(options.directory, repo),
    id = options.digest;
  check(
    /^[a-f0-9]{64}$/.test(id ?? "") && options.approvedDigest === id,
    "Exact operator-approved proposal digest required",
  );
  return locked(root, async () => {
    const proposal = readState(root, id + ".proposal.json");
    check(
      digest(proposal) === id && proposal.repo === repo,
      "Proposal identity changed",
    );
    identity({ ...proposal, repo });
    const name = id + ".publication.json";
    const state = existsSync(join(root, name))
      ? readState(root, name)
      : { schemaVersion: 1, digest: id };
    check(
      state.schemaVersion === 1 && state.digest === id,
      "Invalid publication state",
    );
    const save = () => writeState(root, name, state);
    const current = snapshot(repo, proposal.branch);
    check(
      current.tree === proposal.tree &&
        [proposal.parent, state.commit].includes(current.parent),
      "Local candidate changed since preparation",
    );
    check(
      (await remote.ref(proposal.repository, proposal.base)) ===
        proposal.baseRevision,
      "Base moved; prepare a new proposal",
    );
    // Authentication occurs only after local admission; the real gateway validates
    // the external private key and exact repository-scoped App identity.
    await remote.authenticate(proposal, options.privateKeyPath);
    try {
      const authority = async () => {
        const local = snapshot(repo, proposal.branch);
        check(
          local.tree === proposal.tree &&
            [proposal.parent, state.commit].includes(local.parent) &&
            (await remote.ref(proposal.repository, proposal.base)) ===
              proposal.baseRevision,
          "Publication authority changed",
        );
      };
      let head = await remote.ref(proposal.repository, proposal.branch);
      if (!head) {
        check(
          !state.branchIntent && !state.commitIntent,
          "Uncertain branch creation; reconcile before further writes",
        );
        await authority();
        state.branchIntent = true;
        save();
        await remote.createBranch(
          proposal.repository,
          proposal.branch,
          proposal.parent,
        );
        head = await remote.ref(proposal.repository, proposal.branch);
        check(
          head === proposal.parent,
          "Branch creation could not be reconciled",
        );
      }
      if (head === proposal.parent) {
        check(
          !state.commitIntent,
          "Uncertain commit creation; no blind write retry",
        );
        await authority();
        state.commitIntent = true;
        save();
        head = await remote.createCommit(proposal, id);
      }
      state.commit = verifyCommit(
        await remote.commit(proposal.repository, head),
        proposal,
        id,
      );
      save();
      check(
        (await remote.ref(proposal.repository, proposal.branch)) ===
          state.commit,
        "Remote branch changed",
      );
      const observe = async () => {
        const existing = await remote.pullRequests(
          proposal.repository,
          proposal.branch,
        );
        check(
          Array.isArray(existing) && existing.length <= 1,
          "Ambiguous PR history; use a new proposal branch",
        );
        return existing[0];
      };
      let pr = await observe();
      for (
        let seen = 1;
        pr && pr.head?.sha !== state.commit && seen < PR_HEAD_OBSERVATIONS;
        seen++
      ) {
        await (remote.delay?.(PR_HEAD_DELAY_MS) ?? delay(PR_HEAD_DELAY_MS));
        pr = await observe();
        check(pr, "PR identity or exact head mismatch");
      }
      if (!pr) {
        check(
          !state.prIntent,
          "Uncertain PR creation; no blind duplicate retry",
        );
        await authority();
        check(
          (await remote.ref(proposal.repository, proposal.branch)) ===
            state.commit,
          "Remote branch changed before PR creation",
        );
        state.prIntent = true;
        save();
        pr = await remote.createPullRequest(proposal, id);
      }
      check(
        pr?.user?.login === proposal.bot &&
          pr.head?.sha === state.commit &&
          pr.head.ref === proposal.branch &&
          pr.head.repo?.full_name === proposal.repository &&
          pr.base?.ref === proposal.base &&
          pr.base.repo?.full_name === proposal.repository &&
          Number.isSafeInteger(pr.number) &&
          pr.number > 0 &&
          pr.html_url ===
            `https://github.com/${proposal.repository}/pull/${pr.number}`,
        "PR identity or exact head mismatch",
      );
      state.pr = { number: pr.number, url: pr.html_url, state: pr.state };
      save();
      // Re-read before the local adoption; the gateway uses only fixed Git argv.
      check(
        (await remote.ref(proposal.repository, proposal.base)) ===
          proposal.baseRevision &&
          (await remote.ref(proposal.repository, proposal.branch)) ===
            state.commit,
        "Remote authority changed before adoption",
      );
      const beforeAdoption = snapshot(repo, proposal.branch);
      check(
        beforeAdoption.tree === proposal.tree &&
          [proposal.parent, state.commit].includes(beforeAdoption.parent),
        "Local source changed before adoption",
      );
      await remote.adopt?.(proposal, state.commit);
      state.adopted = Boolean(remote.adopt);
      save();
      return {
        digest: id,
        commit: state.commit,
        tree: proposal.tree,
        verified: true,
        bot: proposal.bot,
        committer: "GitHub/web-flow",
        ...state.pr,
        adopted: state.adopted,
      };
    } finally {
      await remote.close();
    }
  });
}

export class GitHubPublisher {
  async request(path, method = "GET", body, credential = this.token) {
    const response = await fetch("https://api.github.com/" + path, {
      method,
      headers: {
        Authorization: "Bearer " + credential,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (response.status === 404 && method === "GET") return null;
    check(response.ok, `GitHub ${method} request refused (${response.status})`);
    if (response.status === 204) return null;
    const chunks = [];
    let length = 0;
    for await (const chunk of response.body) {
      length += chunk.length;
      check(length <= 16 * 1024 * 1024, "API response too large");
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString());
  }
  async read(path) {
    if (this.token) return this.request(path);
    const result = spawnSync("gh", ["api", path], {
      encoding: "utf8",
      timeout: 30000,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (result.status !== 0 && result.stderr.includes("HTTP 404")) return null;
    check(result.status === 0, "Read-only GitHub observation failed");
    return JSON.parse(result.stdout);
  }
  async ref(repository, branch) {
    return (
      (await this.read(`repos/${repository}/git/ref/heads/${branch}`))?.object
        ?.sha ?? null
    );
  }
  async authenticate(proposal, path) {
    try {
      check(
        process.platform !== "win32",
        "Native Windows publication is not qualified",
      );
      const keyPath = resolve(path);
      trustedAncestors(keyPath);
      check(
        !within(proposal.repo, realpathSync(keyPath)),
        "App key must remain outside the source repository",
      );
      const key = createPrivateKey(readPrivateFile(keyPath));
      check(key.asymmetricKeyType === "rsa", "External RSA App key required");
      const b64 = (value) =>
          Buffer.from(JSON.stringify(value)).toString("base64url"),
        now = Math.floor(Date.now() / 1000);
      const payload =
        b64({ alg: "RS256", typ: "JWT" }) +
        "." +
        b64({ iat: now - 60, exp: now + 540, iss: proposal.appId });
      const signer = createSign("RSA-SHA256");
      signer.update(payload);
      const jwt = payload + "." + signer.sign(key).toString("base64url");
      const app = await this.request("app", "GET", undefined, jwt);
      check(
        `${app?.slug}[bot]` === proposal.bot &&
          String(app.id) === proposal.appId,
        "Wrong GitHub App",
      );
      const installation = await this.request(
        `repos/${proposal.repository}/installation`,
        "GET",
        undefined,
        jwt,
      );
      check(
        String(installation?.id) === proposal.installationId,
        "Wrong repository installation",
      );
      const permissions = {
        contents: "write",
        pull_requests: "write",
        ...(proposal.additions.some((file) =>
          file.path.startsWith(".github/workflows/"),
        ) ||
        proposal.deletions.some((file) =>
          file.path.startsWith(".github/workflows/"),
        )
          ? { workflows: "write" }
          : {}),
      };
      const credential = await this.request(
        `app/installations/${proposal.installationId}/access_tokens`,
        "POST",
        { repositories: [proposal.repository.split("/")[1]], permissions },
        jwt,
      );
      this.token = credential?.token;
      check(
        typeof this.token === "string" &&
          credential.repositories?.length === 1 &&
          credential.repositories[0].full_name === proposal.repository &&
          Object.entries(permissions).every(
            ([key, value]) => credential.permissions?.[key] === value,
          ) &&
          Object.keys(credential.permissions).every(
            (key) => key === "metadata" || key in permissions,
          ),
        "Unexpected installation credential scope",
      );
    } catch (error) {
      await this.close();
      throw error;
    }
  }
  async createBranch(repository, branch, parent) {
    await this.request(`repos/${repository}/git/refs`, "POST", {
      ref: "refs/heads/" + branch,
      sha: parent,
    });
  }
  async createCommit(proposal, id) {
    const result = await this.request("graphql", "POST", {
      query:
        "mutation($input:CreateCommitOnBranchInput!){createCommitOnBranch(input:$input){commit{oid}}}",
      variables: {
        input: {
          branch: {
            repositoryNameWithOwner: proposal.repository,
            branchName: proposal.branch,
          },
          expectedHeadOid: proposal.parent,
          message: {
            headline: proposal.title,
            body: `Operator-Proposal: ${id}`,
          },
          fileChanges: {
            additions: proposal.additions,
            deletions: proposal.deletions,
          },
        },
      },
    });
    check(
      !result?.errors && sha(result?.data?.createCommitOnBranch?.commit?.oid),
      "Commit write uncertain; reconcile proposal state",
    );
    return result.data.createCommitOnBranch.commit.oid;
  }
  async commit(repository, revision) {
    check(sha(revision), "Exact commit required");
    return this.request(`repos/${repository}/commits/${revision}`);
  }
  async pullRequests(repository, branch) {
    const all = [];
    for (let page = 1; page <= 10; page++) {
      const batch = await this.request(
        `repos/${repository}/pulls?state=all&head=${encodeURIComponent(repository.split("/")[0] + ":" + branch)}&per_page=100&page=${page}`,
      );
      check(Array.isArray(batch), "Complete PR observation required");
      all.push(...batch);
      if (batch.length < 100) return all;
    }
    throw Error("PR history exceeds observation bound");
  }
  async createPullRequest(proposal, id) {
    return this.request(`repos/${proposal.repository}/pulls`, "POST", {
      head: proposal.branch,
      base: proposal.base,
      title: proposal.title,
      body: proposal.body + `\n\n<!-- operator-proposal:${id} -->`,
      draft: proposal.draft,
    });
  }
  async fetchInto(transfer, proposal, credentials) {
    git(
      transfer,
      [
        // A redirect must not carry the credential prompt to another host.
        "-c",
        "http.followRedirects=false",
        "fetch",
        "--depth=1",
        `https://github.com/${proposal.repository}.git`,
        "refs/heads/" + proposal.branch,
      ],
      credentials,
    );
  }
  async adopt(proposal, commit) {
    // The helper contains no credential. Its only consumer is the fixed HTTPS
    // fetch; the ephemeral credential is never part of argv, files or output.
    const helper = join(
      this.stateRoot,
      "askpass-" + digest({ commit, now: Date.now() }) + ".sh",
    );
    check(
      process.platform !== "win32",
      "Native Windows local adoption is not qualified; remote evidence remains retained",
    );
    writeFileSync(
      helper,
      // Answers only GitHub's own prompts; any other host gets no credential.
      '#!/bin/sh\ncase "$1" in\n' +
        "\"Username for 'https://github.com': \") printf '%s\\n' x-access-token;;\n" +
        "\"Password for 'https://x-access-token@github.com': \") printf '%s\\n' \"$OPERATOR_TOKEN\";;\n" +
        "*) exit 1;;\nesac\n",
      { flag: "wx", mode: 0o700 },
    );
    chmodSync(helper, 0o700);
    const transfer = mkdtempSync(join(this.stateRoot, "fetch-"));
    try {
      identity(proposal);
      // Credentials never enter a Git process that reads source Git metadata.
      git(this.stateRoot, ["init", "--bare", transfer]);
      await this.fetchInto(transfer, proposal, {
        GIT_ASKPASS: helper,
        GIT_TERMINAL_PROMPT: "0",
        OPERATOR_TOKEN: this.token,
      });
      check(
        git(transfer, ["rev-parse", "FETCH_HEAD"]).toString().trim() === commit,
        "Fetched head changed",
      );
      const pack = git(
        transfer,
        ["pack-objects", "--stdout", "--revs"],
        {},
        commit + "\n",
      );
      identity(proposal);
      git(proposal.repo, ["index-pack", "--stdin", "--fix-thin"], {}, pack);
      const local = snapshot(proposal.repo, proposal.branch);
      check(
        local.tree === proposal.tree &&
          [proposal.parent, commit].includes(local.parent),
        "Local adoption source changed",
      );
      if (local.parent !== commit)
        git(proposal.repo, [
          "update-ref",
          "refs/heads/" + proposal.branch,
          commit,
          proposal.parent,
        ]);
    } finally {
      rmSync(helper, { force: true });
      rmSync(transfer, { recursive: true, force: true });
    }
  }
  async close() {
    if (!this.token) return;
    try {
      await this.request("installation/token", "DELETE");
    } finally {
      this.token = undefined;
    }
  }
}
