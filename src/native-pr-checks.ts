import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { CheckStatus } from "./isolated-validation.js";
import { ghApi, type GitHubApi } from "./native-publication.js";
import type {
  PRCheckAttempt,
  PRCheckObservation,
  PRChecksRuntime,
} from "./pr-checks.js";

/** The publisher every trusted native check reports: GitHub Actions. */
export const actionsPublisher = "github-actions";
/** How long a dispatched rerun may still be accepted. */
export const rerunSettleMs = 120000;
const MAX_PAGES = 10;

export interface NativePRChecksOptions {
  /** The onboarded repository, `owner/name`. */
  repository: string;
  /** The trusted workflow files, by path under `.github/workflows/`. A check
   * counts only from a GitHub Actions run of one of these, for the exact
   * head, whose file at that head is byte-identical to the base branch's. */
  workflows: string[];
  /** A private folder for this monitor's rerun markers. */
  state: string;
  github?: GitHubApi;
  clock?: () => number;
}

/** The workflow identity a trusted native check carries: its file, as the
 * base branch has it. An owner contract declares this as the check's
 * `workflow`, with `publisher` `github-actions`. */
export const workflowIdentity = (path: string, base: string) =>
  `${path}@${base}`;

/** GitHub Actions statuses as the controller's check statuses. */
function status(job: { status?: unknown; conclusion?: unknown }): CheckStatus {
  if (job.status !== "completed") return "pending";
  switch (job.conclusion) {
    case "success":
      return "success";
    case "failure":
      return "failure";
    case "cancelled":
      return "cancelled";
    case "skipped":
      return "skipped";
    case "neutral":
      return "neutral";
    case "timed_out":
      return "timeout";
    default:
      // stale, action_required, startup_failure and anything new.
      return "missing";
  }
}
const time = (value: unknown) => {
  const t = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isSafeInteger(t) && t > 0 ? t : undefined;
};

/** Every job of every attempt of the GitHub Actions runs of `workflows` for
 * exactly `head`, as check attempts, through `github`; undefined when any page
 * or attempt is unreadable. A run whose workflow `trusted` refuses is
 * reported under an untrusted publisher, so it never counts. With `event`
 * (and `branch`), only runs of that event on that branch count. Shared by the
 * PR check monitor and the main observer (#271). */
export async function actionsChecks(
  github: GitHubApi,
  request: {
    repository: string;
    workflows: string[];
    head: string;
    base: string;
    trusted: (path: string) => boolean;
    event?: string;
    branch?: string;
  },
): Promise<
  { checks: PRCheckAttempt[]; attempts: Map<number, number> } | undefined
> {
  const repo = `repos/${request.repository}`;
  async function all<T>(path: string, key: string): Promise<T[] | undefined> {
    const found: T[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const r = await github(
        `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
      );
      const body = r.body as Record<string, unknown> | null;
      const items = body?.[key];
      if (r.status !== 200 || !Array.isArray(items)) return undefined;
      found.push(...(items as T[]));
      if (
        typeof body!.total_count === "number" &&
        found.length >= body!.total_count
      )
        return found;
      if (items.length < 100) return found;
    }
    return undefined;
  }
  const runs = await all<{
    id?: unknown;
    path?: unknown;
    head_sha?: unknown;
    head_branch?: unknown;
    run_attempt?: unknown;
    event?: unknown;
  }>(`${repo}/actions/runs?head_sha=${request.head}`, "workflow_runs");
  if (!runs) return undefined;
  const checks: PRCheckAttempt[] = [];
  const attempts = new Map<number, number>();
  for (const run of runs) {
    if (
      typeof run.path !== "string" ||
      !request.workflows.includes(run.path) ||
      run.head_sha !== request.head ||
      (request.event !== undefined && run.event !== request.event) ||
      (request.branch !== undefined && run.head_branch !== request.branch)
    )
      continue;
    if (
      !Number.isSafeInteger(run.id) ||
      !Number.isSafeInteger(run.run_attempt) ||
      (run.run_attempt as number) < 1 ||
      (run.run_attempt as number) > 50
    )
      return undefined;
    const id = run.id as number,
      last = run.run_attempt as number;
    attempts.set(id, last);
    for (let attempt = 1; attempt <= last; attempt++) {
      const jobs = await all<{
        name?: unknown;
        status?: unknown;
        conclusion?: unknown;
        started_at?: unknown;
        completed_at?: unknown;
      }>(`${repo}/actions/runs/${id}/attempts/${attempt}/jobs`, "jobs");
      if (!jobs) return undefined;
      for (const job of jobs) {
        const startedAt = time(job.started_at),
          completedAt = time(job.completed_at),
          s = status(job);
        if (typeof job.name !== "string" || startedAt === undefined) continue;
        checks.push({
          runId: id,
          attempt,
          checkId: job.name,
          publisher: request.trusted(run.path)
            ? actionsPublisher
            : "untrusted-workflow-change",
          workflow: workflowIdentity(run.path, request.base),
          head: request.head,
          status: s,
          startedAt,
          ...(s !== "pending" && completedAt !== undefined
            ? { completedAt }
            : {}),
        });
      }
    }
  }
  return { checks, attempts };
}

/** The owner's native PR check monitor (ticket 09, #268). It reads, through
 * the owner's `gh` login, every GitHub Actions run of the trusted workflows
 * for the exact PR head, and every job of every attempt of each, so earlier
 * failures stay visible after a rerun. A run whose workflow file differs at
 * the head from the base branch's is reported under an untrusted publisher,
 * so it can never count. Its one write is an explicit rerun of a run's
 * failed jobs, recorded before dispatch and reconciled by the run's attempt
 * number. */
export function nativePRChecksRuntime(
  options: NativePRChecksOptions,
): PRChecksRuntime {
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository) ||
    !options.workflows.length ||
    !options.workflows.every((w) =>
      /^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(w),
    )
  )
    throw Error("Invalid PR check monitor");
  const github = options.github ?? ghApi(),
    clock = options.clock ?? Date.now;
  const repo = `repos/${options.repository}`;
  const marker = (operationId: string) => {
    if (!/^[A-Za-z0-9-]{1,80}$/.test(operationId))
      throw Error("Invalid rerun operation");
    return join(options.state, "rerun-" + operationId + ".json");
  };
  /** The file's blob at `ref`, or undefined. */
  async function blob(path: string, ref: string) {
    const r = await github(
      `${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`,
    );
    const sha = (r.body as { sha?: unknown } | null)?.sha;
    return r.status === 200 && typeof sha === "string" ? sha : undefined;
  }
  return {
    mode: "controlled",
    bindingSha256: createHash("sha256")
      .update(
        JSON.stringify({
          scope: "aios-native-pr-checks-v1",
          repository: options.repository,
          workflows: [...options.workflows].sort(),
        }),
      )
      .digest("hex"),
    async observe(request) {
      const unavailable = (
        pr?: Partial<PRCheckObservation>,
      ): PRCheckObservation => ({
        repository: options.repository,
        number: request.number,
        head: pr?.head ?? "",
        base: pr?.base ?? "",
        author: pr?.author ?? "",
        state: pr?.state ?? "closed",
        complete: false,
        checks: [],
        reruns: [],
      });
      if (request.repository !== options.repository) return unavailable();
      const pull = await github(`${repo}/pulls/${request.number}`);
      const p = pull.body as {
        state?: unknown;
        head?: { sha?: unknown; repo?: { full_name?: unknown } };
        base?: { ref?: unknown; repo?: { full_name?: unknown } };
        user?: { login?: unknown };
      } | null;
      if (
        pull.status !== 200 ||
        typeof p?.head?.sha !== "string" ||
        typeof p.base?.ref !== "string" ||
        typeof p.user?.login !== "string"
      )
        return unavailable();
      const pr = {
        head: p.head.sha,
        base: p.base.ref,
        author: p.user.login,
        state: (p.state === "open" ? "open" : "closed") as "open" | "closed",
      };
      if (
        p.head.repo?.full_name !== options.repository ||
        p.base.repo?.full_name !== options.repository
      )
        return unavailable(pr);
      const trustedFile = new Map<string, boolean>();
      for (const path of options.workflows) {
        const [atHead, atBase] = [
          await blob(path, pr.head),
          await blob(path, pr.base),
        ];
        trustedFile.set(path, !!atHead && atHead === atBase);
      }
      const read = await actionsChecks(github, {
        repository: options.repository,
        workflows: options.workflows,
        head: pr.head,
        base: pr.base,
        trusted: (path) => trustedFile.get(path) === true,
      });
      if (!read) return unavailable(pr);
      const { checks, attempts } = read;
      const reruns: PRCheckObservation["reruns"] = [];
      // Each rerun this monitor dispatched, by its run's attempt number.
      let recorded: string[] = [];
      try {
        recorded = readdirSync(options.state)
          .map((name) => /^rerun-([A-Za-z0-9-]{1,80})\.json$/.exec(name)?.[1])
          .filter((id): id is string => !!id)
          .map((id) => ({ id, at: statSync(marker(id)).mtimeMs }))
          .sort((a, b) => b.at - a.at)
          .slice(0, 32)
          .map((m) => m.id);
      } catch {}
      for (const operationId of recorded) {
        let m: { runId?: number; attempt?: number; at?: number } = {};
        try {
          m = JSON.parse(readFileSync(marker(operationId), "utf8"));
        } catch {}
        const now = attempts.get(m.runId as number);
        if (now !== undefined && now > (m.attempt as number))
          reruns.push({ operationId, state: "accepted" });
        else
          reruns.push({
            operationId,
            state: "absent",
            quiescent:
              typeof m.at !== "number" || clock() - m.at > rerunSettleMs,
          });
      }
      return {
        repository: options.repository,
        number: request.number,
        ...pr,
        complete: true,
        checks,
        reruns,
      };
    },
    async rerun(request) {
      if (
        !request.mayDispatch() ||
        request.repository !== options.repository ||
        !Number.isSafeInteger(request.runId) ||
        request.runId < 1 ||
        !Number.isSafeInteger(request.attempt) ||
        request.attempt < 1
      )
        throw Error("Fenced or invalid rerun");
      mkdirSync(options.state, { recursive: true, mode: 0o700 });
      // Recorded before dispatch, so an unanswered rerun is never absent.
      writeFileSync(
        marker(request.operationId),
        JSON.stringify({
          runId: request.runId,
          attempt: request.attempt,
          at: clock(),
        }),
        { mode: 0o600 },
      );
      const r = await github(
        `${repo}/actions/runs/${request.runId}/rerun-failed-jobs`,
        "POST",
      );
      return { operationId: request.operationId, accepted: r.status === 201 };
    },
  };
}

/** The native monitor the owner policy at `policyPath` names: its
 * repository, and the workflow files of its PR-scoped checks declared as
 * GitHub Actions checks, `workflow: <path>@<base>` with `publisher:
 * github-actions`. Undefined when the policy declares none, so PR
 * monitoring then refuses. Rerun markers live in a private folder under
 * `stateDirectory`, one per repository. */
export function ownerPolicyPRChecksRuntime(
  policyPath: string,
  stateDirectory: string,
  github?: GitHubApi,
): PRChecksRuntime | undefined {
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
            c?.scope === "pr" &&
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
  const folder = join(
    stateDirectory,
    "pr-checks",
    createHash("sha256").update(policy.repository).digest("hex").slice(0, 32),
  );
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  return nativePRChecksRuntime({
    repository: policy.repository,
    workflows,
    state: folder,
    ...(github ? { github } : {}),
  });
}
