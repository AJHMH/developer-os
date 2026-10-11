import type { Delivery } from "./controller.js";
import { isolationProbes } from "./qualification.js";

export type QualificationCheckResult = "passed" | "failed" | "not-run";
export interface QualificationCheck {
  result: QualificationCheckResult;
  evidenceMode: "live" | "controlled" | "unavailable";
  evidenceSha256?: string;
}
export interface WindowsWorkerQualificationReport {
  schema: 1;
  target: { platform: "win32"; arch: "x64"; provider: "hyperv" };
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
const sameBinding = (delivery: Delivery) => {
  const q = delivery.qualification,
    binding = q?.offlineAdmission?.binding;
  return Boolean(
    q?.offlineAdmission?.allowed &&
      binding?.platform === "win32" &&
      binding.arch === "x64" &&
      binding.provider === "hyperv" &&
      /^10\.0\.\d+$/.test(binding.osVersion ?? "") &&
      Number(binding.osVersion?.split(".")[2]) >= 22000 &&
      /^aios-[a-z0-9-]+$/.test(binding.machine ?? "") &&
      sha256(binding.hostId) &&
      sha256(binding.vmImageSha256) &&
      /^[a-z0-9./_-]+@sha256:[a-f0-9]{64}$/.test(binding.template ?? "") &&
      /^\d+\.\d+\.\d+$/.test(binding.engineVersion ?? "") &&
      /^\d+\.\d+\.\d+$/.test(binding.workerVersion ?? "") &&
      q.offlineAdmission.effective?.hypervisor === true &&
      q.offlineAdmission.effective.dedicated === true &&
      q.offlineAdmission.effective.managementExposed === false &&
      q.offlineAdmission.effective.rootful === false &&
      q.offlineAdmission.effective.network === "none" &&
      q.offlineAdmission.effective.readOnly === true &&
      q.offlineAdmission.effective.user === "65534:65534" &&
      q.offlineAdmission.effective.noNewPrivileges === true &&
      Array.isArray(q.offlineAdmission.effective.mounts) &&
      q.offlineAdmission.effective.mounts.length === 0 &&
      Array.isArray(q.offlineAdmission.effective.capabilities) &&
      q.offlineAdmission.effective.capabilities.length === 0 &&
      sha256(q.bindingSha256) &&
      sha256(q.policySha256),
  );
};

const check = (
  result: QualificationCheckResult,
  evidenceMode: QualificationCheck["evidenceMode"],
  evidenceSha256?: string,
): QualificationCheck => ({
  result,
  evidenceMode,
  ...(sha256(evidenceSha256) ? { evidenceSha256 } : {}),
});

/** Builds a read-only snapshot. Controlled evidence remains visibly controlled
 * and cannot qualify Windows production; no report can enable delivery. */
export function windowsWorkerQualificationReport(
  delivery: Delivery,
): WindowsWorkerQualificationReport {
  const q = delivery.qualification,
    admission = q?.offlineAdmission,
    binding = admission?.binding,
    evidenceMode = q?.mode ?? "unavailable",
    noQualification = !q,
    matchingBinding = sameBinding(delivery);
  const hostBinding = check(
    noQualification ? "not-run" : matchingBinding ? "passed" : "failed",
    evidenceMode,
    q?.bindingSha256,
  );

  const canary = delivery.offlineCanary;
  const offlineTransfer = check(
    !canary
      ? "not-run"
      : canary.outcome === "completed" &&
          canary.bindingSha256 === q?.bindingSha256 &&
          canary.policySha256 === q?.policySha256 &&
          canary.shutdownProof?.remainingProcesses === 0 &&
          Boolean(canary.inputSha256 && canary.outputSha256)
        ? "passed"
        : "failed",
    canary?.mode ?? "unavailable",
    canary?.outputSha256,
  );

  const requiredIsolation = isolationProbes;
  const probes = q?.probes ?? [];
  const adversarial = q?.adversarial;
  const adversarialPassed = Boolean(
    matchingBinding &&
      adversarial?.scope === "synthetic-windows-controls" &&
      /^[a-f0-9-]{36}$/.test(adversarial.challengeId) &&
      sha256(adversarial.probeVersion) &&
      adversarial.escapeAttempts.length === 4 &&
      adversarial.escapeAttempts.every((attempt) =>
        /^passed-escape-(unshare|chroot|cgroup|proc)$/.test(attempt),
      ) &&
      requiredIsolation.every((name) => {
        const probe = probes.find((entry) => entry.name === name);
        return probe?.outcome === "passed" && sha256(probe.evidenceSha256);
      }),
  );
  const adversarialIsolation = check(
    adversarial ? (adversarialPassed ? "passed" : "failed") : "not-run",
    adversarial ? evidenceMode : "unavailable",
    adversarial?.probeVersion,
  );

  const online = delivery.onlineAccess;
  const onlinePassed = Boolean(
    matchingBinding &&
      online?.outcome === "passed" &&
      online.state === "stopped" &&
      online.productionEnabled === false &&
      online.bindingSha256 === q?.bindingSha256 &&
      online.hostPolicySha256 === q?.policySha256 &&
      online.proof?.runId === online.runId &&
      online.proof.policyVersion === online.policyVersion &&
      online.proof.model === "passed" &&
      online.proof.dependency === "passed" &&
      online.proof.bypass === "passed" &&
      online.shutdown?.revoked === true &&
      online.shutdown.remainingProcesses === 0,
  );
  const onlinePolicy = check(
    !online ? "not-run" : onlinePassed ? "passed" : "failed",
    online?.mode ?? "unavailable",
    online?.policyVersion,
  );

  const authentication = check("not-run", "unavailable");
  const usageAge = delivery.usage
    ? Date.now() - Date.parse(delivery.usage.checkedAt)
    : Number.NaN;
  const usageApprovedForRun = Boolean(
    delivery.usage &&
      (delivery.usage.decision === "ready" ||
        (delivery.usage.decision === "approval-required" &&
          delivery.usage.approval?.scope === delivery.usage.scope &&
          delivery.usage.approval.operationId === online?.runId &&
          Date.now() - Date.parse(delivery.usage.approval.at) >= 0 &&
          Date.now() - Date.parse(delivery.usage.approval.at) <= 60000)),
  );
  const usageGate = check(
    onlinePassed &&
      delivery.usage?.checkId &&
      delivery.usage.scope === online?.usageScope &&
      (!delivery.usage.accountId ||
        delivery.usage.accountId === online?.accountId) &&
      usageAge >= 0 &&
      usageAge <= 60000 &&
      usageApprovedForRun
      ? "passed"
      : "not-run",
    online?.mode ?? "unavailable",
    online?.usageScope,
  );

  const fencingPassed = Boolean(
    adversarialPassed &&
      canary?.outcome === "completed" &&
      canary.shutdownProof?.remainingProcesses === 0 &&
      !delivery.recovery?.some((event) => event.outcome === "uncertain"),
  );
  const fencingRecovery = check(
    fencingPassed ? "passed" : "not-run",
    canary?.mode === "live" && evidenceMode === "live"
      ? "live"
      : canary
        ? "controlled"
        : "unavailable",
    canary?.shutdownProof?.censusSha256,
  );
  const syntheticTask = check("not-run", "unavailable");
  const isolatedValidation = check("not-run", "unavailable");

  const checks = {
    hostBinding,
    offlineTransfer,
    adversarialIsolation,
    onlinePolicy,
    authentication,
    usageGate,
    fencingRecovery,
    syntheticTask,
    isolatedValidation,
  };
  const blockers: string[] = [];
  if (hostBinding.result !== "passed" || evidenceMode !== "live")
    blockers.push(
      "Native Windows Hyper-V binding and effective worker controls are not qualified; controlled observations do not qualify the host.",
    );
  if (offlineTransfer.result !== "passed" || canary?.mode !== "live")
    blockers.push(
      "A binding-matched native offline transfer, stopped-worker proof and safe result collection are not recorded.",
    );
  if (adversarialIsolation.result !== "passed" || evidenceMode !== "live")
    blockers.push(
      "The complete native Windows positive/negative isolation and escape-control report is not recorded.",
    );
  if (onlinePolicy.result !== "passed" || online?.mode !== "live")
    blockers.push(
      "Native model and dependency endpoint enforcement is not qualified for this Windows binding.",
    );
  if (authentication.result !== "passed")
    blockers.push(
      "Windows worker authentication isolation has no trusted qualification evidence.",
    );
  if (usageGate.result !== "passed")
    blockers.push(
      "A fresh account/window-scoped usage check has not authorized this online run.",
    );
  if (fencingRecovery.result !== "passed" || evidenceMode !== "live")
    blockers.push(
      "Native Windows fencing and recovery evidence is incomplete for this delivery.",
    );
  if (syntheticTask.result !== "passed")
    blockers.push(
      "A synthetic worker task has not completed through the qualified Windows worker.",
    );
  if (isolatedValidation.result !== "passed")
    blockers.push(
      "Isolated validation and safe result collection have not been qualified through the Windows worker.",
    );

  const status =
    Object.values(checks).every((entry) => entry.result === "passed") &&
    Object.values(checks).every((entry) => entry.evidenceMode === "live")
      ? "qualified"
      : "blocked";
  return {
    schema: 1,
    target: { platform: "win32", arch: "x64", provider: "hyperv" },
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
    blockers,
    productionEnabled: false,
  };
}
