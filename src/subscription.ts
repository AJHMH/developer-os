import { createHash, randomUUID } from "node:crypto";

export interface SubscriptionObservation {
  observedAt: string;
  accountId: string;
  authMode: "chatgpt";
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
export function assessSubscription(
  observation: SubscriptionObservation | undefined,
): UsageReport {
  const report: UsageReport = {
    checkId: randomUUID(),
    checkedAt: new Date().toISOString(),
    decision: "approval-required",
    remainingPercent: null,
    scope: "unknown",
  };
  if (
    observation?.authMode === "chatgpt" &&
    typeof observation.accountId === "string" &&
    observation.accountId
  ) {
    report.accountId = observation.accountId;
    report.scope = createHash("sha256")
      .update(
        JSON.stringify({ account: observation.accountId, windows: "unknown" }),
      )
      .digest("hex");
  }
  if (observation?.authMode === "chatgpt" && observation.exhausted === true)
    report.decision = "exhausted";
  if (
    !observation ||
    observation.authMode !== "chatgpt" ||
    typeof observation.accountId !== "string" ||
    !observation.accountId ||
    !Number.isFinite(Date.parse(observation.observedAt)) ||
    Math.abs(Date.now() - Date.parse(observation.observedAt)) > 60000 ||
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
        window.resetsAt <= Date.now() / 1000,
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
