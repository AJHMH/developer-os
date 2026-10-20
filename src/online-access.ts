import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { UsageApprovalGate, type UsageReport } from "./subscription.js";

/** Fixed synthetic routing policy. No URL, redirect, proxy, repository script or
 * provider credential is accepted from a worker. Model and dependency grants
 * have distinct destinations and capabilities; neither authorizes the other. */
export const onlinePolicyVersion = createHash("sha256")
  .update(readFileSync(new URL(import.meta.url)))
  .update(readFileSync(new URL("./session-lifecycle.js", import.meta.url)))
  .update(readFileSync(new URL("./subscription.js", import.meta.url)))
  .update(readFileSync(new URL("./inference-contract.js", import.meta.url)))
  .digest("hex");
export interface OnlineDependency {
  registry: "https://registry.npmjs.org";
  path: string;
  artifactSha256: string;
  bytes: number;
  policySha256: string;
  transport: "https" | "controlled";
}
export interface InferenceDescription {
  requestSha256: string;
  gatewayVersion: string;
  hostId: string;
}
export interface PreparedOnline {
  plan: OnlinePlan;
  sha256: string;
  expiresAt: number;
  consumed: boolean;
  approval?: { sha256: string; unknownUsageApproved: true };
}
export interface OnlinePlan {
  runId: string;
  deliveryId: string;
  repository: string;
  fence: number;
  accountId: string;
  usageScope: string;
  policyVersion: string;
  runtimeVersion: string;
  bindingSha256: string;
  hostPolicySha256: string;
  dependency?: OnlineDependency;
  inference?: InferenceDescription & {
    request: string;
    maxRequests: 1;
    deadlineSeconds: 30;
    retries: 0;
    refresh: false;
    paidFallback: false;
  };
}
export interface OnlineProof {
  dependencyArtifactSha256?: string;
  runId: string;
  policyVersion: string;
  model: "passed";
  dependency: "passed";
  bypass: "passed";
}
export interface OnlineStop {
  runId: string;
  revoked: boolean;
  remainingProcesses: number;
}
/** Trusted host management adapter. Fixed synthetic traffic only, no inference.
 * authorize must be called before each forwarded request. stop irreversibly
 * revokes capabilities and observes every worker/relay descendant independently.
 * Native implementations retain a journal for recovery after controller death. */
export interface OnlineAccessRuntime {
  readonly mode: "controlled" | "live";
  readonly version?: string;
  readonly requiresExactApproval?: boolean;
  inferenceRequest?(
    repository: string,
    authority: string,
  ): InferenceDescription;
  dependencyPlan?(repository: string): OnlineDependency;
  execute(
    plan: OnlinePlan,
    authorize: () => Promise<boolean>,
    artifact?: { bytes: Buffer; sha256: string },
  ): Promise<OnlineProof>;
  stop(runId: string): Promise<OnlineStop>;
}
export interface OnlineAccessEvidence extends OnlinePlan {
  /** The endorsed usage-reader account whose usage authorized this run. */
  usageAccountId?: string;
  mode: "controlled" | "live";
  state: "dispatched" | "stopped" | "uncertain";
  outcome: "running" | "passed" | "refused" | "uncertain";
  productionEnabled: false;
  usageAuthorization?: { authorizedAt: string; usage: UsageReport };
  proof?: OnlineProof;
  shutdown?: OnlineStop;
}

/** Missing account observations require the grant already bound to this run's
 * endorsed usage account. A changed observed account or window refuses. */
export function onlineUsagePermits(
  usage: UsageReport | undefined,
  run: OnlineAccessEvidence,
): boolean {
  return (
    !!run.usageAccountId &&
    new UsageApprovalGate().permits(usage, {
      operationId: run.runId,
      accountId: run.usageAccountId,
      scope: run.usageScope,
    })
  );
}
