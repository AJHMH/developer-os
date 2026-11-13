import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mainSyncControls,
  type MainSyncObservation,
  type MainSyncRuntime,
} from "./main-sync.js";
import {
  cleanEnvironment,
  defaultRunner,
  type CommandRunner,
} from "./native-publication.js";

const sha40 = /^[a-f0-9]{40}$/;
const slug = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const branchName = /^[A-Za-z0-9._/-]{1,100}$/;

export interface NativeMainSyncOptions {
  /** The onboarded repository, `owner/name`. */
  repository: string;
  /** Where main is fetched from; GitHub over HTTPS by default. */
  remoteUrl?: string;
  run?: CommandRunner;
}

/** The owner's native main synchronization (ticket 13, #272). In the
 * delivery's own checkout it fetches the default branch through the owner's
 * `gh` login, from the repository's own URL, into the origin tracking ref,
 * then fast-forwards local main to exactly the verified revision. Every Git
 * step runs with no system or global configuration, no hooks and no
 * fsmonitor; a checkout whose own configuration names filters or includes is
 * refused. It never switches branch, stashes, resets, rebases or forces: the
 * checkout must already be on main, clean (tracked, staged and untracked
 * work; ignored files are allowed, as the owner chose, and the fast-forward
 * runs with `--no-overwrite-ignore`, so it aborts rather than overwrite one),
 * with main checked out nowhere else
 * and local main an ancestor of the target. It re-observes everything right
 * before the write and refuses any difference. */
export function nativeMainSyncRuntime(
  options: NativeMainSyncOptions,
): MainSyncRuntime {
  if (!slug.test(options.repository)) throw Error("Invalid main sync");
  const run = options.run ?? defaultRunner;
  const remote =
    options.remoteUrl ?? `https://github.com/${options.repository}.git`;
  const https = remote.startsWith("https://");
  if (!https && !remote.startsWith("file://"))
    throw Error("Invalid main sync remote");
  // An empty hooks folder, outside every checkout.
  const empty = mkdtempSync(join(tmpdir(), "aios-main-sync-hooks-"));
  const env = (): NodeJS.ProcessEnv => ({
    ...cleanEnvironment(),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GH_PROMPT_DISABLED: "1",
  });
  const git = (checkout: string, args: string[], timeoutMs = 60000) => {
    const r = run(
      "git",
      [
        "-C",
        checkout,
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
  /** The checkout's own configuration may not select helpers. */
  const reviewed = (checkout: string) => {
    for (const scope of ["--local", "--worktree"]) {
      const r = git(checkout, ["config", scope, "--no-includes", "--list"]);
      // `--worktree` fails without worktree config; that is fine.
      if (
        r.ok &&
        /^(?:filter\.[^=]+\.(?:clean|smudge|process)|include(?:if\.[^=]+)?\.path)=/im.test(
          r.out,
        )
      )
        return false;
    }
    return true;
  };
  const originMatches = (checkout: string) => {
    const r = git(checkout, ["config", "--local", "remote.origin.url"]);
    if (!r.ok) return false;
    const url = r.out.replace(/\.git$/, "").replace(/\/$/, "");
    return (
      url === remote.replace(/\.git$/, "") ||
      url === `git@github.com:${options.repository}` ||
      url === `ssh://git@github.com/${options.repository}`
    );
  };
  async function observe(
    request: Parameters<MainSyncRuntime["observe"]>[0],
  ): Promise<MainSyncObservation> {
    const blank: MainSyncObservation = {
      repository: options.repository,
      checkout: request.checkout,
      branch: request.branch,
      remoteMain: "",
      localMain: "",
      currentBranch: "",
      head: "",
      clean: false,
      fastForward: false,
      mainCheckedOutElsewhere: true,
      complete: false,
      quiescent: false,
    };
    if (
      request.repository !== options.repository ||
      !branchName.test(request.branch)
    )
      return blank;
    let checkout: string;
    try {
      checkout = realpathSync.native(request.checkout);
    } catch {
      return blank;
    }
    if (!reviewed(checkout) || !originMatches(checkout)) return blank;
    const tracking = `refs/remotes/origin/${request.branch}`;
    const fetched = git(
      checkout,
      [
        "fetch",
        "--quiet",
        "--no-tags",
        "--no-recurse-submodules",
        remote,
        `+refs/heads/${request.branch}:${tracking}`,
      ],
      120000,
    );
    const gitDir = git(checkout, ["rev-parse", "--absolute-git-dir"]).out;
    const remoteMain = git(checkout, ["rev-parse", "--verify", tracking]).out,
      localMain = git(checkout, [
        "rev-parse",
        "--verify",
        `refs/heads/${request.branch}`,
      ]).out,
      head = git(checkout, ["rev-parse", "--verify", "HEAD"]).out,
      current = git(checkout, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    // Tracked, staged and untracked work; ignored files are allowed.
    const status = git(checkout, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--ignored=no",
    ]);
    const worktrees = git(checkout, ["worktree", "list", "--porcelain"]);
    if (
      !fetched.ok ||
      !gitDir ||
      !sha40.test(remoteMain) ||
      !sha40.test(localMain) ||
      !sha40.test(head) ||
      !status.ok ||
      !worktrees.ok
    )
      return { ...blank, checkout };
    // Main checked out in any worktree but this one.
    const elsewhere = worktrees.out
      .split("\n\n")
      .map((block) => ({
        path: /^worktree (.+)$/m.exec(block)?.[1],
        branch: /^branch (.+)$/m.exec(block)?.[1],
      }))
      .some((w) => {
        if (w.branch !== `refs/heads/${request.branch}` || !w.path)
          return false;
        try {
          return realpathSync.native(w.path) !== checkout;
        } catch {
          return true;
        }
      });
    return {
      repository: options.repository,
      checkout,
      branch: request.branch,
      remoteMain,
      localMain,
      currentBranch: current.ok ? current.out : "HEAD",
      head,
      clean: status.out === "",
      fastForward: git(checkout, [
        "merge-base",
        "--is-ancestor",
        localMain,
        remoteMain,
      ]).ok,
      mainCheckedOutElsewhere: elsewhere,
      complete: true,
      // No Git process of this checkout is mid-write: its locks are free.
      quiescent:
        !existsSync(join(gitDir, "index.lock")) &&
        !existsSync(join(gitDir, `refs/heads/${request.branch}.lock`)) &&
        !existsSync(join(gitDir, "HEAD.lock")),
    };
  }
  return {
    mode: "controlled",
    bindingSha256: createHash("sha256")
      .update(
        JSON.stringify({
          scope: "aios-native-main-sync-v1",
          repository: options.repository,
          method: "fast-forward-only",
        }),
      )
      .digest("hex"),
    observe,
    async synchronize(request) {
      if (
        !request.mayDispatch() ||
        JSON.stringify(request.controls) !== JSON.stringify(mainSyncControls) ||
        !sha40.test(request.revision)
      )
        throw Error("Fenced or invalid synchronization");
      // Everything exactly as verified, and only a fast-forward to the target.
      const now = await observe(request);
      if (
        JSON.stringify(now) !== JSON.stringify(request.expected) ||
        !now.complete ||
        !now.clean ||
        !now.quiescent ||
        !now.fastForward ||
        now.mainCheckedOutElsewhere ||
        now.currentBranch !== request.branch ||
        now.remoteMain !== request.revision
      )
        throw Error("The checkout changed or is unsafe");
      if (!request.mayDispatch()) throw Error("Dispatch fenced");
      // By default Git overwrites an ignored file the new main tracks; this
      // makes the fast-forward abort instead, so nothing is lost.
      const r = git(now.checkout, [
        "merge",
        "--ff-only",
        "--no-overwrite-ignore",
        "--no-edit",
        "--quiet",
        request.revision,
      ]);
      if (!r.ok) throw Error("The fast-forward was refused");
    },
  };
}

/** The native main sync for the owner policy at `policyPath`: its
 * repository. Undefined when the policy names none, so synchronization then
 * refuses. */
export function ownerPolicyMainSyncRuntime(
  policyPath: string,
): MainSyncRuntime | undefined {
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
    return nativeMainSyncRuntime({ repository: policy.repository });
  } catch {
    return undefined;
  }
}
