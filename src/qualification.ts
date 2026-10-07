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
export function unavailableQualification(): WorkerQualification {
  return {
    ready: false,
    liveReady: false,
    mode: "unavailable",
    checkedAt: new Date().toISOString(),
    probes: isolationProbes.map((name) => ({ name, outcome: "not-run" })),
    blockers: [
      "Configure an external pinned worker policy and a qualified Docker Sandboxes probe runtime; host prerequisites and enforcement have not been demonstrated.",
    ],
  };
}
