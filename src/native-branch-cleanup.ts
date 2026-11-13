import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import {
  branchCleanupControls,
  cleanupDecision,
  type BranchCleanupRuntime,
  type BranchFact,
  type BranchInventory,
} from "./branch-cleanup.js";
import { isolatedGit } from "./native-git.js";
import {
  ghApi,
  type CommandRunner,
  type GitHubApi,
} from "./native-publication.js";

const sha40 = /^[a-f0-9]{40}$/;
const slug = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
/** A name Git accepts for a branch (its check-ref-format rules); the
 * controller's own stricter check still applies to every inventory. */
const branchName =
  /^(?!-)(?!.*(?:\.\.|@\{|\/\/|\/\.|\.lock(?:\/|$)))[^\s\x00-\x1f\x7f~^:?*[\\]{1,240}(?<![./])$/;
/** The Software Factory's published event branches, kept for durable replay
 * evidence (its local remediation guide); deleting one needs manual recovery. */
const factoryReplay = /^feat\/factory-remediation-[0-9a-f]{32}$/;
const maxPages = 50;

export interface NativeBranchCleanupOptions {
  /** The onboarded repository, `owner/name`. */
  repository: string;
  /** The owner policy whose digest every inventory reports. */
  policyPath: string;
  /** Where branches are fetched from and deleted; GitHub over HTTPS by default. */
  remoteUrl?: string;
  github?: GitHubApi;
  run?: CommandRunner;
}

interface RemoteBranch {
  name: string;
  sha: string;
  protected: boolean;
}

/** The owner's native branch cleanup (ticket 14, #273), in the delivery's
 * own checkout. An inventory fetches every remote branch through the owner's
 * `gh` login into the origin tracking refs, then lists the remote branches
 * through GitHub and requires each tip to match the fetch, so a race reads as
 * incomplete. Each local and remote branch carries:
 * - protection: GitHub's classic protection or an active ruleset deletion
 *   rule for that name (a local branch shares its remote name's);
 * - replay retention for the Software Factory's event branches;
 * - whether any worktree has it checked out;
 * - ancestry into the exact main tip, and, for a branch not in main's
 *   history, its merged PR history into main (squash and rebase merges):
 *   the latest merged PR for the branch, its head, and whether its merge
 *   commit is in main's history.
 *
 * A removal re-checks only that branch, against the same main and policy,
 * requires the same tip, re-applies the cleanup decision, and only then
 * deletes, conditioned on
 * the evaluated tip: `update-ref -d` with the old value locally, and a push
 * with a lease on that tip remotely, under GitHub's own branch rules. Every
 * Git step is isolated as in the main sync. */
export function nativeBranchCleanupRuntime(
  options: NativeBranchCleanupOptions,
): BranchCleanupRuntime {
  if (!slug.test(options.repository)) throw Error("Invalid branch cleanup");
  let isolated;
  try {
    isolated = isolatedGit(options.repository, options.remoteUrl, options.run);
  } catch {
    throw Error("Invalid branch cleanup remote");
  }
  const { remote, git, reviewed, originMatches } = isolated;
  const github = options.github ?? ghApi();
  const repo = `repos/${options.repository}`;
  const owner = options.repository.split("/")[0];
  let inFlight = 0;

  const policyDigest = () => {
    try {
      const st = lstatSync(options.policyPath);
      if (!st.isFile() || st.size > 65536) return "";
      return createHash("sha256")
        .update(readFileSync(options.policyPath))
        .digest("hex");
    } catch {
      return "";
    }
  };
  async function remoteBranches(): Promise<RemoteBranch[] | undefined> {
    const all: RemoteBranch[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const r = await github(`${repo}/branches?per_page=100&page=${page}`);
      if (r.status !== 200 || !Array.isArray(r.body)) return undefined;
      for (const b of r.body as {
        name?: unknown;
        commit?: { sha?: unknown };
        protected?: unknown;
      }[]) {
        if (
          typeof b?.name !== "string" ||
          typeof b.commit?.sha !== "string" ||
          !sha40.test(b.commit.sha) ||
          typeof b.protected !== "boolean"
        )
          return undefined;
        all.push({ name: b.name, sha: b.commit.sha, protected: b.protected });
      }
      if (r.body.length < 100) return all;
    }
    return undefined;
  }
  /** An active ruleset rule forbids deleting this branch. */
  async function deletionRule(name: string): Promise<boolean | undefined> {
    const r = await github(
      `${repo}/rules/branches/${encodeURIComponent(name)}`,
    );
    if (r.status !== 200 || !Array.isArray(r.body)) return undefined;
    return (r.body as { type?: unknown }[]).some((x) => x?.type === "deletion");
  }
  async function linkage(
    name: string,
    tip: string,
    base: string,
    revision: string,
  ): Promise<BranchFact["linkage"]> {
    const unknown = {
      repository: options.repository,
      base,
      head: "",
      mergeCommit: "",
      merged: false,
      reachable: false,
      complete: false,
    };
    const r = await github(
      `${repo}/pulls?state=closed&base=${encodeURIComponent(base)}&head=${encodeURIComponent(`${owner}:${name}`)}&per_page=100`,
    );
    // A full page may hide more history.
    if (r.status !== 200 || !Array.isArray(r.body) || r.body.length >= 100)
      return unknown;
    const merged = (
      r.body as {
        merged_at?: unknown;
        merge_commit_sha?: unknown;
        head?: { sha?: unknown; ref?: unknown };
        base?: { ref?: unknown; repo?: { full_name?: unknown } };
      }[]
    ).filter((p) => typeof p?.merged_at === "string");
    if (!merged.length) return undefined;
    for (const p of merged)
      if (
        p.head?.ref !== name ||
        p.base?.ref !== base ||
        p.base?.repo?.full_name !== options.repository ||
        typeof p.head?.sha !== "string" ||
        !sha40.test(p.head.sha) ||
        typeof p.merge_commit_sha !== "string" ||
        !sha40.test(p.merge_commit_sha)
      )
        return unknown;
    // The PR for exactly this tip, or else the latest: a newer tip.
    const pick =
      merged.find((p) => p.head!.sha === tip) ??
      [...merged].sort((a, b) =>
        String(b.merged_at).localeCompare(String(a.merged_at)),
      )[0]!;
    const mergeCommit = pick.merge_commit_sha as string;
    const compare = await github(
      `${repo}/compare/${mergeCommit}...${revision}`,
    );
    const status = (compare.body as { status?: unknown } | null)?.status;
    if (compare.status !== 200 || typeof status !== "string") return unknown;
    return {
      repository: options.repository,
      base,
      head: pick.head!.sha as string,
      mergeCommit,
      merged: true,
      reachable: status === "identical" || status === "ahead",
      complete: true,
    };
  }

  /** One branch's facts against main's tip `revision`. */
  async function factOf(
    checkout: string,
    f: { name: string; tip: string; location: BranchFact["location"] },
    base: string,
    revision: string,
    isProtected: boolean,
    checkedOut: Set<string>,
  ): Promise<BranchFact> {
    const a = git(checkout, ["merge-base", "--is-ancestor", f.tip, revision]);
    const ancestry =
      a.status === 0 ? "merged" : a.status === 1 ? "unmerged" : "unknown";
    const fact: BranchFact = {
      name: f.name,
      location: f.location,
      tip: f.tip,
      protected: isProtected,
      replayRetained: factoryReplay.test(f.name),
      activeWorktree: f.location === "local" && checkedOut.has(f.name),
      ancestry,
      conditionalDelete: true,
    };
    if (ancestry === "unmerged" && f.name !== base) {
      const l = await linkage(f.name, f.tip, base, revision);
      if (l) fact.linkage = l;
    }
    return fact;
  }
  const worktreeBranches = (out: string) =>
    new Set(
      [...out.matchAll(/^branch refs\/heads\/(.+)$/gm)].map((m) => m[1]!),
    );
  const sharedLocks = ["index.lock", "HEAD.lock", "packed-refs.lock"];

  async function observe(
    target: Parameters<BranchCleanupRuntime["observe"]>[0],
  ): Promise<BranchInventory> {
    const blank: BranchInventory = {
      repository: options.repository,
      checkout: target.checkout,
      branch: target.branch,
      revision: "",
      policySha256: "",
      complete: false,
      quiescent: false,
      branches: [],
    };
    if (
      target.repository !== options.repository ||
      !branchName.test(target.branch)
    )
      return blank;
    let checkout: string;
    try {
      checkout = realpathSync.native(target.checkout);
    } catch {
      return blank;
    }
    if (!reviewed(checkout) || !originMatches(checkout))
      return { ...blank, checkout };
    const policySha256 = policyDigest();
    const fetched = git(
      checkout,
      [
        "fetch",
        "--quiet",
        "--no-tags",
        "--no-recurse-submodules",
        remote,
        "+refs/heads/*:refs/remotes/origin/*",
      ],
      300000,
    );
    const listed = await remoteBranches();
    const refs = (prefix: string) => {
      const r = git(checkout, [
        "for-each-ref",
        "--format=%(refname) %(objectname)",
        prefix,
      ]);
      if (!r.ok) return undefined;
      const m = new Map<string, string>();
      for (const line of r.out.split("\n").filter(Boolean)) {
        const [ref, sha] = line.split(" ");
        m.set(ref!.slice(prefix.length), sha!);
      }
      return m;
    };
    const tracking = refs("refs/remotes/origin/"),
      local = refs("refs/heads/"),
      worktrees = git(checkout, ["worktree", "list", "--porcelain"]),
      gitDir = git(checkout, ["rev-parse", "--absolute-git-dir"]).out;
    const revision = listed?.find((b) => b.name === target.branch)?.sha;
    if (
      !fetched.ok ||
      !listed ||
      !tracking ||
      !local ||
      !worktrees.ok ||
      !gitDir ||
      !policySha256 ||
      !revision ||
      // Every remote tip as fetched: otherwise the branches moved meanwhile.
      listed.some((b) => tracking.get(b.name) !== b.sha)
    )
      return { ...blank, checkout };
    const checkedOut = worktreeBranches(worktrees.out);
    const protectedNames = new Map<string, boolean>();
    for (const b of listed) if (b.protected) protectedNames.set(b.name, true);
    const names = new Set([...listed.map((b) => b.name), ...local.keys()]);
    for (const name of names) {
      if (protectedNames.get(name)) continue;
      const rule = await deletionRule(name);
      if (rule === undefined) return { ...blank, checkout };
      protectedNames.set(name, rule);
    }
    const branches: BranchFact[] = [];
    const facts = [
      ...[...local].map(([name, tip]) => ({
        name,
        tip,
        location: "local" as const,
      })),
      ...listed.map((b) => ({
        name: b.name,
        tip: b.sha,
        location: "remote" as const,
      })),
    ];
    for (const f of facts)
      branches.push(
        await factOf(
          checkout,
          f,
          target.branch,
          revision,
          protectedNames.get(f.name) === true,
          checkedOut,
        ),
      );
    const locks = [
      ...sharedLocks,
      ...[...local.keys()].map((n) => `refs/heads/${n}.lock`),
      ...listed.map((b) => `refs/remotes/origin/${b.name}.lock`),
    ];
    return {
      repository: options.repository,
      checkout,
      branch: target.branch,
      revision,
      policySha256,
      complete: true,
      // No deletion of this adapter and no Git write in this checkout is
      // under way: its locks are free.
      quiescent:
        inFlight === 0 && !locks.some((l) => existsSync(join(gitDir, l))),
      branches,
    };
  }

  /** Only the branch being deleted, against the evaluated main and policy:
   * main's tip on GitHub, the branch's tip (on GitHub and as fetched, for a
   * remote branch), its protection, worktrees, ancestry, PR history and
   * locks. Undefined when anything is unavailable or busy. */
  async function recheck(
    request: Parameters<BranchCleanupRuntime["remove"]>[0],
  ): Promise<{ checkout: string; fact: BranchFact } | undefined> {
    if (request.repository !== options.repository) return undefined;
    let checkout: string;
    try {
      checkout = realpathSync.native(request.checkout);
    } catch {
      return undefined;
    }
    if (
      !reviewed(checkout) ||
      !originMatches(checkout) ||
      policyDigest() !== request.policySha256
    )
      return undefined;
    const main = await github(
      `${repo}/git/ref/heads/${encodeURIComponent(request.branch)}`,
    );
    if (
      main.status !== 200 ||
      (main.body as { object?: { sha?: unknown } } | null)?.object?.sha !==
        request.revision
    )
      return undefined;
    // GitHub's own view of this branch name: its tip and classic protection.
    const named = await github(
      `${repo}/branches/${encodeURIComponent(request.name)}`,
    );
    const listed = named.body as {
      commit?: { sha?: unknown };
      protected?: unknown;
    } | null;
    if (named.status !== 200 && named.status !== 404) return undefined;
    let tip: string;
    const tracking = `refs/remotes/origin/${request.name}`;
    if (request.location === "remote") {
      if (
        named.status !== 200 ||
        typeof listed?.commit?.sha !== "string" ||
        !sha40.test(listed.commit.sha)
      )
        return undefined;
      const fetched = git(
        checkout,
        [
          "fetch",
          "--quiet",
          "--no-tags",
          "--no-recurse-submodules",
          remote,
          `+refs/heads/${request.name}:${tracking}`,
        ],
        120000,
      );
      tip = git(checkout, ["rev-parse", "--verify", tracking]).out;
      // The branch moved between GitHub's answer and the fetch.
      if (!fetched.ok || tip !== listed.commit.sha) return undefined;
    } else {
      const r = git(checkout, [
        "rev-parse",
        "--verify",
        `refs/heads/${request.name}`,
      ]);
      if (!r.ok || !sha40.test(r.out)) return undefined;
      tip = r.out;
    }
    const rule = await deletionRule(request.name);
    const worktrees = git(checkout, ["worktree", "list", "--porcelain"]),
      gitDir = git(checkout, ["rev-parse", "--absolute-git-dir"]).out;
    if (rule === undefined || !worktrees.ok || !gitDir) return undefined;
    const locks = [
      ...sharedLocks,
      `refs/heads/${request.name}.lock`,
      `${tracking}.lock`,
    ];
    if (inFlight > 0 || locks.some((l) => existsSync(join(gitDir, l))))
      return undefined;
    return {
      checkout,
      fact: await factOf(
        checkout,
        { name: request.name, tip, location: request.location },
        request.branch,
        request.revision,
        rule || (named.status === 200 && listed?.protected === true),
        worktreeBranches(worktrees.out),
      ),
    };
  }

  return {
    mode: "controlled",
    bindingSha256: createHash("sha256")
      .update(
        JSON.stringify({
          scope: "aios-native-branch-cleanup-v1",
          repository: options.repository,
          method: "conditional-tip-deletion",
        }),
      )
      .digest("hex"),
    observe,
    async remove(request) {
      if (
        !request.mayDispatch() ||
        JSON.stringify(request.controls) !==
          JSON.stringify(branchCleanupControls) ||
        !sha40.test(request.expectedTip) ||
        !branchName.test(request.name) ||
        request.name === request.branch ||
        !["local", "remote"].includes(request.location)
      )
        throw Error("Fenced or invalid branch deletion");
      // Main, the policy, the tip and its eligibility, all as evaluated.
      const now = await recheck(request);
      if (
        !now ||
        now.fact.tip !== request.expectedTip ||
        cleanupDecision(now.fact, request).decision !== "eligible"
      )
        throw Error("The branch changed or is not eligible");
      if (!request.mayDispatch()) throw Error("Dispatch fenced");
      inFlight++;
      try {
        const r =
          request.location === "local"
            ? git(now.checkout, [
                "update-ref",
                "-d",
                `refs/heads/${request.name}`,
                request.expectedTip,
              ])
            : git(
                now.checkout,
                [
                  "push",
                  "--quiet",
                  "--no-verify",
                  `--force-with-lease=refs/heads/${request.name}:${request.expectedTip}`,
                  remote,
                  `:refs/heads/${request.name}`,
                ],
                120000,
              );
        if (!r.ok) throw Error("The deletion was refused");
        if (request.location === "remote")
          // The stale tracking ref, only while it still names that tip.
          git(now.checkout, [
            "update-ref",
            "-d",
            `refs/remotes/origin/${request.name}`,
            request.expectedTip,
          ]);
      } finally {
        inFlight--;
      }
    },
  };
}

/** The native branch cleanup for the owner policy at `policyPath`: its
 * repository. Undefined when the policy names none, so cleanup then refuses. */
export function ownerPolicyBranchCleanupRuntime(
  policyPath: string,
): BranchCleanupRuntime | undefined {
  let policy: { repository?: unknown };
  try {
    const st = lstatSync(policyPath);
    if (!st.isFile() || st.size > 65536) return undefined;
    policy = JSON.parse(readFileSync(policyPath, "utf8"));
  } catch {
    return undefined;
  }
  if (typeof policy?.repository !== "string") return undefined;
  try {
    return nativeBranchCleanupRuntime({
      repository: policy.repository,
      policyPath,
    });
  } catch {
    return undefined;
  }
}
