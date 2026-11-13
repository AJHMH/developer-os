import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cleanEnvironment,
  defaultRunner,
  type CommandRunner,
} from "./native-publication.js";

export interface IsolatedGit {
  /** Where the repository is fetched from and pushed to. */
  remote: string;
  git(
    checkout: string,
    args: string[],
    timeoutMs?: number,
  ): { ok: boolean; status: number | null; out: string };
  /** The checkout's own configuration selects no filters or includes. */
  reviewed(checkout: string): boolean;
  /** The checkout's origin is this repository. */
  originMatches(checkout: string): boolean;
}

/** Git for the owner's checkout of `repository`, isolated from everything
 * but the checkout's own reviewed configuration: no system or global
 * configuration, an empty hooks folder outside every checkout, fsmonitor off,
 * one allowed protocol, and over HTTPS only the owner's `gh` login as the
 * credential helper. Shared by the native main sync (#272) and branch
 * cleanup (#273). */
export function isolatedGit(
  repository: string,
  remoteUrl?: string,
  run: CommandRunner = defaultRunner,
): IsolatedGit {
  const remote = remoteUrl ?? `https://github.com/${repository}.git`;
  const https = remote.startsWith("https://");
  if (!https && !remote.startsWith("file://"))
    throw Error("Invalid Git remote");
  const empty = mkdtempSync(join(tmpdir(), "aios-git-hooks-"));
  const env = (): NodeJS.ProcessEnv => ({
    ...cleanEnvironment(),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GH_PROMPT_DISABLED: "1",
  });
  const git: IsolatedGit["git"] = (checkout, args, timeoutMs = 60000) => {
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
    return { ok: r.status === 0, status: r.status, out: r.stdout.trim() };
  };
  return {
    remote,
    git,
    reviewed(checkout) {
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
    },
    originMatches(checkout) {
      const r = git(checkout, ["config", "--local", "remote.origin.url"]);
      if (!r.ok) return false;
      const url = r.out.replace(/\.git$/, "").replace(/\/$/, "");
      return (
        url === remote.replace(/\.git$/, "") ||
        url === `git@github.com:${repository}` ||
        url === `ssh://git@github.com/${repository}`
      );
    },
  };
}
