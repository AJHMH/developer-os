import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type {
  MergeAttempt,
  MergeObservation,
  MergeReceipt,
  MergeRuntime,
} from "./conditional-merge.js";
import {
  cleanEnvironment,
  defaultRunner,
  ghApi,
  type CommandRunner,
  type GitHubApi,
} from "./native-publication.js";

/** How long a dispatched merge push may still land. */
export const mergeSettleMs = 120000;
/** How long a merge waits for GitHub to mark the PR merged after its push. */
export const mergeLinkMs = 30000;
const sha40 = /^[a-f0-9]{40}$/;
const login = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const slug = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export interface NativeMergeOptions {
  /** The onboarded repository, `owner/name`. */
  repository: string;
  /** The owner's GitHub login: the configured merge identity, the same one
   * that pushes the feature branch. */
  login: string;
  /** The owner policy; observations report its current digest. */
  policyPath: string;
  /** The PR checks GitHub must enforce on the default branch. */
  requiredChecks: string[];
  /** A private folder this port owns: bare Git metadata and merge markers. */
  metadata: string;
  /** Where the repository is fetched and pushed; GitHub over HTTPS by default. */
  remoteUrl?: string;
  github?: GitHubApi;
  run?: CommandRunner;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** The owner's native merge (ticket 11, #270). It merges by fast-forward: the
 * owner's `gh` login pushes the PR's exact validated head to the default
 * branch with a lease on main's expected revision, so one atomic push is
 * conditional on both the head and the base, and main becomes exactly the
 * owner-signed, checked commit. GitHub's own rules (signed commits, no force
 * push or deletion, the required checks) apply to that push. A head that no
 * longer descends from that revision is refused before dispatch; refresh
 * takes over. Its intent is recorded before the push, and a merge is
 * confirmed only by observing main containing the head and GitHub reporting
 * the PR merged. It never uses the merge API, so it never writes a commit of
 * its own. */
export function nativeMergeRuntime(options: NativeMergeOptions): MergeRuntime {
  if (
    !slug.test(options.repository) ||
    !login.test(options.login) ||
    !options.requiredChecks.length
  )
    throw Error("Invalid merge identity");
  const run = options.run ?? defaultRunner,
    github = options.github ?? ghApi(run),
    clock = options.clock ?? Date.now,
    sleep =
      options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const remote =
    options.remoteUrl ?? `https://github.com/${options.repository}.git`;
  const https = remote.startsWith("https://");
  if (!https && !remote.startsWith("file://"))
    throw Error("Invalid merge remote");
  const repo = `repos/${options.repository}`;
  const empty = join(options.metadata, "empty");
  const marker = (operationId: string) => {
    if (!/^[A-Za-z0-9-]{1,80}$/.test(operationId))
      throw Error("Invalid merge operation");
    return join(options.metadata, "merge-" + operationId + ".json");
  };
  const env = (): NodeJS.ProcessEnv => ({
    ...cleanEnvironment(),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GH_PROMPT_DISABLED: "1",
  });
  const prepare = () => {
    mkdirSync(empty, { recursive: true, mode: 0o700 });
    if (!existsSync(join(options.metadata, "HEAD"))) {
      const r = run(
        "git",
        ["init", "--bare", "--quiet", "--template=" + empty, options.metadata],
        { env: env(), timeoutMs: 10000 },
      );
      if (r.status !== 0) throw Error("Merge metadata unavailable");
    }
  };
  const git = (args: string[], timeoutMs = 60000) => {
    const r = run(
      "git",
      [
        "--git-dir",
        options.metadata,
        "-c",
        "core.hooksPath=" + empty,
        "-c",
        "core.fsmonitor=false",
        "-c",
        "protocol.allow=never",
        "-c",
        https ? "protocol.https.allow=always" : "protocol.file.allow=always",
        "-c",
        "credential.helper=",
        ...(https ? ["-c", "credential.helper=!gh auth git-credential"] : []),
        ...args,
      ],
      { env: env(), timeoutMs },
    );
    return { ok: r.status === 0, out: r.stdout.trim() };
  };
  const policyDigest = () => {
    try {
      return createHash("sha256")
        .update(readFileSync(options.policyPath))
        .digest("hex");
    } catch {
      return "";
    }
  };
  async function pull(number: number) {
    const r = await github(`${repo}/pulls/${number}`);
    const p = r.body as {
      state?: unknown;
      merged?: unknown;
      head?: { sha?: unknown; repo?: { full_name?: unknown } };
      base?: { ref?: unknown; repo?: { full_name?: unknown } };
    } | null;
    if (
      r.status !== 200 ||
      typeof p?.head?.sha !== "string" ||
      typeof p.base?.ref !== "string"
    )
      return undefined;
    return {
      head: p.head.sha,
      base: p.base.ref,
      state: (p.state === "open" ? "open" : "closed") as "open" | "closed",
      merged: p.merged === true,
      sameRepository:
        p.head.repo?.full_name === options.repository &&
        p.base.repo?.full_name === options.repository,
    };
  }
  /** The default branch's tip, or undefined. */
  async function tip(base: string) {
    const r = await github(`${repo}/git/ref/heads/${encodeURIComponent(base)}`);
    const sha = (r.body as { object?: { sha?: unknown } } | null)?.object?.sha;
    return r.status === 200 && typeof sha === "string" && sha40.test(sha)
      ? sha
      : undefined;
  }
  /** Whether `head` is in `main`'s history, or undefined when unreadable. */
  async function reachable(head: string, main: string) {
    if (head === main) return true;
    const r = await github(`${repo}/compare/${head}...${main}?per_page=1`);
    const status = (r.body as { status?: unknown } | null)?.status;
    if (r.status !== 200 || typeof status !== "string") return undefined;
    return status === "ahead" || status === "identical";
  }
  /** The merge as GitHub has it now. */
  async function receipt(a: MergeAttempt): Promise<MergeReceipt> {
    const [p, main] = [await pull(a.number), await tip(a.base)];
    if (!p || !main) return { state: "unknown" };
    const inMain = await reachable(a.head, main);
    if (inMain === undefined) return { state: "unknown" };
    if (inMain)
      // Fast-forward: the head itself is the merge commit.
      return p.merged
        ? {
            operationId: a.operationId,
            state: "merged",
            head: a.head,
            baseRevision: a.baseRevision,
            mergeCommit: a.head,
            mainRevision: main,
            reachable: true,
          }
        : { state: "unknown" };
    let at = NaN;
    try {
      at = (
        JSON.parse(readFileSync(marker(a.operationId), "utf8")) as {
          at?: number;
        }
      ).at!;
    } catch {}
    // Absent is settled once no push of this operation can still land.
    return {
      operationId: a.operationId,
      state: "absent",
      quiescent: !Number.isFinite(at) || clock() - at > mergeSettleMs,
    };
  }
  return {
    mode: "controlled",
    bindingSha256: createHash("sha256")
      .update(
        JSON.stringify({
          scope: "aios-native-merge-v1",
          repository: options.repository,
          login: options.login,
          method: "fast-forward",
          requiredChecks: [...options.requiredChecks].sort(),
        }),
      )
      .digest("hex"),
    async observe(request) {
      const blank: MergeObservation = {
        repository: options.repository,
        number: request.number,
        head: "",
        base: "",
        baseRevision: "",
        policySha256: "",
        complete: false,
        state: "closed",
        actor: "",
        mergeAllowed: false,
        protectionsEnforced: false,
        conditionalHead: false,
        conditionalBase: false,
        gatesEnforced: false,
      };
      if (request.repository !== options.repository) return blank;
      const p = await pull(request.number);
      if (!p || !p.sameRepository) return blank;
      const user = await github("user");
      const me = (user.body as { login?: unknown } | null)?.login;
      const permission = await github(
        `${repo}/collaborators/${options.login}/permission`,
      );
      const perm = permission.body as {
        permission?: unknown;
        role_name?: unknown;
      } | null;
      const main = await tip(p.base);
      const rules = await github(
        `${repo}/rules/branches/${encodeURIComponent(p.base)}`,
      );
      if (
        user.status !== 200 ||
        typeof me !== "string" ||
        permission.status !== 200 ||
        !main ||
        rules.status !== 200 ||
        !Array.isArray(rules.body)
      )
        return { ...blank, head: p.head, base: p.base, state: p.state };
      const list = rules.body as {
        type?: unknown;
        parameters?: {
          required_status_checks?: { context?: unknown }[];
        };
      }[];
      const has = (type: string) => list.some((r) => r.type === type);
      const required = list
        .filter((r) => r.type === "required_status_checks")
        .flatMap((r) => r.parameters?.required_status_checks ?? [])
        .map((c) => c.context);
      return {
        repository: options.repository,
        number: request.number,
        head: p.head,
        base: p.base,
        baseRevision: main,
        policySha256: policyDigest(),
        complete: true,
        state: p.state,
        actor: me,
        mergeAllowed:
          me === options.login &&
          !p.merged &&
          (["admin", "maintain", "write"].includes(perm?.role_name as string) ||
            ["admin", "write"].includes(perm?.permission as string)),
        // GitHub refuses a push to main that is unsigned, forced or deletes it.
        protectionsEnforced:
          has("required_signatures") &&
          has("non_fast_forward") &&
          has("deletion"),
        // The push names the exact head, with a lease on main's revision.
        conditionalHead: true,
        conditionalBase: true,
        // GitHub refuses the push unless the head passed the required checks.
        gatesEnforced: options.requiredChecks.every((c) =>
          required.includes(c),
        ),
      };
    },
    async merge(request) {
      if (
        !request.mayDispatch() ||
        request.repository !== options.repository ||
        !sha40.test(request.head) ||
        !sha40.test(request.baseRevision) ||
        !/^[A-Za-z0-9._/-]{1,100}$/.test(request.base) ||
        !Number.isSafeInteger(request.number)
      )
        throw Error("Fenced or invalid merge");
      prepare();
      const file = marker(request.operationId);
      // Recorded before dispatch, so an unanswered merge is never absent.
      writeFileSync(
        file,
        JSON.stringify({
          head: request.head,
          baseRevision: request.baseRevision,
          at: clock(),
        }),
        { mode: 0o600 },
      );
      const ref = `refs/aios/merge/${request.operationId}`;
      const fetched = git([
        "fetch",
        "--quiet",
        "--no-tags",
        remote,
        `+refs/pull/${request.number}/head:${ref}/head`,
        `+refs/heads/${request.base}:${ref}/base`,
      ]);
      const head = git(["rev-parse", "--verify", `${ref}/head`]).out,
        base = git(["rev-parse", "--verify", `${ref}/base`]).out;
      // Only the exact head, onto exactly the expected main, as a
      // fast-forward.
      if (
        !fetched.ok ||
        head !== request.head ||
        base !== request.baseRevision ||
        !git([
          "merge-base",
          "--is-ancestor",
          request.baseRevision,
          request.head,
        ]).ok
      )
        throw Error("The head is not a fast-forward of the expected main");
      if (!request.mayDispatch()) throw Error("Dispatch fenced");
      git(
        [
          "push",
          "--quiet",
          "--porcelain",
          "--no-verify",
          `--force-with-lease=refs/heads/${request.base}:${request.baseRevision}`,
          remote,
          `${request.head}:refs/heads/${request.base}`,
        ],
        120000,
      );
      // GitHub links the PR to the push shortly after it lands.
      const start = clock();
      for (;;) {
        const r = await receipt(request);
        if (r.state !== "unknown" || clock() - start > mergeLinkMs) return r;
        await sleep(2000);
      }
    },
    async reconcile(request) {
      if (request.repository !== options.repository)
        return { state: "unknown" };
      return receipt(request);
    },
  };
}

/** The native merge for the owner policy at `policyPath`: its repository, its
 * publication login as the merge identity and its required PR checks.
 * Undefined when the policy names them not, so merge then refuses. Its Git
 * metadata lives in a private folder under `stateDirectory`, one per
 * repository. */
export function ownerPolicyMergeRuntime(
  policyPath: string,
  stateDirectory: string,
  github?: GitHubApi,
): MergeRuntime | undefined {
  let policy: {
    repository?: unknown;
    publicationLogin?: unknown;
    requiredChecks?: unknown;
  };
  try {
    const st = lstatSync(policyPath);
    if (!st.isFile() || st.size > 65536) return undefined;
    policy = JSON.parse(readFileSync(policyPath, "utf8"));
  } catch {
    return undefined;
  }
  if (
    typeof policy?.repository !== "string" ||
    typeof policy.publicationLogin !== "string" ||
    !Array.isArray(policy.requiredChecks) ||
    !policy.requiredChecks.every((c) => typeof c === "string")
  )
    return undefined;
  const folder = join(
    stateDirectory,
    "merge",
    createHash("sha256").update(policy.repository).digest("hex").slice(0, 32),
  );
  try {
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    return nativeMergeRuntime({
      repository: policy.repository,
      login: policy.publicationLogin,
      policyPath,
      requiredChecks: policy.requiredChecks as string[],
      metadata: folder,
      ...(github ? { github } : {}),
    });
  } catch {
    return undefined;
  }
}
