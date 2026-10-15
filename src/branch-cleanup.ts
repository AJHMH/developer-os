import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { redact } from "./redaction.js";
import { sha256 } from "./offline-canary.js";
import type { Delivery } from "./controller.js";
import type { MainSyncTarget } from "./main-sync.js";

export interface BranchFact {
  name: string;
  location: "local" | "remote";
  tip: string;
  protected: boolean;
  replayRetained: boolean;
  activeWorktree: boolean;
  ancestry: "merged" | "unmerged" | "unknown";
  conditionalDelete: boolean;
  linkage?: {
    repository: string;
    base: string;
    head: string;
    mergeCommit: string;
    merged: boolean;
    reachable: boolean;
    complete: boolean;
  };
}
export interface BranchInventory {
  repository: string;
  checkout: string;
  branch: string;
  revision: string;
  policySha256: string;
  complete: boolean;
  quiescent: boolean;
  branches: BranchFact[];
}
export const branchCleanupControls = Object.freeze({
  expectedTipRequired: true,
  recheckPolicy: true,
  recheckWorktrees: true,
  deleteUnmerged: false,
  migrateReplayEvidence: false,
  hooks: false,
  candidateConfiguration: false,
  candidateEnvironment: false,
} as const);
/** Trusted controlled boundary, never configured by a repository. Inventory
 * covers ALL local and remote branch tips, effective protected/replay/worktree
 * exclusions and independently measured integration into the exact target main.
 * remove must recheck identity/main/policy/exclusions under exclusive authority,
 * condition deletion on the exact tip at acceptance, and call mayDispatch there.
 * Unsupported conditional authority refuses. Operation observations must prove
 * the exact effect quiescent (including delayed senders), not just ref absence. */
export interface BranchCleanupRuntime {
  readonly mode: "controlled";
  readonly bindingSha256: string;
  observe(
    target: MainSyncTarget & { operationId?: string },
  ): Promise<BranchInventory>;
  remove(
    request: MainSyncTarget & {
      operationId: string;
      name: string;
      location: BranchFact["location"];
      expectedTip: string;
      controls: typeof branchCleanupControls;
      mayDispatch(): boolean;
    },
  ): Promise<void>;
}
export interface CleanupEntry {
  fact: BranchFact;
  decision: "eligible" | "retained" | "blocked";
  reason: string;
  decisionReason: string;
  evidenceSha256: string;
  state:
    | "eligible"
    | "retained"
    | "blocked"
    | "dispatched"
    | "uncertain"
    | "deleted";
  operationId?: string;
}
export interface CleanupRound {
  id: string;
  target: MainSyncTarget;
  bindingSha256: string;
  fence: number;
  activeObservation?: string;
  executionId?: string;
  state: "planned" | "blocked" | "completed";
  entries: CleanupEntry[];
}
export interface BranchCleanupEvidence {
  mode: "controlled";
  productionEnabled: false;
  rounds: CleanupRound[];
}
export function pendingCleanup(d: Delivery): boolean {
  return Boolean(
    d.cleanup?.rounds.some((r) =>
      r.entries.some((e) => ["dispatched", "uncertain"].includes(e.state)),
    ),
  );
}
interface Host {
  status(): Delivery;
  change(update: (d: Delivery) => void): Delivery;
  input(): MainSyncTarget;
  refresh(): Promise<void>;
  observe<T>(p: Promise<T>): Promise<T | undefined>;
}
const oid = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{40}$/.test(v);
function branchName(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.length > 0 &&
    v.length <= 240 &&
    !/[\s\u0000-\u001f\u007f~^:?*\[\\]/.test(v) &&
    !v.includes("..") &&
    !v.includes("@{") &&
    v !== "@" &&
    !v.startsWith("-") &&
    v
      .split("/")
      .every(
        (p) =>
          p && !p.startsWith(".") && !p.endsWith(".") && !p.endsWith(".lock"),
      ) &&
    redact(v) === v
  );
}
function validInventory(
  o: BranchInventory | undefined,
  t: MainSyncTarget,
  outcomeOnly = false,
): o is BranchInventory {
  try {
    if (
      !o ||
      o.complete !== true ||
      o.repository !== t.repository ||
      o.branch !== t.branch ||
      !oid(o.revision) ||
      !/^[a-f0-9]{64}$/.test(o.policySha256) ||
      (!outcomeOnly &&
        (o.revision !== t.revision || o.policySha256 !== t.policySha256)) ||
      typeof o.quiescent !== "boolean" ||
      !Array.isArray(o.branches) ||
      o.branches.length > 10000
    )
      return false;
    const path = (s: string) =>
      process.platform === "win32"
        ? realpathSync.native(s).toLowerCase()
        : realpathSync.native(s);
    if (path(o.checkout) !== path(t.checkout)) return false;
    const keys = new Set<string>();
    for (const f of o.branches) {
      const key = `${f.location}:${f.name.normalize("NFC").toLowerCase()}`;
      if (
        !branchName(f.name) ||
        !["local", "remote"].includes(f.location) ||
        !oid(f.tip) ||
        keys.has(key) ||
        ![
          f.protected,
          f.replayRetained,
          f.activeWorktree,
          f.conditionalDelete,
        ].every((v) => typeof v === "boolean") ||
        !["merged", "unmerged", "unknown"].includes(f.ancestry)
      )
        return false;
      keys.add(key);
    }
    const localMain = o.branches.find(
        (f) => f.location === "local" && f.name === t.branch,
      ),
      remoteMain = o.branches.find(
        (f) => f.location === "remote" && f.name === t.branch,
      );
    if (
      !localMain ||
      !remoteMain ||
      remoteMain.tip !== o.revision ||
      (!outcomeOnly && localMain.tip !== t.revision)
    )
      return false;
    return true;
  } catch {
    return false;
  }
}
function decide(
  f: BranchFact,
  t: MainSyncTarget,
): Pick<CleanupEntry, "decision" | "reason"> {
  for (const [flag, reason] of [
    [f.protected, "protected"],
    [f.replayRetained, "replay-retained"],
    [f.activeWorktree, "active-worktree"],
  ] as const)
    if (flag) return { decision: "retained", reason };
  let integrated = f.ancestry === "merged";
  if (!integrated && f.linkage) {
    const p = f.linkage;
    if (
      p.complete !== true ||
      p.repository !== t.repository ||
      p.base !== t.branch ||
      p.merged !== true ||
      p.reachable !== true ||
      !oid(p.head) ||
      !oid(p.mergeCommit)
    )
      return { decision: "blocked", reason: "ambiguous-merge-linkage" };
    if (p.head !== f.tip) return { decision: "retained", reason: "newer-tip" };
    integrated = true;
  }
  if (!integrated)
    return f.ancestry === "unknown"
      ? { decision: "blocked", reason: "integration-unknown" }
      : { decision: "retained", reason: "unmerged" };
  return f.conditionalDelete
    ? { decision: "eligible", reason: "integrated" }
    : { decision: "blocked", reason: "conditional-delete-unavailable" };
}
function entry(f: BranchFact, t: MainSyncTarget): CleanupEntry {
  // Persist a bounded projection, never raw transport messages or arbitrary PR text.
  const fact: BranchFact = {
    name: f.name,
    location: f.location,
    tip: f.tip,
    protected: f.protected,
    replayRetained: f.replayRetained,
    activeWorktree: f.activeWorktree,
    ancestry: f.ancestry,
    conditionalDelete: f.conditionalDelete,
  };
  if (f.linkage)
    fact.linkage = {
      repository:
        f.linkage.repository === t.repository ? t.repository : "mismatch",
      base: f.linkage.base === t.branch ? t.branch : "mismatch",
      head: oid(f.linkage.head) ? f.linkage.head : "invalid",
      mergeCommit: oid(f.linkage.mergeCommit)
        ? f.linkage.mergeCommit
        : "invalid",
      merged: f.linkage.merged === true,
      reachable: f.linkage.reachable === true,
      complete: f.linkage.complete === true,
    };
  const d = decide(fact, t);
  return {
    fact,
    ...d,
    state: d.decision,
    decisionReason: d.reason,
    evidenceSha256: sha256(JSON.stringify({ fact, target: t, ...d })),
  };
}
const sameTarget = (a: MainSyncTarget, b: MainSyncTarget) =>
  a.repository === b.repository &&
  a.checkout === b.checkout &&
  a.branch === b.branch &&
  a.revision === b.revision &&
  a.policySha256 === b.policySha256 &&
  a.mergeOperationId === b.mergeOperationId;
export class BranchCleanupCoordinator {
  constructor(
    private host: Host,
    private runtime?: BranchCleanupRuntime,
  ) {}
  private runtimeFor(binding?: string) {
    const r = this.runtime;
    if (
      !r ||
      r.mode !== "controlled" ||
      !/^[a-f0-9]{64}$/.test(r.bindingSha256) ||
      (binding && binding !== r.bindingSha256)
    )
      throw Error("Qualified cleanup adapter required");
    return r;
  }
  private allowed(round: CleanupRound): boolean {
    try {
      const d = this.host.status();
      return (
        d.ownership.held &&
        d.ownership.fence === round.fence &&
        !["paused", "cancelled"].includes(d.phase) &&
        this.runtime?.bindingSha256 === round.bindingSha256 &&
        sameTarget(this.host.input(), round.target) &&
        d.cleanup?.rounds.at(-1)?.id === round.id &&
        d.cleanup.rounds.at(-1)?.executionId === round.executionId
      );
    } catch {
      return false;
    }
  }
  private block(roundId?: string, token?: string): Delivery {
    return this.host.change((d) => {
      const current = d.cleanup?.rounds.at(-1);
      if (
        roundId &&
        (current?.id !== roundId ||
          (token && current.activeObservation !== token))
      )
        return;
      if (current && token) delete current.activeObservation;
      if (!["paused", "cancelled"].includes(d.phase)) d.phase = "blocked";
      const round = d.cleanup?.rounds.at(-1);
      if (round) {
        round.state = "blocked";
        delete round.executionId;
      }
      d.blocker.nextAction =
        "Cleanup incomplete. Preserve retained/newer tips and all evidence; reconcile uncertain deletions and resolve inventory, authority or main-alignment blockers before an explicit fresh cleanup attempt. Production remains disabled.";
    });
  }
  async run(): Promise<Delivery> {
    if (pendingCleanup(this.host.status())) return this.reconcile();
    const t = this.host.input(),
      r = this.runtimeFor(),
      binding = r.bindingSha256;
    const snapshot = this.host.status();
    if (
      !snapshot.ownership.held ||
      ["paused", "cancelled"].includes(snapshot.phase)
    )
      throw Error("Cleanup fenced");
    let o: BranchInventory | undefined;
    try {
      o = await this.host.observe(r.observe(t));
    } catch {
      /* no deletion */
    }
    if (!validInventory(o, t) || !o.quiescent || r.bindingSha256 !== binding)
      return this.block();
    const round: CleanupRound = {
      id: randomUUID(),
      executionId: randomUUID(),
      target: t,
      bindingSha256: binding,
      fence: snapshot.ownership.fence,
      state: "planned",
      entries: o.branches
        .filter((f) => f.name !== t.branch)
        .map((f) => entry(f, t)),
    };
    if (!sameTarget(this.host.input(), t)) return this.block();
    this.host.change((d) => {
      if (
        !d.ownership.held ||
        d.ownership.fence !== round.fence ||
        ["paused", "cancelled"].includes(d.phase) ||
        pendingCleanup(d)
      )
        throw Error("Cleanup fenced");
      (d.cleanup ??= {
        mode: "controlled",
        productionEnabled: false,
        rounds: [],
      }).rounds.push(round);
      d.phase = "cleaning-branches";
    });
    if (round.entries.some((e) => e.decision === "blocked"))
      return this.block();
    for (const e of round.entries.filter((e) => e.decision === "eligible")) {
      if (!this.allowed(round)) return this.block(round.id);
      const operationId = randomUUID();
      this.host.change((d) => {
        const saved = d.cleanup!.rounds.at(-1)!;
        if (
          saved.id !== round.id ||
          d.ownership.fence !== round.fence ||
          !d.ownership.held ||
          ["paused", "cancelled"].includes(d.phase)
        )
          throw Error("Cleanup fenced");
        const current = saved.entries.find(
          (x) =>
            x.fact.location === e.fact.location && x.fact.name === e.fact.name,
        )!;
        current.operationId = operationId;
        current.state = "dispatched";
      });
      const mayDispatch = () =>
        this.allowed(round) &&
        this.host
          .status()
          .cleanup?.rounds.at(-1)
          ?.entries.some(
            (x) => x.operationId === operationId && x.state === "dispatched",
          ) === true;
      try {
        await this.host.observe(
          r.remove({
            ...t,
            name: e.fact.name,
            location: e.fact.location,
            expectedTip: e.fact.tip,
            operationId,
            controls: branchCleanupControls,
            mayDispatch,
          }),
        );
      } catch {
        /* independently observe acceptance, never repeat */
      }
      await this.observePending(round.id);
      if (
        this.host.status().cleanup?.rounds.at(-1)?.executionId !==
        round.executionId
      )
        return this.host.status();
      if (
        this.host
          .status()
          .cleanup!.rounds.at(-1)!
          .entries.some((x) =>
            ["uncertain", "dispatched", "blocked"].includes(x.state),
          )
      )
        return this.block(round.id);
    }
    return this.finish(round.id);
  }
  private async observePending(roundId: string): Promise<void> {
    const round = this.host.status().cleanup?.rounds.at(-1);
    if (!round || round.id !== roundId) return;
    const e = round.entries.find((x) =>
      ["dispatched", "uncertain"].includes(x.state),
    );
    if (!e) return;
    if (!e.operationId) throw Error("Missing cleanup operation identity");
    const r = this.runtimeFor(round.bindingSha256),
      token = randomUUID();
    this.host.change((d) => {
      const saved = d.cleanup!.rounds.at(-1)!;
      if (saved.id !== roundId) throw Error("Cleanup changed");
      saved.activeObservation = token;
      saved.entries.find((x) => x.operationId === e.operationId)!.state =
        "uncertain";
    });
    let o: BranchInventory | undefined;
    try {
      o = await this.host.observe(
        r.observe({ ...round.target, operationId: e.operationId }),
      );
    } catch {
      /* uncertainty persists */
    }
    this.host.change((d) => {
      const saved = d.cleanup!.rounds.at(-1)!;
      if (saved.id !== roundId || saved.activeObservation !== token) return;
      delete saved.activeObservation;
      const current = saved.entries.find(
        (x) => x.operationId === e.operationId,
      )!;
      if (
        !validInventory(o, round.target, true) ||
        !o.quiescent ||
        r.bindingSha256 !== round.bindingSha256
      ) {
        current.state = "uncertain";
        current.reason = "acceptance-unavailable";
        return;
      }
      const found = o.branches.find(
        (x) => x.location === e.fact.location && x.name === e.fact.name,
      );
      current.state = found ? "blocked" : "deleted";
      current.reason = !found
        ? "deleted"
        : found.tip !== e.fact.tip
          ? "tip-changed"
          : "deletion-not-accepted";
    });
  }
  async reconcile(): Promise<Delivery> {
    const round = this.host.status().cleanup?.rounds.at(-1);
    if (!round) throw Error("No cleanup to reconcile");
    this.host.change((d) => {
      const saved = d.cleanup!.rounds.at(-1)!;
      if (saved.id !== round.id) throw Error("Cleanup changed");
      delete saved.executionId;
    });
    await this.observePending(round.id);
    return this.finish(round.id);
  }
  private async finish(roundId: string): Promise<Delivery> {
    try {
      await this.host.refresh();
    } catch {
      return this.block(roundId);
    }
    const round = this.host.status().cleanup?.rounds.at(-1);
    if (!round || round.id !== roundId || !this.allowed(round))
      return this.block(roundId);
    const r = this.runtimeFor(round.bindingSha256),
      token = randomUUID();
    this.host.change((d) => {
      const saved = d.cleanup!.rounds.at(-1)!;
      if (saved.id !== roundId) throw Error("Cleanup changed");
      saved.activeObservation = token;
    });
    let o: BranchInventory | undefined;
    try {
      o = await this.host.observe(r.observe(round.target));
    } catch {
      /* incomplete */
    }
    if (
      !validInventory(o, round.target) ||
      !o.quiescent ||
      !this.allowed(round)
    )
      return this.block(roundId, token);
    const remaining = o.branches
      .filter((f) => f.name !== round.target.branch)
      .map((f) => entry(f, round.target));
    return this.host.change((d) => {
      const saved = d.cleanup!.rounds.at(-1)!;
      if (saved.id !== roundId || saved.activeObservation !== token) return;
      delete saved.activeObservation;
      // Newly appeared refs and changed exclusions are never hidden by an old plan.
      for (const fresh of remaining) {
        const prior = saved.entries.find(
          (e) =>
            e.fact.location === fresh.fact.location &&
            e.fact.name === fresh.fact.name,
        );
        if (
          !prior ||
          prior.fact.tip !== fresh.fact.tip ||
          prior.state === "deleted"
        )
          saved.entries.push(fresh);
        else if (
          prior.state === "retained" &&
          prior.evidenceSha256 !== fresh.evidenceSha256
        )
          saved.entries.push(fresh);
      }
      const complete = saved.entries.every(
        (e) => e.state === "deleted" || e.state === "retained",
      );
      delete saved.executionId;
      saved.state = complete ? "completed" : "blocked";
      if (!["paused", "cancelled"].includes(d.phase))
        d.phase = complete ? "completed" : "blocked";
      d.blocker.nextAction = complete
        ? "Controlled delivery complete at the recorded verified and synchronized main revision; eligible branches deleted and expected retentions recorded. Native qualification and production delivery remain disabled."
        : "Cleanup incomplete; inspect independent local/remote outcomes, preserve retained tips and reconcile uncertainty before an explicit fresh attempt. Production remains disabled.";
    });
  }
}
