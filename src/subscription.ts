import { createHash, randomUUID } from "node:crypto";

/** How a usage reader's account authenticates. Each coding provider's
 * subscription adds its own mode (ADR 0003); only ChatGPT is read today. */
export type SubscriptionAuthMode = "chatgpt";
export const subscriptionAuthModes: readonly SubscriptionAuthMode[] = [
  "chatgpt",
];
export interface SubscriptionObservation {
  observedAt: string;
  accountId: string;
  authMode: SubscriptionAuthMode;
  windows: { id: string; usedPercent: number; resetsAt: number }[];
  exhausted: boolean;
}
export interface UsageReport {
  checkId: string;
  checkedAt: string;
  accountId?: string;
  decision: "ready" | "approval-required" | "exhausted";
  remainingPercent: number | null;
  scope: string;
  approval?: { scope: string; at: string; operationId?: string };
}
export type SubscriptionReader = () => Promise<
  SubscriptionObservation | undefined
>;
const unknownAccountScope = (account: string) =>
  createHash("sha256")
    .update(JSON.stringify({ account, windows: "unknown" }))
    .digest("hex");
export function assessSubscription(
  observation: SubscriptionObservation | undefined,
  now = Date.now(),
  authModes: readonly SubscriptionAuthMode[] = subscriptionAuthModes,
): UsageReport {
  const accepted = (
    o: SubscriptionObservation | undefined,
  ): o is SubscriptionObservation => !!o && authModes.includes(o.authMode);
  const report: UsageReport = {
    checkId: randomUUID(),
    checkedAt: new Date(now).toISOString(),
    decision: "approval-required",
    remainingPercent: null,
    scope: "unknown",
  };
  if (
    accepted(observation) &&
    typeof observation.accountId === "string" &&
    observation.accountId
  ) {
    report.accountId = observation.accountId;
    report.scope = unknownAccountScope(observation.accountId);
  }
  if (accepted(observation) && observation.exhausted === true)
    report.decision = "exhausted";
  if (
    !observation ||
    !accepted(observation) ||
    typeof observation.accountId !== "string" ||
    !observation.accountId ||
    !Number.isFinite(Date.parse(observation.observedAt)) ||
    !fresh(observation.observedAt, now) ||
    !Array.isArray(observation.windows) ||
    !observation.windows.length ||
    typeof observation.exhausted !== "boolean" ||
    observation.windows.some(
      (window) =>
        !window ||
        typeof window.id !== "string" ||
        !window.id ||
        !Number.isFinite(window.usedPercent) ||
        window.usedPercent < 0 ||
        window.usedPercent > 100 ||
        !Number.isSafeInteger(window.resetsAt) ||
        window.resetsAt <= now / 1000,
    ) ||
    new Set(observation.windows.map((window) => window.id)).size !==
      observation.windows.length
  )
    return report;
  report.scope = createHash("sha256")
    .update(
      JSON.stringify({
        account: observation.accountId,
        windows: observation.windows
          .map(({ id, resetsAt }) => ({ id, resetsAt }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      }),
    )
    .digest("hex");
  report.remainingPercent = Math.min(
    ...observation.windows.map((window) => 100 - window.usedPercent),
  );
  report.decision =
    observation.exhausted || report.remainingPercent === 0
      ? "exhausted"
      : report.remainingPercent <= 20
        ? "approval-required"
        : "ready";
  return report;
}

const usageFreshnessMs = 60_000;
function fresh(at: string, now: number, maximum = usageFreshnessMs): boolean {
  const age = now - Date.parse(at);
  return Number.isFinite(age) && age >= 0 && age <= maximum;
}

/** Owns observation assessment and one-operation owner allowances. The gate is
 * stateless: callers persist returned reports inside their existing transaction. */
export class UsageApprovalGate {
  constructor(private readonly clock: () => number = Date.now) {}

  observe(
    observation: SubscriptionObservation | undefined,
    previous?: UsageReport,
    endorsedAccount?: string,
  ): UsageReport {
    const report = assessSubscription(observation, this.clock());
    if (report.scope === "unknown" && endorsedAccount) {
      report.accountId = endorsedAccount;
      report.scope = unknownAccountScope(endorsedAccount);
    }
    if (
      previous?.approval?.scope === report.scope &&
      report.decision !== "exhausted"
    )
      report.approval = structuredClone(previous.approval);
    return report;
  }

  approve(
    usage: UsageReport | undefined,
    checkId: string,
  ): UsageReport | undefined {
    const now = this.clock();
    if (
      !usage ||
      usage.checkId !== checkId ||
      usage.decision !== "approval-required" ||
      !fresh(usage.checkedAt, now)
    )
      return undefined;
    return {
      ...structuredClone(usage),
      approval: { scope: usage.scope, at: new Date(now).toISOString() },
    };
  }

  permits(
    usage: UsageReport | undefined,
    operation: {
      operationId?: string;
      accountId?: string;
      scope?: string;
      /** A dispatched coding turn: its bound approval covers the whole turn. */
      dispatchedTurn?: boolean;
    } = {},
  ): boolean {
    const now = this.clock();
    return Boolean(
      usage &&
        fresh(usage.checkedAt, now) &&
        (operation.scope === undefined || usage.scope === operation.scope) &&
        (operation.accountId === undefined ||
          !usage.accountId ||
          usage.accountId === operation.accountId) &&
        (usage.decision === "ready" ||
          (usage.decision === "approval-required" &&
            usage.approval?.scope === usage.scope &&
            usage.approval.operationId === operation.operationId &&
            // Fresh to bind; once bound to a dispatched coding turn, the
            // observation's freshness governs for the rest of that turn.
            fresh(
              usage.approval.at,
              now,
              operation.dispatchedTurn && usage.approval.operationId
                ? Infinity
                : usageFreshnessMs,
            ))),
    );
  }

  bind(
    usage: UsageReport | undefined,
    operationId: string,
  ): UsageReport | undefined {
    if (!operationId || !this.permits(usage)) return undefined;
    const report = structuredClone(usage!);
    if (report.decision === "approval-required")
      report.approval!.operationId = operationId;
    else delete report.approval;
    return report;
  }
}
