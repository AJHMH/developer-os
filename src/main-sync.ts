import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import type { Delivery } from "./controller.js";

/** Required at the trusted Git boundary; repository config/environment may not
 * select hooks, filters, helpers or transports. Native ports are not installed. */
export const mainSyncControls = Object.freeze({
  hooks: false,
  filters: false,
  includes: false,
  candidateEnvironment: false,
  stash: false,
  reset: false,
  rebase: false,
  forcePush: false,
  fastForwardOnly: true,
} as const);
export interface MainSyncTarget {
  repository: string;
  checkout: string;
  branch: string;
  revision: string;
  policySha256: string;
  mergeOperationId: string;
}
export interface MainSyncObservation {
  repository: string;
  checkout: string;
  branch: string;
  remoteMain: string;
  localMain: string;
  currentBranch: string;
  head: string;
  clean: boolean;
  fastForward: boolean;
  mainCheckedOutElsewhere: boolean;
  complete: boolean;
  /** Exact operation is stopped and cannot later modify the checkout. */
  quiescent: boolean;
}
/** Controlled authority port. Observe fetches current refs through a pinned
 * transport and independently verifies canonical checkout/repository identity.
 * synchronize must hold exclusive checkout/ref authority, recheck ALL expected
 * fields and mayDispatch immediately before effects, and refuse unsupported race
 * control. Never trust a client-side check as a remote/ref CAS. An observation
 * naming an operation must independently establish its quiescence. */
export interface MainSyncRuntime {
  readonly mode: "controlled";
  readonly bindingSha256: string;
  observe(
    target: MainSyncTarget & { operationId?: string },
  ): Promise<MainSyncObservation>;
  synchronize(
    request: MainSyncTarget & {
      operationId: string;
      expected: MainSyncObservation;
      controls: typeof mainSyncControls;
      mayDispatch(): boolean;
    },
  ): Promise<void>;
}
export interface MainSyncAttempt extends MainSyncTarget {
  operationId: string;
  fence: number;
  bindingSha256: string;
  from: string;
  activeObservation?: string;
  state: "dispatched" | "uncertain" | "aligned" | "blocked";
  reason: "pending" | "aligned" | "unsafe" | "main-advanced" | "unavailable";
}
export interface MainSyncEvidence {
  attempts: MainSyncAttempt[];
}
export function pendingMainSync(d: Delivery): boolean {
  const a = d.mainSync?.attempts.at(-1);
  return a?.state === "dispatched" || a?.state === "uncertain";
}
interface Host {
  status(): Delivery;
  change(update: (d: Delivery) => void): Delivery;
  input(): MainSyncTarget;
  observe<T>(p: Promise<T>): Promise<T | undefined>;
}
const oid = (s: unknown): s is string =>
  typeof s === "string" && /^[a-f0-9]{40}$/.test(s);
function samePath(a: string, b: string): boolean {
  try {
    const canonical = (s: string) => {
      const p = realpathSync.native(s);
      return process.platform === "win32" ? p.toLowerCase() : p;
    };
    return canonical(a) === canonical(b);
  } catch {
    return false;
  }
}
function identity(
  o: MainSyncObservation | undefined,
  t: MainSyncTarget,
): o is MainSyncObservation {
  return Boolean(
    o &&
      o.complete === true &&
      o.repository === t.repository &&
      o.branch === t.branch &&
      samePath(o.checkout, t.checkout) &&
      oid(o.remoteMain) &&
      oid(o.localMain) &&
      oid(o.head) &&
      typeof o.currentBranch === "string" &&
      o.currentBranch.length > 0 &&
      o.currentBranch.length <= 256 &&
      typeof o.clean === "boolean" &&
      typeof o.fastForward === "boolean" &&
      typeof o.mainCheckedOutElsewhere === "boolean" &&
      typeof o.quiescent === "boolean",
  );
}
function safe(o: MainSyncObservation): boolean {
  return o.clean && o.quiescent && !o.mainCheckedOutElsewhere && o.fastForward;
}
export class MainSyncCoordinator {
  constructor(
    private host: Host,
    private runtime?: MainSyncRuntime,
  ) {}
  private runtimeFor(binding?: string) {
    const r = this.runtime;
    if (
      !r ||
      r.mode !== "controlled" ||
      !/^[a-f0-9]{64}$/.test(r.bindingSha256) ||
      (binding && binding !== r.bindingSha256)
    )
      throw Error("Qualified synchronization adapter required");
    return r;
  }
  private block(
    reason: MainSyncAttempt["reason"],
    attempt?: string,
    observation?: string,
  ): Delivery {
    return this.host.change((d) => {
      const a = d.mainSync?.attempts.at(-1);
      if (
        attempt &&
        (a?.operationId !== attempt ||
          (observation && a.activeObservation !== observation))
      )
        return;
      if (a && observation) delete a.activeObservation;
      if (a && attempt) {
        a.state = reason === "unavailable" ? "uncertain" : "blocked";
        a.reason = reason;
      }
      if (reason === "main-advanced" && d.mainChecks)
        d.mainChecks.outcome = "unavailable";
      if (!["paused", "cancelled"].includes(d.phase)) d.phase = "blocked";
      d.blocker.nextAction =
        reason === "main-advanced"
          ? "Remote main advanced. Verify current main checks before synchronizing; preserve all work."
          : "Preserve local work and history. Reconcile synchronization and resolve checkout/ref/authority blockers; no stash, reset or rewrite. Cleanup remains disabled.";
    });
  }
  async sync(): Promise<Delivery> {
    const snapshot = this.host.status();
    if (pendingMainSync(snapshot)) return this.reconcile();
    const t = this.host.input(),
      r = this.runtimeFor(),
      binding = r.bindingSha256;
    if (
      !snapshot.ownership.held ||
      ["paused", "cancelled"].includes(snapshot.phase)
    )
      throw Error("Synchronization fenced");
    let o: MainSyncObservation | undefined;
    try {
      o = await this.host.observe(r.observe(t));
    } catch {
      /* no effect */
    }
    if (r.bindingSha256 !== binding || !identity(o, t))
      return this.block("unsafe");
    if (o.remoteMain !== t.revision) return this.block("main-advanced");
    if (!safe(o)) return this.block("unsafe");
    const operationId = randomUUID();
    const allowed = () => {
      try {
        const d = this.host.status(),
          current = this.host.input();
        return (
          d.ownership.held &&
          d.ownership.fence === snapshot.ownership.fence &&
          !["paused", "cancelled"].includes(d.phase) &&
          r.bindingSha256 === binding &&
          JSON.stringify(current) === JSON.stringify(t)
        );
      } catch {
        return false;
      }
    };
    if (!allowed()) return this.block("unsafe");
    this.host.change((d) => {
      if (
        !d.ownership.held ||
        d.ownership.fence !== snapshot.ownership.fence ||
        ["paused", "cancelled"].includes(d.phase) ||
        pendingMainSync(d) ||
        d.mainChecks?.outcome !== "passed" ||
        d.mainChecks.revision !== t.revision ||
        d.authorityPolicySha256 !== t.policySha256
      )
        throw Error("Synchronization fenced");
      (d.mainSync ??= { attempts: [] }).attempts.push({
        ...t,
        operationId,
        fence: d.ownership.fence,
        bindingSha256: binding,
        from: o.localMain,
        state: "dispatched",
        reason: "pending",
      });
      d.phase = "synchronizing-main";
    });
    const mayDispatch = () =>
      allowed() &&
      this.host.status().mainSync?.attempts.at(-1)?.operationId ===
        operationId &&
      this.host.status().mainSync?.attempts.at(-1)?.state === "dispatched";
    try {
      await this.host.observe(
        r.synchronize({
          ...t,
          operationId,
          expected: o,
          controls: mainSyncControls,
          mayDispatch,
        }),
      );
    } catch {
      /* reconcile actual state, never retry an uncertain effect */
    }
    return this.reconcile();
  }
  async reconcile(): Promise<Delivery> {
    const a = this.host.status().mainSync?.attempts.at(-1);
    if (!a) throw Error("No synchronization to reconcile");
    const r = this.runtimeFor(a.bindingSha256),
      token = randomUUID();
    this.host.change((d) => {
      const saved = d.mainSync?.attempts.at(-1);
      if (saved?.operationId !== a.operationId)
        throw Error("Synchronization changed");
      saved.activeObservation = token;
      if (saved.state === "dispatched") saved.state = "uncertain";
    });
    let o: MainSyncObservation | undefined;
    try {
      o = await this.host.observe(
        r.observe({ ...a, operationId: a.operationId }),
      );
    } catch {
      /* uncertainty remains durable */
    }
    if (!identity(o, a) || !o.quiescent)
      return this.block("unavailable", a.operationId, token);
    // Quiescence is recorded before re-evaluating authorization. A stopped effect
    // with revoked authority must not remain dispatchable or count as alignment.
    let t: MainSyncTarget | undefined;
    try {
      t = this.host.input();
    } catch {
      /* gate revoked */
    }
    if (o.remoteMain !== a.revision)
      return this.block("main-advanced", a.operationId, token);
    const d = this.host.status();
    if (
      !t ||
      JSON.stringify(t) !==
        JSON.stringify({
          repository: a.repository,
          checkout: a.checkout,
          branch: a.branch,
          revision: a.revision,
          policySha256: a.policySha256,
          mergeOperationId: a.mergeOperationId,
        }) ||
      !d.ownership.held ||
      d.ownership.fence !== a.fence ||
      r.bindingSha256 !== a.bindingSha256 ||
      !safe(o) ||
      o.localMain !== a.revision ||
      o.head !== a.revision ||
      o.currentBranch !== a.branch
    )
      return this.block("unsafe", a.operationId, token);
    return this.host.change((current) => {
      const saved = current.mainSync?.attempts.at(-1);
      if (
        saved?.operationId !== a.operationId ||
        saved.activeObservation !== token
      )
        return;
      delete saved.activeObservation;
      saved.state = "aligned";
      saved.reason = "aligned";
      if (!["paused", "cancelled"].includes(current.phase))
        current.phase = "main-synchronized";
      current.blocker.nextAction =
        "Local and remote main aligned at the recorded verified revision. Eligible cleanup (ticket 14) and native qualification remain required; delivery is not complete.";
    });
  }
}
