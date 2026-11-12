import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
} from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AppPullRequestPort } from "./publication-adapter.js";

/** A bounded GitHub REST call: its status and parsed body. */
export type GitHubFetch = (
  path: string,
  init: { method: string; token: string; body?: unknown },
) => Promise<{ status: number; body: unknown }>;

export const githubFetch: GitHubFetch = async (path, init) => {
  const response = await fetch("https://api.github.com/" + path, {
    method: init.method,
    headers: {
      Authorization: "Bearer " + init.token,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body === undefined
        ? {}
        : { "Content-Type": "application/json" }),
    },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  if (text.length > 16 * 1024 * 1024) throw Error("GitHub answer too large");
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {}
  return { status: response.status, body };
};

/** How long a dispatched PR creation may still be accepted. */
export const pullRequestSettleMs = 120000;

export interface NativeAppOptions {
  /** The onboarded repository, `owner/name`. */
  repository: string;
  appId: string;
  installationId: string;
  /** The App's bot login, `slug[bot]`. */
  botLogin: string;
  /** The App's private key (PEM). Read only to sign the App's own JWT; never
   * a commit-signing key, and never part of any report. */
  keyPath: string;
  /** The sole eligible approver, who is never the App. */
  approver: string;
  /** A private folder for this port's dispatch markers. */
  state: string;
  fetch?: GitHubFetch;
  clock?: () => number;
}

/** The Software Factory App's PR author (ticket 08). Every call takes an
 * installation token limited to `pull_requests:write` on the one onboarded
 * repository, checks GitHub granted exactly that, and revokes it after use.
 * It only creates and observes pull requests: no review, merge or content
 * write exists here. */
export function nativeAppPullRequestPort(
  options: NativeAppOptions,
): AppPullRequestPort {
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository) ||
    !/^[0-9]{1,12}$/.test(options.appId) ||
    !/^[0-9]{1,15}$/.test(options.installationId) ||
    !/^[a-z0-9-]{1,80}\[bot\]$/.test(options.botLogin) ||
    !/^[A-Za-z0-9-]{1,39}$/.test(options.approver)
  )
    throw Error("Invalid App publication identity");
  const call = options.fetch ?? githubFetch,
    clock = options.clock ?? Date.now;
  const [owner, name] = options.repository.split("/") as [string, string];
  const key = () => {
    const k = createPrivateKey(readFileSync(options.keyPath));
    if (k.asymmetricKeyType !== "rsa") throw Error("Invalid App key");
    return k;
  };
  const keySha256 = () =>
    createHash("sha256")
      .update(createPublicKey(key()).export({ type: "spki", format: "der" }))
      .digest("hex");
  const jwt = () => {
    const b64 = (v: unknown) =>
      Buffer.from(JSON.stringify(v)).toString("base64url");
    const now = Math.floor(clock() / 1000);
    const payload =
      b64({ alg: "RS256", typ: "JWT" }) +
      "." +
      b64({ iat: now - 60, exp: now + 540, iss: options.appId });
    return (
      payload +
      "." +
      createSign("RSA-SHA256").update(payload).sign(key()).toString("base64url")
    );
  };
  /** Runs `use` with a token scoped to pull requests on this repository. */
  async function scoped<T>(use: (token: string) => Promise<T>): Promise<T> {
    const app = jwt();
    const self = await call("app", { method: "GET", token: app });
    const body = self.body as { id?: unknown; slug?: unknown } | null;
    if (
      self.status !== 200 ||
      String(body?.id) !== options.appId ||
      `${String(body?.slug)}[bot]` !== options.botLogin
    )
      throw Error("Wrong GitHub App");
    const granted = await call(
      `app/installations/${options.installationId}/access_tokens`,
      {
        method: "POST",
        token: app,
        body: {
          repositories: [name],
          permissions: { pull_requests: "write" },
        },
      },
    );
    const t = granted.body as {
      token?: unknown;
      permissions?: Record<string, unknown>;
      repositories?: { full_name?: unknown }[];
    } | null;
    const token = typeof t?.token === "string" ? t.token : "";
    try {
      const permissions = Object.entries(t?.permissions ?? {});
      if (
        granted.status !== 201 ||
        !token ||
        t?.repositories?.length !== 1 ||
        t.repositories[0]!.full_name !== options.repository ||
        t.permissions?.pull_requests !== "write" ||
        !permissions.every(
          ([k, v]) =>
            (k === "pull_requests" && v === "write") ||
            (k === "metadata" && v === "read"),
        )
      )
        throw Error("Unexpected App credential scope");
      return await use(token);
    } finally {
      if (token)
        await call("installation/token", { method: "DELETE", token }).catch(
          () => {},
        );
    }
  }
  const marker = (operationId: string) => {
    if (!/^[A-Za-z0-9-]{1,80}$/.test(operationId))
      throw Error("Invalid publication operation");
    return join(options.state, "pr-" + operationId);
  };
  return {
    async inspect() {
      await scoped(async () => undefined);
      return {
        repository: options.repository,
        login: options.botLogin,
        keySha256: keySha256(),
        permissions: ["pull_requests:write"],
        approver: options.approver,
        eligibleApprovers: [options.approver],
      };
    },
    async create(r) {
      if (!r.mayDispatch() || r.repository !== options.repository)
        throw Error("Fenced PR creation");
      mkdirSync(options.state, { recursive: true, mode: 0o700 });
      // Recorded before dispatch, so an unanswered creation is never absent.
      writeFileSync(marker(r.operationId), String(clock()), { mode: 0o600 });
      await scoped(async (token) => {
        const created = await call(`repos/${options.repository}/pulls`, {
          method: "POST",
          token,
          body: {
            title: "AIOS delivery candidate",
            head: r.branch,
            base: r.base,
            body: `Signed by the owner and validated by the controller.\n\nAIOS-Operation: ${r.operationId}`,
          },
        });
        if (created.status !== 201) throw Error("PR creation refused");
      });
    },
    async observe(r) {
      return scoped(async (token) => {
        const found = await call(
          `repos/${options.repository}/pulls?state=all&per_page=100&head=${encodeURIComponent(owner + ":" + r.branch)}`,
          { method: "GET", token },
        );
        if (found.status !== 200 || !Array.isArray(found.body))
          return { state: "unknown" as const };
        const prs = found.body as {
          number?: unknown;
          user?: { login?: unknown };
          head?: {
            ref?: unknown;
            sha?: unknown;
            repo?: { full_name?: unknown };
          };
          base?: { ref?: unknown; repo?: { full_name?: unknown } };
        }[];
        if (prs.length === 0) {
          let dispatched = NaN;
          try {
            dispatched = Number(readFileSync(marker(r.operationId), "utf8"));
          } catch {}
          return {
            state: "absent" as const,
            quiescent:
              Number.isNaN(dispatched) ||
              clock() - dispatched > pullRequestSettleMs,
          };
        }
        // Any PR from this branch counts, whatever its operation marker;
        // more than one is for the owner to resolve.
        if (prs.length !== 1) return { state: "unknown" as const };
        const pr = prs[0]!;
        if (
          typeof pr.number !== "number" ||
          pr.head?.repo?.full_name !== options.repository ||
          pr.base?.repo?.full_name !== options.repository ||
          typeof pr.head?.sha !== "string" ||
          typeof pr.user?.login !== "string"
        )
          return { state: "unknown" as const };
        return {
          state: "found" as const,
          result: {
            number: pr.number,
            repository: options.repository,
            head: pr.head.sha,
            branch: String(pr.head.ref),
            base: String(pr.base?.ref),
            author: pr.user.login,
            approver: options.approver,
          },
        };
      });
    },
  };
}
