import { randomUUID } from "node:crypto";
import type { Delivery } from "./controller.js";
import type { MergeAttempt } from "./conditional-merge.js";
import type { ValidationCheck } from "./isolated-validation.js";
import {
  hostedCheckOutcome,
  hostedCheckDeadline,
  recordCheckAttempts,
  type HostedCheckState,
  type PRCheckAttempt,
  type PRCheckRun,
} from "./pr-checks.js";

export interface MainObservation {
  repository: string;
  number: number;
  head: string;
  base: string;
  mergeCommit: string;
  mainRevision: string;
  reachable: boolean;
  complete: boolean;
  checks: PRCheckAttempt[];
}
/** Read-only trusted host boundary. Establish PR/head/merge linkage and reachability
 * on current main independently, with complete check history and publisher/workflow
 * provenance for that exact main revision. Re-read main before returning; a raced
 * observation must be incomplete. No native adapter or repair authority is installed. */
export interface MainChecksRuntime {
  readonly mode: "controlled";
  readonly bindingSha256: string;
  observe(request: {
    repository: string;
    number: number;
    head: string;
    base: string;
    mergeCommit: string;
  }): Promise<MainObservation>;
}
export interface MainCheckRun extends HostedCheckState {
  revision: string;
  outcome: PRCheckRun["outcome"];
  observedAt: number;
}
export interface MainChecksEvidence {
  mergeOperationId: string;
  revision?: string;
  bindingSha256: string;
  policySha256: string;
  startedAt: number;
  lastClock: number;
  nextPollAt: number;
  activeObservation?: string;
  outcome: PRCheckRun["outcome"];
  runs: MainCheckRun[];
}
interface MainHost {
  status(): Delivery;
  change(update: (d: Delivery) => void): Delivery;
  input(): { merge: MergeAttempt; checks: ValidationCheck[] };
  observe<T>(p: Promise<T>, ms: number): Promise<T | undefined>;
  now(): number;
}
export class MainChecksCoordinator {
  constructor(
    private host: MainHost,
    private runtime?: MainChecksRuntime,
  ) {}
  async monitor(): Promise<Delivery> {
    const { merge: a, checks } = this.host.input(),
      snapshot = this.host.status(),
      r = this.runtime;
    const previous = snapshot.mainChecks;
    if (
      !snapshot.ownership.held ||
      ["paused", "cancelled"].includes(snapshot.phase)
    )
      return snapshot;
    if (
      !r ||
      r.mode !== "controlled" ||
      !/^[a-f0-9]{64}$/.test(r.bindingSha256) ||
      (previous &&
        (previous.bindingSha256 !== r.bindingSha256 ||
          previous.mergeOperationId !== a.operationId ||
          previous.policySha256 !== a.policySha256))
    )
      throw Error("Unqualified main observation binding");
    const now = this.host.now();
    if (previous?.outcome === "timeout")
      return this.host.change((d) => {
        d.phase = "blocked";
      });
    const deadline = hostedCheckDeadline(
      previous?.runs.find((run) => run.revision === previous.revision) ?? {
        checks,
        attempts: [],
        rejected: 0,
        startedAt: previous?.startedAt ?? now,
        head: a.mainRevision!,
        findings: [],
        canRepair: false,
      },
    );
    if (
      !Number.isSafeInteger(now) ||
      now < 0 ||
      (previous && now < previous.lastClock) ||
      now >= deadline
    ) {
      return this.host.change((d) => {
        if (d.mainChecks) {
          d.mainChecks.outcome = "timeout";
          if (Number.isSafeInteger(now))
            d.mainChecks.lastClock = Math.max(d.mainChecks.lastClock, now);
          delete d.mainChecks.activeObservation;
        }
        d.phase = "blocked";
        d.blocker.nextAction =
          "Main check timeout or invalid clock; preserve revision/check evidence. Owner must investigate; any fix or revert needs a new signed PR and approval. Synchronization and cleanup remain blocked.";
      });
    }
    if (
      previous &&
      previous.outcome !== "passed" &&
      now < previous.nextPollAt &&
      !previous.activeObservation
    )
      return snapshot;
    const token = randomUUID();
    const prepared = this.host.change((d) => {
      if (
        d.ownership.fence !== snapshot.ownership.fence ||
        d.mainChecks?.activeObservation !== previous?.activeObservation
      )
        throw Error("Main observation fenced");
      const e = (d.mainChecks ??= {
        mergeOperationId: a.operationId,
        bindingSha256: r.bindingSha256,
        policySha256: a.policySha256,
        startedAt: now,
        lastClock: now,
        nextPollAt: now,
        outcome: "pending",
        runs: [],
      });
      e.activeObservation = token;
      e.outcome = "pending";
      e.lastClock = now;
      e.nextPollAt = now + 5000;
      d.phase = "verifying-main";
    });
    const e = prepared.mainChecks!;
    let o: MainObservation | undefined;
    try {
      o = await this.host.observe(
        r.observe({
          repository: a.repository,
          number: a.number,
          head: a.head,
          base: a.base,
          mergeCommit: a.mergeCommit!,
        }),
        Math.max(1, Math.min(30000, deadline - now)),
      );
      this.host.input();
      if (r.bindingSha256 !== e.bindingSha256) o = undefined;
    } catch {
      o = undefined;
    }
    return this.host.change((d) => {
      const saved = d.mainChecks!;
      if (saved.activeObservation !== token) return;
      delete saved.activeObservation;
      const end = this.host.now();
      let effectiveDeadline = deadline;
      if (Number.isSafeInteger(end))
        saved.lastClock = Math.max(saved.lastClock, end);
      saved.outcome = "unavailable";
      if (
        o &&
        o.repository === a.repository &&
        o.number === a.number &&
        o.head === a.head &&
        o.base === a.base &&
        o.mergeCommit === a.mergeCommit &&
        /^[a-f0-9]{40}$/.test(o.mainRevision) &&
        o.reachable === true &&
        o.complete === true &&
        Array.isArray(o.checks) &&
        o.checks.length <= 1024
      ) {
        saved.revision = o.mainRevision;
        let run = saved.runs.find((run) => run.revision === o.mainRevision);
        if (!run) {
          run = {
            revision: o.mainRevision,
            head: o.mainRevision,
            checks,
            attempts: [],
            rejected: 0,
            findings: [],
            canRepair: false,
            startedAt: saved.startedAt,
            observedAt: end,
            outcome: "pending",
          };
          saved.runs.push(run);
        }
        recordCheckAttempts(run, o.checks, end);
        run.outcome = hostedCheckOutcome(run, end);
        if (run.outcome !== "passed" && end >= hostedCheckDeadline(run))
          run.outcome = "timeout";
        run.canRepair = false;
        run.observedAt = end;
        saved.outcome = run.outcome;
        effectiveDeadline = hostedCheckDeadline(run);
      }
      if (
        !Number.isSafeInteger(end) ||
        end < now ||
        (saved.outcome !== "passed" && end >= effectiveDeadline)
      )
        saved.outcome = "timeout";
      if (
        d.ownership.fence !== snapshot.ownership.fence ||
        !d.ownership.held ||
        ["paused", "cancelled"].includes(d.phase)
      ) {
        if (saved.outcome !== "timeout") saved.outcome = "unavailable";
        return;
      }
      d.phase =
        saved.outcome === "passed"
          ? "main-verified"
          : saved.outcome === "incomplete"
            ? "verifying-main"
            : "blocked";
      d.blocker.nextAction =
        saved.outcome === "passed"
          ? "Main checks verified for the recorded revision; safe synchronization and eligible cleanup remain required."
          : `Main verification ${saved.outcome} at ${saved.revision ?? a.mainRevision}; ${saved.runs.find((run) => run.revision === saved.revision)?.findings.join("; ") || "obtain complete trusted check evidence"}. Preserve evidence; owner must resolve the blocker through a new signed PR and approval if a fix or revert is needed. Do not synchronize, clean up or patch main directly.`;
    });
  }
}
