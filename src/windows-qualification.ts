import type { Delivery } from "./controller.js";
import {
  evaluateQualificationRules,
  type QualificationCheck,
} from "./qualification-rules.js";

export type {
  QualificationCheck,
  QualificationCheckResult,
} from "./qualification-rules.js";
export interface HostWorkerQualificationReport {
  schema: 1;
  /** Fixed worker evidence never qualifies the complete delivery controller. */
  scope: "fixed-worker";
  target:
    | { platform: "win32"; arch: "x64"; provider: "hyperv" }
    | { platform: "darwin"; arch: "arm64"; provider: "applehv" };
  deliveryId: string;
  outcome: "qualified" | "blocked";
  source: {
    evidenceMode: "live" | "controlled" | "unavailable";
    checkedAt?: string;
    bindingSha256?: string;
    policySha256?: string;
    binding?: {
      osVersion?: string;
      machine?: string;
      hostId?: string;
      engineVersion?: string;
      vmImageSha256?: string;
      template?: string;
      workerVersion?: string;
      policyVersion?: string;
    };
  };
  checks: {
    hostBinding: QualificationCheck;
    offlineTransfer: QualificationCheck;
    adversarialIsolation: QualificationCheck;
    onlinePolicy: QualificationCheck;
    authentication: QualificationCheck;
    usageGate: QualificationCheck;
    fencingRecovery: QualificationCheck;
    syntheticTask: QualificationCheck;
    isolatedValidation: QualificationCheck;
  };
  blockers: string[];
  productionEnabled: false;
}

const sha256 = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
/** Builds a read-only snapshot. Controlled evidence remains visibly controlled
 * and cannot qualify Windows production; no report can enable delivery. */
export function windowsWorkerQualificationReport(
  delivery: Delivery,
): HostWorkerQualificationReport {
  return workerQualificationReport(delivery, false);
}

export function macosWorkerQualificationReport(
  delivery: Delivery,
): HostWorkerQualificationReport {
  return workerQualificationReport(delivery, true);
}

function workerQualificationReport(
  delivery: Delivery,
  macos: boolean,
): HostWorkerQualificationReport {
  const q = delivery.qualification,
    binding = q?.offlineAdmission?.binding,
    evidenceMode = q?.mode ?? "unavailable";
  const { checks, blockers } = evaluateQualificationRules(delivery, macos);
  const status =
    Object.values(checks).every((entry) => entry.result === "passed") &&
    Object.values(checks).every((entry) => entry.evidenceMode === "live")
      ? "qualified"
      : "blocked";
  return {
    schema: 1,
    scope: "fixed-worker",
    target: macos
      ? { platform: "darwin", arch: "arm64", provider: "applehv" }
      : { platform: "win32", arch: "x64", provider: "hyperv" },
    deliveryId: delivery.id,
    outcome: status,
    source: {
      evidenceMode,
      ...(q?.checkedAt ? { checkedAt: q.checkedAt } : {}),
      ...(sha256(q?.bindingSha256) ? { bindingSha256: q.bindingSha256 } : {}),
      ...(sha256(q?.policySha256) ? { policySha256: q.policySha256 } : {}),
      ...(binding
        ? {
            binding: Object.fromEntries(
              [
                "osVersion",
                "machine",
                "hostId",
                "engineVersion",
                "vmImageSha256",
                "template",
                "workerVersion",
                "policyVersion",
              ].flatMap((key) =>
                typeof binding[key] === "string" ? [[key, binding[key]]] : [],
              ),
            ),
          }
        : {}),
    },
    checks,
    blockers: macos
      ? blockers.map((message) =>
          message
            .replaceAll("Windows Hyper-V", "macOS AppleHV")
            .replaceAll("Windows", "macOS"),
        )
      : blockers,
    productionEnabled: false,
  };
}

/** Compatibility name for persisted consumer integrations. */
export type WindowsWorkerQualificationReport = HostWorkerQualificationReport;
