import { randomUUID } from "node:crypto";
import type { Delivery } from "./controller.js";
import type { PublicationEvidence } from "./publication.js";
import type { CheckStatus, ValidationCheck } from "./isolated-validation.js";

export interface PRCheckAttempt {
  runId: number;
  attempt: number;
  checkId: string;
  publisher: string;
  workflow: string;
  head: string;
  status: CheckStatus;
  startedAt: number;
  completedAt?: number;
}
export interface PRCheckObservation {
  repository: string;
  number: number;
  head: string;
  base: string;
  author: string;
  state: "open" | "closed";
  /** All pages and all attempts for the exact PR head, including prior failures. */
  complete: boolean;
  checks: PRCheckAttempt[];
  reruns: {
    operationId: string;
    state: "accepted" | "absent";
    quiescent?: boolean;
  }[];
}
export interface PRDiagnosticRerun {
  operationId: string;
  checkId: string;
  runId: number;
  attempt: number;
  state: "dispatched" | "accepted" | "uncertain" | "not-applied";
}
export interface PRCheckRun {
  id: string;
  publicationId: string;
  head: string;
  bindingSha256: string;
  policySha256: string;
  checks: ValidationCheck[];
  startedAt: number;
  lastClock: number;
  nextPollAt: number;
  activeObservation?: string;
  observedAt?: number;
  polls: number;
  attempts: PRCheckAttempt[];
  outcome:
    | "pending"
    | "passed"
    | "incomplete"
    | "failed"
    | "flaky"
    | "timeout"
    | "stale"
    | "unavailable"
    | "repairing";
  rejected: number;
  findings: string[];
  canRepair: boolean;
  diagnostic?: PRDiagnosticRerun;
}
export interface PRChecksEvidence {
  runs: PRCheckRun[];
}
export interface PRChecksRequest {
  repository: string;
  number: number;
  head: string;
}
/** Trusted host boundary; complete observations must include all attempts and
 * independently established workflow/publisher identity. No native GitHub port
 * is installed. Rerun honors mayDispatch and its stable operation identity; an
 * absent reconciliation must prove no late acceptance can occur. */
export interface PRChecksRuntime {
  readonly mode: "controlled";
  readonly bindingSha256: string;
  observe(request: PRChecksRequest): Promise<PRCheckObservation>;
  rerun(
    request: PRChecksRequest & PRDiagnosticRerun & { mayDispatch(): boolean },
  ): Promise<{ operationId: string; accepted: boolean }>;
}
export interface PRChecksHost {
  status(): Delivery;
  change(update: (d: Delivery) => void): Delivery;
  input(d?: Delivery): {
    publication: PublicationEvidence;
    checks: ValidationCheck[];
  };
  observe<T>(pending: Promise<T>, timeoutMs?: number): Promise<T | undefined>;
  now(): number;
}
const hash = (s: unknown) => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
const integer = (n: unknown): n is number =>
  Number.isSafeInteger(n) && (n as number) >= 0;
const terminal = (s: CheckStatus) => !["pending", "missing"].includes(s);
const failed = (s: CheckStatus) => ["failure", "timeout"].includes(s);
const key = (a: PRCheckAttempt) => `${a.checkId}:${a.runId}:${a.attempt}`;
function latest(run: PRCheckRun, id: string) {
  return run.attempts
    .filter((a) => a.checkId === id)
    .sort(
      (a, b) =>
        a.startedAt - b.startedAt || a.runId - b.runId || a.attempt - b.attempt,
    )
    .at(-1);
}
function outcome(run: PRCheckRun, now: number): PRCheckRun["outcome"] {
  run.findings = [];
  run.canRepair = false;
  if (run.rejected) return "incomplete";
  if (
    run.diagnostic &&
    ["dispatched", "uncertain"].includes(run.diagnostic.state)
  )
    return "incomplete";
  if (run.diagnostic?.state === "accepted") {
    const d = run.diagnostic;
    const next = latest(run, d.checkId);
    if (!next || (next.runId === d.runId && next.attempt <= d.attempt))
      return "incomplete";
  }
  let incomplete = false,
    flaky = false,
    failure = false,
    expired = false;
  for (const c of run.checks) {
    const r = latest(run, c.id),
      status = r?.status ?? "missing";
    const allowed =
      status === "success" || !!c.exception?.statuses.includes(status);
    if (!allowed) {
      if (failed(status)) {
        failure = true;
        run.findings.push(`Trusted PR check ${c.id}: ${status}`);
      } else incomplete = true;
      if (now - run.startedAt >= c.timeoutMs) expired = true;
    }
    if (
      r?.completedAt !== undefined &&
      r.completedAt > run.startedAt + c.timeoutMs
    )
      expired = true;
    if (
      allowed &&
      run.attempts.some((a) => a.checkId === c.id && failed(a.status)) &&
      !c.flake?.allowDiagnosticPass
    )
      flaky = true;
  }
  run.canRepair =
    failure &&
    !incomplete &&
    !flaky &&
    run.checks.every((c) => {
      const r = latest(run, c.id);
      return !!r && terminal(r.status);
    });
  if (expired) {
    run.canRepair = false;
    return "timeout";
  }
  return failure
    ? "failed"
    : flaky
      ? "flaky"
      : incomplete
        ? "incomplete"
        : "passed";
}
function record(
  run: PRCheckRun,
  observation: PRCheckObservation,
  p: PublicationEvidence,
  now: number,
) {
  run.canRepair = false;
  if (
    observation.repository !== p.repository ||
    observation.number !== p.pullRequest!.number ||
    observation.head !== p.commit ||
    observation.base !== p.defaultBranch ||
    observation.author !== p.appLogin ||
    observation.state !== "open"
  ) {
    run.outcome = "stale";
    return;
  }
  if (
    observation.complete !== true ||
    !Array.isArray(observation.checks) ||
    observation.checks.length > 1024 ||
    !Array.isArray(observation.reruns) ||
    observation.reruns.length > 32
  ) {
    run.outcome = "unavailable";
    return;
  }
  let rejected = 0;
  const seen = new Set<string>();
  for (const value of observation.checks) {
    const c = run.checks.find((c) => c.id === value?.checkId);
    if (!c) continue;
    if (
      !value ||
      value.publisher !== c.publisher ||
      value.workflow !== c.workflow ||
      value.head !== run.head ||
      !integer(value.runId) ||
      value.runId < 1 ||
      !integer(value.attempt) ||
      value.attempt < 1 ||
      !integer(value.startedAt) ||
      value.startedAt > now ||
      (value.completedAt !== undefined && !integer(value.completedAt)) ||
      ![
        "success",
        "failure",
        "missing",
        "pending",
        "skipped",
        "neutral",
        "cancelled",
        "timeout",
      ].includes(value.status) ||
      (terminal(value.status) &&
        (!integer(value.completedAt) ||
          value.completedAt < value.startedAt ||
          value.completedAt > now))
    ) {
      rejected++;
      continue;
    }
    const a: PRCheckAttempt = {
      runId: value.runId,
      attempt: value.attempt,
      checkId: c.id,
      publisher: c.publisher,
      workflow: c.workflow!,
      head: run.head,
      status: value.status,
      startedAt: value.startedAt,
      ...(value.completedAt === undefined
        ? {}
        : { completedAt: value.completedAt }),
    };
    if (seen.has(key(a))) {
      rejected++;
      continue;
    }
    seen.add(key(a));
    const old = run.attempts.find((x) => key(x) === key(a));
    if (
      old &&
      (old.startedAt !== a.startedAt ||
        (terminal(old.status) && JSON.stringify(old) !== JSON.stringify(a)))
    ) {
      rejected++;
      continue;
    }
    if (!old) {
      if (run.attempts.length >= 1024) {
        rejected++;
        continue;
      }
      run.attempts.push(a);
    } else Object.assign(old, a);
  }
  // An incomplete history cannot turn an earlier failure into an unexplained green badge.
  if (run.attempts.some((a) => !seen.has(key(a))) || run.attempts.length > 1024)
    rejected++;
  run.rejected = rejected;
  const diagnostic = run.diagnostic;
  if (diagnostic && ["dispatched", "uncertain"].includes(diagnostic.state)) {
    const receipt = observation.reruns.filter(
      (r) => r?.operationId === diagnostic.operationId,
    );
    if (receipt.length === 1) {
      if (receipt[0]!.state === "accepted") diagnostic.state = "accepted";
      else if (receipt[0]!.state === "absent" && receipt[0]!.quiescent === true)
        diagnostic.state = "not-applied";
    }
  }
  run.observedAt = now;
  run.outcome = outcome(run, now);
}
export class PRChecksCoordinator {
  constructor(
    private readonly host: PRChecksHost,
    private readonly runtime?: PRChecksRuntime,
  ) {}
  private binding(run?: PRCheckRun) {
    const r = this.runtime;
    if (
      !r ||
      r.mode !== "controlled" ||
      !hash(r.bindingSha256) ||
      (run && r.bindingSha256 !== run.bindingSha256)
    )
      throw Error("Trusted PR observation binding is unavailable");
    return r;
  }
  async monitor(force = false): Promise<Delivery> {
    const snapshot = this.host.status(),
      input = this.host.input(snapshot),
      p = input.publication;
    if (!snapshot.ownership.held)
      throw Error("PR monitoring requires ownership");
    const previous = snapshot.prChecks?.runs.at(-1),
      matching = previous?.publicationId === p.id ? previous : undefined;
    const runtime = this.binding(matching),
      now = this.host.now();
    if (!integer(now) || (matching && now < matching.lastClock)) {
      if (!matching) throw Error("Unavailable clock");
      return this.host.change((d) => {
        const r = d.prChecks!.runs.at(-1)!;
        r.outcome = "timeout";
        r.canRepair = false;
        delete r.activeObservation;
        if (!["paused", "cancelled"].includes(d.phase)) d.phase = "blocked";
      });
    }
    const timedOut = matching?.outcome === "timeout";
    const reconcileTimeout =
      timedOut &&
      matching.diagnostic &&
      ["dispatched", "uncertain"].includes(matching.diagnostic.state);
    if ((timedOut && !reconcileTimeout) || matching?.outcome === "repairing")
      return snapshot;
    if (!force && matching && now < matching.nextPollAt) return snapshot;
    if (!matching && ["paused", "cancelled"].includes(snapshot.phase))
      throw Error("Resume before starting PR monitoring");
    const id = matching?.id ?? randomUUID(),
      observationId = randomUUID();
    const prepared = this.host.change((d) => {
      if (
        d.ownership.fence !== snapshot.ownership.fence ||
        d.publication?.id !== p.id ||
        d.prChecks?.runs.at(-1)?.id !== previous?.id
      )
        throw Error("PR observation authority changed");
      if (!matching)
        (d.prChecks ??= { runs: [] }).runs.push({
          id,
          publicationId: p.id,
          head: p.commit!,
          policySha256: p.policySha256,
          bindingSha256: runtime.bindingSha256,
          checks: input.checks,
          startedAt: now,
          lastClock: now,
          nextPollAt: now,
          polls: 0,
          attempts: [],
          outcome: "pending",
          rejected: 0,
          findings: [],
          canRepair: false,
        });
      const run = d.prChecks!.runs.at(-1)!;
      run.lastClock = now;
      if (
        !reconcileTimeout &&
        run.checks.some(
          (c) =>
            now - run.startedAt >= c.timeoutMs &&
            !["success", ...(c.exception?.statuses ?? [])].includes(
              latest(run, c.id)?.status ?? "missing",
            ),
        )
      ) {
        run.outcome = "timeout";
        run.canRepair = false;
        delete run.activeObservation;
        if (!["paused", "cancelled"].includes(d.phase)) d.phase = "blocked";
        return;
      }
      run.activeObservation = observationId;
      run.polls++;
      run.nextPollAt = now + 5000;
      if (!timedOut) run.outcome = "pending";
      run.canRepair = false;
      if (!["paused", "cancelled"].includes(d.phase))
        d.phase = timedOut ? "blocked" : "waiting-checks";
    });
    if (prepared.prChecks!.runs.at(-1)!.activeObservation !== observationId)
      return prepared;
    let response: PRCheckObservation | undefined;
    try {
      response = await this.host.observe(
        runtime.observe({
          repository: p.repository,
          number: p.pullRequest!.number,
          head: p.commit!,
        }),
        Math.max(
          1,
          reconcileTimeout
            ? 30000
            : Math.min(
                30000,
                ...input.checks
                  .filter(
                    (c) =>
                      !matching ||
                      !["success", ...(c.exception?.statuses ?? [])].includes(
                        latest(matching, c.id)?.status ?? "missing",
                      ),
                  )
                  .map(
                    (c) => c.timeoutMs - (now - (matching?.startedAt ?? now)),
                  ),
              ),
        ),
      );
      this.binding(prepared.prChecks!.runs.at(-1));
      this.host.input();
    } catch {
      response = undefined;
    }
    return this.host.change((d) => {
      const run = d.prChecks?.runs.at(-1);
      if (
        run?.id !== id ||
        run.activeObservation !== observationId ||
        d.publication?.id !== p.id
      )
        return;
      delete run.activeObservation;
      const end = this.host.now();
      if (!integer(end) || end < run.lastClock) {
        run.outcome = "timeout";
        run.canRepair = false;
      } else {
        run.lastClock = end;
        if (!response) run.outcome = "unavailable";
        else {
          try {
            record(run, response, p, end);
          } catch {
            run.outcome = "unavailable";
            run.canRepair = false;
          }
        }
        if (
          run.outcome !== "passed" &&
          end - run.startedAt >= Math.max(...run.checks.map((c) => c.timeoutMs))
        ) {
          run.outcome = "timeout";
          run.canRepair = false;
        }
      }
      if (timedOut) {
        run.outcome = "timeout";
        run.canRepair = false;
      }
      if (
        !["paused", "cancelled"].includes(d.phase) &&
        d.ownership.fence === snapshot.ownership.fence
      )
        d.phase =
          run.outcome === "passed"
            ? "waiting-review"
            : run.outcome === "incomplete"
              ? "waiting-checks"
              : "blocked";
      d.blocker.nextAction =
        run.outcome === "passed"
          ? "Reconcile independent review and current-head owner approval; checks alone do not authorize merge."
          : "Preserve PR evidence; resolve failed, missing, stale or timed-out trusted checks before advancement.";
    });
  }
  async rerun(checkId: string): Promise<Delivery> {
    await this.monitor(true);
    const snapshot = this.host.status(),
      run = snapshot.prChecks?.runs.at(-1),
      p = snapshot.publication!;
    if (
      !run ||
      run.outcome !== "failed" ||
      !run.canRepair ||
      run.diagnostic ||
      !snapshot.ownership.held ||
      snapshot.phase !== "blocked"
    )
      throw Error("Diagnostic rerun is unavailable");
    const attempt = latest(run, checkId);
    if (!attempt || !failed(attempt.status))
      throw Error("No failed trusted check");
    const runtime = this.binding(run),
      operationId = randomUUID();
    const diagnostic: PRDiagnosticRerun = {
      operationId,
      checkId,
      runId: attempt.runId,
      attempt: attempt.attempt,
      state: "dispatched",
    };
    this.host.change((d) => {
      const current = d.prChecks!.runs.at(-1)!;
      if (
        current.id !== run.id ||
        current.diagnostic ||
        d.ownership.fence !== snapshot.ownership.fence ||
        d.phase !== "blocked"
      )
        throw Error("Rerun authority changed");
      current.diagnostic = diagnostic;
      current.canRepair = false;
      current.outcome = "incomplete";
    });
    const mayDispatch = () => {
      try {
        this.binding(run);
        this.host.input();
        const d = this.host.status(),
          r = d.prChecks?.runs.at(-1);
        return (
          d.ownership.held &&
          d.phase === "blocked" &&
          d.ownership.fence === snapshot.ownership.fence &&
          r?.id === run.id &&
          r.diagnostic?.operationId === operationId &&
          r.diagnostic.state === "dispatched"
        );
      } catch {
        return false;
      }
    };
    let result: { operationId: string; accepted: boolean } | undefined;
    try {
      if (mayDispatch())
        result = await this.host.observe(
          runtime.rerun({
            repository: p.repository,
            number: p.pullRequest!.number,
            head: p.commit!,
            ...diagnostic,
            mayDispatch,
          }),
        );
    } catch {}
    return this.host.change((d) => {
      const r = d.prChecks?.runs.at(-1);
      if (
        r?.id === run.id &&
        r.diagnostic?.operationId === operationId &&
        r.diagnostic.state === "dispatched"
      )
        r.diagnostic.state =
          result?.operationId === operationId && result.accepted === true
            ? "accepted"
            : "uncertain";
    });
  }
}
