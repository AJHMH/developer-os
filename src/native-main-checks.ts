import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import type { MainChecksRuntime, MainObservation } from "./main-checks.js";
import { actionsChecks, actionsPublisher } from "./native-pr-checks.js";
import { ghApi, type GitHubApi } from "./native-publication.js";

const sha40 = /^[a-f0-9]{40}$/;

export interface NativeMainChecksOptions {
  /** The onboarded repository, `owner/name`. */
  repository: string;
  /** The trusted main workflow files, by path under `.github/workflows/`. */
  workflows: string[];
  github?: GitHubApi;
}

/** The owner's native main observer (ticket 12, #271). Read-only, through
 * the owner's `gh` login. It establishes that the PR merged with exactly the
 * recorded merge commit and approved head, reads main's current tip and
 * whether the merge commit is in its history, then every job of every
 * attempt of the trusted main workflows' push runs on the default branch for
 * exactly that tip. Main is the trusted branch, so its own workflow file is
 * the trusted one. It re-reads main before answering: a main that moved
 * meanwhile makes the observation incomplete. */
export function nativeMainChecksRuntime(
  options: NativeMainChecksOptions,
): MainChecksRuntime {
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository) ||
    !options.workflows.length ||
    !options.workflows.every((w) =>
      /^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(w),
    )
  )
    throw Error("Invalid main observer");
  const github = options.github ?? ghApi();
  const repo = `repos/${options.repository}`;
  async function tip(base: string) {
    const r = await github(`${repo}/git/ref/heads/${encodeURIComponent(base)}`);
    const sha = (r.body as { object?: { sha?: unknown } } | null)?.object?.sha;
    return r.status === 200 && typeof sha === "string" && sha40.test(sha)
      ? sha
      : undefined;
  }
  return {
    mode: "controlled",
    bindingSha256: createHash("sha256")
      .update(
        JSON.stringify({
          scope: "aios-native-main-checks-v1",
          repository: options.repository,
          workflows: [...options.workflows].sort(),
        }),
      )
      .digest("hex"),
    async observe(request) {
      const seen: MainObservation = {
        repository: options.repository,
        number: request.number,
        head: "",
        base: "",
        mergeCommit: "",
        mainRevision: "",
        reachable: false,
        complete: false,
        checks: [],
      };
      if (request.repository !== options.repository) return seen;
      // The PR merged, with exactly this head and merge commit.
      const pull = await github(`${repo}/pulls/${request.number}`);
      const p = pull.body as {
        merged?: unknown;
        merge_commit_sha?: unknown;
        head?: { sha?: unknown };
        base?: { ref?: unknown; repo?: { full_name?: unknown } };
      } | null;
      if (
        pull.status !== 200 ||
        p?.merged !== true ||
        typeof p.head?.sha !== "string" ||
        typeof p.base?.ref !== "string" ||
        typeof p.merge_commit_sha !== "string" ||
        p.base.repo?.full_name !== options.repository
      )
        return seen;
      const linked = {
        ...seen,
        head: p.head.sha,
        base: p.base.ref,
        mergeCommit: p.merge_commit_sha,
      };
      const main = await tip(linked.base);
      if (!main) return linked;
      let reachable = main === linked.mergeCommit;
      if (!reachable) {
        const r = await github(
          `${repo}/compare/${linked.mergeCommit}...${main}?per_page=1`,
        );
        const status = (r.body as { status?: unknown } | null)?.status;
        if (r.status !== 200 || typeof status !== "string")
          return { ...linked, mainRevision: main };
        reachable = status === "ahead";
      }
      const read = await actionsChecks(github, {
        repository: options.repository,
        workflows: options.workflows,
        head: main,
        base: linked.base,
        trusted: () => true,
        // Only the default branch's own push runs check main.
        event: "push",
        branch: linked.base,
      });
      // Main must not have moved while it was read.
      const again = await tip(linked.base);
      return {
        ...linked,
        mainRevision: main,
        reachable,
        complete: !!read && again === main,
        checks: read?.checks ?? [],
      };
    },
  };
}

/** The native main observer for the owner policy at `policyPath`: its
 * repository, and the workflow files of its main-scoped checks declared as
 * GitHub Actions checks (`publisher: github-actions`, `workflow:
 * <path>@<default branch>`). Undefined when it declares none, so main
 * monitoring then refuses. */
export function ownerPolicyMainChecksRuntime(
  policyPath: string,
  github?: GitHubApi,
): MainChecksRuntime | undefined {
  let policy: {
    repository?: unknown;
    defaultBranch?: unknown;
    validationContract?: { checks?: unknown };
  };
  try {
    const st = lstatSync(policyPath);
    if (!st.isFile() || st.size > 65536) return undefined;
    policy = JSON.parse(readFileSync(policyPath, "utf8"));
  } catch {
    return undefined;
  }
  const checks = Array.isArray(policy?.validationContract?.checks)
    ? (policy.validationContract.checks as {
        scope?: unknown;
        publisher?: unknown;
        workflow?: unknown;
      }[])
    : [];
  const workflows = [
    ...new Set(
      checks
        .filter(
          (c) =>
            c?.scope === "main" &&
            c.publisher === actionsPublisher &&
            typeof c.workflow === "string" &&
            c.workflow.endsWith("@" + String(policy.defaultBranch)),
        )
        .map((c) =>
          (c.workflow as string).slice(
            0,
            (c.workflow as string).lastIndexOf("@"),
          ),
        ),
    ),
  ];
  if (typeof policy?.repository !== "string" || !workflows.length)
    return undefined;
  try {
    return nativeMainChecksRuntime({
      repository: policy.repository,
      workflows,
      ...(github ? { github } : {}),
    });
  } catch {
    return undefined;
  }
}
