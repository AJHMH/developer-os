import { subscriptionDecisionScope } from "./subscription-decision.js";
import type { Delivery } from "./controller.js";
import {
  syntheticSiteInput,
  syntheticSiteOutput,
  syntheticTaskVersion,
} from "./synthetic-task.js";
import { sha256 as digest } from "./offline-canary.js";
import { isolationProbes } from "./qualification.js";
import { readFileSync } from "node:fs";
import { onlinePolicyVersion } from "./online-access.js";
import {
  windowsControlsVersion,
  windowsControlNames,
} from "./windows-controls.js";

export type QualificationCheckResult = "passed" | "failed" | "not-run";
export interface QualificationCheck {
  result: QualificationCheckResult;
  evidenceMode: "live" | "controlled" | "unavailable";
  evidenceSha256?: string;
}
export interface WindowsWorkerQualificationReport {
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
const sameBinding = (delivery: Delivery, macos: boolean) => {
  const q = delivery.qualification,
    binding = q?.offlineAdmission?.binding;
  return Boolean(
    q?.offlineAdmission?.allowed &&
      binding &&
      (macos
        ? binding?.platform === "darwin" &&
          binding.arch === "arm64" &&
          binding.provider === "applehv" &&
          /^\d+\.\d+\.\d+$/.test(binding.osVersion ?? "") &&
          Number(binding.osVersion?.split(".")[0]) >= 23
        : binding?.platform === "win32" &&
          binding.arch === "x64" &&
          binding.provider === "hyperv" &&
          /^10\.0\.\d+$/.test(binding.osVersion ?? "") &&
          Number(binding.osVersion?.split(".")[2]) >= 22000) &&
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
  return workerQualificationReport(delivery, false);
}

export function macosWorkerQualificationReport(
  delivery: Delivery,
): WindowsWorkerQualificationReport {
  return workerQualificationReport(delivery, true);
}

function workerQualificationReport(
  delivery: Delivery,
  macos: boolean,
): WindowsWorkerQualificationReport {
  const q = delivery.qualification,
    admission = q?.offlineAdmission,
    binding = admission?.binding,
    evidenceMode = q?.mode ?? "unavailable",
    noQualification = !q,
    matchingBinding = sameBinding(delivery, macos);
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
  const controls = delivery.windowsControls;
  const controlsPassed = Boolean(
    matchingBinding &&
      controls?.outcome === "passed" &&
      controls.productionEnabled === false &&
      controls.mode === evidenceMode &&
      controls.version === windowsControlsVersion &&
      controls.nativeVersion ===
        digest(readFileSync(new URL("./podman-native.js", import.meta.url))) &&
      controls.bindingSha256 === q?.bindingSha256 &&
      controls.policySha256 === q?.policySha256 &&
      [delivery.execution, ...(delivery.sessions ?? [])].some(
        (s) => s?.operationId === controls.operationId && s.state === "stopped",
      ) &&
      controls.checks.length === windowsControlNames.length &&
      windowsControlNames.every((name) =>
        controls.checks.some(
          (c) => c.name === name && sha256(c.evidenceSha256),
        ),
      ) &&
      controls.censuses.length >= 2 &&
      controls.censuses.every(
        (c) =>
          c.observedProcesses >= 8 &&
          c.remainingProcesses === 0 &&
          sha256(c.censusSha256),
      ),
  );
  const probes = q?.probes ?? [];
  const adversarial = q?.adversarial;
  const adversarialPassed = Boolean(
    matchingBinding &&
      adversarial?.scope ===
        (macos ? "synthetic-macos-controls" : "synthetic-windows-controls") &&
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
  let adversarialIsolation = check(
    adversarial ? (adversarialPassed ? "passed" : "failed") : "not-run",
    adversarial ? evidenceMode : "unavailable",
    adversarial?.probeVersion,
  );

  const online = delivery.onlineAccess;
  const nativeOnlineVersion = digest(
    readFileSync(new URL("./online-native.js", import.meta.url)),
  );
  const nativeArtifactVersion = digest(
    readFileSync(new URL("./npm-artifact.js", import.meta.url)) +
      "\n" +
      nativeOnlineVersion,
  );
  const onlinePassed = Boolean(
    matchingBinding &&
      online?.outcome === "passed" &&
      online.state === "stopped" &&
      online.productionEnabled === false &&
      online.mode === evidenceMode &&
      (evidenceMode !== "live" ||
        (online.policyVersion === onlinePolicyVersion &&
          [nativeOnlineVersion, nativeArtifactVersion].includes(
            online.runtimeVersion,
          ))) &&
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

  const decision = q?.subscriptionMediation?.mechanismDecision;
  const authentication = check(
    matchingBinding &&
      decision?.qualified === true &&
      decision.scope === subscriptionDecisionScope(binding) &&
      decision.bindingSha256 === q?.bindingSha256 &&
      decision.inferenceAuthorized === false
      ? "passed"
      : "not-run",
    decision ? evidenceMode : "unavailable",
    decision?.requestSha256,
  );
  // Historical dispatch evidence expires at its authorization instant, never
  // conferring authority for another request. Live dispatch still rechecks usage.
  const authorized = online?.usageAuthorization;
  const usage = authorized?.usage ?? delivery.usage;
  const authorizationTime = authorized
    ? Date.parse(authorized.authorizedAt)
    : Date.now();
  const usageAge = usage
    ? authorizationTime - Date.parse(usage.checkedAt)
    : Number.NaN;
  const usageApprovedForRun = Boolean(
    usage &&
      (usage.decision === "ready" ||
        (usage.decision === "approval-required" &&
          usage.approval?.scope === usage.scope &&
          usage.approval.operationId === online?.runId &&
          authorizationTime - Date.parse(usage.approval.at) >= 0 &&
          authorizationTime - Date.parse(usage.approval.at) <= 60000)),
  );
  const usageGate = check(
    onlinePassed &&
      (evidenceMode !== "live" || authorized) &&
      authorizationTime <= Date.now() &&
      usage?.checkId &&
      usage.scope === online?.usageScope &&
      (!usage.accountId || usage.accountId === online?.accountId) &&
      usageAge >= 0 &&
      usageAge <= 60000 &&
      usageApprovedForRun
      ? "passed"
      : "not-run",
    online?.mode ?? "unavailable",
    online?.usageScope,
  );

  if (
    !adversarialPassed &&
    controlsPassed &&
    onlinePassed &&
    usageGate.result === "passed" &&
    authentication.result === "passed" &&
    q?.subscriptionMediation?.explicitResume === "passed" &&
    adversarial &&
    adversarial.scope ===
      (macos ? "synthetic-macos-controls" : "synthetic-windows-controls") &&
    /^[a-f0-9-]{36}$/.test(adversarial.challengeId) &&
    sha256(adversarial.probeVersion) &&
    adversarial.escapeAttempts.length === 4 &&
    ["unshare", "chroot", "cgroup", "proc"].every((name) =>
      adversarial.escapeAttempts.includes("passed-escape-" + name),
    ) &&
    requiredIsolation.every((name) => {
      const probe = probes.find((p) => p.name === name);
      if (probe?.outcome === "failed") return false;
      if (probe?.outcome === "passed" && sha256(probe.evidenceSha256))
        return true;
      if (
        windowsControlNames.includes(
          name as (typeof windowsControlNames)[number],
        )
      )
        return true;
      return [
        "model-only-auth",
        "spending-control",
        "dependency-egress",
      ].includes(name);
    })
  )
    adversarialIsolation = check(
      "passed",
      evidenceMode,
      adversarial.probeVersion,
    );

  const fencingPassed = Boolean(
    (controlsPassed ||
      (evidenceMode === "controlled" &&
        adversarialPassed &&
        canary?.outcome === "completed" &&
        canary.shutdownProof?.remainingProcesses === 0)) &&
      ![delivery.execution, ...(delivery.sessions ?? [])].some(
        (session) => session && session.state !== "stopped",
      ) &&
      !delivery.recovery?.some(
        (event, index, history) =>
          event.outcome === "uncertain" &&
          !history
            .slice(index + 1)
            .some(
              (later) =>
                later.outcome === "stopped" &&
                Number.isSafeInteger(event.fence) &&
                Number.isSafeInteger(later.fence) &&
                later.fence >= event.fence,
            ),
      ),
  );
  const fencingRecovery = check(
    fencingPassed ? "passed" : "not-run",
    (controls?.mode === "live" || canary?.mode === "live") &&
      evidenceMode === "live"
      ? "live"
      : canary
        ? "controlled"
        : "unavailable",
    controlsPassed
      ? controls?.censuses.at(-1)?.censusSha256
      : canary?.shutdownProof?.censusSha256,
  );
  const task = delivery.syntheticTask;
  const taskPassed = Boolean(
    matchingBinding &&
      authentication.result === "passed" &&
      task?.outcome === "completed" &&
      task.productionEnabled === false &&
      task.version === syntheticTaskVersion &&
      task.bindingSha256 === q?.bindingSha256 &&
      task.policySha256 === q?.policySha256 &&
      task.session?.state === "stopped" &&
      task.session.operationId === canary?.session?.operationId &&
      task.shutdownProof?.remainingProcesses === 0 &&
      sha256(task.shutdownProof.censusSha256) &&
      task.result?.version === task.version &&
      task.result.operationId === task.session.operationId &&
      task.result.inputSha256 === digest(syntheticSiteInput) &&
      task.result.output === syntheticSiteOutput &&
      task.result.outputSha256 === digest(syntheticSiteOutput) &&
      task.result.validation === "passed" &&
      task.result.negativeValidation === "passed" &&
      task.result.httpValidation === "passed" &&
      sha256(task.result.collectionSha256),
  );
  const syntheticTask = check(
    taskPassed ? "passed" : "not-run",
    task?.mode ?? "unavailable",
    task?.result?.outputSha256,
  );
  const isolatedValidation = check(
    taskPassed ? "passed" : "not-run",
    task?.mode ?? "unavailable",
    task?.result?.collectionSha256,
  );

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
