import type { SubscriptionMediationReport } from "./codex-mediation.js";

export const isolationProbes = [
  "host-files",
  "controller-ledger",
  "owner-credentials",
  "ssh-gpg",
  "host-docker",
  "skills-mcp-hooks",
  "github-binding",
  "effective-mounts",
  "model-only-auth",
  "spending-control",
  "network-bypass",
  "dependency-egress",
  "cross-delivery",
  "descendant-stop",
  "orphan-resume",
  "repository-fencing",
] as const;
export type IsolationProbe = (typeof isolationProbes)[number];
export interface WorkerQualification {
  runtimeVersions?: import("./qualification-versions.js").QualificationRuntimeVersions;
  adversarialBlocker?: string;
  /** Where inside a refused isolation probe it failed; fixed names only. */
  adversarialDiagnostic?: import("./native-diagnostics.js").IsolationProbeDiagnostic;
  adversarial?: {
    scope: "synthetic-macos-controls";
    challengeId: string;
    probeVersion: string;
    escapeAttempts: string[];
  };
  subscriptionMediation?: SubscriptionMediationReport;
  offlineAdmission?: {
    allowed: boolean;
    scope: "offline-probe-only";
    /** Where a refused admission stopped. */
    refusal?: OfflineAdmissionRefusal;
    /** The pinned binding keys an observation no longer matched; names only. */
    mismatchedKeys?: string[];
    binding?: Record<string, string>;
    effective?: Record<string, string | boolean | string[]>;
    configurationIntent?: { hostSharesConfigured: boolean; rootful: boolean };
  };
  ready: boolean;
  liveReady: boolean;
  mode: "live" | "controlled" | "unavailable";
  checkedAt: string;
  policySha256?: string;
  bindingSha256?: string;
  host?: {
    sbxVersion?: string;
    virtualization: "verified" | "unknown" | "conflicting";
    daemon: "verified" | "unknown" | "conflicting";
    authentication: "verified" | "unknown" | "conflicting";
  };
  probes: {
    name: IsolationProbe;
    outcome: "passed" | "failed" | "not-run";
    evidenceSha256?: string;
  }[];
  blockers: string[];
}
export type OfflineAdmissionRefusal =
  | "authority-directory"
  | "observation"
  | "configuration"
  | "policy"
  | "binding"
  | "unsupported-binding"
  | "effective-controls"
  | "adversarial-driver";
export function unavailableQualification(): WorkerQualification {
  return {
    ready: false,
    liveReady: false,
    mode: "unavailable",
    checkedAt: new Date().toISOString(),
    probes: isolationProbes.map((name) => ({ name, outcome: "not-run" })),
    blockers: [
      "Configure an external pinned worker policy and qualify the selected dedicated Podman VM runtime; host prerequisites and enforcement have not been demonstrated.",
    ],
  };
}
