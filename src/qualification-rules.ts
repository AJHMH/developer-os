import type { Delivery } from "./controller.js";
import {
  qualificationCheckNames,
  validEffectiveControls,
  validHostBinding,
} from "./host-target.js";
import { sha256 as digest } from "./offline-canary.js";
import { onlinePolicyVersion } from "./online-access.js";
import {
  qualificationRuntimeVersions,
  qualificationVersionsMatch,
} from "./qualification-versions.js";
import { isolationProbes } from "./qualification.js";
import { sessionsQuiescent } from "./session-lifecycle.js";
import { subscriptionDecisionScope } from "./subscription-decision.js";
import { UsageApprovalGate } from "./subscription.js";
import {
  syntheticSiteInput,
  syntheticSiteOutput,
  syntheticTaskVersion,
} from "./synthetic-task.js";
import { hostControlNames, hostControlsVersion } from "./windows-controls.js";

export type QualificationCheckResult = "passed" | "failed" | "not-run";
export interface QualificationCheck {
  result: QualificationCheckResult;
  evidenceMode: "live" | "controlled" | "unavailable";
  evidenceSha256?: string;
}
export type QualificationCheckName = (typeof qualificationCheckNames)[number];
const sha256 = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const check = (
  result: QualificationCheckResult,
  evidenceMode: QualificationCheck["evidenceMode"],
  evidenceSha256?: string,
): QualificationCheck => ({
  result,
  evidenceMode,
  ...(sha256(evidenceSha256) ? { evidenceSha256 } : {}),
});
function contextFor(delivery: Delivery, macos: boolean, now: number) {
  const q = delivery.qualification,
    binding = q?.offlineAdmission?.binding,
    online = delivery.onlineAccess,
    authorized = online?.usageAuthorization;
  return {
    delivery,
    macos,
    q,
    binding,
    evidenceMode: q?.mode ?? "unavailable",
    noQualification: !q,
    matchingBinding: Boolean(
      q?.offlineAdmission?.allowed &&
        validHostBinding(binding, macos ? "darwin" : "win32") &&
        validEffectiveControls(q.offlineAdmission.effective) &&
        sha256(q.bindingSha256) &&
        sha256(q.policySha256) &&
        qualificationVersionsMatch(q.runtimeVersions),
    ),
    canary: delivery.offlineCanary,
    controls: delivery.windowsControls,
    probes: q?.probes ?? [],
    adversarial: q?.adversarial,
    online,
    decision: q?.subscriptionMediation?.mechanismDecision,
    authorized,
    usage: authorized?.usage ?? delivery.usage,
    authorizationTime: authorized ? Date.parse(authorized.authorizedAt) : now,
    task: delivery.syntheticTask,
    now,
  };
}
type Context = ReturnType<typeof contextFor>;

function controlsProven(context: Context): boolean {
  const { delivery, q, evidenceMode, matchingBinding, controls } = context;
  const controlsPassed = Boolean(
    matchingBinding &&
      controls?.outcome === "passed" &&
      controls.productionEnabled === false &&
      controls.mode === evidenceMode &&
      controls.version === hostControlsVersion &&
      controls.nativeVersion === qualificationRuntimeVersions.worker &&
      controls.bindingSha256 === q?.bindingSha256 &&
      controls.policySha256 === q?.policySha256 &&
      [delivery.execution, ...(delivery.sessions ?? [])].some(
        (s) => s?.operationId === controls.operationId && s.state === "stopped",
      ) &&
      controls.checks.length === hostControlNames.length &&
      hostControlNames.every((name) =>
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
  return controlsPassed;
}

function adversarialProven(context: Context): boolean {
  const { macos, matchingBinding, probes, adversarial } = context;
  const requiredIsolation = isolationProbes;
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
  return adversarialPassed;
}

function onlineProven(context: Context): boolean {
  const { q, evidenceMode, matchingBinding, online } = context;
  const nativeOnlineVersion = qualificationRuntimeVersions.online,
    nativeArtifactVersion = qualificationRuntimeVersions.artifact;
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
  return onlinePassed;
}

function fencingProven(context: Context): boolean {
  const { delivery, evidenceMode, canary } = context;
  const controlsPassed = controlsProven(context),
    adversarialPassed = adversarialProven(context);
  const fencingPassed = Boolean(
    (controlsPassed ||
      (evidenceMode === "controlled" &&
        adversarialPassed &&
        canary?.outcome === "completed" &&
        canary.shutdownProof?.remainingProcesses === 0)) &&
      sessionsQuiescent(delivery) &&
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
  return fencingPassed;
}

function taskProven(context: Context): boolean {
  const { q, matchingBinding, canary, task } = context;
  const authentication = checkAuthentication(context);
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
  return taskPassed;
}

function checkHost(context: Context): QualificationCheck {
  const { q, evidenceMode, noQualification, matchingBinding } = context;
  const hostBinding = check(
    noQualification ? "not-run" : matchingBinding ? "passed" : "failed",
    evidenceMode,
    q?.bindingSha256,
  );
  return hostBinding;
}

function checkOffline(context: Context): QualificationCheck {
  const { q, canary } = context;
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
  return offlineTransfer;
}

function checkOnline(context: Context): QualificationCheck {
  const { online } = context;
  const onlinePassed = onlineProven(context);
  const onlinePolicy = check(
    !online ? "not-run" : onlinePassed ? "passed" : "failed",
    online?.mode ?? "unavailable",
    online?.policyVersion,
  );
  return onlinePolicy;
}

function checkAuthentication(context: Context): QualificationCheck {
  const { q, binding, evidenceMode, matchingBinding, decision } = context;
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
  return authentication;
}

function checkFencing(context: Context): QualificationCheck {
  const { evidenceMode, canary, controls } = context;
  const fencingPassed = fencingProven(context),
    controlsPassed = controlsProven(context);
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
  return fencingRecovery;
}

function checkTask(context: Context): QualificationCheck {
  const { task } = context;
  const taskPassed = taskProven(context);
  const syntheticTask = check(
    taskPassed ? "passed" : "not-run",
    task?.mode ?? "unavailable",
    task?.result?.outputSha256,
  );
  return syntheticTask;
}

function checkValidation(context: Context): QualificationCheck {
  const { task } = context;
  const taskPassed = taskProven(context);
  const isolatedValidation = check(
    taskPassed ? "passed" : "not-run",
    task?.mode ?? "unavailable",
    task?.result?.collectionSha256,
  );
  return isolatedValidation;
}

function checkUsage(context: Context): QualificationCheck {
  const { online, authorized, usage, authorizationTime, evidenceMode, now } =
    context;
  const passed =
    online &&
    onlineProven(context) &&
    (evidenceMode !== "live" || authorized) &&
    Number.isFinite(authorizationTime) &&
    authorizationTime <= now &&
    usage?.checkId &&
    // Usage identifies the run's endorsed usage-reader account.
    online.usageAccountId &&
    new UsageApprovalGate(() => authorizationTime).permits(usage, {
      operationId: online.runId,
      accountId: online.usageAccountId,
      scope: online.usageScope,
    });
  return check(
    passed ? "passed" : "not-run",
    online?.mode ?? "unavailable",
    online?.usageScope,
  );
}
/** Supplemental controls can complete only explicitly listed not-run probes.
 * A failed probe is never upgraded by this rule. */
function supplementalIsolationProven(context: Context): boolean {
  const { macos, q, probes, adversarial } = context;
  const requiredIsolation = isolationProbes;
  const controlsPassed = controlsProven(context),
    adversarialPassed = adversarialProven(context),
    onlinePassed = onlineProven(context),
    usageGate = checkUsage(context),
    authentication = checkAuthentication(context);
  return Boolean(
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
          hostControlNames.includes(name as (typeof hostControlNames)[number])
        )
          return true;
        return [
          "model-only-auth",
          "spending-control",
          "dependency-egress",
        ].includes(name);
      }),
  );
}
function checkIsolation(context: Context): QualificationCheck {
  const { adversarial, evidenceMode } = context;
  return check(
    !adversarial
      ? "not-run"
      : adversarialProven(context) || supplementalIsolationProven(context)
        ? "passed"
        : "failed",
    adversarial ? evidenceMode : "unavailable",
    adversarial?.probeVersion,
  );
}
interface Rule {
  name: QualificationCheckName;
  evaluate(context: Context): QualificationCheck;
  blocker(context: Context, value: QualificationCheck): string | undefined;
}
const rules: readonly Rule[] = [
  {
    name: "hostBinding",
    evaluate: checkHost,
    blocker: (context, value) =>
      value.result !== "passed" || context.evidenceMode !== "live"
        ? "Native Windows Hyper-V binding and effective worker controls are not qualified; controlled observations do not qualify the host."
        : undefined,
  },
  {
    name: "offlineTransfer",
    evaluate: checkOffline,
    blocker: (context, value) =>
      value.result !== "passed" || context.canary?.mode !== "live"
        ? "A binding-matched native offline transfer, stopped-worker proof and safe result collection are not recorded."
        : undefined,
  },
  {
    name: "adversarialIsolation",
    evaluate: checkIsolation,
    blocker: (context, value) =>
      value.result !== "passed" || context.evidenceMode !== "live"
        ? "The complete native Windows positive/negative isolation and escape-control report is not recorded."
        : undefined,
  },
  {
    name: "onlinePolicy",
    evaluate: checkOnline,
    blocker: (context, value) =>
      value.result !== "passed" || context.online?.mode !== "live"
        ? "Native model and dependency endpoint enforcement is not qualified for this Windows binding."
        : undefined,
  },
  {
    name: "authentication",
    evaluate: checkAuthentication,
    blocker: (context, value) =>
      value.result !== "passed"
        ? "Windows worker authentication isolation has no trusted qualification evidence."
        : undefined,
  },
  {
    name: "usageGate",
    evaluate: checkUsage,
    blocker: (context, value) =>
      value.result !== "passed"
        ? "A fresh account/window-scoped usage check has not authorized this online run."
        : undefined,
  },
  {
    name: "fencingRecovery",
    evaluate: checkFencing,
    blocker: (context, value) =>
      value.result !== "passed" || context.evidenceMode !== "live"
        ? "Native Windows fencing and recovery evidence is incomplete for this delivery."
        : undefined,
  },
  {
    name: "syntheticTask",
    evaluate: checkTask,
    blocker: (context, value) =>
      value.result !== "passed"
        ? "A synthetic worker task has not completed through the qualified Windows worker."
        : undefined,
  },
  {
    name: "isolatedValidation",
    evaluate: checkValidation,
    blocker: (context, value) =>
      value.result !== "passed"
        ? "Isolated validation and safe result collection have not been qualified through the Windows worker."
        : undefined,
  },
];
/** No filesystem or process observations occur while evaluating retained reports. */
export function evaluateQualificationRules(
  delivery: Delivery,
  macos: boolean,
  now = Date.now(),
): {
  checks: Record<QualificationCheckName, QualificationCheck>;
  blockers: string[];
} {
  const context = contextFor(delivery, macos, now),
    blockers: string[] = [];
  const checks = Object.fromEntries(
    rules.map((rule) => {
      let value: QualificationCheck;
      try {
        value = rule.evaluate(context);
      } catch {
        value = check("failed", "unavailable");
      }
      const blocker = rule.blocker(context, value);
      if (blocker) blockers.push(blocker);
      return [rule.name, value];
    }),
  ) as Record<QualificationCheckName, QualificationCheck>;
  return { checks, blockers };
}
