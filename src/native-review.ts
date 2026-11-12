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
import type { ChangedFile, ChangedFileStatus } from "./change-gate.js";
import { ghApi, type GitHubApi } from "./native-publication.js";
import { repairFindings } from "./repair.js";
import type {
  OwnerReview,
  ReviewObservation,
  ReviewRuntime,
  ReviewThread,
} from "./review.js";

/** How long a dispatched resolution may still be accepted. */
export const resolveSettleMs = 120000;
const MAX_PAGES = 30;
const login = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})(?:\[bot\])?$/;

export interface NativeReviewOptions {
  /** The onboarded repository, `owner/name`. */
  repository: string;
  /** A private folder for this adapter's resolution markers. */
  state: string;
  github?: GitHubApi;
  clock?: () => number;
}

/** GitHub refuses a query that could reach more than 500,000 nodes, so the
 * pages are 100 conversations, 50 comments each, 25 reactions each: a bigger
 * conversation is incomplete, never truncated. */
export const threadPages = { threads: 100, comments: 50, reactions: 25 };
const threadsQuery = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewThreads(first: ${threadPages.threads}) {
        pageInfo { hasNextPage }
        nodes {
          id
          isResolved
          path
          line
          originalLine
          comments(first: ${threadPages.comments}) {
            pageInfo { hasNextPage }
            nodes {
              databaseId
              author { login __typename }
              body
              createdAt
              lastEditedAt
              reactions(first: ${threadPages.reactions}) {
                pageInfo { hasNextPage }
                nodes { content user { login } }
              }
            }
          }
        }
      }
    }
  }
}`;
const resolveMutation = `mutation($id: ID!) {
  resolveReviewThread(input: { threadId: $id }) { thread { id isResolved } }
}`;

interface GraphComment {
  databaseId?: unknown;
  author?: { login?: unknown; __typename?: unknown } | null;
  body?: unknown;
  createdAt?: unknown;
  lastEditedAt?: unknown;
  reactions?: {
    pageInfo?: { hasNextPage?: unknown };
    nodes?: { content?: unknown; user?: { login?: unknown } | null }[];
  };
}
interface GraphThread {
  id?: unknown;
  isResolved?: unknown;
  path?: unknown;
  line?: unknown;
  originalLine?: unknown;
  comments?: { pageInfo?: { hasNextPage?: unknown }; nodes?: GraphComment[] };
}

const time = (value: unknown) => {
  const t = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isSafeInteger(t) && t > 0 ? t : undefined;
};
const statuses: Record<string, ChangedFileStatus> = {
  added: "added",
  modified: "modified",
  removed: "removed",
  renamed: "renamed",
  copied: "copied",
  changed: "changed",
  // GitHub lists a file whose content didn't change (a mode change, say).
  unchanged: "changed",
};

/** One thread's content as the controller sees it: `undefined` when a page
 * of it is missing. The digest covers every comment, its edits and the
 * owner's reactions, but not the resolved flag. */
function readThread(
  t: GraphThread,
  owner: string,
  criteriaSha256: string,
): ReviewThread | undefined {
  const comments = t.comments?.nodes;
  if (
    typeof t.id !== "string" ||
    typeof t.isResolved !== "boolean" ||
    t.comments?.pageInfo?.hasNextPage !== false ||
    !Array.isArray(comments) ||
    !comments.length
  )
    return undefined;
  const content = [];
  for (const c of comments) {
    if (
      c.reactions?.pageInfo?.hasNextPage !== false ||
      !Array.isArray(c.reactions.nodes) ||
      typeof c.body !== "string"
    )
      return undefined;
    content.push({
      id: c.databaseId,
      author: c.author?.login ?? null,
      type: c.author?.__typename ?? null,
      body: c.body,
      createdAt: c.createdAt ?? null,
      editedAt: c.lastEditedAt ?? null,
      owner: c.reactions.nodes
        .filter((r) => r.user?.login === owner)
        .map((r) => r.content)
        .sort(),
    });
  }
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        id: t.id,
        path: t.path ?? null,
        line: t.originalLine ?? t.line ?? null,
        comments: content,
      }),
    )
    .digest("hex");
  const thread: ReviewThread = { id: t.id, digest, resolved: t.isResolved };
  // Only the owner's own thread, marked by the owner's reaction on its first
  // comment, is assessed. Anyone else's words in it make it disputed.
  const first = content[0]!;
  if (first.author !== owner || first.type !== "User") return thread;
  const up = first.owner.includes("THUMBS_UP"),
    down = first.owner.includes("THUMBS_DOWN");
  if (!up && !down) return thread;
  const assessed = (
    disposition: "straightforward" | "disputed" | "conflicting",
    finding?: string,
  ): ReviewThread => ({
    ...thread,
    assessment: {
      criteriaSha256,
      disposition,
      ...(finding ? { finding } : {}),
    },
  });
  if (up && down) return assessed("conflicting");
  if (down || content.some((c) => c.author !== owner))
    return assessed("disputed");
  const where =
    typeof t.path === "string"
      ? `${t.path}${typeof (t.line ?? t.originalLine) === "number" ? ":" + String(t.line ?? t.originalLine) : ""}: `
      : "";
  const finding = (
    where + content.map((c) => c.body.replace(/\s+/g, " ").trim()).join(" / ")
  ).trim();
  try {
    return assessed("straightforward", repairFindings([finding])[0]);
  } catch {
    // Too long, or it reads like a secret: the owner resolves it.
    return assessed("disputed");
  }
}

/** The owner's native review adapter (ticket 10, #269). It reads, through
 * the owner's `gh` login, the PR, every review, every review conversation,
 * the repository's eligible approvers and the head's complete diff. It never
 * submits a review. A conversation is a straightforward fix only when the
 * owner started it and reacted 👍 to its first comment, with no one else's
 * words in it; 👎 marks it disputed. Its one write resolves a conversation,
 * after re-reading the head and the conversation, recorded before dispatch
 * and reconciled by observing the conversation resolved. */
export function nativeReviewRuntime(
  options: NativeReviewOptions,
): ReviewRuntime {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository))
    throw Error("Invalid review adapter");
  const github = options.github ?? ghApi(),
    clock = options.clock ?? Date.now;
  const repo = `repos/${options.repository}`;
  const [ownerName, repoName] = options.repository.split("/") as [
    string,
    string,
  ];
  const marker = (operationId: string) => {
    if (!/^[A-Za-z0-9-]{1,80}$/.test(operationId))
      throw Error("Invalid resolution operation");
    return join(options.state, "resolve-" + operationId + ".json");
  };
  /** Every page of an array listing, or undefined when any is unreadable. */
  async function all<T>(path: string): Promise<T[] | undefined> {
    const found: T[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const r = await github(
        `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
      );
      if (r.status !== 200 || !Array.isArray(r.body)) return undefined;
      found.push(...(r.body as T[]));
      if (r.body.length < 100) return found;
    }
    return undefined;
  }
  async function threads(number: number) {
    const r = await github("graphql", "POST", {
      query: threadsQuery,
      variables: { owner: ownerName, name: repoName, number },
    });
    const body = r.body as {
      errors?: unknown;
      data?: {
        repository?: {
          pullRequest?: {
            reviewThreads?: {
              pageInfo?: { hasNextPage?: unknown };
              nodes?: GraphThread[];
            };
          };
        };
      };
    } | null;
    const list = body?.data?.repository?.pullRequest?.reviewThreads;
    if (
      r.status !== 200 ||
      body?.errors !== undefined ||
      list?.pageInfo?.hasNextPage !== false ||
      !Array.isArray(list.nodes)
    )
      return undefined;
    return list.nodes;
  }
  async function pullRequest(number: number) {
    const r = await github(`${repo}/pulls/${number}`);
    const p = r.body as {
      state?: unknown;
      changed_files?: unknown;
      head?: { sha?: unknown; ref?: unknown; repo?: { full_name?: unknown } };
      base?: { sha?: unknown; ref?: unknown; repo?: { full_name?: unknown } };
      user?: { login?: unknown };
    } | null;
    if (
      r.status !== 200 ||
      typeof p?.head?.sha !== "string" ||
      typeof p.head.ref !== "string" ||
      typeof p.base?.ref !== "string" ||
      typeof p.base.sha !== "string" ||
      typeof p.user?.login !== "string"
    )
      return undefined;
    return {
      head: p.head.sha,
      headRef: p.head.ref,
      base: p.base.ref,
      baseSha: p.base.sha,
      author: p.user.login,
      changedFiles: p.changed_files,
      state: (p.state === "open" ? "open" : "closed") as "open" | "closed",
      sameRepository:
        p.head.repo?.full_name === options.repository &&
        p.base.repo?.full_name === options.repository,
    };
  }
  /** The owner: the `gh` login this adapter reads as. */
  async function owner() {
    const r = await github("user");
    const u = r.body as { login?: unknown; type?: unknown } | null;
    if (
      r.status !== 200 ||
      typeof u?.login !== "string" ||
      !login.test(u.login)
    )
      return undefined;
    return {
      login: u.login,
      type: u.type === "User" ? "User" : "Bot",
    } as const;
  }
  return {
    mode: "controlled",
    bindingSha256: createHash("sha256")
      .update(
        JSON.stringify({
          scope: "aios-native-review-v1",
          repository: options.repository,
        }),
      )
      .digest("hex"),
    async observe(request) {
      const unavailable = (
        partial: Partial<ReviewObservation> = {},
      ): ReviewObservation => ({
        repository: options.repository,
        number: request.number,
        head: "",
        base: "",
        author: "",
        state: "closed",
        complete: false,
        eligibleApprovers: [],
        owner: { login: "", type: "Bot", permission: "none" },
        lastPusher: "",
        requiredChanges: true,
        reviews: [],
        threads: [],
        resolutions: [],
        ...partial,
      });
      if (request.repository !== options.repository) return unavailable();
      const pr = await pullRequest(request.number);
      if (!pr) return unavailable();
      const seen = {
        head: pr.head,
        base: pr.base,
        author: pr.author,
        state: pr.state,
      };
      if (!pr.sameRepository) return unavailable(seen);
      const me = await owner();
      if (!me) return unavailable(seen);
      const permission = await github(
        `${repo}/collaborators/${me.login}/permission`,
      );
      const perm = permission.body as {
        permission?: unknown;
        role_name?: unknown;
      } | null;
      const role = ["admin", "maintain", "write"].includes(
        perm?.role_name as string,
      )
        ? (perm!.role_name as string)
        : typeof perm?.permission === "string"
          ? perm.permission
          : undefined;
      // Every person who can push could approve; the owner must be the only one.
      const collaborators = await all<{
        login?: unknown;
        type?: unknown;
      }>(`${repo}/collaborators?affiliation=all&permission=push`);
      const activity = await github(
        `${repo}/activity?ref=${encodeURIComponent("refs/heads/" + pr.headRef)}&per_page=20`,
      );
      const pusher = Array.isArray(activity.body)
        ? (
            activity.body as { after?: unknown; actor?: { login?: unknown } }[]
          ).find((a) => a.after === pr.head)?.actor?.login
        : undefined;
      const rawReviews = await all<{
        id?: unknown;
        user?: { login?: unknown; type?: unknown } | null;
        commit_id?: unknown;
        state?: unknown;
        submitted_at?: unknown;
      }>(`${repo}/pulls/${request.number}/reviews`);
      const rawThreads = await threads(request.number);
      const files = await all<{
        filename?: unknown;
        status?: unknown;
        previous_filename?: unknown;
        additions?: unknown;
        deletions?: unknown;
      }>(`${repo}/pulls/${request.number}/files`);
      const compare = await github(
        `${repo}/compare/${pr.baseSha}...${pr.head}?per_page=1`,
      );
      const compared = (compare.body as { status?: unknown } | null)?.status;
      if (
        permission.status !== 200 ||
        !role ||
        !collaborators ||
        activity.status !== 200 ||
        typeof pusher !== "string" ||
        !rawReviews ||
        !rawThreads ||
        compare.status !== 200 ||
        typeof compared !== "string"
      )
        return unavailable(seen);
      const reviews: OwnerReview[] = [];
      const latest = new Map<string, string>();
      for (const r of rawReviews) {
        const author = r.user?.login,
          submittedAt = time(r.submitted_at);
        if (
          typeof author !== "string" ||
          typeof r.state !== "string" ||
          !Number.isSafeInteger(r.id)
        )
          return unavailable(seen);
        // A pending review has no submission; it never counts.
        if (r.state === "PENDING" || submittedAt === undefined) continue;
        if (["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(r.state))
          latest.set(author, r.state);
        if (typeof r.commit_id !== "string") continue;
        reviews.push({
          id: r.id as number,
          author,
          type: r.user?.type === "User" ? "User" : "Bot",
          head: r.commit_id,
          state: r.state as OwnerReview["state"],
          submittedAt,
        });
      }
      const threadsSeen: ReviewThread[] = [];
      for (const t of rawThreads) {
        const thread = readThread(t, me.login, request.criteriaSha256);
        if (!thread) return unavailable(seen);
        threadsSeen.push(thread);
      }
      // Each resolution this adapter dispatched, by its conversation's state.
      const resolutions: ReviewObservation["resolutions"] = [];
      let recorded: string[] = [];
      try {
        recorded = readdirSync(options.state)
          .map((name) => /^resolve-([A-Za-z0-9-]{1,80})\.json$/.exec(name)?.[1])
          .filter((id): id is string => !!id)
          .map((id) => ({ id, at: statSync(marker(id)).mtimeMs }))
          .sort((a, b) => b.at - a.at)
          .slice(0, 32)
          .map((m) => m.id);
      } catch {}
      for (const operationId of recorded) {
        let m: { threadId?: unknown; at?: unknown } = {};
        try {
          m = JSON.parse(readFileSync(marker(operationId), "utf8"));
        } catch {}
        if (threadsSeen.some((t) => t.id === m.threadId && t.resolved))
          resolutions.push({ operationId, state: "accepted" });
        else
          resolutions.push({
            operationId,
            state: "absent",
            quiescent:
              typeof m.at !== "number" || clock() - m.at > resolveSettleMs,
          });
      }
      const changedFiles: ChangedFile[] = [];
      let changes: ReviewObservation["changes"];
      if (files) {
        for (const f of files) {
          const status = statuses[f.status as string];
          if (typeof f.filename !== "string" || !status)
            return unavailable(seen);
          changedFiles.push({
            path: f.filename,
            status,
            ...((status === "renamed" || status === "copied") &&
            typeof f.previous_filename === "string"
              ? { previousPath: f.previous_filename }
              : {}),
            additions: f.additions as number,
            deletions: f.deletions as number,
          });
        }
        changes = {
          base: pr.baseSha,
          complete: changedFiles.length === pr.changedFiles,
          // The PR's recorded base must be in the head's history.
          baseIsAncestor: compared === "ahead" || compared === "identical",
          files: changedFiles,
        };
      }
      return {
        repository: options.repository,
        number: request.number,
        ...seen,
        complete: true,
        eligibleApprovers: collaborators
          .filter((c) => c.type === "User" && typeof c.login === "string")
          .map((c) => c.login as string),
        owner: { login: me.login, type: me.type, permission: role },
        lastPusher: pusher,
        requiredChanges: [...latest.values()].includes("CHANGES_REQUESTED"),
        reviews,
        threads: threadsSeen,
        resolutions,
        // Without a readable diff the head stays gated.
        ...(changes ? { changes } : {}),
      };
    },
    async resolve(request) {
      if (
        !request.mayDispatch() ||
        request.repository !== options.repository ||
        typeof request.threadId !== "string"
      )
        throw Error("Fenced or invalid resolution");
      // The head and the conversation must be exactly what was verified.
      const pr = await pullRequest(request.number);
      const me = await owner();
      const now = me && (await threads(request.number));
      const thread = now
        ?.map((t) => readThread(t, me!.login, ""))
        .find((t) => t?.id === request.threadId);
      if (
        pr?.head !== request.head ||
        pr.state !== "open" ||
        !thread ||
        thread.digest !== request.digest ||
        thread.resolved
      )
        throw Error("The conversation changed");
      mkdirSync(options.state, { recursive: true, mode: 0o700 });
      // Recorded before dispatch, so an unanswered resolution is never absent.
      writeFileSync(
        marker(request.operationId),
        JSON.stringify({ threadId: request.threadId, at: clock() }),
        { mode: 0o600 },
      );
      if (!request.mayDispatch()) throw Error("Dispatch fenced");
      const r = await github("graphql", "POST", {
        query: resolveMutation,
        variables: { id: request.threadId },
      });
      const done = (
        r.body as {
          errors?: unknown;
          data?: {
            resolveReviewThread?: {
              thread?: { id?: unknown; isResolved?: unknown };
            };
          };
        } | null
      )?.data?.resolveReviewThread?.thread;
      return {
        operationId: request.operationId,
        accepted:
          r.status === 200 &&
          done?.id === request.threadId &&
          done.isResolved === true,
      };
    },
  };
}

/** The native review adapter for the owner policy at `policyPath`: its
 * repository. Undefined when the policy names none, so review then refuses.
 * Resolution markers live in a private folder under `stateDirectory`, one per
 * repository. */
export function ownerPolicyReviewRuntime(
  policyPath: string,
  stateDirectory: string,
  github?: GitHubApi,
): ReviewRuntime | undefined {
  let policy: { repository?: unknown };
  try {
    const st = lstatSync(policyPath);
    if (!st.isFile() || st.size > 65536) return undefined;
    policy = JSON.parse(readFileSync(policyPath, "utf8"));
  } catch {
    return undefined;
  }
  if (typeof policy?.repository !== "string") return undefined;
  const folder = join(
    stateDirectory,
    "review",
    createHash("sha256").update(policy.repository).digest("hex").slice(0, 32),
  );
  try {
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    return nativeReviewRuntime({
      repository: policy.repository,
      state: folder,
      ...(github ? { github } : {}),
    });
  } catch {
    return undefined;
  }
}
