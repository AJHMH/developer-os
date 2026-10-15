import { randomUUID } from "node:crypto";
import type { Delivery } from "./controller.js";
import type { PublicationEvidence } from "./publication.js";

export interface MergeObservation {
  repository: string;
  number: number;
  head: string;
  base: string;
  baseRevision: string;
  policySha256: string;
  complete: boolean;
  state: "open" | "closed";
  actor: string;
  mergeAllowed: boolean;
  protectionsEnforced: boolean;
  conditionalHead: boolean;
  conditionalBase: boolean;
  gatesEnforced: boolean;
}
export interface MergeAttempt {
  operationId: string;
  publicationId: string;
  bindingSha256: string;
  policySha256: string;
  repository: string;
  number: number;
  head: string;
  base: string;
  baseRevision: string;
  fence: number;
  state:
    | "checking"
    | "blocked"
    | "dispatched"
    | "uncertain"
    | "not-applied"
    | "merged";
  mergeCommit?: string;
  mainRevision?: string;
  advancedBase?: string;
}
export interface MergeEvidence {
  attempts: MergeAttempt[];
  refresh?: { publicationId: string; from: string; to: string };
}
export type MergeReceipt =
  | {
      operationId: string;
      state: "merged";
      head: string;
      baseRevision: string;
      mergeCommit: string;
      mainRevision: string;
      reachable: boolean;
    }
  | { operationId: string; state: "absent"; quiescent: boolean }
  | { state: "unknown" };
/** Trusted host boundary. Merge must enforce the exact head AND base, current
 * effective protections, trusted checks, owner review and conversations at the
 * remote effect boundary without bypass. Unsupported atomic semantics refuse.
 * The configured owner merge identity is isolated from worker/App PR authority.
 * Reconcile verifies PR/head/merge linkage and reachability on observed main;
 * absence proves quiescence of every dispatch for this stable operation ID.
 * No native adapter is enabled. */
export interface MergeRuntime {
  readonly mode: "controlled";
  readonly bindingSha256: string;
  observe(request: {
    repository: string;
    number: number;
    head: string;
  }): Promise<MergeObservation>;
  merge(
    request: MergeAttempt & { mayDispatch(): boolean },
  ): Promise<MergeReceipt>;
  reconcile(request: MergeAttempt): Promise<MergeReceipt>;
}
export function mergePending(d: Delivery): boolean {
  return !!d.merge?.attempts.some((a) =>
    ["checking", "dispatched", "uncertain"].includes(a.state),
  );
}
export function mergeSealed(d: Delivery): boolean {
  return (
    mergePending(d) || !!d.merge?.attempts.some((a) => a.state === "merged")
  );
}
interface MergeHost {
  status(): Delivery;
  change(update: (d: Delivery) => void): Delivery;
  input(d?: Delivery): PublicationEvidence;
  refresh(): Promise<void>;
  ready(d: Delivery): boolean;
  observe<T>(promise: Promise<T>): Promise<T | undefined>;
}
const sha = (s: unknown): s is string =>
  typeof s === "string" && /^[a-f0-9]{40}$/.test(s);
export class MergeCoordinator {
  constructor(
    private host: MergeHost,
    private runtime?: MergeRuntime,
  ) {}
  private binding(a?: MergeAttempt) {
    const r = this.runtime;
    if (
      !r ||
      r.mode !== "controlled" ||
      !/^[a-f0-9]{64}$/.test(r.bindingSha256) ||
      (a && a.bindingSha256 !== r.bindingSha256)
    )
      throw Error("Unqualified merge binding");
    return r;
  }
  async merge(): Promise<Delivery> {
    const snapshot = this.host.status();
    if (snapshot.merge?.attempts.some((a) => a.state === "merged"))
      return snapshot;
    if (mergePending(snapshot)) return this.reconcile();
    if (
      !snapshot.ownership.held ||
      ["paused", "cancelled"].includes(snapshot.phase)
    )
      throw Error("Merge stopped");
    const p = this.host.input(snapshot),
      runtime = this.binding();
    const attempt: MergeAttempt = {
      operationId: randomUUID(),
      publicationId: p.id,
      bindingSha256: runtime.bindingSha256,
      policySha256: p.policySha256,
      repository: p.repository,
      number: p.pullRequest!.number,
      head: p.commit!,
      base: p.defaultBranch,
      baseRevision: p.sourceRevision,
      fence: snapshot.ownership.fence,
      state: "checking",
    };
    this.host.change((d) => {
      if (
        mergeSealed(d) ||
        d.publication?.id !== p.id ||
        d.ownership.fence !== attempt.fence ||
        d.phase !== snapshot.phase
      )
        throw Error("Merge generation changed");
      (d.merge ??= { attempts: [] }).attempts.push(attempt);
    });
    try {
      await this.host.refresh();
      if (!this.host.ready(this.host.status()))
        throw Error("Fresh gates failed");
      const o = await this.host.observe(runtime.observe(attempt));
      this.binding(attempt);
      this.host.input();
      if (
        !o ||
        o.complete !== true ||
        o.repository !== p.repository ||
        o.number !== attempt.number ||
        o.head !== attempt.head ||
        o.base !== attempt.base ||
        o.policySha256 !== attempt.policySha256 ||
        o.actor !== p.publicationLogin ||
        o.state !== "open" ||
        o.mergeAllowed !== true ||
        o.protectionsEnforced !== true ||
        o.conditionalHead !== true ||
        o.conditionalBase !== true ||
        o.gatesEnforced !== true ||
        !sha(o.baseRevision)
      )
        throw Error("Remote merge authority unavailable");
      if (o.baseRevision !== attempt.baseRevision) {
        this.host.change((d) => {
          const current = d.merge?.attempts.at(-1);
          if (
            current?.operationId === attempt.operationId &&
            current.state === "checking"
          )
            current.advancedBase = o.baseRevision;
        });
        throw Error("Main advanced");
      }
      this.host.change((d) => {
        const a = d.merge!.attempts.at(-1)!;
        if (
          a.operationId !== attempt.operationId ||
          a.state !== "checking" ||
          !this.allowed(d, attempt)
        )
          throw Error("Merge fenced");
        a.state = "dispatched";
      });
    } catch {
      return this.host.change((d) => {
        const a = d.merge!.attempts.find(
          (a) => a.operationId === attempt.operationId,
        )!;
        if (
          a.state !== "checking" ||
          d.merge?.attempts.at(-1)?.operationId !== attempt.operationId
        )
          return;
        a.state = "blocked";
        if (!["paused", "cancelled"].includes(d.phase)) d.phase = "blocked";
        d.blocker.nextAction = a.advancedBase
          ? "Main advanced; refresh the candidate against verified main within remaining repair allowance, revalidate and obtain renewed owner approval."
          : "Merge blocked; restore exact-head checks, owner review, protections, permissions and supported conditional merge authority.";
      });
    }
    let receipt: MergeReceipt | undefined;
    try {
      const mayDispatch = () => {
        try {
          this.binding(attempt);
          return (
            this.allowed(this.host.status(), attempt) &&
            this.host.status().merge?.attempts.at(-1)?.state === "dispatched"
          );
        } catch {
          return false;
        }
      };
      if (!mayDispatch()) throw Error("Merge fenced");
      receipt = await this.host.observe(
        runtime.merge({ ...attempt, state: "dispatched", mayDispatch }),
      );
    } catch {}
    return this.record(attempt, receipt);
  }
  private allowed(d: Delivery, a: MergeAttempt): boolean {
    return (
      d.ownership.held &&
      d.ownership.fence === a.fence &&
      !["paused", "cancelled"].includes(d.phase) &&
      this.host.input(d).id === a.publicationId &&
      this.host.ready(d) &&
      d.merge?.attempts.at(-1)?.operationId === a.operationId
    );
  }
  private record(a: MergeAttempt, receipt?: MergeReceipt): Delivery {
    return this.host.change((d) => {
      const current = d.merge?.attempts.find(
        (x) => x.operationId === a.operationId,
      );
      if (!current || !["dispatched", "uncertain"].includes(current.state))
        return;
      if (
        receipt?.state === "merged" &&
        receipt.operationId === a.operationId &&
        receipt.head === a.head &&
        receipt.baseRevision === a.baseRevision &&
        sha(receipt.mergeCommit) &&
        sha(receipt.mainRevision) &&
        receipt.reachable === true
      ) {
        current.state = "merged";
        current.mergeCommit = receipt.mergeCommit;
        current.mainRevision = receipt.mainRevision;
      } else if (
        receipt?.state === "absent" &&
        receipt.operationId === a.operationId &&
        receipt.quiescent === true
      )
        current.state = "not-applied";
      else current.state = "uncertain";
      if (!["paused", "cancelled"].includes(d.phase))
        d.phase = current.state === "merged" ? "merged" : "blocked";
      d.blocker.nextAction =
        current.state === "merged"
          ? "Verify main checks, synchronize main and complete eligible cleanup; merge alone is not delivery completion."
          : "Reconcile the retained merge operation; do not repeat an uncertain write. Fresh gates are required after proven absence.";
    });
  }
  async reconcile(): Promise<Delivery> {
    const d = this.host.status(),
      a = d.merge?.attempts.at(-1);
    if (!a) throw Error("No merge intent");
    if (a.state === "checking")
      return this.host.change((current) => {
        const saved = current.merge!.attempts.at(-1)!;
        if (saved.operationId !== a.operationId || saved.state !== "checking")
          return;
        saved.state = "blocked";
        if (!["paused", "cancelled"].includes(current.phase))
          current.phase = "blocked";
        current.blocker.nextAction =
          "Interrupted before merge dispatch; recheck all gates before a new attempt.";
      });
    if (!["dispatched", "uncertain"].includes(a.state)) return d;
    const runtime = this.binding(a);
    let receipt: MergeReceipt | undefined;
    try {
      receipt = await this.host.observe(runtime.reconcile(structuredClone(a)));
      this.binding(a);
    } catch {
      receipt = undefined;
    }
    return this.record(a, receipt);
  }
}
