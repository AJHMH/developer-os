import { createHash } from "node:crypto";
import {
  observeCodexAccount,
  pinnedHostCodex,
  type CodexExecutable,
} from "./codex-app-server.js";
import type {
  SubscriptionObservation,
  SubscriptionReader,
} from "./subscription.js";

/** Usage inspection deliberately uses the owner's host environment/account. It
 * still requires the exact independently pinned executable before and after RPC. */
export function codexSubscriptionReader(
  executable: string | CodexExecutable,
): SubscriptionReader {
  const pin =
    typeof executable === "string"
      ? pinnedHostCodex(executable)
      : { ...executable };
  return async () => {
    try {
      const observed = await observeCodexAccount(
        pin,
        { policy: "owner" },
        true,
      );
      if ("refusal" in observed) return observed;
      const account = observed.session.account,
        limits = observed.session.rateLimits;
      if (
        !account ||
        account.type !== "chatgpt" ||
        typeof account.email !== "string"
      )
        return { refusal: "not-chatgpt" };
      if (!limits) return { refusal: "limits" };
      const buckets =
        limits.rateLimitsByLimitId !== undefined &&
        limits.rateLimitsByLimitId !== null
          ? Object.values(limits.rateLimitsByLimitId)
          : [limits.rateLimits];
      const windows: SubscriptionObservation["windows"] = [];
      let exhausted = false;
      for (const raw of buckets) {
        const bucket = raw as any;
        if (!bucket || typeof bucket.limitId !== "string")
          return { refusal: "limits" };
        exhausted ||= Boolean(bucket.rateLimitReachedType);
        for (const key of ["primary", "secondary"] as const) {
          const window = bucket[key];
          if (window != null)
            windows.push({
              id: bucket.limitId + ":" + key,
              usedPercent: window.usedPercent,
              resetsAt: window.resetsAt,
            });
        }
      }
      return {
        observedAt: new Date().toISOString(),
        authMode: "chatgpt",
        accountId: createHash("sha256").update(account.email).digest("hex"),
        windows,
        exhausted,
      };
    } catch {
      return undefined;
    }
  };
}
