import { randomUUID } from "node:crypto";
import type { Delivery } from "./controller.js";
import type { PublicationEvidence } from "./publication.js";
import { repairFindings } from "./repair.js";

export interface ReviewThread {
  id: string;
  digest: string;
  resolved: boolean;
  /** Independently assessed by the pinned trusted integration, never by review text. */
  assessment?: {
    criteriaSha256: string;
    disposition: "straightforward" | "disputed" | "conflicting";
    finding?: string;
  };
}
export interface OwnerReview {
  id: number;
  author: string;
  type: "User" | "Bot";
  head: string;
  state:
    | "APPROVED"
    | "CHANGES_REQUESTED"
    | "DISMISSED"
    | "COMMENTED"
    | "PENDING";
  submittedAt: number;
}
export interface ReviewObservation {
  repository: string;
  number: number;
  head: string;
  base: string;
  author: string;
  state: "open" | "closed";
  complete: boolean;
  eligibleApprovers: string[];
  owner: { login: string; type: "User" | "Bot"; permission: string };
  lastPusher: string;
  requiredChanges: boolean;
  reviews: OwnerReview[];
  threads: ReviewThread[];
  resolutions: {
    operationId: string;
    state: "accepted" | "absent";
    quiescent?: boolean;
  }[];
}
export interface ReviewResolution {
  operationId: string;
  threadId: string;
  digest: string;
  head: string;
  state: "dispatched" | "accepted" | "uncertain" | "not-applied";
}
export interface ReviewRun {
  id: string;
  publicationId: string;
  head: string;
  bindingSha256: string;
  observedAt?: number;
  activeObservation?: string;
  outcome: "waiting" | "approved" | "blocked" | "unavailable" | "repairing";
  threads: ReviewThread[];
  reviews: OwnerReview[];
  approval?: { reviewId: number; head: string; owner: string };
  repair?: { threads: { id: string; digest: string }[]; findings: string[] };
  resolutions: ReviewResolution[];
}
export interface ReviewEvidence {
  runs: ReviewRun[];
}
export interface ReviewRequest {
  repository: string;
  number: number;
  head: string;
}
/** Trusted host port. It independently establishes complete GitHub review history,
 * permissions, thread fingerprints, and scope assessments against pinned criteria.
 * Raw review text cannot set assessments or authority. No approve/merge capability.
 * Resolve must honor mayDispatch and stable operation identity; absence requires
 * proof of quiescence. There is no native implementation in the CLI. */
export interface ReviewRuntime {
  readonly mode: "controlled";
  readonly bindingSha256: string;
  observe(
    request: ReviewRequest & { criteriaSha256: string },
  ): Promise<ReviewObservation>;
  resolve(
    request: ReviewRequest & ReviewResolution & { mayDispatch(): boolean },
  ): Promise<{ operationId: string; accepted: boolean }>;
}
export interface ReviewHost {
  status(): Delivery;
  change(update: (d: Delivery) => void): Delivery;
  input(d?: Delivery): {
    publication: PublicationEvidence;
    criteriaSha256: string;
    checksPassed: boolean;
  };
  observe<T>(promise: Promise<T>): Promise<T | undefined>;
  now(): number;
  canResolve(d: Delivery, thread: ReviewThread): boolean;
}
const hash = (s: unknown): s is string =>
  typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
const ident = (s: unknown): s is string =>
  typeof s === "string" && /^[A-Za-z0-9_.\[\]-]{1,128}$/.test(s);
const integer = (n: unknown): n is number =>
  Number.isSafeInteger(n) && (n as number) >= 0;
export function unresolvedReviewEffect(d: Delivery): boolean {
  return !!d.review?.runs.some((r) =>
    r.resolutions.some((e) => ["dispatched", "uncertain"].includes(e.state)),
  );
}
function project(
  o: ReviewObservation,
  p: PublicationEvidence,
  criteria: string,
  now: number,
) {
  if (
    !o ||
    o.complete !== true ||
    o.repository !== p.repository ||
    o.number !== p.pullRequest!.number ||
    o.head !== p.commit ||
    o.base !== p.defaultBranch ||
    o.author !== p.appLogin ||
    o.state !== "open" ||
    !Array.isArray(o.eligibleApprovers) ||
    o.eligibleApprovers.length !== 1 ||
    o.eligibleApprovers[0] !== p.approver ||
    o.owner?.login !== p.approver ||
    o.owner.type !== "User" ||
    !["admin", "maintain", "write"].includes(o.owner.permission) ||
    !ident(o.lastPusher) ||
    o.author === p.approver ||
    typeof o.requiredChanges !== "boolean" ||
    !Array.isArray(o.reviews) ||
    o.reviews.length > 1024 ||
    !Array.isArray(o.threads) ||
    o.threads.length > 128 ||
    !Array.isArray(o.resolutions) ||
    o.resolutions.length > 128
  )
    throw Error("Unverified review authority");
  const reviews = o.reviews.map((r) => {
    if (
      !r ||
      !integer(r.id) ||
      r.id === 0 ||
      !ident(r.author) ||
      !["User", "Bot"].includes(r.type) ||
      !/^[a-f0-9]{40}$/.test(r.head) ||
      ![
        "APPROVED",
        "CHANGES_REQUESTED",
        "DISMISSED",
        "COMMENTED",
        "PENDING",
      ].includes(r.state) ||
      !integer(r.submittedAt) ||
      r.submittedAt > now
    )
      throw Error("Malformed review");
    return {
      id: r.id,
      author: r.author,
      type: r.type,
      head: r.head,
      state: r.state,
      submittedAt: r.submittedAt,
    };
  });
  const threads = o.threads.map((t) => {
    if (
      !t ||
      !ident(t.id) ||
      !hash(t.digest) ||
      typeof t.resolved !== "boolean"
    )
      throw Error("Malformed thread");
    let assessment: ReviewThread["assessment"];
    if (t.assessment) {
      const a = t.assessment;
      if (
        a.criteriaSha256 !== criteria ||
        !["straightforward", "disputed", "conflicting"].includes(a.disposition)
      )
        throw Error("Unverified assessment");
      assessment = {
        criteriaSha256: criteria,
        disposition: a.disposition,
        ...(a.disposition === "straightforward"
          ? { finding: repairFindings([a.finding!])[0]! }
          : {}),
      };
    }
    return {
      id: t.id,
      digest: t.digest,
      resolved: t.resolved,
      ...(assessment ? { assessment } : {}),
    };
  });
  if (
    new Set(reviews.map((r) => r.id)).size !== reviews.length ||
    new Set(threads.map((t) => t.id)).size !== threads.length
  )
    throw Error("Ambiguous review evidence");
  const owner = reviews
    .filter(
      (r) =>
        r.author === p.approver &&
        r.state !== "COMMENTED" &&
        r.state !== "PENDING",
    )
    .sort((a, b) => a.submittedAt - b.submittedAt || a.id - b.id)
    .at(-1);
  const approved =
    owner?.type === "User" &&
    owner.head === p.commit &&
    owner.state === "APPROVED" &&
    !o.requiredChanges &&
    threads.every((t) => t.resolved);
  return {
    reviews,
    threads,
    approval: approved
      ? { reviewId: owner!.id, head: p.commit!, owner: p.approver }
      : undefined,
  };
}
export class ReviewCoordinator {
  constructor(
    private host: ReviewHost,
    private runtime?: ReviewRuntime,
  ) {}
  private binding(run?: ReviewRun) {
    const r = this.runtime;
    if (
      !r ||
      r.mode !== "controlled" ||
      !hash(r.bindingSha256) ||
      (run && run.bindingSha256 !== r.bindingSha256)
    )
      throw Error("Unverified review binding");
    return r;
  }
  async monitor(): Promise<Delivery> {
    const snapshot = this.host.status(),
      input = this.host.input(snapshot),
      p = input.publication;
    if (!snapshot.ownership.held) throw Error("Review requires ownership");
    const previous = snapshot.review?.runs.at(-1),
      matching = previous?.publicationId === p.id ? previous : undefined;
    const runtime = this.binding(matching),
      now = this.host.now();
    if (!integer(now)) throw Error("Unavailable clock");
    if (!matching && ["paused", "cancelled"].includes(snapshot.phase))
      throw Error("Resume before monitoring review");
    const id = matching?.id ?? randomUUID(),
      observationId = randomUUID();
    this.host.change((d) => {
      if (
        d.ownership.fence !== snapshot.ownership.fence ||
        d.publication?.id !== p.id ||
        d.review?.runs.at(-1)?.id !== previous?.id
      )
        throw Error("Changed review generation");
      if (!matching)
        (d.review ??= { runs: [] }).runs.push({
          id,
          publicationId: p.id,
          head: p.commit!,
          bindingSha256: runtime.bindingSha256,
          outcome: "waiting",
          threads: [],
          reviews: [],
          resolutions: [],
        });
      const run = d.review!.runs.at(-1)!;
      run.activeObservation = observationId;
      run.outcome = "waiting";
      delete run.approval;
      if (!["paused", "cancelled"].includes(d.phase))
        d.phase = "waiting-review";
    });
    let response: ReviewObservation | undefined;
    try {
      response = await this.host.observe(
        runtime.observe({
          repository: p.repository,
          number: p.pullRequest!.number,
          head: p.commit!,
          criteriaSha256: input.criteriaSha256,
        }),
      );
      this.binding(this.host.status().review!.runs.at(-1));
      this.host.input();
    } catch {
      response = undefined;
    }
    return this.host.change((d) => {
      const run = d.review?.runs.at(-1);
      if (
        run?.id !== id ||
        run.activeObservation !== observationId ||
        d.publication?.id !== p.id
      )
        return;
      delete run.activeObservation;
      delete run.approval;
      try {
        const end = this.host.now();
        if (!integer(end) || end < now) throw Error("Unavailable clock");
        const result = project(response!, p, input.criteriaSha256, end);
        run.observedAt = end;
        run.threads = result.threads;
        run.reviews = result.reviews;
        for (const effect of run.resolutions) {
          if (!["dispatched", "uncertain"].includes(effect.state)) continue;
          const receipts = response!.resolutions.filter(
            (r) => r.operationId === effect.operationId,
          );
          if (receipts.length !== 1) continue;
          const receipt = receipts[0]!,
            thread = result.threads.find((t) => t.id === effect.threadId);
          if (
            receipt.state === "accepted" &&
            thread?.resolved &&
            thread.digest === effect.digest
          )
            effect.state = "accepted";
          else if (receipt.state === "absent" && receipt.quiescent === true)
            effect.state = "not-applied";
        }
        if (
          result.approval &&
          this.host.input(d).checksPassed &&
          !unresolvedReviewEffect(d)
        )
          run.approval = result.approval;
        run.outcome = run.approval
          ? "approved"
          : !this.host.input(d).checksPassed ||
              unresolvedReviewEffect(d) ||
              result.threads.some((t) => !t.resolved) ||
              response!.requiredChanges
            ? "blocked"
            : "waiting";
      } catch {
        run.outcome = "unavailable";
      }
      if (
        !["paused", "cancelled"].includes(d.phase) &&
        d.ownership.fence === snapshot.ownership.fence
      )
        d.phase =
          run.outcome === "approved"
            ? "ready-to-merge"
            : run.outcome === "waiting"
              ? "waiting-review"
              : "blocked";
      d.blocker.nextAction =
        run.outcome === "approved"
          ? "Owner approved this head; revalidate all gates in the separate conditional merge phase."
          : "Wait for current-head owner GitHub approval or resolve review findings; no approval deadline or repeated reminders.";
    });
  }
  async resolve(threadId: string): Promise<Delivery> {
    await this.monitor();
    const snapshot = this.host.status(),
      run = snapshot.review?.runs.at(-1),
      p = this.host.input(snapshot).publication;
    const thread = run?.threads.find((t) => t.id === threadId);
    if (
      !run ||
      !thread ||
      run.outcome === "unavailable" ||
      run.activeObservation ||
      !snapshot.ownership.held ||
      ["paused", "cancelled"].includes(snapshot.phase) ||
      unresolvedReviewEffect(snapshot)
    )
      throw Error("Resolve authority unavailable");
    if (thread.resolved) return snapshot;
    if (
      !this.host.canResolve(snapshot, thread) ||
      run.resolutions.some(
        (e) => e.threadId === threadId && e.state !== "not-applied",
      ) ||
      run.resolutions.length >= 128
    )
      throw Error("Review fix lacks verified evidence");
    const runtime = this.binding(run),
      operationId = randomUUID();
    this.host.change((d) => {
      const currentThread = d.review?.runs
        .at(-1)
        ?.threads.find(
          (t) => t.id === threadId && t.digest === thread.digest && !t.resolved,
        );
      if (
        d.ownership.fence !== snapshot.ownership.fence ||
        d.phase !== snapshot.phase ||
        d.review?.runs.at(-1)?.id !== run.id ||
        d.review.runs.at(-1)!.activeObservation ||
        unresolvedReviewEffect(d) ||
        !currentThread ||
        !this.host.canResolve(d, currentThread)
      )
        throw Error("Resolve authority changed");
      d.review.runs.at(-1)!.resolutions.push({
        operationId,
        threadId,
        digest: thread.digest,
        head: p.commit!,
        state: "dispatched",
      });
      delete d.review.runs.at(-1)!.approval;
    });
    const mayDispatch = () => {
      try {
        this.binding(run);
        const d = this.host.status(),
          current = d.review?.runs.at(-1),
          input = this.host.input(d),
          currentThread = current?.threads.find(
            (t) =>
              t.id === threadId && t.digest === thread.digest && !t.resolved,
          );
        return (
          d.ownership.held &&
          d.ownership.fence === snapshot.ownership.fence &&
          !["paused", "cancelled"].includes(d.phase) &&
          input.publication.id === p.id &&
          current?.id === run.id &&
          !current.activeObservation &&
          current.resolutions.find((e) => e.operationId === operationId)
            ?.state === "dispatched" &&
          !!currentThread &&
          this.host.canResolve(d, currentThread)
        );
      } catch {
        return false;
      }
    };
    let receipt: { operationId: string; accepted: boolean } | undefined;
    try {
      if (!mayDispatch()) throw Error("Dispatch fenced");
      receipt = await this.host.observe(
        runtime.resolve({
          repository: p.repository,
          number: p.pullRequest!.number,
          head: p.commit!,
          operationId,
          threadId,
          digest: thread.digest,
          state: "dispatched",
          mayDispatch,
        }),
      );
    } catch {}
    return this.host.change((d) => {
      const current = d.review?.runs.find((r) => r.id === run.id),
        effect = current?.resolutions.find(
          (e) => e.operationId === operationId,
        );
      if (!effect || effect.state !== "dispatched") return;
      effect.state =
        receipt?.operationId === operationId && receipt.accepted === true
          ? "accepted"
          : "uncertain";
      if (!["paused", "cancelled"].includes(d.phase)) d.phase = "blocked";
      d.blocker.nextAction =
        "Reconcile the exact conversation resolution and fresh owner review; do not repeat uncertain writes.";
    });
  }
}
