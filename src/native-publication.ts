import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GitPublicationPort } from "./publication-adapter.js";
import { publicationTree, type PublicationRequest } from "./publication.js";

/** One command's bounded result. */
export interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}
/** Runs an executable with arguments, an environment and optional input. */
export type CommandRunner = (
  executable: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv;
    input?: string | Buffer | undefined;
    timeoutMs: number;
  },
) => CommandResult;
/** The owner's GitHub API, read through the owner's own `gh` login. */
export type GitHubApi = (path: string) => Promise<{
  status: number;
  body: unknown;
}>;

export const defaultRunner: CommandRunner = (executable, args, options) => {
  const r = spawnSync(executable, args, {
    env: options.env,
    input: options.input,
    timeout: options.timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: r.status,
    stdout: r.stdout?.toString("utf8") ?? "",
    stderr: r.stderr?.toString("utf8").slice(0, 2000) ?? "",
  };
};

/** The owner's `gh api`, with a bounded answer. A missing resource is 404. */
export function ghApi(run: CommandRunner = defaultRunner): GitHubApi {
  return async (path) => {
    const r = run("gh", ["api", "--include", path], {
      env: {
        ...cleanEnvironment(),
        GH_PROMPT_DISABLED: "1",
        NO_COLOR: "1",
      },
      timeoutMs: 30000,
    });
    const text = r.stdout;
    const status = Number(/^HTTP\/[0-9.]+ ([0-9]{3})/.exec(text)?.[1]);
    if (!Number.isInteger(status)) throw Error("GitHub observation failed");
    const split = text.search(/\r?\n\r?\n/);
    const body = split < 0 ? "" : text.slice(split).trim();
    try {
      return { status, body: body ? JSON.parse(body) : null };
    } catch {
      throw Error("GitHub observation failed");
    }
  };
}

/** The process environment without any Git configuration or hook input. */
function cleanEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env))
    if (!/^GIT_/.test(name)) env[name] = value;
  return env;
}

const sha40 = /^[a-f0-9]{40}$/;
const login = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const slug = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
/** How long a dispatched push may still be accepted after its process. */
export const pushSettleMs = 120000;

export interface NativeGitOptions {
  /** The onboarded repository, `owner/name`. */
  repository: string;
  /** The owner's GitHub login, which signs and pushes. */
  login: string;
  /** The commit identity: a name, and an email GitHub has verified for the
   * owner, so its signature shows as Verified. */
  name: string;
  email: string;
  /** The owner's public signing key (`.pub`). Its private half is used only
   * through ssh-agent; the key file itself is never read for signing. */
  signingKey: string;
  /** A private folder this port owns: trusted bare Git metadata. */
  metadata: string;
  /** Where the repository is pushed; GitHub over HTTPS by default. */
  remoteUrl?: string;
  github?: GitHubApi;
  run?: CommandRunner;
  clock?: () => number;
}

/** The owner's Git signer and pusher (ticket 08). It signs with the owner's
 * key through ssh-agent, pushes with the owner's `gh` login, and observes
 * GitHub's own verification. All Git work happens in its own bare metadata
 * with no system or global configuration, hooks, attributes, filters,
 * includes or candidate input. It never forces an update: a new branch must
 * be absent, and an update must start from the exact previous head. */
export function nativeGitPublicationPort(
  options: NativeGitOptions,
): GitPublicationPort {
  if (
    !slug.test(options.repository) ||
    !login.test(options.login) ||
    !/^[^\n<>]{1,100}$/.test(options.name) ||
    !/^[^\s<>@]+@[^\s<>@]+$/.test(options.email)
  )
    throw Error("Invalid publication identity");
  const run = options.run ?? defaultRunner,
    github = options.github ?? ghApi(run),
    clock = options.clock ?? Date.now;
  const remote =
    options.remoteUrl ?? `https://github.com/${options.repository}.git`;
  const https = remote.startsWith("https://");
  if (!https && !remote.startsWith("file://"))
    throw Error("Invalid publication remote");
  const publicKey = () => {
    const text = readFileSync(options.signingKey, "utf8").trim();
    const [type, blob] = text.split(/\s+/);
    if (!/^ssh-ed25519$|^ecdsa-sha2-|^ssh-rsa$/.test(type ?? "") || !blob)
      throw Error("Invalid publication signing key");
    return { type: type!, blob: blob! };
  };
  const empty = join(options.metadata, "empty");
  const allowed = join(options.metadata, "allowed-signers");
  const env = (): NodeJS.ProcessEnv => ({
    ...cleanEnvironment(),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: options.name,
    GIT_AUTHOR_EMAIL: options.email,
    GIT_COMMITTER_NAME: options.name,
    GIT_COMMITTER_EMAIL: options.email,
    // Never prompt for a passphrase: the key is the agent's or unavailable.
    SSH_ASKPASS_REQUIRE: "never",
    GH_PROMPT_DISABLED: "1",
  });
  const prepare = () => {
    try {
      mkdirSync(empty, { recursive: true, mode: 0o700 });
    } catch {
      throw Error("Publication metadata unavailable");
    }
    if (!existsSync(join(options.metadata, "HEAD"))) {
      const r = run(
        "git",
        ["init", "--bare", "--quiet", "--template=" + empty, options.metadata],
        { env: env(), timeoutMs: 10000 },
      );
      if (r.status !== 0) throw Error("Publication metadata unavailable");
    }
    const key = publicKey();
    writeFileSync(
      allowed,
      `${options.email} namespaces="git" ${key.type} ${key.blob}\n`,
      { mode: 0o600 },
    );
  };
  const git = (args: string[], input?: string | Buffer, timeoutMs = 30000) => {
    const r = run(
      "git",
      [
        "--git-dir",
        options.metadata,
        "-c",
        "core.hooksPath=" + empty,
        "-c",
        "core.attributesFile=/dev/null",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "commit.gpgSign=false",
        "-c",
        "gpg.format=ssh",
        "-c",
        "gpg.ssh.program=ssh-keygen",
        "-c",
        // A literal public key: Git then signs with \`ssh-keygen -U\`, which
        // uses only the agent and never reads or prompts for a key file.
        "user.signingKey=key::" + `${publicKey().type} ${publicKey().blob}`,
        "-c",
        "gpg.ssh.allowedSignersFile=" + allowed,
        "-c",
        "protocol.allow=never",
        "-c",
        https ? "protocol.https.allow=always" : "protocol.file.allow=always",
        "-c",
        "credential.helper=",
        ...(https ? ["-c", "credential.helper=!gh auth git-credential"] : []),
        ...args,
      ],
      { env: env(), input, timeoutMs },
    );
    if (r.status !== 0) throw Error("Publication Git step failed");
    return r.stdout.trim();
  };
  const markerRef = (kind: "sign" | "push", effect: string) => {
    if (!/^[A-Za-z0-9-]{1,80}$/.test(effect))
      throw Error("Invalid publication effect");
    return `refs/aios/${kind}/${effect}`;
  };
  const read = (ref: string) => {
    const r = run(
      "git",
      ["--git-dir", options.metadata, "rev-parse", "--verify", "--quiet", ref],
      { env: env(), timeoutMs: 10000 },
    );
    return r.status === 0 ? r.stdout.trim() : null;
  };
  /** Writes the admitted files as blobs and trees; returns the root tree. */
  const writeTree = (files: PublicationRequest["files"]) => {
    interface Node {
      files: Map<string, { sha: string; executable: boolean }>;
      dirs: Map<string, Node>;
    }
    const node = (): Node => ({ files: new Map(), dirs: new Map() });
    const root = node();
    for (const f of files) {
      const parts = f.path.split("/");
      let at = root;
      for (const part of parts.slice(0, -1)) {
        if (!at.dirs.has(part)) at.dirs.set(part, node());
        at = at.dirs.get(part)!;
      }
      at.files.set(parts.at(-1)!, {
        sha: git(["hash-object", "-w", "--no-filters", "--stdin"], f.bytes),
        executable: f.executable,
      });
    }
    const write = (n: Node): string =>
      git(
        ["mktree"],
        [...n.files]
          .map(
            ([name, f]) =>
              `${f.executable ? "100755" : "100644"} blob ${f.sha}\t${name}\n`,
          )
          .concat(
            [...n.dirs].map(
              ([name, d]) => `040000 tree ${write(d)}\t${name}\n`,
            ),
          )
          .join(""),
      );
    return write(root);
  };
  const keySha256 = () =>
    createHash("sha256")
      .update(Buffer.from(publicKey().blob, "base64"))
      .digest("hex");
  const show = (commit: string, format: string) =>
    git(["show", "-s", "--no-show-signature", "--format=" + format, commit]);

  return {
    async inspect() {
      prepare();
      const user = await github("user");
      const repo = await github(`repos/${options.repository}`);
      const agent = run("ssh-add", ["-L"], {
        env: cleanEnvironment(),
        timeoutMs: 10000,
      });
      const key = publicKey();
      const held =
        agent.status === 0 &&
        agent.stdout
          .split("\n")
          .some((line) => line.split(/\s+/)[1] === key.blob);
      const body = repo.body as {
        full_name?: string;
        permissions?: { push?: boolean };
      } | null;
      return {
        repository: options.repository,
        login:
          user.status === 200 &&
          typeof (user.body as { login?: unknown })?.login === "string"
            ? (user.body as { login: string }).login
            : "",
        signingKeySha256: keySha256(),
        signingAvailable: held,
        publicationAllowed:
          repo.status === 200 &&
          body?.full_name === options.repository &&
          body.permissions?.push === true,
      };
    },
    async sign(r) {
      if (
        !r.mayDispatch() ||
        r.controls.hooks ||
        r.controls.filters ||
        r.controls.includes ||
        r.controls.candidateConfiguration ||
        r.controls.signWithAppPem
      )
        throw Error("Fenced or uncontrolled signing");
      prepare();
      const parent =
        r.publication.previous?.commit ?? r.publication.sourceRevision;
      if (!sha40.test(parent)) throw Error("Invalid publication parent");
      // The parent comes from the onboarded repository itself.
      git(
        [
          "fetch",
          "--quiet",
          "--no-tags",
          "--no-write-fetch-head",
          remote,
          `+refs/heads/${r.publication.previous ? r.publication.branch : r.publication.defaultBranch}:refs/aios/base`,
        ],
        undefined,
        120000,
      );
      git(["cat-file", "-e", parent + "^{commit}"]);
      const tree = writeTree(r.files);
      if (tree !== r.publication.treeSha1 || tree !== publicationTree(r.files))
        throw Error("Signed tree differs from the admitted tree");
      const commit = git(
        [
          "commit-tree",
          tree,
          "-p",
          parent,
          "-S",
          "-m",
          `AIOS delivery candidate\n\nPublication: ${r.publication.id}\nOperation: ${r.effect.id}`,
        ],
        undefined,
        60000,
      );
      if (!sha40.test(commit)) throw Error("Signing produced no commit");
      git(["update-ref", markerRef("sign", r.effect.id), commit]);
      return { commit };
    },
    async verifyLocal(r) {
      prepare();
      if (!sha40.test(r.commit)) throw Error("Invalid commit");
      const raw = run(
        "git",
        [
          "--git-dir",
          options.metadata,
          "-c",
          "gpg.format=ssh",
          "-c",
          "gpg.ssh.allowedSignersFile=" + allowed,
          "verify-commit",
          "--raw",
          r.commit,
        ],
        { env: env(), timeoutMs: 30000 },
      );
      const fingerprint =
        "SHA256:" +
        Buffer.from(keySha256(), "hex").toString("base64").replace(/=+$/, "");
      const good =
        raw.status === 0 &&
        raw.stderr.includes(`Good "git" signature for ${options.email}`) &&
        raw.stderr.includes(fingerprint);
      return {
        commit: r.commit,
        tree: show(r.commit, "%T"),
        parent: show(r.commit, "%P"),
        signer: good ? options.login : "",
        localVerified: good,
      };
    },
    async push(r) {
      if (!r.mayDispatch() || r.controls.forcePush)
        throw Error("Fenced or forced push");
      prepare();
      const commit = r.publication.commit;
      if (
        !commit ||
        !sha40.test(commit) ||
        (r.expectedRemoteHead !== null && !sha40.test(r.expectedRemoteHead))
      )
        throw Error("Invalid push");
      // Recorded before dispatch, so an unanswered push is never absent.
      writeFileSync(
        join(options.metadata, "push-" + r.effect.id),
        String(clock()),
        { mode: 0o600 },
      );
      git(
        [
          "push",
          "--quiet",
          "--porcelain",
          "--no-verify",
          // Conditional: absent for a new branch, the exact previous head
          // for an update. Never a plain force.
          `--force-with-lease=refs/heads/${r.publication.branch}:${r.expectedRemoteHead ?? ""}`,
          remote,
          `${commit}:refs/heads/${r.publication.branch}`,
        ],
        undefined,
        120000,
      );
    },
    async findSigned(r) {
      prepare();
      const commit = read(markerRef("sign", r.effect.id));
      return commit
        ? { state: "found", result: { commit } }
        : // Signing is local: once its process is gone, nothing can land.
          { state: "absent", quiescent: true };
    },
    async observeRemote(r) {
      const branch = await github(
        `repos/${options.repository}/branches/${encodeURIComponent(r.publication.branch)}`,
      );
      if (branch.status === 404) {
        let dispatched = NaN;
        try {
          dispatched = Number(
            readFileSync(join(options.metadata, "push-" + r.effect.id), "utf8"),
          );
        } catch {}
        // Absent is settled once no push of this effect can still land.
        return {
          state: "absent",
          quiescent:
            Number.isNaN(dispatched) || clock() - dispatched > pushSettleMs,
        };
      }
      const head = (branch.body as { commit?: { sha?: unknown } } | null)
        ?.commit?.sha;
      if (
        branch.status !== 200 ||
        typeof head !== "string" ||
        !sha40.test(head)
      )
        return { state: "unknown" };
      const commit = await github(
        `repos/${options.repository}/commits/${head}`,
      );
      const c = commit.body as {
        sha?: string;
        commit?: {
          tree?: { sha?: string };
          verification?: { verified?: boolean; reason?: string };
        };
        committer?: { login?: string } | null;
      } | null;
      if (commit.status !== 200 || c?.sha !== head) return { state: "unknown" };
      // Who pushed the branch head, from GitHub's own activity record.
      const activity = await github(
        `repos/${options.repository}/activity?ref=${encodeURIComponent("refs/heads/" + r.publication.branch)}&per_page=20`,
      );
      const pusher = Array.isArray(activity.body)
        ? (
            activity.body as { after?: string; actor?: { login?: string } }[]
          ).find((a) => a.after === head)?.actor?.login
        : undefined;
      if (activity.status !== 200 || typeof pusher !== "string")
        return { state: "unknown" };
      const verified =
        c.commit?.verification?.verified === true &&
        c.commit.verification.reason === "valid";
      return {
        state: "found",
        result: {
          commit: head,
          tree: c.commit?.tree?.sha ?? "",
          repository: options.repository,
          branch: r.publication.branch,
          githubVerified: verified,
          signer: verified ? (c.committer?.login ?? "") : "",
          publisher: pusher,
        },
      };
    },
  };
}
