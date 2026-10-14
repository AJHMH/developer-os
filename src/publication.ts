import { createHash, randomUUID } from "node:crypto";
import type { Delivery } from "./controller.js";

export type PublicationStage = "sign" | "push" | "pr";
export interface SignedCommit {
  commit: string;
  tree: string;
  parent: string;
  signer: string;
  localVerified: boolean;
}
export interface PublishedCommit {
  commit: string;
  tree: string;
  repository: string;
  branch: string;
  githubVerified: boolean;
  signer: string;
  publisher: string;
}
export interface ProposedPullRequest {
  number: number;
  repository: string;
  head: string;
  branch: string;
  base: string;
  author: string;
  approver: string;
}
export type PublicationResult =
  | SignedCommit
  | PublishedCommit
  | ProposedPullRequest;
export interface PublicationEffect {
  id: string;
  runId: string;
  kind: PublicationStage;
  fence: number;
  state: "dispatched" | "succeeded" | "failed" | "uncertain";
  startedAt: string;
  finishedAt?: string;
  reason?: "unverified" | "unknown" | "not-applied";
}
export interface PublicationEvidence {
  id: string;
  activeRun?: string;
  mode: "controlled";
  bindingSha256: string;
  repository: string;
  defaultBranch: string;
  branch: string;
  sourceRevision: string;
  candidateSha256: string;
  treeSha1: string;
  policySha256: string;
  validationOperationId: string;
  publicationLogin: string;
  appLogin: string;
  approver: string;
  outcome: "pending" | "blocked" | "uncertain" | "published";
  effects: PublicationEffect[];
  signingKeySha256?: string;
  appKeySha256?: string;
  commit?: string;
  localSignature?: SignedCommit;
  remoteSignature?: PublishedCommit;
  pullRequest?: ProposedPullRequest;
}
export interface PublicationAuthority {
  repository: string;
  publicationLogin: string;
  appLogin: string;
  approver: string;
  eligibleApprovers: string[];
  signingAvailable: boolean;
  publicationAllowed: boolean;
  appPermissions: string[];
  signingKeySha256: string;
  appKeySha256: string;
}
export interface PublicationRequest {
  publication: PublicationEvidence;
  effect: PublicationEffect;
  files: { path: string; bytes: Buffer; executable: boolean }[];
  mayDispatch(): boolean;
}
/** Credential-bearing trusted host boundary. No native implementation is installed.
 * sign uses sanitized trusted Git configuration; push uses the configured Git
 * identity; createPullRequest uses only repository-scoped App PR authority.
 * Reconciliation is read-only. An absent result must also prove no late acceptance
 * is possible before another operation may be proposed. No human review API exists. */
export interface PublicationRuntime {
  readonly mode: "controlled";
  readonly bindingSha256: string;
  inspect(): Promise<PublicationAuthority>;
  sign(request: PublicationRequest): Promise<SignedCommit>;
  push(request: PublicationRequest): Promise<PublishedCommit>;
  createPullRequest(request: PublicationRequest): Promise<ProposedPullRequest>;
  reconcile(
    request: Omit<PublicationRequest, "files" | "mayDispatch">,
  ): Promise<
    | { state: "found"; result: PublicationResult }
    | { state: "absent"; quiescent: boolean }
    | { state: "unknown" }
  >;
}
export interface PublicationInput {
  repository: string;
  defaultBranch: string;
  branch: string;
  sourceRevision: string;
  candidateSha256: string;
  policySha256: string;
  validationOperationId: string;
  publicationLogin: string;
  appLogin: string;
  approver: string;
  files: PublicationRequest["files"];
}
export interface PublicationHost {
  status(): Delivery;
  change(update: (delivery: Delivery) => void): Delivery;
  input(delivery?: Delivery): PublicationInput;
  qualified(): Promise<boolean>;
  observe<T>(promise: Promise<T>): Promise<T | undefined>;
}
const hash = (s: unknown): s is string =>
  typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
const oid = (s: unknown): s is string =>
  typeof s === "string" && /^[a-f0-9]{40}$/.test(s);

/** Git's SHA-1 tree identity, calculated from admitted bytes without a checkout,
 * attributes, filters, hooks, or running candidate code. */
export function publicationTree(files: PublicationRequest["files"]): string {
  interface Tree {
    files: Map<string, { sha: string; executable: boolean }>;
    dirs: Map<string, Tree>;
  }
  const node = (): Tree => ({ files: new Map(), dirs: new Map() });
  const root = node();
  const object = (type: string, data: Buffer) =>
    createHash("sha1")
      .update(type + " " + data.length + "\0")
      .update(data)
      .digest("hex");
  for (const f of files) {
    const parts = f.path.split("/");
    let tree = root;
    for (const part of parts.slice(0, -1)) {
      if (!tree.dirs.has(part)) tree.dirs.set(part, node());
      tree = tree.dirs.get(part)!;
    }
    tree.files.set(parts.at(-1)!, {
      sha: object("blob", f.bytes),
      executable: f.executable,
    });
  }
  const digest = (tree: Tree): string => {
    const entries = [...tree.files]
      .map(([name, f]) => ({
        name,
        sort: name,
        mode: f.executable ? "100755" : "100644",
        sha: f.sha,
      }))
      .concat(
        [...tree.dirs].map(([name, dir]) => ({
          name,
          sort: name + "/",
          mode: "40000",
          sha: digest(dir),
        })),
      );
    entries.sort((a, b) =>
      Buffer.compare(Buffer.from(a.sort), Buffer.from(b.sort)),
    );
    return object(
      "tree",
      Buffer.concat(
        entries.map((e) =>
          Buffer.concat([
            Buffer.from(e.mode + " " + e.name + "\0"),
            Buffer.from(e.sha, "hex"),
          ]),
        ),
      ),
    );
  };
  return digest(root);
}
function authorized(
  a: PublicationAuthority | undefined,
  p: PublicationEvidence,
): boolean {
  return (
    !!a &&
    a.repository === p.repository &&
    a.publicationLogin === p.publicationLogin &&
    a.appLogin === p.appLogin &&
    a.approver === p.approver &&
    a.appLogin !== a.approver &&
    a.eligibleApprovers?.length === 1 &&
    a.eligibleApprovers[0] === p.approver &&
    a.signingAvailable === true &&
    a.publicationAllowed === true &&
    a.appPermissions?.length === 1 &&
    a.appPermissions[0] === "pull_requests:write" &&
    hash(a.signingKeySha256) &&
    hash(a.appKeySha256) &&
    a.signingKeySha256 !== a.appKeySha256 &&
    (!p.signingKeySha256 || p.signingKeySha256 === a.signingKeySha256) &&
    (!p.appKeySha256 || p.appKeySha256 === a.appKeySha256)
  );
}
function matched(input: PublicationInput, p: PublicationEvidence) {
  return (
    (
      [
        "repository",
        "defaultBranch",
        "branch",
        "sourceRevision",
        "candidateSha256",
        "policySha256",
        "validationOperationId",
        "publicationLogin",
        "appLogin",
        "approver",
      ] as const
    ).every((k) => input[k] === p[k]) &&
    publicationTree(input.files) === p.treeSha1
  );
}
function resultEvidence(
  p: PublicationEvidence,
  kind: PublicationStage,
  value: PublicationResult,
): void {
  if (kind === "sign") {
    const v = value as SignedCommit;
    if (
      !oid(v.commit) ||
      v.tree !== p.treeSha1 ||
      v.parent !== p.sourceRevision ||
      v.signer !== p.publicationLogin ||
      v.localVerified !== true
    )
      throw Error("Unverified local signature");
    p.commit = v.commit;
    p.localSignature = {
      commit: v.commit,
      tree: v.tree,
      parent: v.parent,
      signer: v.signer,
      localVerified: true,
    };
  } else if (kind === "push") {
    const v = value as PublishedCommit;
    if (
      v.commit !== p.commit ||
      v.tree !== p.treeSha1 ||
      v.repository !== p.repository ||
      v.branch !== p.branch ||
      v.signer !== p.publicationLogin ||
      v.publisher !== p.publicationLogin ||
      v.githubVerified !== true
    )
      throw Error("Unverified published signature");
    p.remoteSignature = {
      commit: v.commit,
      tree: v.tree,
      repository: v.repository,
      branch: v.branch,
      signer: v.signer,
      publisher: v.publisher,
      githubVerified: true,
    };
  } else {
    const v = value as ProposedPullRequest;
    if (
      !Number.isSafeInteger(v.number) ||
      v.number < 1 ||
      v.repository !== p.repository ||
      v.head !== p.commit ||
      v.branch !== p.branch ||
      v.base !== p.defaultBranch ||
      v.author !== p.appLogin ||
      v.approver !== p.approver ||
      v.author === v.approver
    )
      throw Error("Wrong PR identity");
    p.pullRequest = {
      number: v.number,
      repository: v.repository,
      head: v.head,
      branch: v.branch,
      base: v.base,
      author: v.author,
      approver: v.approver,
    };
    p.outcome = "published";
  }
}
export class PublicationCoordinator {
  constructor(
    private readonly host: PublicationHost,
    private readonly runtime: PublicationRuntime | undefined,
  ) {}
  private binding(p?: PublicationEvidence): PublicationRuntime {
    const r = this.runtime;
    if (
      !r ||
      r.mode !== "controlled" ||
      !hash(r.bindingSha256) ||
      (p && p.bindingSha256 !== r.bindingSha256)
    )
      throw Error(
        "Publication requires the same trusted controlled runtime; native writes remain disabled",
      );
    return r;
  }
  private mayDispatch(
    p: PublicationEvidence,
    effect: PublicationEffect,
  ): boolean {
    try {
      this.binding(p);
      const d = this.host.status(),
        current = d.publication?.effects.find((e) => e.id === effect.id);
      return (
        d.ownership.held &&
        d.ownership.fence === effect.fence &&
        d.phase === "publishing" &&
        d.publication?.activeRun === effect.runId &&
        current?.state === "dispatched" &&
        matched(this.host.input(), p)
      );
    } catch {
      return false;
    }
  }
  async publish(): Promise<Delivery> {
    const r = this.binding(),
      snapshot = this.host.status();
    if (snapshot.publication?.outcome === "published") return snapshot;
    if (
      !snapshot.ownership.held ||
      !["blocked", "preparing"].includes(snapshot.phase)
    )
      throw Error("Resolve publication controls before dispatch");
    const input = this.host.input();
    let p = snapshot.publication;
    if (p) {
      this.binding(p);
      if (
        !matched(input, p) ||
        p.effects.some(
          (e) =>
            e.state === "dispatched" ||
            e.state === "uncertain" ||
            (e.state === "failed" && e.reason !== "not-applied"),
        )
      )
        throw Error("Reconcile publication evidence before dispatch");
    }
    if (!snapshot.publication) {
      const { files, ...identity } = input;
      p = {
        ...identity,
        id: randomUUID(),
        mode: "controlled",
        bindingSha256: r.bindingSha256,
        treeSha1: publicationTree(files),
        outcome: "pending",
        effects: [],
      };
    }
    const authority = await this.host.observe(r.inspect());
    if (!authorized(authority, p!) || !(await this.host.qualified()))
      throw Error("Signing, publication or App authority is unavailable");
    const expected = p!,
      runId = randomUUID();
    expected.signingKeySha256 = authority!.signingKeySha256;
    expected.appKeySha256 = authority!.appKeySha256;
    this.host.change((d) => {
      if (
        d.phase !== snapshot.phase ||
        d.ownership.fence !== snapshot.ownership.fence ||
        !matched(this.host.input(d), expected) ||
        d.publication?.id !== snapshot.publication?.id
      )
        throw Error("Publication authority changed");
      d.publication ??= expected;
      d.publication.activeRun = runId;
      d.phase = "publishing";
    });
    try {
      for (const kind of ["sign", "push", "pr"] as const) {
        p = this.host.status().publication!;
        if (p.activeRun !== runId) break;
        if (p.effects.some((e) => e.kind === kind && e.state === "succeeded"))
          continue;
        if (!["publishing"].includes(this.host.status().phase)) break;
        if (
          !authorized(await this.host.observe(r.inspect()), p) ||
          !(await this.host.qualified())
        )
          break;
        const effect: PublicationEffect = {
          id: randomUUID(),
          runId,
          kind,
          fence: this.host.status().ownership.fence,
          state: "dispatched",
          startedAt: new Date().toISOString(),
        };
        let prepared: Delivery;
        try {
          prepared = this.host.change((d) => {
            if (
              d.phase !== "publishing" ||
              d.publication?.activeRun !== runId ||
              !d.ownership.held ||
              !matched(this.host.input(d), p!) ||
              d.publication?.id !== p!.id ||
              d.publication.effects.some(
                (e) => e.state === "dispatched" || e.state === "uncertain",
              )
            )
              throw Error("Publication dispatch changed");
            d.publication.effects.push(effect);
          });
        } catch {
          break;
        }
        const request: PublicationRequest = {
          publication: structuredClone(prepared.publication!),
          effect: structuredClone(effect),
          files: this.host.input().files,
          mayDispatch: () => this.mayDispatch(prepared.publication!, effect),
        };
        let value: PublicationResult | undefined;
        try {
          if (request.mayDispatch())
            value = await this.host.observe<PublicationResult>(
              kind === "sign"
                ? r.sign(request)
                : kind === "push"
                  ? r.push(request)
                  : r.createPullRequest(request),
            );
        } catch {}
        const recorded = this.record(effect, value);
        if (
          recorded.publication!.effects.find((e) => e.id === effect.id)!
            .state !== "succeeded"
        )
          break;
      }
    } catch {
      /* Retain durable intent; no retry after unknown acceptance. */
    }
    return this.host.change((d) => {
      if (d.publication?.activeRun !== runId) return;
      delete d.publication.activeRun;
      if (d.phase === "publishing") d.phase = "blocked";
      d.blocker.nextAction =
        d.publication?.outcome === "published"
          ? "Observe required hosted checks and independent owner review; publication is not delivery completion."
          : "Preserve publication evidence and reconcile uncertain effects before further dispatch.";
    });
  }
  private record(
    effect: PublicationEffect,
    value: PublicationResult | undefined,
  ): Delivery {
    return this.host.change((d) => {
      const p = d.publication,
        e = p?.effects.find((e) => e.id === effect.id);
      if (!p || !e || !["dispatched", "uncertain"].includes(e.state)) return;
      if (!value) {
        e.state = "uncertain";
        e.reason = "unknown";
        p.outcome = "uncertain";
        return;
      }
      try {
        resultEvidence(p, e.kind, value);
        e.state = "succeeded";
        e.finishedAt = new Date().toISOString();
        delete e.reason;
        if (p.outcome !== "published") p.outcome = "pending";
      } catch {
        e.state = "failed";
        e.reason = "unverified";
        p.outcome = "blocked";
      }
    });
  }
  async reconcile(): Promise<Delivery> {
    const snapshot = this.host.status(),
      p = snapshot.publication;
    if (!p) throw Error("No publication operation to reconcile");
    const r = this.binding(p),
      effect = p.effects.find(
        (e) => e.state === "dispatched" || e.state === "uncertain",
      );
    this.host.change((d) => {
      if (d.publication?.activeRun === p.activeRun) {
        delete d.publication!.activeRun;
        if (d.phase === "publishing") d.phase = "blocked";
      }
    });
    if (!effect) return this.host.status();
    let observation:
      | Awaited<ReturnType<PublicationRuntime["reconcile"]>>
      | undefined;
    try {
      if (authorized(await this.host.observe(r.inspect()), p))
        observation = await this.host.observe(
          r.reconcile({
            publication: structuredClone(p),
            effect: structuredClone(effect),
          }),
        );
    } catch {}
    if (observation?.state === "found") this.record(effect, observation.result);
    else
      this.host.change((d) => {
        const current = d.publication!,
          e = current.effects.find((e) => e.id === effect.id)!;
        if (!["dispatched", "uncertain"].includes(e.state)) return;
        if (observation?.state === "absent" && observation.quiescent === true) {
          e.state = "failed";
          e.reason = "not-applied";
          e.finishedAt = new Date().toISOString();
          current.outcome = "pending";
        } else {
          e.state = "uncertain";
          e.reason = "unknown";
          current.outcome = "uncertain";
        }
      });
    return this.host.status();
  }
}
