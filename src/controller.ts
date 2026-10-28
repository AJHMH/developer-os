import { randomUUID } from "node:crypto";
import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  BranchCleanupCoordinator,
  pendingCleanup,
  type BranchCleanupEvidence,
  type BranchCleanupRuntime,
} from "./branch-cleanup.js";
import {
  MergeCoordinator,
  mergePending,
  mergeSealed,
  type MergeEvidence,
  type MergeRuntime,
} from "./conditional-merge.js";
import { DeliveryError } from "./errors.js";
import {
  candidateDigest,
  candidateMainSource,
  candidateOutput,
  candidateRevisionFiles,
  candidateSource,
  codingBinding,
  codingTurn,
  advanceFeatureBranch,
  featureBranchAdvance,
  featureBranch,
  needsResumeRecovery,
  unrestartedInterruption,
  featurePlan,
  validCodingPins,
  lockedCodingArgv,
  type CodingResult,
  type CodingCleanup,
  type CodingSession,
  type SessionRoute,
  type ResumeReconciliation,
  type FeatureEvidence,
  type FeaturePlanner,
  type FeatureRuntime,
} from "./feature-candidate.js";
import {
  passedBaseline,
  protectValidationInputs,
  validationCandidate,
  validationContract,
  validationCriteria,
  validationDigest,
  validationOutcome,
  validationResult,
  type ValidationAttempt,
  type ValidationEvidence,
  type ValidationResult,
  type ValidationRuntime,
  type ValidationStage,
} from "./isolated-validation.js";
import {
  MainChecksCoordinator,
  type MainChecksEvidence,
  type MainChecksRuntime,
} from "./main-checks.js";
import {
  MainSyncCoordinator,
  pendingMainSync,
  type MainSyncEvidence,
  type MainSyncRuntime,
  type MainSyncTarget,
} from "./main-sync.js";
import {
  canaryInput,
  collectCanary,
  matchesCanary,
  sha256,
  type OfflineCanaryEvidence,
  type OfflineCanaryRuntime,
} from "./offline-canary.js";
import {
  inspectOnboarding,
  type OnboardingOptions,
  type OnboardingReport,
} from "./onboarding.js";
import {
  onlinePolicyVersion,
  type OnlineAccessEvidence,
  type OnlineAccessRuntime,
  type OnlineProof,
  type PreparedOnline,
} from "./online-access.js";
import { pathContains } from "./path-containment.js";
import {
  PRChecksCoordinator,
  type PRChecksEvidence,
  type PRChecksRuntime,
} from "./pr-checks.js";
import {
  PublicationCoordinator,
  type PublicationEvidence,
  type PublicationInput,
  type PublicationRuntime,
} from "./publication.js";
import {
  qualificationVersionsMatch,
  stampQualificationVersions,
} from "./qualification-versions.js";
import {
  unavailableQualification,
  type WorkerQualification,
} from "./qualification.js";
import { redact } from "./redaction.js";
import { repairBudget, repairFindings, type RepairEvidence } from "./repair.js";
import {
  RepositoryLedger,
  repositoryIdentity,
  type OwnershipTransaction,
} from "./repository-ledger.js";
import {
  ReviewCoordinator,
  unresolvedReviewEffect,
  type ReviewEvidence,
  type ReviewRuntime,
  type ReviewThread,
} from "./review.js";
import {
  SessionLifecycle,
  sessionsQuiescent,
  type WorkerAdapter,
  type WorkerReceipt,
  type WorkerSession,
} from "./session-lifecycle.js";
import {
  projectSubscriptionDecision,
  subscriptionDecisionScope,
  verifySubscriptionDecision,
} from "./subscription-decision.js";
import {
  gatewayRequest,
  subscriptionGatewayVersion,
} from "./subscription-gateway.js";
import {
  UsageApprovalGate,
  type SubscriptionObservation,
  type SubscriptionReader,
  type UsageReport,
} from "./subscription.js";
import {
  generalSessionLimits,
  type GeneralSessionAuthority,
  type GeneralSessionLapse,
  type GeneralSessionRevocation,
} from "./general-session-gateway.js";
import type { SessionGateway } from "./session-relay.js";
import {
  syntheticSiteInput,
  syntheticSiteOutput,
  syntheticSiteValidator,
  syntheticTaskVersion,
  type SyntheticTaskEvidence,
  type SyntheticTaskResult,
  type SyntheticTaskRuntime,
} from "./synthetic-task.js";
import {
  hostControlNames,
  hostControlsVersion,
  type HostControlsEvidence,
  type HostControlsRuntime,
} from "./windows-controls.js";
import {
  macosWorkerQualificationReport,
  windowsWorkerQualificationReport,
  type HostWorkerQualificationReport,
} from "./windows-qualification.js";
import { admitFiles } from "./workspace.js";
export type {
  WorkerAdapter,
  WorkerReceipt,
  WorkerSession,
} from "./session-lifecycle.js";

/** Only fixed, non-input-derived messages may cross the public error boundary. */
export { DeliveryError } from "./errors.js";

function canonicalPath(path: string): string {
  let existing = resolve(path);
  const missing: string[] = [];
  while (!existsSync(existing)) {
    missing.unshift(basename(existing));
    const parent = dirname(existing);
    if (parent === existing)
      throw new DeliveryError("Provide an accessible state directory.");
    existing = parent;
  }
  return join(realpathSync(existing), ...missing);
}

const onlineAuthorizationPollMs = 30_000;
const workerUsagePollMs = 30_000;
const defaultObservationTimeoutMs = 30_000;
function contains(parent: string, child: string): boolean {
  return pathContains(parent, child);
}

export interface FeatureRequest {
  codingMinutes?: number;
  repository: string;
  request: string;
  issue?: string;
}

/** Grace beyond a routed turn's remaining allowance for its final request. */
const sessionGraceMs = 60_000;

/** One routed coding turn's general session, as the controller grants it. */
export interface GeneralSessionTurn {
  deliveryId: string;
  /** The coding operation the turn runs as. */
  sessionId: string;
  /** SHA-256 of the qualified mediation decision the route names. */
  decisionSha256: string;
  /** The decision's credential account, not its usage-reader account. */
  accountId: string;
  expiresAt: number;
}
/** Opens the host side of a routed coding turn. `authority` is fresh at each
 * model request: usage observed now, the decision re-qualified. The real,
 * credential-backed factory belongs to slice 5; without one, coding stays
 * offline. */
export type GeneralSessionFactory = (
  turn: GeneralSessionTurn,
  authority: () => Promise<GeneralSessionAuthority>,
) => SessionGateway;

export interface CoordinationOptions {
  branchCleanupRuntime?: BranchCleanupRuntime;
  mainSyncRuntime?: MainSyncRuntime;
  mainChecksRuntime?: MainChecksRuntime;
  mergeRuntime?: MergeRuntime;
  reviewRuntime?: ReviewRuntime;
  prChecksRuntime?: PRChecksRuntime;
  publicationRuntime?: PublicationRuntime;
  validationRuntime?: ValidationRuntime;
  featurePlanner?: FeaturePlanner;
  featureRuntime?: FeatureRuntime;
  clock?: () => number;
  windowsControls?: HostControlsRuntime;
  synthetic?: SyntheticTaskRuntime;
  offline?: OfflineCanaryRuntime;
  online?: OnlineAccessRuntime;
  subscription?: SubscriptionReader;
  worker?: WorkerAdapter;
  observationTimeoutMs?: number;
  /** How often a running coding turn re-observes usage (default 30 s). */
  codingUsagePollMs?: number;
  /** Routes a mediated delivery's coding turns (slice 4a). */
  generalSessions?: GeneralSessionFactory;
}

export interface Delivery {
  cleanup?: BranchCleanupEvidence;
  mainSync?: MainSyncEvidence;
  mainChecks?: MainChecksEvidence;
  merge?: MergeEvidence;
  review?: ReviewEvidence;
  prChecks?: PRChecksEvidence;
  publicationHistory?: PublicationEvidence[];
  publication?: PublicationEvidence;
  validation?: ValidationEvidence;
  initialCodingAllowanceMs?: number;
  feature?: FeatureEvidence;
  repair?: RepairEvidence;
  id: string;
  phase:
    | "blocked"
    | "queued"
    | "paused"
    | "cancelled"
    | "preparing"
    | "implementing"
    | "validating"
    | "publishing"
    | "waiting-checks"
    | "waiting-review"
    | "ready-to-merge"
    | "merged"
    | "verifying-main"
    | "main-verified"
    | "synchronizing-main"
    | "main-synchronized"
    | "cleaning-branches"
    | "completed";
  ownership: { held: boolean; fence: number; key: string };
  priorPhase?: Delivery["phase"];
  controls?: {
    action: "pause" | "resume" | "cancel" | "release";
    at: string;
  }[];
  execution?: WorkerSession;
  sessions?: WorkerSession[];
  recovery?: {
    at: string;
    outcome: "stopped" | "uncertain" | "late-response";
    fence: number;
  }[];
  repository: string;
  request: string;
  issue: string | null;
  createdAt: string;
  onboarding: OnboardingReport;
  qualification?: WorkerQualification;
  offlineCanary?: OfflineCanaryEvidence;
  syntheticTask?: SyntheticTaskEvidence;
  windowsControls?: HostControlsEvidence;
  onlineAccess?: OnlineAccessEvidence;
  onlineRuns?: OnlineAccessEvidence[];
  onlinePlan?: PreparedOnline;
  onlinePlans?: PreparedOnline[];
  usage?: UsageReport;
  authorityPolicySha256: string | null;
  blocker: {
    code: "DELIVERY_NOT_ENABLED" | "UNCERTAIN_SESSION";
    message: string;
    nextAction: string;
  };
  evidence: {
    kind: "request" | "offline-canary" | "interrupted-turn";
    path: string;
  }[];
}

const restartRequired =
  "Coding was interrupted by usage; record the owner's restart approval before re-dispatch.";

/** The unspent owner approval to restart past the latest interruption. */
function pendingRestart(feature: FeatureEvidence | undefined) {
  const interrupted = unrestartedInterruption(feature);
  return interrupted
    ? feature!.restartApprovals?.find(
        (a) => a.interruptedOperationId === interrupted.operationId,
      )
    : undefined;
}

/** Record a usage interruption of `session`, once, with its reason. */
function recordInterruption(
  delivery: Delivery,
  session: CodingSession,
  reason: GeneralSessionLapse,
) {
  const f = delivery.feature!;
  if (!f.usageInterruptions?.some((i) => i.operationId === session.operationId))
    (f.usageInterruptions ??= []).push({
      operationId: session.operationId,
      at: new Date().toISOString(),
      reason,
    });
}

/** Before any candidate or repair exists, coding may follow a moved main;
 * an admitted candidate refreshes its base through repair instead. */
function mayMoveBase(delivery: Delivery, repairId?: string): boolean {
  return !delivery.feature?.candidate && !delivery.repair && !repairId;
}

/** Once a coding operation reaches dispatch, it spends its restart approval
 * and its base move becomes evidence, each once. */
function reachedDispatch(delivery: Delivery, operationId: string) {
  const f = delivery.feature;
  const approval = f?.restartApprovals?.find(
    (a) => a.operationId === operationId,
  );
  if (approval) approval.dispatched = true;
  const move =
    f?.session?.operationId === operationId ? f.session.baseMove : undefined;
  if (move && !f!.baseMoves?.some((m) => m.operationId === operationId))
    (f!.baseMoves ??= []).push({
      operationId,
      ...move,
      at: new Date().toISOString(),
    });
}

/** Public durable delivery controls. The CLI supplies no live worker adapter. */
/** The delivery's owner-endorsed mediation decision, when it is qualified
 * for the delivery's current offline admission binding. */
function qualifiedDecision(delivery: Delivery) {
  const qualification = delivery.qualification,
    decision = qualification?.subscriptionMediation?.mechanismDecision;
  return decision?.qualified &&
    decision.scope ===
      subscriptionDecisionScope(qualification?.offlineAdmission?.binding)
    ? decision
    : undefined;
}

/** A runtime receipt names exactly this coding operation and fence. */
function sameOperation(
  receipt: { operationId: string; fence: number } | undefined,
  session: CodingSession,
): boolean {
  return (
    receipt?.operationId === session.operationId &&
    receipt.fence === session.fence
  );
}

export class DeliveryController {
  private readonly stateDirectory: string;
  private get lifecycle() {
    return new SessionLifecycle({
      read: (id) => this.status(id),
      change: (id, update) =>
        this.change(id, (delivery, ownership) =>
          update(delivery, () => ownership.advanceFence()),
        ),
      observe: (pending) => this.observe(pending),
      runnerId: this.runnerId,
      clock: () => (this.coordination.clock ?? Date.now)(),
      runtimes: this.coordination,
      disabledBlocker: () => this.disabledBlocker(),
      stopValidation: (id) => this.stopValidation(id),
      stopFeature: (id) => this.stopFeature(id),
      finishRepair: (id, repairId) => this.finishRepair(id, repairId),
    });
  }
  private get ledger() {
    return new RepositoryLedger(this.stateDirectory);
  }
  private readonly runnerId = randomUUID();
  private readonly usageGate = new UsageApprovalGate(() =>
    (this.coordination.clock ?? Date.now)(),
  );

  constructor(
    stateDirectory: string,
    private readonly onboardingOptions: OnboardingOptions = {},
    private readonly coordination: CoordinationOptions = {},
  ) {
    if (
      coordination.observationTimeoutMs !== undefined &&
      (!Number.isSafeInteger(coordination.observationTimeoutMs) ||
        coordination.observationTimeoutMs < 1 ||
        coordination.observationTimeoutMs > 60000)
    )
      throw new DeliveryError(
        "Use a worker observation timeout between 1 and 60000 milliseconds.",
      );
    if (
      coordination.codingUsagePollMs !== undefined &&
      (!Number.isSafeInteger(coordination.codingUsagePollMs) ||
        coordination.codingUsagePollMs < 1 ||
        coordination.codingUsagePollMs > 60000)
    )
      throw new DeliveryError(
        "Use a usage poll interval between 1 and 60000 milliseconds.",
      );
    if (!stateDirectory.trim() || /[\u0000-\u001F\u007F]/.test(stateDirectory))
      throw new DeliveryError("Provide a valid state directory.");
    this.stateDirectory = canonicalPath(stateDirectory);
    if (redact(this.stateDirectory) !== this.stateDirectory)
      throw new DeliveryError("Use a state path without embedded credentials.");
  }

  start(input: FeatureRequest): Delivery {
    if (
      input.codingMinutes !== undefined &&
      (!Number.isSafeInteger(input.codingMinutes) ||
        input.codingMinutes < 1 ||
        input.codingMinutes > 1440)
    )
      throw new DeliveryError("Declare 1 to 1440 initial coding minutes.");
    if (
      typeof input.repository !== "string" ||
      !isAbsolute(input.repository) ||
      !existsSync(input.repository) ||
      !statSync(input.repository).isDirectory() ||
      typeof input.request !== "string" ||
      !input.request.trim() ||
      input.request.length > 65_536 ||
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(input.request)
    ) {
      throw new DeliveryError(
        "Provide an absolute repository directory and a nonempty feature request.",
      );
    }
    if (
      input.issue !== undefined &&
      (typeof input.issue !== "string" ||
        !input.issue.trim() ||
        input.issue.length > 2048 ||
        /[\u0000-\u001F\u007F]/.test(input.issue))
    ) {
      throw new DeliveryError(
        "Provide a nonempty issue reference without control characters.",
      );
    }
    const repository = realpathSync(input.repository);
    if (
      redact(repository) !== repository ||
      redact(this.stateDirectory) !== this.stateDirectory
    )
      throw new DeliveryError(
        "Use repository and state paths without embedded credentials.",
      );
    if (
      contains(repository, this.stateDirectory) ||
      contains(this.stateDirectory, repository)
    )
      throw new DeliveryError(
        "Keep controller state outside and separate from the target repository.",
      );
    const id = randomUUID();
    const artifact = this.ledger.requestArtifact(id);
    const onboarding = inspectOnboarding(repository, this.onboardingOptions);
    const key = repositoryIdentity(repository, onboarding);
    const delivery: Delivery = {
      id,
      phase: "blocked",
      ownership: { held: false, fence: 0, key },
      repository,
      request: redact(input.request.trim()),
      issue: input.issue === undefined ? null : redact(input.issue.trim()),
      ...(input.codingMinutes !== undefined
        ? { initialCodingAllowanceMs: input.codingMinutes * 60000 }
        : {}),
      createdAt: new Date().toISOString(),
      onboarding,
      authorityPolicySha256: onboarding.policy?.sha256 ?? null,
      blocker: {
        code: "DELIVERY_NOT_ENABLED",
        message:
          "Live feature delivery is not enabled by these controller slices.",
        nextAction:
          "Complete repository onboarding, host qualification and the remaining delivery implementation before execution.",
      },
      evidence: [{ kind: "request", path: artifact }],
    };
    return this.ledger.admit(delivery);
  }

  status(id: string): Delivery {
    return verifySubscriptionDecision(this.ledger.read(id));
  }

  /** Read a version-bound qualification snapshot without running probes. */
  qualificationReport(id: string): HostWorkerQualificationReport {
    const delivery = this.status(id);
    return (delivery.qualification?.intendedPlatform ??
      delivery.qualification?.offlineAdmission?.binding?.platform) === "darwin"
      ? macosWorkerQualificationReport(delivery)
      : windowsWorkerQualificationReport(delivery);
  }

  list(): { deliveries: Delivery[] } {
    return {
      deliveries: this.ledger
        .list()
        .map((delivery) => verifySubscriptionDecision(delivery)),
    };
  }

  /** Prepare a reviewable fixed supported inference plan without credentials or effects. */
  async prepareOnline(id: string): Promise<Delivery> {
    const runtime = this.coordination.online;
    const before = this.status(id);
    if (
      !runtime?.requiresExactApproval ||
      !runtime.inferenceRequest ||
      !before.ownership.held ||
      !["blocked", "preparing"].includes(before.phase) ||
      (before.onlineAccess && before.onlineAccess.state !== "stopped")
    )
      throw new DeliveryError(
        "Prepare an exact inference plan with the trusted gateway on an owned stopped delivery.",
      );
    const qualified = await this.qualify(id),
      decision = qualifiedDecision(qualified);
    if (!decision)
      throw new DeliveryError(
        "Positive fixed-request authentication mediation is required.",
      );
    const checked = await this.checkUsage(id),
      usage = checked.usage!;
    if (
      usage.decision === "exhausted" ||
      (usage.accountId && usage.accountId !== decision.usageAccountId)
    )
      throw new DeliveryError("Account allowance is exhausted or mismatched.");
    const description = runtime.inferenceRequest(
      before.repository,
      this.stateDirectory,
    );
    if (
      description.requestSha256 !== sha256(gatewayRequest) ||
      description.requestSha256 !== decision.requestSha256 ||
      description.gatewayVersion !== subscriptionGatewayVersion
    )
      throw new DeliveryError(
        "Inference request exceeds positively qualified scope.",
      );
    const dependency = runtime.dependencyPlan?.(before.repository);
    const plan = {
      runId: randomUUID(),
      deliveryId: id,
      repository: before.repository,
      fence: before.ownership.fence + 1,
      accountId: decision.accountId,
      usageScope: usage.scope,
      policyVersion: onlinePolicyVersion,
      runtimeVersion: runtime.version ?? "controlled-observation",
      bindingSha256: qualified.qualification!.bindingSha256!,
      hostPolicySha256: qualified.qualification!.policySha256!,
      ...(dependency ? { dependency } : {}),
      inference: {
        ...description,
        request: gatewayRequest,
        maxRequests: 1 as const,
        deadlineSeconds: 30 as const,
        retries: 0 as const,
        refresh: false as const,
        paidFallback: false as const,
      },
    };
    return this.change(id, (delivery) => {
      if (
        delivery.ownership.fence !== before.ownership.fence ||
        delivery.phase !== before.phase ||
        (delivery.onlineAccess && delivery.onlineAccess.state !== "stopped")
      )
        throw new DeliveryError(
          "Authority changed while preparing the exact plan.",
        );
      if (delivery.onlinePlan)
        (delivery.onlinePlans ??= []).push(
          structuredClone(delivery.onlinePlan),
        );
      delivery.onlinePlan = {
        plan,
        sha256: sha256(JSON.stringify(plan)),
        expiresAt: Date.now() + 3600000,
        consumed: false,
      };
    });
  }

  /** Explicit owner action; candidate code has no controller state/command access. */
  approveOnline(
    id: string,
    runId: string,
    planSha256: string,
    unknownUsageApproved: boolean,
  ): Delivery {
    return this.change(id, (delivery) => {
      const prepared = delivery.onlinePlan;
      if (
        !prepared ||
        prepared.consumed ||
        prepared.expiresAt <= Date.now() ||
        prepared.plan.runId !== runId ||
        prepared.sha256 !== planSha256 ||
        prepared.sha256 !== sha256(JSON.stringify(prepared.plan)) ||
        unknownUsageApproved !== true ||
        !delivery.ownership.held ||
        !["blocked", "preparing"].includes(delivery.phase) ||
        !sessionsQuiescent(delivery)
      )
        throw new DeliveryError(
          "Approve the exact fresh unused inference plan and unknown-usage risk on an owned stopped delivery.",
        );
      prepared.approval = { sha256: planSha256, unknownUsageApproved: true };
    });
  }

  /** Fixed synthetic model/dependency dispatch only; never live inference. */
  async onlineCanary(id: string): Promise<Delivery> {
    const runtime = this.coordination.online;
    const before = this.status(id);
    const exact = runtime?.requiresExactApproval
      ? before.onlinePlan
      : undefined;
    if (
      runtime?.requiresExactApproval &&
      (!exact ||
        exact.consumed ||
        exact.expiresAt <= Date.now() ||
        exact.approval?.sha256 !== exact.sha256 ||
        exact.sha256 !== sha256(JSON.stringify(exact.plan)))
    )
      throw new DeliveryError(
        "An exact fresh approved inference plan is required before dispatch.",
      );
    if (
      !runtime ||
      !before.ownership.held ||
      !["blocked", "preparing"].includes(before.phase) ||
      !sessionsQuiescent(before)
    )
      throw new DeliveryError(
        "Online canary requires an owned stopped delivery and trusted runtime; recover uncertain sessions first.",
      );
    const qualified = await this.qualify(id);
    const decision = qualifiedDecision(qualified);
    if (
      !decision ||
      !qualified.qualification?.offlineAdmission?.allowed ||
      (runtime.mode === "live" && qualified.qualification.mode !== "live")
    )
      throw new DeliveryError(
        "Trusted positive authentication mediation and fresh host admission are required.",
      );
    const checked = await this.checkUsage(id);
    const usage = checked.usage!;
    if (
      exact &&
      (exact.plan.accountId !== decision.accountId ||
        exact.plan.usageScope !== usage.scope ||
        exact.plan.fence !== before.ownership.fence + 1 ||
        exact.plan.bindingSha256 !== qualified.qualification?.bindingSha256 ||
        exact.plan.hostPolicySha256 !== qualified.qualification?.policySha256 ||
        exact.plan.policyVersion !== onlinePolicyVersion ||
        exact.plan.runtimeVersion !==
          (runtime.version ?? "controlled-observation") ||
        exact.plan.inference?.request !== gatewayRequest ||
        exact.plan.inference.requestSha256 !== decision.requestSha256 ||
        exact.plan.inference.gatewayVersion !== subscriptionGatewayVersion ||
        JSON.stringify(
          runtime.inferenceRequest?.(before.repository, this.stateDirectory),
        ) !==
          JSON.stringify({
            requestSha256: exact.plan.inference.requestSha256,
            gatewayVersion: exact.plan.inference.gatewayVersion,
            hostId: exact.plan.inference.hostId,
          }))
    )
      throw new DeliveryError(
        "Exact inference plan authority drifted; prepare and approve a new plan.",
      );
    if (exact?.approval && usage.decision === "approval-required") {
      const approved = this.usageGate.approve(usage, usage.checkId);
      if (approved) usage.approval = approved.approval!;
    }
    if (!this.usageGate.permits(usage, { accountId: decision.usageAccountId }))
      throw new DeliveryError(
        "Fresh account-scoped subscription usage approval is required; exhaustion cannot be overridden.",
      );
    const dependency = runtime.dependencyPlan?.(before.repository);
    if (
      exact &&
      JSON.stringify(exact.plan.dependency) !== JSON.stringify(dependency)
    )
      throw new DeliveryError("Exact artifact plan changed.");
    const started = this.change(id, (delivery, ownership) => {
      if (
        delivery.ownership.fence !== before.ownership.fence ||
        !delivery.ownership.held ||
        delivery.phase !== before.phase ||
        delivery.usage?.checkId !== usage.checkId ||
        !sessionsQuiescent(delivery)
      )
        throw new DeliveryError(
          "Delivery authority changed before online dispatch.",
        );
      if (exact) {
        if (
          delivery.onlinePlan?.sha256 !== exact.sha256 ||
          delivery.onlinePlan.consumed ||
          delivery.onlinePlan.expiresAt <= Date.now() ||
          delivery.onlinePlan.sha256 !==
            sha256(JSON.stringify(delivery.onlinePlan.plan)) ||
          delivery.onlinePlan.approval?.sha256 !== exact.sha256
        )
          throw new DeliveryError(
            "Exact inference approval changed or consumed.",
          );
        delivery.onlinePlan.consumed = true;
        if (usage.approval) delivery.usage!.approval = usage.approval;
      }
      this.lifecycle.dispatchOnline(delivery, () => ownership.advanceFence(), {
        runId: exact?.plan.runId ?? randomUUID(),
        ...(exact?.plan.inference ? { inference: exact.plan.inference } : {}),
        deliveryId: id,
        repository: before.repository,
        accountId: decision.accountId,
        usageAccountId: decision.usageAccountId,
        usageScope: usage.scope,
        policyVersion: onlinePolicyVersion,
        runtimeVersion: runtime.version ?? "controlled-observation",
        bindingSha256: qualified.qualification!.bindingSha256!,
        hostPolicySha256: qualified.qualification!.policySha256!,
        ...(dependency ? { dependency } : {}),
        mode: runtime.mode,
        state: "dispatched",
        outcome: "running",
        productionEnabled: false,
      });
      const boundUsage = this.usageGate.bind(
        delivery.usage,
        delivery.onlineAccess!.runId,
      );
      if (!boundUsage)
        throw new DeliveryError(
          "Usage allowance changed before online dispatch.",
        );
      delivery.usage = boundUsage;
    });
    const plan = started.onlineAccess!;
    const authorize = async () => {
      try {
        const current = await this.checkUsage(id);
        const fresh = this.status(id);
        const u = current.usage!,
          endorsed =
            fresh.qualification?.subscriptionMediation?.mechanismDecision;
        const allowed =
          fresh.ownership.held &&
          fresh.ownership.fence === plan.fence &&
          fresh.phase === before.phase &&
          fresh.onlineAccess?.runId === plan.runId &&
          fresh.onlineAccess.state === "dispatched" &&
          endorsed?.accountId === plan.accountId &&
          this.usageGate.permits(u, {
            operationId: plan.runId,
            accountId: endorsed.usageAccountId,
            scope: plan.usageScope,
          });
        if (!allowed) return false;
        const authorizedAt = new Date().toISOString();
        this.change(id, (delivery) => {
          if (
            !delivery.ownership.held ||
            delivery.ownership.fence !== plan.fence ||
            delivery.phase !== before.phase ||
            delivery.onlineAccess?.runId !== plan.runId ||
            delivery.onlineAccess.state !== "dispatched" ||
            !this.usageGate.permits(delivery.usage, {
              operationId: plan.runId,
              accountId: endorsed.usageAccountId,
              scope: plan.usageScope,
            })
          )
            throw new DeliveryError(
              "Online authorization changed before recording.",
            );
          delivery.onlineAccess.usageAuthorization ??= {
            authorizedAt,
            usage: structuredClone(delivery.usage!),
          };
        });
        return true;
      } catch {
        return false;
      }
    };
    let proof: OnlineProof | undefined;
    let stopping: Promise<Delivery> | undefined;
    const timer = setInterval(() => {
      void authorize()
        .then((allowed) => {
          if (!allowed) stopping ??= this.recoverOnline(id);
        })
        .catch(() => {
          stopping ??= this.recoverOnline(id);
        });
    }, onlineAuthorizationPollMs);
    try {
      proof = await this.observe(runtime.execute(plan, authorize));
      if (
        !proof ||
        proof.runId !== plan.runId ||
        proof.policyVersion !== onlinePolicyVersion ||
        proof.model !== "passed" ||
        proof.dependency !== "passed" ||
        proof.bypass !== "passed" ||
        (plan.dependency &&
          proof.dependencyArtifactSha256 !== plan.dependency.artifactSha256) ||
        !(await authorize())
      )
        proof = undefined;
    } catch {
      /* Safe refusal, never provider or worker error text. */
    } finally {
      clearInterval(timer);
    }
    const stopped = await (stopping ?? this.recoverOnline(id));
    return this.change(id, (delivery) => {
      if (
        delivery.onlineAccess?.runId !== plan.runId ||
        delivery.onlineAccess.state !== "stopped"
      )
        return;
      if (
        proof &&
        stopped.ownership.fence === plan.fence &&
        stopped.phase === before.phase
      ) {
        delivery.onlineAccess.proof = proof;
        delivery.onlineAccess.outcome = "passed";
      } else delivery.onlineAccess.outcome = "refused";
    });
  }

  private recoverOnline(id: string): Promise<Delivery> {
    return this.lifecycle.stopOnline(id);
  }

  private mainSyncTarget(id: string): MainSyncTarget {
    const d = this.status(id),
      a = d.merge?.attempts.at(-1),
      m = d.mainChecks;
    if (
      !a ||
      a.state !== "merged" ||
      !a.mergeCommit ||
      !m ||
      m.outcome !== "passed" ||
      m.mergeOperationId !== a.operationId ||
      !m.revision ||
      !/^[a-f0-9]{40}$/.test(m.revision) ||
      m.policySha256 !== a.policySha256 ||
      d.authorityPolicySha256 !== a.policySha256 ||
      m.bindingSha256 !== this.coordination.mainChecksRuntime?.bindingSha256 ||
      d.publication?.id !== a.publicationId ||
      d.publication.commit !== a.head
    )
      throw Error("Verified main linkage required");
    validationContract(this.onboardingOptions.policyPath, a.policySha256);
    return {
      repository: a.repository,
      checkout: d.repository,
      branch: a.base,
      revision: m.revision,
      policySha256: a.policySha256,
      mergeOperationId: a.operationId,
    };
  }
  private mainSyncCoordinator(id: string) {
    return new MainSyncCoordinator(
      {
        status: () => this.status(id),
        change: (update) => this.change(id, update),
        observe: (p) => this.observe(p),
        input: () => this.mainSyncTarget(id),
      },
      this.coordination.mainSyncRuntime,
    );
  }
  private cleanupCoordinator(id: string) {
    return new BranchCleanupCoordinator(
      {
        status: () => this.status(id),
        change: (update) => this.change(id, update),
        observe: (p) => this.observe(p),
        refresh: async () => {
          await this.reconcileMainSync(id);
        },
        input: () => {
          const t = this.mainSyncTarget(id),
            d = this.status(id),
            a = d.mainSync?.attempts.at(-1);
          if (
            !a ||
            a.state !== "aligned" ||
            a.revision !== t.revision ||
            a.policySha256 !== t.policySha256 ||
            a.mergeOperationId !== t.mergeOperationId ||
            a.bindingSha256 !==
              this.coordination.mainSyncRuntime?.bindingSha256 ||
            a.fence !== d.ownership.fence ||
            pendingMainSync(d)
          )
            throw Error("Verified alignment required");
          return t;
        },
      },
      this.coordination.branchCleanupRuntime,
    );
  }
  async cleanupBranches(id: string): Promise<Delivery> {
    try {
      if (pendingCleanup(this.status(id)))
        return await this.reconcileCleanup(id);
      await this.reconcileMainSync(id);
      return await this.cleanupCoordinator(id).run();
    } catch {
      this.change(id, (d) => {
        if (!["paused", "cancelled"].includes(d.phase)) d.phase = "blocked";
        d.blocker.nextAction =
          "Cleanup requires verified synchronized main and qualified conditional branch authority. Preserve all branches and evidence; reconcile uncertain deletions. Native cleanup remains disabled.";
      });
      throw new DeliveryError(
        "Branch cleanup requires verified alignment and a qualified adapter; native cleanup remains disabled.",
      );
    }
  }
  async reconcileCleanup(id: string): Promise<Delivery> {
    return this.cleanupCoordinator(id).reconcile();
  }

  async syncMain(id: string): Promise<Delivery> {
    if (pendingCleanup(this.status(id)))
      throw new DeliveryError("Reconcile cleanup before synchronization.");
    try {
      if (pendingMainSync(this.status(id)))
        return await this.reconcileMainSync(id);
      await this.monitorMainChecks(id);
      return await this.mainSyncCoordinator(id).sync();
    } catch {
      this.change(id, (d) => {
        if (!["paused", "cancelled"].includes(d.phase)) d.phase = "blocked";
        d.blocker.nextAction =
          "Safe main synchronization requires fresh trusted main checks and a qualified controlled Git adapter. Preserve work; reconcile uncertain operations before retry. Native synchronization and cleanup remain disabled.";
      });
      throw new DeliveryError(
        "Main synchronization requires verified main and a qualified adapter; native synchronization remains disabled.",
      );
    }
  }
  async reconcileMainSync(id: string): Promise<Delivery> {
    // Recovery never dispatches a Git write. Refresh checks when controls permit;
    // paused/cancelled recovery can still establish that an old effect stopped.
    const d = this.status(id);
    if (!["paused", "cancelled"].includes(d.phase)) {
      try {
        await this.monitorMainChecks(id);
      } catch {
        /* reconcile without advancement */
      }
    }
    return this.mainSyncCoordinator(id).reconcile();
  }

  async monitorMainChecks(id: string): Promise<Delivery> {
    try {
      return await new MainChecksCoordinator(
        {
          status: () => this.status(id),
          change: (update) => this.change(id, update),
          now: () => (this.coordination.clock ?? Date.now)(),
          observe: (p, ms) => this.observe(p, ms),
          input: () => {
            const d = this.status(id),
              merge = d.merge?.attempts.at(-1),
              p = d.publication;
            if (
              !merge ||
              merge.state !== "merged" ||
              !merge.mergeCommit ||
              !merge.mainRevision ||
              !p ||
              p.id !== merge.publicationId ||
              p.commit !== merge.head ||
              p.policySha256 !== merge.policySha256 ||
              d.authorityPolicySha256 !== merge.policySha256
            )
              throw Error("Confirmed merge required");
            const checks = validationContract(
              this.onboardingOptions.policyPath,
              merge.policySha256,
            ).checks.filter((c) => c.scope === "main");
            if (!checks.length || checks.some((c) => !c.workflow))
              throw Error("Declare trusted main workflows");
            return { merge, checks };
          },
        },
        this.coordination.mainChecksRuntime,
      ).monitor();
    } catch {
      this.change(id, (d) => {
        if (d.mainChecks) {
          if (d.mainChecks.outcome !== "timeout")
            d.mainChecks.outcome = "unavailable";
          delete d.mainChecks.activeObservation;
        }
        if (!["paused", "cancelled"].includes(d.phase)) d.phase = "blocked";
        d.blocker.nextAction =
          "Restore confirmed merge linkage, pinned policy and trusted main observation binding. Preserve evidence; synchronization and cleanup remain blocked. Any fix or revert requires a new signed PR and owner approval.";
      });
      throw new DeliveryError(
        "Main monitoring requires confirmed merge linkage, unchanged owner policy and a qualified read-only adapter; native monitoring remains disabled.",
      );
    }
  }

  private requireMergeIdle(id: string) {
    if (mergeSealed(this.status(id)))
      throw new DeliveryError(
        "Reconcile merge before changing candidate or review state; a merged candidate is sealed.",
      );
  }
  private mergeCoordinator(id: string) {
    return new MergeCoordinator(
      {
        status: () => this.status(id),
        change: (update) => this.change(id, update),
        input: (d) => this.prChecksInput(id, d).publication,
        observe: (p) => this.observe(p),
        refresh: async () => {
          this.invalidateReviewApproval(id);
          await this.prChecksCoordinator(id).monitor(true);
          await this.reviewCoordinator(id).monitor();
        },
        ready: (d) => {
          const p = d.publication,
            r = d.review?.runs.at(-1);
          return !!(
            p &&
            r?.publicationId === p.id &&
            r.outcome === "approved" &&
            r.approval?.head === p.commit &&
            !r.activeObservation &&
            r.bindingSha256 ===
              this.coordination.reviewRuntime?.bindingSha256 &&
            this.reviewChecksPassed(d) &&
            !unresolvedReviewEffect(d)
          );
        },
      },
      this.coordination.mergeRuntime,
    );
  }
  async mergeFeature(id: string): Promise<Delivery> {
    try {
      return await this.mergeCoordinator(id).merge();
    } catch {
      throw new DeliveryError(
        "Merge requires fresh approved-head gates and qualified conditional authority; native merge remains disabled.",
      );
    }
  }
  async reconcileMerge(id: string): Promise<Delivery> {
    try {
      return await this.mergeCoordinator(id).reconcile();
    } catch {
      throw new DeliveryError(
        "Merge reconciliation requires the retained operation and same trusted binding.",
      );
    }
  }

  async refreshMergeBase(id: string): Promise<Delivery> {
    this.requireMergeIdle(id);
    const snapshot = this.status(id),
      a = snapshot.merge?.attempts.at(-1),
      p = snapshot.publication ?? snapshot.publicationHistory?.at(-1);
    if (
      !snapshot.ownership.held ||
      snapshot.phase !== "blocked" ||
      !a?.advancedBase ||
      a.state !== "blocked" ||
      !p ||
      p.id !== a.publicationId ||
      this.coordination.mergeRuntime?.bindingSha256 !== a.bindingSha256 ||
      unresolvedReviewEffect(snapshot)
    )
      throw new DeliveryError(
        "Refresh requires a retained advanced-main observation and stopped owned candidate.",
      );
    const prior = snapshot.repair?.attempts.at(-1);
    if (
      !snapshot.publication &&
      prior?.baseRefresh?.to === a.advancedBase &&
      prior.state === "stopped" &&
      prior.outcome === "passed"
    )
      return snapshot;
    const r = snapshot.repair;
    if (
      r &&
      (r.attempts.some((x) => x.state !== "stopped") ||
        r.activeMs >= r.allowanceMs ||
        r.attempts.length >= r.allowanceCycles)
    )
      throw new DeliveryError(
        "Base refresh requires remaining repair allowance; preserve work and request an owner extension.",
      );
    const source = candidateMainSource(snapshot.repository, p.defaultBranch);
    if (source.revision !== a.advancedBase)
      throw new DeliveryError(
        "Fetch and verify clean local main at the observed revision before refresh; never discard local work.",
      );
    // Read-only authority check before retiring the old publication. Fresh review
    // and checks are deliberately required only after the repaired publication.
    const onboarding = inspectOnboarding(
      snapshot.repository,
      this.onboardingOptions,
    );
    if (
      !onboarding.ready ||
      onboarding.policy?.sha256 !== p.policySha256 ||
      repositoryIdentity(snapshot.repository, onboarding) !==
        snapshot.ownership.key
    )
      throw new DeliveryError("Base refresh authority changed.");
    const remote = await this.observe(
      this.coordination.mergeRuntime!.observe({
        repository: p.repository,
        number: p.pullRequest!.number,
        head: p.commit!,
      }),
    );
    if (
      !remote ||
      remote.complete !== true ||
      remote.repository !== p.repository ||
      remote.number !== p.pullRequest!.number ||
      remote.head !== p.commit ||
      remote.base !== p.defaultBranch ||
      remote.baseRevision !== source.revision ||
      remote.policySha256 !== p.policySha256 ||
      remote.state !== "open" ||
      remote.mergeAllowed !== true ||
      remote.protectionsEnforced !== true ||
      remote.actor !== p.publicationLogin
    )
      throw new DeliveryError("Base refresh remote authority changed.");
    this.change(id, (d) => {
      if (
        d.ownership.fence !== snapshot.ownership.fence ||
        d.phase !== "blocked" ||
        mergeSealed(d) ||
        d.publication?.id !== snapshot.publication?.id ||
        d.merge?.attempts.at(-1)?.operationId !== a.operationId
      )
        throw new DeliveryError("Base refresh generation changed.");
      if (d.publication) {
        (d.publicationHistory ??= []).push(d.publication);
        delete d.publication;
      }
      d.merge!.refresh = {
        publicationId: p.id,
        from: p.sourceRevision,
        to: source.revision,
      };
      const review = d.review?.runs.at(-1);
      if (review) {
        delete review.approval;
        review.outcome = "waiting";
      }
    });
    return this.repairCandidate(
      id,
      [
        "Integrate the retained candidate with verified advanced main; preserve both changes and revalidate.",
      ],
      { from: p.sourceRevision, to: source.revision },
    );
  }

  private reviewInput(id: string, observed?: Delivery) {
    const d = observed ?? this.status(id),
      { publication } = this.prChecksInput(id, d),
      checks = d.prChecks?.runs.at(-1);
    const checksPassed = !!(
      checks &&
      checks.publicationId === publication.id &&
      checks.outcome === "passed" &&
      !checks.activeObservation &&
      this.coordination.prChecksRuntime?.bindingSha256 === checks.bindingSha256
    );
    return {
      publication,
      criteriaSha256: validationCriteria(d.feature!),
      checksPassed,
    };
  }
  private reviewCoordinator(id: string) {
    return new ReviewCoordinator(
      {
        status: () => this.status(id),
        change: (update) => this.change(id, update),
        input: (d) => this.reviewInput(id, d),
        observe: (p) => this.observe(p),
        now: () => (this.coordination.clock ?? Date.now)(),
        canResolve: (d, t) => this.reviewFixVerified(d, t),
      },
      this.coordination.reviewRuntime,
    );
  }
  async monitorReview(id: string): Promise<Delivery> {
    this.requireMergeIdle(id);
    try {
      this.invalidateReviewApproval(id);
      await this.prChecksCoordinator(id).monitor(true);
      return await this.reviewCoordinator(id).monitor();
    } catch {
      throw new DeliveryError(
        "Review requires current validated publication, trusted checks, unchanged authority and a controlled review adapter; native review remains disabled.",
      );
    }
  }

  private invalidateReviewApproval(id: string) {
    this.change(id, (d) => {
      const run = d.review?.runs.at(-1);
      if (run) {
        delete run.approval;
        if (run.outcome === "approved") run.outcome = "waiting";
      }
      if (d.phase === "ready-to-merge") d.phase = "waiting-review";
    });
  }
  private reviewChecksPassed(d: Delivery): boolean {
    const c = d.prChecks?.runs.at(-1);
    return !!(
      c &&
      c.publicationId === d.publication?.id &&
      c.outcome === "passed" &&
      !c.activeObservation &&
      c.bindingSha256 === this.coordination.prChecksRuntime?.bindingSha256
    );
  }
  private reviewFixVerified(d: Delivery, thread: ReviewThread): boolean {
    const a = d.repair?.attempts.at(-1),
      p = d.publication,
      old = d.review?.runs.find((r) => r.id === a?.reviewRunId);
    const previous = d.publicationHistory?.at(-1);
    return !!(
      this.reviewChecksPassed(d) &&
      p?.outcome === "published" &&
      previous?.id === old?.publicationId &&
      p.previous?.commit === previous?.commit &&
      a?.state === "stopped" &&
      a.outcome === "passed" &&
      a.candidateSha256 === p.candidateSha256 &&
      a.validationOperationId === p.validationOperationId &&
      old?.repair?.threads.some(
        (t) => t.id === thread.id && t.digest === thread.digest,
      ) &&
      thread.assessment?.disposition === "straightforward" &&
      thread.assessment.criteriaSha256 === validationCriteria(d.feature!) &&
      this.coordination.reviewRuntime?.bindingSha256 === old.bindingSha256
    );
  }
  async resolveReviewThread(id: string, threadId: string): Promise<Delivery> {
    this.requireMergeIdle(id);
    try {
      this.invalidateReviewApproval(id);
      await this.prChecksCoordinator(id).monitor(true);
      return await this.reviewCoordinator(id).resolve(threadId);
    } catch {
      throw new DeliveryError(
        "Conversation resolution requires the exact verified review fix, current authority and reconciled effects.",
      );
    }
  }
  async repairReview(id: string): Promise<Delivery> {
    this.requireMergeIdle(id);
    try {
      let d = this.status(id);
      if (d.publication) {
        this.invalidateReviewApproval(id);
        await this.prChecksCoordinator(id).monitor(true);
        await this.reviewCoordinator(id).monitor();
        d = this.status(id);
        const run = d.review?.runs.at(-1),
          threads = run?.threads.filter((t) => !t.resolved),
          p = d.publication!,
          budget = d.repair;
        if (
          !run ||
          !this.reviewChecksPassed(d) ||
          run.outcome !== "blocked" ||
          run.activeObservation ||
          !threads?.length ||
          threads.length > 32 ||
          threads.some(
            (t) => t.assessment?.disposition !== "straightforward",
          ) ||
          !d.ownership.held ||
          d.phase !== "blocked" ||
          unresolvedReviewEffect(d) ||
          (budget &&
            (budget.attempts.some((a) => a.state !== "stopped") ||
              budget.attempts.length >= budget.allowanceCycles ||
              budget.activeMs >= budget.allowanceMs))
        )
          throw Error("Review batch requires owner resolution or allowance");
        const findings = repairFindings(
          threads.map((t) => t.assessment!.finding!),
        );
        this.change(id, (current) => {
          const latest = current.review?.runs.at(-1);
          if (
            current.ownership.fence !== d.ownership.fence ||
            current.phase !== "blocked" ||
            current.publication?.id !== p.id ||
            latest?.id !== run.id ||
            latest.activeObservation ||
            unresolvedReviewEffect(current)
          )
            throw Error("Review repair authority changed");
          latest.repair = {
            threads: threads.map((t) => ({ id: t.id, digest: t.digest })),
            findings,
          };
          latest.outcome = "repairing";
          delete latest.approval;
          (current.publicationHistory ??= []).push(current.publication);
          delete current.publication;
        });
      }
      d = this.status(id);
      const run = d.review?.runs.at(-1),
        last = d.repair?.attempts.at(-1);
      if (
        !run?.repair ||
        run.outcome !== "repairing" ||
        d.publicationHistory?.at(-1)?.id !== run.publicationId ||
        !["blocked", "preparing"].includes(d.phase)
      )
        throw Error("No resumable review batch");
      if (
        last?.reviewRunId === run.id &&
        last.state === "stopped" &&
        last.outcome === "passed"
      )
        return d;
      return await this.repairFeature(id, run.repair.findings);
    } catch {
      throw new DeliveryError(
        "Review repair requires independently assessed in-scope findings, stopped work and cumulative allowance; disputed requests remain for the owner.",
      );
    }
  }

  private prChecksInput(id: string, observed?: Delivery) {
    const d = observed ?? this.status(id),
      p = d.publication;
    if (
      !p ||
      p.outcome !== "published" ||
      !p.commit ||
      !p.pullRequest ||
      p.pullRequest.head !== p.commit
    )
      throw new DeliveryError(
        "Publish a validated PR before monitoring checks.",
      );
    const input = this.publicationInput(id, d);
    if (
      input.policySha256 !== p.policySha256 ||
      input.validationOperationId !== p.validationOperationId ||
      input.candidateSha256 !== p.candidateSha256
    )
      throw new DeliveryError("Published validation authority changed.");
    const checks = validationContract(
      this.onboardingOptions.policyPath,
      d.authorityPolicySha256!,
    ).checks.filter((c) => c.scope === "pr");
    if (!checks.length || checks.some((c) => !c.workflow))
      throw new DeliveryError(
        "Declare trusted PR workflows before monitoring.",
      );
    return { publication: p, checks };
  }

  private prChecksCoordinator(id: string) {
    return new PRChecksCoordinator(
      {
        status: () => this.status(id),
        change: (update) => this.change(id, update),
        input: (d) => this.prChecksInput(id, d),
        observe: (p, ms) => this.observe(p, ms),
        now: () => (this.coordination.clock ?? Date.now)(),
      },
      this.coordination.prChecksRuntime,
    );
  }
  async monitorPRChecks(id: string): Promise<Delivery> {
    this.requireMergeIdle(id);
    try {
      this.invalidateReviewApproval(id);
      return await this.prChecksCoordinator(id).monitor();
    } catch {
      throw new DeliveryError(
        "PR monitoring requires a published candidate, unchanged trusted policy and a controlled check adapter; native monitoring remains disabled.",
      );
    }
  }
  async rerunPRCheck(id: string, checkId: string): Promise<Delivery> {
    this.requireMergeIdle(id);
    try {
      return await this.prChecksCoordinator(id).rerun(checkId);
    } catch {
      throw new DeliveryError(
        "Diagnostic rerun blocked: reconcile the current failed head and retained rerun allowance.",
      );
    }
  }

  async repairPRChecks(id: string): Promise<Delivery> {
    this.requireMergeIdle(id);
    try {
      return await this.repairHostedChecks(id);
    } catch {
      throw new DeliveryError(
        "PR repair requires current trusted terminal failures, stopped work and remaining cumulative allowance.",
      );
    }
  }
  private async repairHostedChecks(id: string): Promise<Delivery> {
    this.invalidateReviewApproval(id);
    if (unresolvedReviewEffect(this.status(id)))
      throw new DeliveryError("Reconcile review effects before repair.");
    let snapshot = this.status(id),
      run = snapshot.prChecks?.runs.at(-1);
    if (snapshot.publication) {
      await this.prChecksCoordinator(id).monitor(true);
      snapshot = this.status(id);
      run = snapshot.prChecks?.runs.at(-1);
      if (
        !run ||
        run.outcome !== "failed" ||
        !run.canRepair ||
        snapshot.phase !== "blocked" ||
        !snapshot.ownership.held ||
        run.publicationId !== snapshot.publication?.id ||
        run.activeObservation
      )
        throw new DeliveryError(
          "Only current trusted terminal PR failures can enter repair.",
        );
      const findings = repairFindings(run.findings);
      const saved = snapshot.publication!,
        expected = run.id;
      this.change(id, (d) => {
        const current = d.prChecks?.runs.at(-1),
          budget = d.repair;
        if (
          d.ownership.fence !== snapshot.ownership.fence ||
          d.phase !== "blocked" ||
          d.publication?.id !== saved.id ||
          current?.id !== expected ||
          !current.canRepair ||
          current.outcome !== "failed" ||
          (budget &&
            (budget.attempts.some((a) => a.state !== "stopped") ||
              budget.attempts.length >= budget.allowanceCycles ||
              budget.activeMs >= budget.allowanceMs))
        )
          throw new DeliveryError(
            "Resolve repair authority or allowance before updating the PR.",
          );
        current.findings = findings;
        current.outcome = "repairing";
        current.canRepair = false;
        (d.publicationHistory ??= []).push(d.publication);
        delete d.publication;
      });
    }
    snapshot = this.status(id);
    run = snapshot.prChecks?.runs.at(-1);
    if (
      !run ||
      run.outcome !== "repairing" ||
      snapshot.publicationHistory?.at(-1)?.id !== run.publicationId ||
      !["blocked", "preparing"].includes(snapshot.phase)
    )
      throw new DeliveryError(
        "No retained PR failure batch is eligible for repair.",
      );
    const last = snapshot.repair?.attempts.at(-1);
    if (
      last?.prCheckRunId === run.id &&
      last.outcome === "passed" &&
      last.state === "stopped"
    )
      return snapshot;
    return this.repairFeature(id, run.findings);
  }

  private publicationInput(id: string, observed?: Delivery): PublicationInput {
    const d = observed ?? this.status(id),
      f = d.feature,
      v = d.validation?.attempts.at(-1);
    if (
      !f?.candidate ||
      f.candidate.validation !== "passed" ||
      f.session?.state !== "stopped" ||
      d.repair?.attempts.some((a) => a.state !== "stopped") ||
      (d.repair && d.repair.attempts.at(-1)?.outcome !== "passed") ||
      d.validation?.attempts.some((a) => a.state !== "stopped") ||
      !sessionsQuiescent(d) ||
      !v ||
      v.stage !== "candidate" ||
      v.outcome !== "passed" ||
      v.treeSha256 !== f.candidate.sha256 ||
      v.policySha256 !== d.authorityPolicySha256 ||
      v.criteriaSha256 !== validationCriteria(f) ||
      this.coordination.validationRuntime?.mode !== "controlled" ||
      this.coordination.validationRuntime.bindingSha256 !== v.bindingSha256
    )
      throw new DeliveryError(
        "Publication requires exact passing candidate evidence and stopped workers.",
      );
    const onboarding = inspectOnboarding(d.repository, this.onboardingOptions);
    if (
      !onboarding.ready ||
      onboarding.policy?.sha256 !== d.authorityPolicySha256 ||
      repositoryIdentity(d.repository, onboarding) !== d.ownership.key
    )
      throw new DeliveryError("Publication onboarding authority changed.");
    const policyBytes = readFileSync(onboarding.policy!.source);
    if (candidateDigest(policyBytes) !== d.authorityPolicySha256)
      throw new DeliveryError("Publication policy changed.");
    const policy = JSON.parse(policyBytes.toString());
    const source = candidateMainSource(
      d.repository,
      onboarding.canonicalRepository!.defaultBranch,
    );
    if (
      source.revision !== v.sourceRevision ||
      source.revision !== f.sourceRevision ||
      !f.branch ||
      !/^codex\/feature-[a-f0-9-]+$/.test(f.branch) ||
      validationDigest(
        validationContract(
          this.onboardingOptions.policyPath,
          d.authorityPolicySha256!,
        ),
      ) !== v.contractSha256
    )
      throw new DeliveryError("Publication source or check contract changed.");
    const candidate = validationCandidate(f, this.stateDirectory);
    protectValidationInputs(v.contract, source.files, candidate.files);
    const previous = d.publicationHistory?.at(-1);
    if (
      previous &&
      (previous.outcome !== "published" ||
        !previous.commit ||
        !previous.pullRequest ||
        previous.repository !== policy.repository ||
        previous.branch !== f.branch ||
        previous.candidateSha256 === candidate.digest ||
        d.repair?.attempts.at(-1)?.outcome !== "passed")
    )
      throw new DeliveryError(
        "PR update requires a changed repaired candidate and retained publication identity.",
      );
    return {
      ...(previous
        ? {
            previous: {
              commit: previous.commit!,
              number: previous.pullRequest!.number,
            },
          }
        : {}),
      repository: policy.repository,
      defaultBranch: policy.defaultBranch,
      branch: f.branch,
      sourceRevision: source.revision,
      candidateSha256: candidate.digest,
      policySha256: d.authorityPolicySha256!,
      validationOperationId: v.operationId,
      publicationLogin: policy.publicationLogin,
      appLogin: policy.appLogin,
      approver: policy.approver,
      files: candidate.files,
    };
  }

  private publicationCoordinator(id: string): PublicationCoordinator {
    return new PublicationCoordinator(
      {
        status: () => this.status(id),
        change: (update) => this.change(id, update),
        input: (observed) => this.publicationInput(id, observed),
        qualified: async () => {
          const before = this.publicationInput(id);
          const v = this.status(id).validation!.attempts.at(-1)!;
          const runtime = this.coordination.validationRuntime!;
          const observation = await this.observe(runtime.inspect());
          const after = this.publicationInput(id);
          return (
            before.validationOperationId === after.validationOperationId &&
            observation?.mode === "controlled" &&
            observation.bindingSha256 === v.bindingSha256 &&
            validationDigest(observation.environment) === v.environmentSha256
          );
        },
        observe: (promise) => this.observe(promise),
      },
      this.coordination.publicationRuntime,
    );
  }

  async publishFeature(id: string): Promise<Delivery> {
    this.requireMergeIdle(id);
    try {
      this.invalidateReviewApproval(id);
      if (unresolvedReviewEffect(this.status(id)))
        throw Error("Uncertain review effect");
      return await this.publicationCoordinator(id).publish();
    } catch {
      throw new DeliveryError(
        "Publication blocked: verify candidate, signatures, authority, controls and unresolved effects; native writes remain disabled.",
      );
    }
  }

  async reconcilePublication(id: string): Promise<Delivery> {
    this.requireMergeIdle(id);
    try {
      return await this.publicationCoordinator(id).reconcile();
    } catch {
      throw new DeliveryError(
        "Publication reconciliation requires the same trusted binding and retained operation.",
      );
    }
  }

  async validateBaseline(id: string): Promise<Delivery> {
    if (this.status(id).publication)
      throw new DeliveryError(
        "Preserve the published candidate and its validation evidence.",
      );
    return this.validateFeatureTree(id, "baseline");
  }

  async validateCandidate(id: string): Promise<Delivery> {
    if (this.status(id).publication)
      throw new DeliveryError(
        "Preserve publication evidence before changing validation.",
      );
    if (this.status(id).repair)
      throw new DeliveryError(
        "Local revalidation belongs to the persisted repair cycle.",
      );
    return this.validateFeatureTree(id, "candidate");
  }

  private async validateFeatureTree(
    id: string,
    stage: ValidationStage,
    repairId?: string,
  ): Promise<Delivery> {
    const snapshot = this.status(id),
      runtime = this.coordination.validationRuntime;
    if (
      (snapshot.repair?.attempts.some((a) => a.state !== "stopped") &&
        snapshot.repair.attempts.at(-1)?.id !== repairId) ||
      !runtime ||
      runtime.mode !== "controlled" ||
      !/^[a-f0-9]{64}$/.test(runtime.bindingSha256) ||
      !snapshot.ownership.held ||
      !["blocked", "preparing"].includes(snapshot.phase) ||
      !snapshot.feature ||
      snapshot.feature.ambiguity ||
      (snapshot.feature.session &&
        snapshot.feature.session.state !== "stopped") ||
      !sessionsQuiescent(snapshot) ||
      snapshot.validation?.attempts.some((a) => a.state !== "stopped")
    )
      throw new DeliveryError(
        "Validation requires planned criteria, stopped workers and a controlled isolated runtime.",
      );
    const onboarding = inspectOnboarding(
      snapshot.repository,
      this.onboardingOptions,
    );
    if (
      !onboarding.ready ||
      onboarding.policy?.sha256 !== snapshot.authorityPolicySha256 ||
      repositoryIdentity(snapshot.repository, onboarding) !==
        snapshot.ownership.key
    )
      throw new DeliveryError("Validation owner authority changed.");
    const contract = validationContract(
      this.onboardingOptions.policyPath,
      snapshot.authorityPolicySha256,
    );
    if (
      snapshot.feature.requires?.some(
        (resource) => !contract.environment[resource],
      )
    )
      throw new DeliveryError(
        "Declared synthetic E2E infrastructure is missing for this feature.",
      );
    const source = candidateMainSource(
      snapshot.repository,
      onboarding.canonicalRepository!.defaultBranch,
    );
    // After coding started, a new baseline is only for a moved main before any
    // candidate exists; an admitted candidate refreshes through repair.
    const mainMoved =
      mayMoveBase(snapshot) &&
      !!snapshot.feature.sourceRevision &&
      snapshot.feature.sourceRevision !== source.revision;
    if (
      stage === "baseline" &&
      snapshot.feature.session &&
      !mainMoved &&
      !(
        repairId &&
        snapshot.repair?.attempts.at(-1)?.baseRefresh?.to === source.revision
      )
    )
      throw new DeliveryError("Baseline must precede coding.");
    if (
      stage === "candidate" &&
      !passedBaseline(
        snapshot.validation,
        source.digest,
        source.revision,
        snapshot.authorityPolicySha256,
        validationCriteria(snapshot.feature),
        runtime.bindingSha256,
      )
    )
      throw new DeliveryError(
        "Validate unchanged main before candidate checks.",
      );
    const input =
      stage === "baseline"
        ? source
        : validationCandidate(snapshot.feature, this.stateDirectory);
    if (stage === "candidate")
      protectValidationInputs(contract, source.files, input.files);
    const observed = await this.observe(runtime.inspect());
    if (
      !observed ||
      observed.mode !== "controlled" ||
      observed.bindingSha256 !== runtime.bindingSha256 ||
      validationDigest(observed.environment) !==
        validationDigest(contract.environment)
    )
      throw new DeliveryError("Validation environment is unqualified.");
    const attempt: ValidationAttempt = {
      operationId: randomUUID(),
      fence: snapshot.ownership.fence,
      stage,
      sourceRevision: source.revision,
      treeSha256: input.digest,
      policySha256: snapshot.authorityPolicySha256!,
      contractSha256: validationDigest(contract),
      criteriaSha256: validationCriteria(snapshot.feature),
      environmentSha256: validationDigest(contract.environment),
      bindingSha256: runtime.bindingSha256,
      state: "running",
      outcome: "pending",
      startedAt: new Date().toISOString(),
      results: [],
      contract,
    };
    const previous =
      snapshot.validation?.attempts.filter(
        (a) => a.stage === stage && a.treeSha256 === attempt.treeSha256,
      ) ?? [];
    if (previous.length >= 2)
      throw new DeliveryError(
        "One diagnostic rerun on unchanged code is permitted; retain evidence and resolve policy or scope.",
      );
    this.change(id, (d) => {
      if (
        d.ownership.fence !== snapshot.ownership.fence ||
        d.phase !== snapshot.phase ||
        (repairId && !this.repairActive(d, repairId)) ||
        d.validation?.attempts.some((a) => a.state !== "stopped")
      )
        throw new DeliveryError(
          "Validation authority changed before dispatch.",
        );
      if (
        !d.feature ||
        validationCriteria(d.feature) !== attempt.criteriaSha256
      )
        throw new DeliveryError("Validation criteria changed before dispatch.");
      (d.validation ??= { attempts: [] }).attempts.push(attempt);
      if (repairId)
        d.repair!.attempts.at(-1)!.validationOperationId = attempt.operationId;
      if (stage === "candidate" && d.feature.candidate)
        d.feature.candidate.validation = "not-run";
      if (repairId)
        d.repair!.checkpoint = {
          at: (this.coordination.clock ?? Date.now)(),
          runnerId: this.runnerId,
        };
      d.phase = "validating";
    });
    const mayDispatch = () => {
      const d = repairId
        ? this.change(id, (d) => this.chargeRepair(d))
        : this.status(id);
      try {
        validationContract(
          this.onboardingOptions.policyPath,
          attempt.policySha256,
        );
      } catch {
        return false;
      }
      return (
        runtime.mode === "controlled" &&
        runtime.bindingSha256 === attempt.bindingSha256 &&
        d.ownership.held &&
        d.ownership.fence === attempt.fence &&
        d.phase === "validating" &&
        (!repairId ||
          (d.repair!.attempts.at(-1)?.id === repairId &&
            d.repair!.attempts.at(-1)?.state === "running" &&
            d.repair!.activeMs < d.repair!.allowanceMs)) &&
        d.validation?.attempts.at(-1)?.operationId === attempt.operationId &&
        d.validation.attempts.at(-1)?.state === "running"
      );
    };
    try {
      for (const check of contract.checks.filter(
        (c) => c.scope === "local" && c.stages.includes(stage),
      )) {
        if (!mayDispatch()) break;
        let timer: ReturnType<typeof setTimeout> | undefined,
          heartbeat: ReturnType<typeof setInterval> | undefined;
        let observed: ValidationResult | "timeout" | "interrupted";
        try {
          const stop = new Promise<"timeout" | "interrupted">((resolve) => {
            const remaining = repairId
              ? this.status(id).repair!.allowanceMs -
                this.status(id).repair!.activeMs
              : Infinity;
            timer = setTimeout(
              () => {
                if (repairId && remaining <= check.timeoutMs)
                  this.change(id, (d) => {
                    if (this.repairActive(d, repairId))
                      d.repair!.activeMs = Math.max(
                        d.repair!.activeMs,
                        d.repair!.allowanceMs,
                      );
                  });
                resolve("timeout");
              },
              Math.min(check.timeoutMs, remaining),
            );
            heartbeat = setInterval(() => {
              try {
                if (!mayDispatch()) resolve("interrupted");
              } catch {
                resolve("interrupted");
              }
            }, 25);
          });
          observed = await Promise.race([
            runtime.execute({
              ...structuredClone(attempt),
              check: structuredClone(check),
              files: input.files,
              mayDispatch,
            }),
            stop,
          ]);
        } finally {
          clearTimeout(timer);
          clearInterval(heartbeat);
        }
        if (observed === "timeout" || observed === "interrupted") {
          this.change(id, (d) => {
            const a = d.validation?.attempts.find(
              (a) => a.operationId === attempt.operationId,
            );
            if (a) {
              a.outcome = observed === "timeout" ? "timeout" : "incomplete";
              a.results.push({
                checkId: check.id,
                status: observed === "timeout" ? "timeout" : "cancelled",
                publisher: check.publisher,
                treeSha256: attempt.treeSha256,
                environmentSha256: attempt.environmentSha256,
                artifacts: [],
              });
            }
          });
          break;
        }
        const result = validationResult(observed, check, attempt);
        this.change(id, (d) => {
          const a = d.validation?.attempts.find(
            (a) => a.operationId === attempt.operationId,
          );
          if (
            a?.state === "running" &&
            d.phase === "validating" &&
            d.ownership.fence === attempt.fence
          )
            a.results.push(result);
        });
      }
    } catch {
      this.change(id, (d) => {
        const a = d.validation?.attempts.find(
          (a) => a.operationId === attempt.operationId,
        );
        if (a) a.outcome = "incomplete";
      });
    }
    await this.stopValidation(id, attempt.operationId);
    let current = false;
    try {
      const fresh = inspectOnboarding(
          snapshot.repository,
          this.onboardingOptions,
        ),
        measured = await this.observe(runtime.inspect());
      const tree = candidateMainSource(
        snapshot.repository,
        onboarding.canonicalRepository!.defaultBranch,
      );
      current =
        !!fresh.ready &&
        fresh.policy?.sha256 === attempt.policySha256 &&
        repositoryIdentity(snapshot.repository, fresh) ===
          snapshot.ownership.key &&
        validationDigest(
          validationContract(
            this.onboardingOptions.policyPath,
            attempt.policySha256,
          ),
        ) === attempt.contractSha256 &&
        tree.revision === source.revision &&
        tree.digest === source.digest &&
        runtime.mode === "controlled" &&
        runtime.bindingSha256 === attempt.bindingSha256 &&
        measured?.mode === "controlled" &&
        measured.bindingSha256 === attempt.bindingSha256 &&
        validationDigest(measured.environment) === attempt.environmentSha256 &&
        (stage === "baseline" ||
          validationCandidate(this.status(id).feature!, this.stateDirectory)
            .digest === attempt.treeSha256);
    } catch {}
    return this.change(id, (d) => {
      const a = d.validation?.attempts.find(
        (a) => a.operationId === attempt.operationId,
      );
      if (
        !a ||
        a.state !== "stopped" ||
        d.phase !== "blocked" ||
        d.ownership.fence !== attempt.fence ||
        (repairId && !this.repairActive(d, repairId))
      )
        return;
      if (repairId && d.repair!.activeMs >= d.repair!.allowanceMs)
        a.outcome = "incomplete";
      if (a.outcome === "pending")
        a.outcome =
          current &&
          d.feature &&
          validationCriteria(d.feature) === attempt.criteriaSha256
            ? validationOutcome(a, previous)
            : "stale";
      if (stage === "candidate" && d.feature?.candidate)
        d.feature.candidate.validation =
          a.outcome === "passed" ? "passed" : "not-run";
      d.blocker.nextAction =
        a.outcome === "passed"
          ? stage === "baseline"
            ? "Baseline passed; candidate validation and later delivery gates remain required."
            : "Candidate validation passed; hosted checks and later delivery gates remain required."
          : "Validation blocked; preserve evidence and resolve the declared checks without unrelated repairs.";
    });
  }

  async stopValidation(id: string, operationId?: string): Promise<Delivery> {
    const snapshot = this.status(id),
      attempt = snapshot.validation?.attempts.find(
        (a) =>
          a.state !== "stopped" &&
          (!operationId || a.operationId === operationId),
      );
    if (!attempt) return snapshot;
    const runtime = this.coordination.validationRuntime;
    const same = () =>
      runtime?.mode === "controlled" &&
      runtime.bindingSha256 === attempt.bindingSha256;
    let stopped: Awaited<ReturnType<ValidationRuntime["stop"]>> | undefined;
    try {
      if (same())
        stopped = await this.observe(runtime!.stop(structuredClone(attempt)));
    } catch {}
    return this.change(id, (d) => {
      const a = d.validation?.attempts.find(
        (a) => a.operationId === attempt.operationId,
      );
      if (!a || a.state === "stopped") return;
      this.chargeRepair(d);
      if (d.repair) delete d.repair.checkpoint;
      const verified =
        same() &&
        stopped?.operationId === a.operationId &&
        stopped.fence === a.fence &&
        stopped.stopped === true &&
        stopped.remainingProcesses === 0;
      a.state = verified ? "stopped" : "uncertain";
      if (
        d.ownership.fence !== a.fence ||
        ["paused", "cancelled"].includes(d.phase)
      )
        a.outcome = "incomplete";
      if (
        (!verified || stopped?.treeSha256 !== a.treeSha256) &&
        a.outcome !== "timeout"
      )
        a.outcome = "incomplete";
      if (
        verified &&
        d.blocker.code === "UNCERTAIN_SESSION" &&
        (!d.feature?.session || d.feature.session.state === "stopped") &&
        sessionsQuiescent(d)
      )
        d.blocker = this.disabledBlocker();
      if (!["paused", "cancelled"].includes(d.phase)) d.phase = "blocked";
      if (!verified)
        d.blocker = {
          code: "UNCERTAIN_SESSION",
          message: "Validation descendants are not verified stopped.",
          nextAction:
            "Recover the exact validation operation with the same isolated binding.",
        };
    });
  }

  async planFeature(id: string): Promise<Delivery> {
    const snapshot = this.status(id);
    if (
      !snapshot.ownership.held ||
      !["blocked", "preparing"].includes(snapshot.phase) ||
      snapshot.feature
    )
      throw new DeliveryError("Resolve controls before planning this feature.");
    let planned: FeatureEvidence;
    try {
      planned = featurePlan(
        await this.observe(
          this.coordination.featurePlanner?.plan(snapshot.request) ??
            Promise.resolve(undefined),
        ),
      );
    } catch {
      throw new DeliveryError(
        "Feature criteria could not be established safely.",
      );
    }
    return this.change(id, (delivery) => {
      if (
        delivery.ownership.fence !== snapshot.ownership.fence ||
        delivery.phase !== snapshot.phase ||
        delivery.feature
      )
        throw new DeliveryError("Feature planning authority changed.");
      planned.allowanceMs =
        snapshot.initialCodingAllowanceMs ?? planned.allowanceMs;
      delivery.feature = planned;
      if (planned.outcome === "needs-info")
        delivery.blocker.nextAction =
          "Clarify the material requirement before coding.";
    });
  }

  async clarifyFeature(id: string, clarification: string): Promise<Delivery> {
    const snapshot = this.status(id),
      previous = snapshot.feature;
    if (
      !previous ||
      previous.outcome !== "needs-info" ||
      previous.session ||
      !snapshot.ownership.held ||
      !["blocked", "preparing"].includes(snapshot.phase) ||
      typeof clarification !== "string" ||
      !clarification.trim() ||
      clarification.length > 2000 ||
      /[\u0000-\u001f\u007f]/.test(clarification) ||
      redact(clarification) !== clarification
    )
      throw new DeliveryError(
        "Clarify only the owner's stopped material planning blocker with safe request text.",
      );
    let plan: FeatureEvidence;
    const clarifications = [
      ...(previous.clarifications ?? []),
      clarification.trim(),
    ];
    if (clarifications.length > 32)
      throw new DeliveryError(
        "Too many clarification attempts; retain this request and resubmit explicitly.",
      );
    try {
      plan = featurePlan(
        await this.observe(
          this.coordination.featurePlanner?.plan(
            JSON.stringify({ request: snapshot.request, clarifications }),
          ) ?? Promise.resolve(undefined),
        ),
      );
    } catch {
      throw new DeliveryError(
        "Feature criteria could not be established safely.",
      );
    }
    return this.change(id, (delivery) => {
      if (
        delivery.ownership.fence !== snapshot.ownership.fence ||
        delivery.phase !== snapshot.phase ||
        delivery.feature?.outcome !== "needs-info" ||
        JSON.stringify(delivery.feature) !== JSON.stringify(previous)
      )
        throw new DeliveryError("Feature clarification authority changed.");
      plan.allowanceMs = previous.allowanceMs;
      plan.clarifications = clarifications;
      delivery.feature = plan;
      delivery.blocker = this.disabledBlocker();
      if (plan.outcome === "needs-info")
        delivery.blocker.nextAction =
          "Clarify the material requirement before coding.";
    });
  }

  private repairActive(d: Delivery, id: string): boolean {
    const a = d.repair?.attempts.at(-1);
    return (
      a?.id === id &&
      a.state === "running" &&
      a.runnerId === this.runnerId &&
      a.fence === d.ownership.fence
    );
  }

  private featureBudget(delivery: Delivery) {
    return delivery.repair?.attempts.at(-1)?.state === "running"
      ? delivery.repair
      : delivery.feature!;
  }

  private chargeRepair(delivery: Delivery): void {
    const r = delivery.repair,
      now = (this.coordination.clock ?? Date.now)();
    if (
      !r?.checkpoint ||
      r.checkpoint.runnerId !== this.runnerId ||
      r.attempts.at(-1)?.state !== "running" ||
      !["implementing", "validating"].includes(delivery.phase)
    )
      return;
    if (!Number.isSafeInteger(now) || now < r.checkpoint.at) {
      r.activeMs = r.allowanceMs;
      delete r.checkpoint;
      return;
    }
    r.activeMs = Math.min(
      Number.MAX_SAFE_INTEGER,
      r.activeMs + now - r.checkpoint.at,
    );
    r.checkpoint.at = now;
  }

  private finishRepair(id: string, repairId: string, passed = false): Delivery {
    return this.change(id, (d) => {
      const r = d.repair,
        a = r?.attempts.at(-1);
      if (!r || !a || a.id !== repairId || a.state === "stopped") return;
      this.chargeRepair(d);
      delete r.checkpoint;
      const stopped =
        (!d.feature?.session || d.feature.session.state === "stopped") &&
        !d.validation?.attempts.some((v) => v.state !== "stopped");
      a.state = stopped ? "stopped" : "uncertain";
      if (d.feature?.session)
        a.codingSession = structuredClone(d.feature.session);
      a.activeMs = r.activeMs - a.startActiveMs;
      a.remainingMs = Math.max(0, r.allowanceMs - r.activeMs);
      a.remainingCycles = Math.max(0, r.allowanceCycles - r.attempts.length);
      a.outcome =
        r.activeMs >= r.allowanceMs
          ? "exhausted"
          : d.ownership.fence !== a.fence ||
              ["paused", "cancelled"].includes(d.phase)
            ? "interrupted"
            : passed && stopped
              ? "passed"
              : "failed";
      const verification = d.validation?.attempts.find(
        (v) => v.operationId === a.validationOperationId,
      );
      if (
        verification?.state === "stopped" &&
        verification.outcome === "pending"
      )
        verification.outcome = "incomplete";
      if (a.outcome !== "passed" && d.feature?.candidate)
        d.feature.candidate.validation = "not-run";
      if (stopped) a.finishedAt = new Date().toISOString();
      if (
        a.outcome !== "passed" &&
        stopped &&
        (r.activeMs >= r.allowanceMs || r.attempts.length >= r.allowanceCycles)
      )
        d.blocker.nextAction =
          "Repair allowance exhausted; preserve work and record an explicit owner extension.";
    });
  }

  async repairFeature(
    id: string,
    reviewFindings: string[] = [],
  ): Promise<Delivery> {
    return this.repairCandidate(id, reviewFindings);
  }

  private async repairCandidate(
    id: string,
    reviewFindings: string[],
    baseRefresh?: { from: string; to: string },
  ): Promise<Delivery> {
    if (this.status(id).publication)
      throw new DeliveryError(
        "Published candidate updates require a new validated publication protocol.",
      );
    const snapshot = this.status(id),
      feature = snapshot.feature,
      validation = baseRefresh
        ? snapshot.validation?.attempts.findLast(
            (v) =>
              v.stage === "candidate" &&
              v.treeSha256 === feature?.candidate?.sha256,
          )
        : snapshot.validation?.attempts.at(-1);
    if (
      !snapshot.ownership.held ||
      !["blocked", "preparing"].includes(snapshot.phase) ||
      !feature?.candidate ||
      feature.session?.state !== "stopped" ||
      snapshot.repair?.attempts.some((a) => a.state !== "stopped") ||
      snapshot.validation?.attempts.some((a) => a.state !== "stopped") ||
      !sessionsQuiescent(snapshot) ||
      !validation ||
      validation.stage !== "candidate" ||
      validation.state !== "stopped" ||
      validation.treeSha256 !== feature.candidate.sha256 ||
      !["failed", "passed", "incomplete", "timeout", "flaky"].includes(
        validation.outcome,
      )
    )
      throw new DeliveryError(
        "Repair requires stopped candidate validation; baseline or uncertain work cannot be repaired.",
      );
    const findings = repairFindings([
      ...(validation.outcome === "passed"
        ? []
        : [
            "Candidate validation: " + validation.outcome,
            ...validation.results
              .filter((r) => r.status !== "success")
              .map((r) => "Candidate check " + r.checkId + ": " + r.status),
          ]),
      ...(Array.isArray(reviewFindings) && reviewFindings.length === 0
        ? []
        : repairFindings(reviewFindings)),
    ]);
    const input = validationCandidate(feature, this.stateDirectory);
    const attemptId = randomUUID();
    const prepared = this.change(id, (d) => {
      if (
        d.phase !== snapshot.phase ||
        d.ownership.fence !== snapshot.ownership.fence ||
        d.feature?.candidate?.sha256 !== input.digest ||
        d.repair?.attempts.some((a) => a.state !== "stopped")
      )
        throw new DeliveryError("Repair authority changed.");
      const r = (d.repair ??= repairBudget());
      if (
        r.activeMs >= r.allowanceMs ||
        r.attempts.length >= r.allowanceCycles
      ) {
        d.blocker.nextAction =
          "Repair allowance exhausted; record an explicit owner extension.";
        return;
      }
      r.attempts.push({
        ...(d.review?.runs.at(-1)?.outcome === "repairing"
          ? { reviewRunId: d.review.runs.at(-1)!.id }
          : {}),
        ...(d.prChecks?.runs.at(-1)?.outcome === "repairing"
          ? { prCheckRunId: d.prChecks.runs.at(-1)!.id }
          : {}),
        ...(baseRefresh ? { baseRefresh } : {}),
        id: attemptId,
        fence: d.ownership.fence,
        runnerId: this.runnerId,
        findings,
        inputSha256: input.digest,
        state: "running",
        outcome: "pending",
        startedAt: new Date().toISOString(),
        startActiveMs: r.activeMs,
        activeMs: 0,
        remainingMs: r.allowanceMs - r.activeMs,
        remainingCycles: r.allowanceCycles - r.attempts.length - 1,
      });
      d.feature!.candidate!.validation = "not-run";
    });
    if (prepared.repair!.attempts.at(-1)?.id !== attemptId) return prepared;
    let passed = false;
    try {
      if (baseRefresh) {
        this.change(id, (d) => {
          d.feature!.sourceRevision = baseRefresh.to;
        });
        const source = candidateMainSource(
          snapshot.repository,
          snapshot.publicationHistory!.at(-1)!.defaultBranch,
        );
        if (
          !passedBaseline(
            snapshot.validation,
            source.digest,
            source.revision,
            snapshot.authorityPolicySha256,
            validationCriteria(snapshot.feature!),
            this.coordination.validationRuntime?.bindingSha256,
          )
        ) {
          const baseline = await this.validateFeatureTree(
            id,
            "baseline",
            attemptId,
          );
          if (baseline.validation?.attempts.at(-1)?.outcome !== "passed")
            throw Error("Advanced baseline failed");
        }
      }
      const coded = await this.executeFeature(id, {}, attemptId);
      if (
        coded.feature?.outcome === "admitted" &&
        coded.feature.session?.state === "stopped" &&
        coded.phase === "blocked" &&
        coded.ownership.fence === snapshot.ownership.fence &&
        coded.repair!.activeMs < coded.repair!.allowanceMs
      ) {
        const checked = await this.validateFeatureTree(
          id,
          "candidate",
          attemptId,
        );
        const check = checked.validation!.attempts.at(-1)!;
        passed =
          check.outcome === "passed" &&
          checked.feature?.candidate?.validation === "passed";
      }
    } catch {
      // Detailed worker/errors are untrusted; retain only bounded findings and evidence.
    }
    return this.finishRepair(id, attemptId, passed);
  }

  extendRepair(
    id: string,
    addedCycles: number,
    addedMinutes: number,
  ): Delivery {
    if (
      !Number.isSafeInteger(addedCycles) ||
      addedCycles < 0 ||
      addedCycles > 100 ||
      !Number.isSafeInteger(addedMinutes) ||
      addedMinutes < 0 ||
      addedMinutes > 1440 ||
      addedCycles + addedMinutes === 0
    )
      throw new DeliveryError(
        "Extend repair by 0–100 cycles and 0–1440 minutes, with a positive extension.",
      );
    return this.change(id, (d) => {
      const r = d.repair;
      if (
        !r ||
        !d.ownership.held ||
        d.phase !== "blocked" ||
        r.attempts.some((a) => a.state !== "stopped") ||
        (d.feature?.session && d.feature.session.state !== "stopped") ||
        d.validation?.attempts.some((a) => a.state !== "stopped") ||
        (r.activeMs < r.allowanceMs && r.attempts.length < r.allowanceCycles)
      )
        throw new DeliveryError(
          "Only stopped exhausted repairs may receive an owner extension.",
        );
      r.allowanceCycles += addedCycles;
      r.allowanceMs += addedMinutes * 60000;
      r.extensions.push({
        addedCycles,
        addedMs: addedMinutes * 60000,
        at: new Date().toISOString(),
      });
      d.blocker = this.disabledBlocker();
    });
  }

  private chargeCoding(delivery: Delivery): void {
    if (delivery.repair?.attempts.at(-1)?.state === "running") {
      this.chargeRepair(delivery);
      return;
    }
    const f = delivery.feature,
      now = (this.coordination.clock ?? Date.now)();
    if (
      !f?.activeCheckpoint ||
      f.activeCheckpoint.runnerId !== this.runnerId ||
      f.session?.state !== "running" ||
      delivery.phase !== "implementing"
    )
      return;
    if (!Number.isSafeInteger(now) || now < f.activeCheckpoint.at)
      throw new DeliveryError(
        "Coding clock is unavailable; stop and reconcile the session.",
      );
    f.activeMs = Math.min(
      Number.MAX_SAFE_INTEGER,
      f.activeMs + now - f.activeCheckpoint.at,
    );
    f.activeCheckpoint.at = now;
  }

  async codeFeature(
    id: string,
    options: { codingMinutes?: number } = {},
  ): Promise<Delivery> {
    if (this.status(id).publication)
      throw new DeliveryError(
        "Preserve publication evidence before further coding.",
      );
    if (this.status(id).repair)
      throw new DeliveryError(
        "Use the persisted repair allowance after repair has begun.",
      );
    return this.executeFeature(id, options);
  }

  private async executeFeature(
    id: string,
    options: { codingMinutes?: number } = {},
    repairId?: string,
  ): Promise<Delivery> {
    const runtime = this.coordination.featureRuntime,
      snapshot = this.status(id),
      feature = snapshot.feature;
    if (
      !sessionsQuiescent(snapshot) ||
      snapshot.blocker.code === "UNCERTAIN_SESSION" ||
      !runtime ||
      runtime.mode !== "controlled" ||
      !validCodingPins(runtime.pins) ||
      !feature ||
      feature.ambiguity ||
      !snapshot.ownership.held ||
      !["blocked", "preparing"].includes(snapshot.phase) ||
      (feature.outcome === "admitted" && !repairId) ||
      (snapshot.repair?.attempts.some((a) => a.state !== "stopped") &&
        snapshot.repair.attempts.at(-1)?.id !== repairId) ||
      (feature.session && feature.session.state !== "stopped")
    )
      throw new DeliveryError(
        "Resolve feature criteria, ownership and stopped controlled coding runtime before coding; production remains disabled.",
      );
    const onboarding = inspectOnboarding(
      snapshot.repository,
      this.onboardingOptions,
    );
    if (
      !onboarding.ready ||
      onboarding.policy?.sha256 !== snapshot.authorityPolicySha256 ||
      repositoryIdentity(snapshot.repository, onboarding) !==
        snapshot.ownership.key
    )
      throw new DeliveryError(
        "Feature onboarding authority is unavailable or changed.",
      );
    // Coding stays on the feature's revision, except that before any
    // candidate exists it may continue on a moved main; the baseline check
    // below then requires that new main to have passed validation.
    const mayMove = mayMoveBase(snapshot, repairId);
    let source: ReturnType<typeof candidateSource>;
    try {
      source = candidateSource(
        snapshot.repository,
        mayMove ? undefined : feature.sourceRevision,
      );
    } catch {
      throw new DeliveryError(
        "Feature source is changed or unsafe; preserve repository work.",
      );
    }
    if (
      !passedBaseline(
        snapshot.validation,
        source.digest,
        source.revision,
        snapshot.authorityPolicySha256,
        validationCriteria(feature),
        this.coordination.validationRuntime?.bindingSha256,
      )
    )
      throw new DeliveryError(
        "Validate unchanged main before coding; passing baseline evidence is required.",
      );
    const validationRuntime = this.coordination.validationRuntime;
    const baseline = snapshot
      .validation!.attempts.filter((a) => a.stage === "baseline")
      .at(-1)!;
    const validationEnvironment = await this.observe(
      validationRuntime!.inspect(),
    );
    if (
      validationRuntime?.mode !== "controlled" ||
      !validationEnvironment ||
      validationEnvironment.mode !== "controlled" ||
      validationEnvironment.bindingSha256 !== baseline.bindingSha256 ||
      validationDigest(validationEnvironment.environment) !==
        baseline.environmentSha256
    )
      throw new DeliveryError(
        "Baseline validation environment changed before coding.",
      );
    const currentMain = candidateMainSource(
      snapshot.repository,
      onboarding.canonicalRepository!.defaultBranch,
    );
    if (
      currentMain.revision !== source.revision ||
      currentMain.digest !== source.digest
    )
      throw new DeliveryError(
        "Main changed before coding dispatch; validate the new baseline.",
      );
    // Refuse before any durable effect if the feature branch can't follow.
    if (mayMove)
      try {
        featureBranchAdvance(
          snapshot.repository,
          `codex/feature-${id}`,
          source.revision,
        );
      } catch {
        throw new DeliveryError(
          "The feature branch has its own commits or main moved backwards; it can't follow the new main.",
        );
      }
    validationContract(
      this.onboardingOptions.policyPath,
      snapshot.authorityPolicySha256 ?? undefined,
    );
    const input = repairId
      ? validationCandidate(feature, this.stateDirectory)
      : source;
    const minutes = options.codingMinutes;
    if (
      minutes !== undefined &&
      (feature.session ||
        !Number.isSafeInteger(minutes) ||
        minutes < 1 ||
        minutes > 1440)
    )
      throw new DeliveryError(
        "Declare 1 to 1440 initial coding minutes before the first coding session.",
      );
    if (
      feature.pins &&
      JSON.stringify(feature.pins) !== JSON.stringify(runtime.pins)
    )
      throw new DeliveryError(
        "Coding pins changed; requalification is required.",
      );
    // Each coding launch, resume or repair needs fresh model-only usage
    // authority: a low allowance needs owner approval, exhaustion is never
    // overridden, and every approval binds to exactly one operation.
    // Fresh usage alone never restarts coding after a usage interruption.
    if (unrestartedInterruption(feature) && !pendingRestart(feature))
      throw new DeliveryError(restartRequired);
    const usage = (await this.checkUsage(id)).usage!,
      account = usage.accountId;
    // An unknown account is never model-only authority, and a feature's
    // turns all use the account its first coding launch used.
    // Unmeasured usage (endorsed or not) is never a known model-only account.
    if (
      !account ||
      usage.remainingPercent === null ||
      (feature.usageAccountId !== undefined &&
        feature.usageAccountId !== account)
    )
      throw new DeliveryError(
        "Coding usage authority must come from the same known model-only account as the first coding launch.",
      );
    // A qualified mediation decision names the only account coding may use,
    // and a feature once linked to it never codes without that decision.
    // Like every dispatch path, a mediated delivery re-qualifies first.
    const mediation =
      snapshot.qualification?.subscriptionMediation?.mechanismDecision ||
      feature.mediationUsageAccountId
        ? qualifiedDecision(await this.qualify(id))
        : undefined;
    if (
      (mediation || feature.mediationUsageAccountId) &&
      mediation?.usageAccountId !== account
    )
      throw new DeliveryError(
        "Coding usage must come from the delivery's qualified model-only mediation account.",
      );
    // A mediated turn is routed when a general session can be opened for it
    // (decision E); the host records the route each session runs under.
    const decisionSha256 = mediation && sha256(JSON.stringify(mediation));
    const route: SessionRoute | undefined =
      decisionSha256 && this.coordination.generalSessions
        ? { deliveryId: id, decisionSha256 }
        : undefined;
    const prepared = this.change(id, (delivery) => {
      if (
        delivery.ownership.fence !== snapshot.ownership.fence ||
        delivery.phase !== snapshot.phase ||
        (repairId && !this.repairActive(delivery, repairId)) ||
        delivery.feature?.session?.state === "running" ||
        delivery.validation?.attempts.some((a) => a.state !== "stopped") ||
        !passedBaseline(
          delivery.validation,
          source.digest,
          source.revision,
          delivery.authorityPolicySha256,
          validationCriteria(delivery.feature!),
          validationRuntime?.bindingSha256,
        )
      )
        throw new DeliveryError("Feature coding authority changed.");
      const f = delivery.feature!;
      const budget = repairId ? delivery.repair! : f;
      if (minutes !== undefined) f.allowanceMs = minutes * 60000;
      if (budget.activeMs >= budget.allowanceMs) {
        f.outcome = "exhausted";
        delivery.blocker.nextAction =
          "Record an owner coding allowance extension before continuing.";
        return;
      }
      f.sourceRevision = source.revision;
      f.branch = `codex/feature-${id}`;
      f.pins = structuredClone(runtime.pins);
      const prior = f.session;
      // A recovered resume returned the home, so its predecessor resumes again.
      const predecessor =
        prior?.resumeRecovery === "recovered" ? prior.resumeFrom! : prior;
      // A retired lineage is never resumed; coding restarts fresh.
      const resumable =
        !repairId &&
        !!prior?.threadId &&
        !!predecessor &&
        prior.resumeRecovery !== "retired";
      // A resume keeps its predecessor's route. Under another route (a new
      // decision, or a change between offline and routed) coding starts a
      // new lineage instead.
      const sameRoute = JSON.stringify(prior?.route) === JSON.stringify(route);
      const resuming = resumable && sameRoute;
      // A recovered resume never ran, so its predecessor's revision is the one
      // it recorded; otherwise the predecessor built its own workspace.
      // A session recorded before revisions were kept names no move; the
      // guest then refuses a predecessor on another revision.
      const predecessorRevision =
        prior?.resumeRecovery === "recovered"
          ? (prior.baseMove?.from ?? prior.sourceRevision)
          : prior?.sourceRevision;
      const moved =
        resuming &&
        predecessorRevision !== undefined &&
        predecessorRevision !== source.revision;
      f.session = {
        operationId: randomUUID(),
        fence: delivery.ownership.fence,
        state: "running",
        intent: resuming ? "resume" : "start",
        sourceRevision: source.revision,
        ...(moved
          ? { baseMove: { from: predecessorRevision!, to: source.revision } }
          : {}),
        ...(route ? { route } : {}),
        ...(resuming
          ? {
              threadId: prior!.threadId,
              resumeFrom: {
                operationId: predecessor!.operationId,
                fence: predecessor!.fence,
                state: "stopped" as const,
                intent: predecessor!.intent,
              },
            }
          : {}),
      };
      if (resumable && !resuming)
        (f.supersededLineages ??= []).push({
          operationId: predecessor!.operationId,
          threadId: prior!.threadId!,
          ...(prior!.route ? { route: prior!.route } : {}),
          at: new Date().toISOString(),
          by: f.session.operationId,
          session: codingBinding(predecessor!),
        });
      // Bind fresh authority from exactly this check to this operation; the
      // gate refuses stale, unapproved or exhausted usage.
      const bound =
        delivery.usage?.checkId === usage.checkId &&
        this.usageGate.bind(delivery.usage, f.session.operationId);
      if (!bound)
        throw new DeliveryError(
          "Fresh model-only subscription usage authority is required before coding; exhaustion cannot be overridden.",
        );
      delivery.usage = bound;
      // Bind the owner's restart approval to this re-dispatch; reaching
      // dispatch spends it, so a refusal before then leaves it usable.
      if (unrestartedInterruption(f)) {
        const approval = pendingRestart(f);
        if (!approval) throw new DeliveryError(restartRequired);
        approval.operationId = f.session.operationId;
      }
      f.usageAccountId = account;
      if (mediation) f.mediationUsageAccountId = account;
      f.activeCheckpoint = {
        at: (this.coordination.clock ?? Date.now)(),
        runnerId: this.runnerId,
      };
      if (repairId)
        delivery.repair!.checkpoint = {
          at: (this.coordination.clock ?? Date.now)(),
          runnerId: this.runnerId,
        };
      f.outcome = "coding";
      delivery.phase = "implementing";
    });
    if (prepared.feature!.outcome === "exhausted") return prepared;
    const session = structuredClone(prepared.feature!.session!),
      pins = JSON.stringify(runtime.pins),
      clock = this.coordination.clock ?? Date.now;
    let result: CodingResult | undefined,
      completed = false;
    const checkpoint = () => {
      const now = clock();
      if (!Number.isSafeInteger(now)) return false;
      const d = this.change(id, (delivery) => {
        if (delivery.feature?.session?.operationId === session.operationId)
          this.chargeCoding(delivery);
      });
      return (
        lapse === undefined &&
        runtime.mode === "controlled" &&
        d.phase === "implementing" &&
        (!repairId || this.repairActive(d, repairId)) &&
        d.ownership.held &&
        d.ownership.fence === session.fence &&
        d.feature?.session?.operationId === session.operationId &&
        this.featureBudget(d).activeMs < this.featureBudget(d).allowanceMs &&
        JSON.stringify(runtime.pins) === pins
      );
    };
    // A routed turn's model requests each need usage observed now and the
    // owner's decision record still naming the same decision (decision E).
    // The record is re-read, not re-probed; launch re-qualifies fully.
    // The turn's usage permits this operation, and is measured (decision H).
    const usagePermitsTurn = (usage: UsageReport | undefined) =>
      usage?.remainingPercent !== null &&
      this.usageGate.permits(usage, {
        operationId: session.operationId,
        accountId: account,
      });
    // Why authority observed now no longer permits this turn, or null while
    // it does: usage first, then a mediated turn's decision. Throws when the
    // usage read loses delivery authority.
    const freshLapse = async (): Promise<GeneralSessionLapse | null> => {
      const usage = (await this.checkUsage(id)).usage;
      if (!usage || usage.remainingPercent === null) return "unknown";
      if (usage.accountId !== account) return "account";
      if (usage.decision === "exhausted") return "exhausted";
      if (!usagePermitsTurn(usage)) return "approval-required";
      if (!mediation) return null;
      // The projection never throws: missing or drifted evidence yields no
      // decision, which reads as withdrawn.
      const current = qualifiedDecision(
        projectSubscriptionDecision(
          structuredClone(this.status(id)),
          this.stateDirectory,
        ),
      );
      return current && sha256(JSON.stringify(current)) === decisionSha256
        ? null
        : "withdrawn";
    };
    const authority = (): Promise<GeneralSessionAuthority> =>
      freshLapse().then(
        (lapse) => lapse ?? "permitted",
        () => "unknown",
      );
    const prompt = JSON.stringify({
      request: snapshot.request,
      criteria: feature.criteria,
      verification: feature.verification,
      clarifications: feature.clarifications ?? [],
      // A resumed conversation is told its workspace now starts from a new main.
      ...(session.baseMove ? { baseMove: session.baseMove } : {}),
      ...(repairId
        ? { repairFindings: snapshot.repair!.attempts.at(-1)!.findings }
        : {}),
    });
    let gateway: SessionGateway | undefined,
      revoked = false;
    // The turn's general session is revoked once, with the first reason.
    const revoke = (reason: GeneralSessionRevocation) => {
      if (!gateway || revoked) return;
      revoked = true;
      gateway.revoke(reason);
    };
    let interrupt: (value: undefined) => void;
    const interrupted = new Promise<undefined>((resolve) => {
      interrupt = resolve;
    });
    // Re-observe usage while the turn runs: exhaustion, an account change or
    // a lost observation stops it, preserving any started thread.
    let lapse: GeneralSessionLapse | undefined,
      monitoring = true,
      polling = false;
    // A lapse, null while authority permits, or undefined after a control
    // change.
    const observedLapse = () => freshLapse().catch(() => undefined);
    // A lapse or withdrawal ends the turn at once (decision F): the grant is
    // revoked with the reason and the checkpoint fails. It is durable before
    // the worker is stopped, so a controller lost mid-stop still needs the
    // owner's restart approval.
    const recordLapse = (reason: GeneralSessionLapse) => {
      lapse ??= reason;
      revoke(reason);
      try {
        this.change(id, (delivery) =>
          recordInterruption(delivery, session, reason),
        );
      } catch {}
      interrupt(undefined);
    };
    const usageMonitor = setInterval(() => {
      if (polling) return;
      polling = true;
      void observedLapse().then((observed) => {
        polling = false;
        // A poll that finishes after the turn ended changes nothing.
        if (observed === null || !monitoring) return;
        if (observed) recordLapse(observed);
        else interrupt(undefined);
      });
    }, this.coordination.codingUsagePollMs ?? workerUsagePollMs);
    usageMonitor.unref();
    const heartbeat = setInterval(() => {
      try {
        if (!checkpoint()) interrupt(undefined);
      } catch {
        interrupt(undefined);
      }
    }, 250);
    const deadline = setTimeout(
      () => {
        this.change(id, (delivery) => {
          if (
            delivery.feature?.session?.operationId === session.operationId &&
            delivery.phase === "implementing"
          )
            this.featureBudget(delivery).activeMs = Math.max(
              this.featureBudget(delivery).activeMs,
              this.featureBudget(delivery).allowanceMs,
            );
        });
        interrupt(undefined);
      },
      this.featureBudget(prepared).allowanceMs -
        this.featureBudget(prepared).activeMs,
    );
    try {
      if (mayMove)
        advanceFeatureBranch(
          snapshot.repository,
          prepared.feature!.branch!,
          source.revision,
        );
      featureBranch(
        snapshot.repository,
        prepared.feature!.branch!,
        snapshot.publicationHistory?.[0]?.sourceRevision ?? source.revision,
      );
      if (!checkpoint()) throw Error();
      // Dispatch takes usage observed now, not a report up to 60 s old. A
      // refusal here stops the session before any turn, so no interruption
      // is recorded and no restart approval is needed.
      if (!usagePermitsTurn((await this.checkUsage(id)).usage) || !checkpoint())
        throw Error();
      // Opened inside the guarded turn, so a refusal still stops the session.
      if (route)
        gateway = this.coordination.generalSessions!(
          {
            deliveryId: id,
            sessionId: session.operationId,
            decisionSha256: route.decisionSha256,
            accountId: mediation!.accountId,
            // Within the gateway's session limit; a longer turn is stopped.
            expiresAt:
              clock() +
              Math.min(
                generalSessionLimits.sessionMs,
                this.featureBudget(prepared).allowanceMs -
                  this.featureBudget(prepared).activeMs +
                  sessionGraceMs,
              ),
          },
          async () => {
            const current = await authority();
            // A request answered after the turn ended changes nothing.
            if (current !== "permitted" && monitoring) recordLapse(current);
            return current;
          },
        );
      const modelRoute = gateway && {
        ...route!,
        capability: gateway.capability,
      };
      const argv = [...lockedCodingArgv(session.threadId, modelRoute), prompt];
      result = await Promise.race([
        runtime.execute(
          {
            ...session,
            ...(modelRoute ? { modelRoute } : {}),
            branch: prepared.feature!.branch!,
            sourceRevision: source.revision,
            inputSha256: input.digest,
            onEvent: (event) => {
              if (!checkpoint() || !event || typeof event !== "object")
                return false;
              const item = event as Record<string, unknown>;
              if (
                item.type !== "thread.started" ||
                typeof item.thread_id !== "string" ||
                !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
                  item.thread_id,
                )
              )
                return false;
              const threadId = item.thread_id;
              if (session.threadId && session.threadId !== threadId)
                return false;
              const updated = this.change(id, (delivery) => {
                if (
                  delivery.feature?.session?.operationId ===
                    session.operationId &&
                  delivery.feature.session.state === "running" &&
                  delivery.ownership.fence === session.fence
                ) {
                  if (
                    delivery.feature.session.threadId &&
                    delivery.feature.session.threadId !== threadId
                  )
                    throw new DeliveryError("Coding session identity changed.");
                  delivery.feature.session.threadId = threadId;
                  delivery.feature.session.threadStarted = true;
                  reachedDispatch(delivery, session.operationId);
                }
              });
              return (
                updated.feature?.session?.operationId === session.operationId &&
                updated.feature.session.threadId === threadId
              );
            },
            argv,
            files: input.files,
            ...(repairId && snapshot.repair?.attempts.at(-1)?.baseRefresh
              ? {
                  baseRefresh: {
                    from: {
                      revision:
                        snapshot.repair.attempts.at(-1)!.baseRefresh!.from,
                      files: candidateRevisionFiles(
                        snapshot.repository,
                        snapshot.repair.attempts.at(-1)!.baseRefresh!.from,
                      ),
                    },
                    to: { revision: source.revision, files: source.files },
                  },
                }
              : {}),
            pins: structuredClone(runtime.pins),
            allowanceMs:
              this.featureBudget(prepared).allowanceMs -
              this.featureBudget(prepared).activeMs,
            // Recheck the bound authority after asynchronous pin inspection.
            mayDispatch: () => {
              const permitted =
                checkpoint() &&
                this.usageGate.permits(this.status(id).usage, {
                  operationId: session.operationId,
                });
              if (permitted)
                this.change(id, (delivery) =>
                  reachedDispatch(delivery, session.operationId),
                );
              return permitted;
            },
            checkpoint,
          },
          gateway,
        ),
        interrupted,
      ]);
      if (
        result?.operationId !== session.operationId ||
        result.fence !== session.fence
      )
        throw Error();
      const turn = codingTurn(
        result,
        this.status(id).feature?.session?.threadId ?? session.threadId,
      );
      completed = turn.completed;
      this.change(id, (delivery) => {
        if (delivery.feature?.session?.operationId === session.operationId) {
          delivery.feature.session.threadId = turn.threadId;
          delivery.feature.session.threadStarted = true;
          reachedDispatch(delivery, session.operationId);
        }
      });
      checkpoint();
    } catch {
      /* Only fixed safe status crosses the controller boundary. */
    } finally {
      clearTimeout(deadline);
      monitoring = false;
      clearInterval(heartbeat);
      clearInterval(usageMonitor);
      let ended: GeneralSessionRevocation =
        JSON.stringify(runtime.pins) === pins ? "stopped" : "pin-changed";
      try {
        if (this.status(id).phase === "paused") ended = "paused";
      } catch {}
      revoke(ended);
    }
    let stopped = await this.stopFeature(id, session.operationId);
    // Output is collected only under authority that still holds afterwards;
    // exhaustion is never overridden, and the stopped thread stays resumable.
    if (!lapse && completed) lapse = (await observedLapse()) ?? undefined;
    if (lapse)
      stopped = this.change(id, (delivery) =>
        recordInterruption(delivery, session, lapse!),
      );
    if (
      stopped.feature?.session?.operationId === session.operationId &&
      needsResumeRecovery(stopped.feature.session)
    )
      return this.recoverResume(id);
    // A lapsed turn's workspace is kept as evidence only, never as a
    // candidate (decision G); a refused collection leaves the interruption.
    if (
      lapse &&
      stopped.feature?.session?.operationId === session.operationId &&
      stopped.feature.session.state === "stopped" &&
      stopped.ownership.fence === session.fence &&
      JSON.stringify(runtime.pins) === pins
    )
      try {
        const output = await this.observe(runtime.collect(session));
        if (
          output?.operationId !== session.operationId ||
          output.fence !== session.fence
        )
          throw Error();
        const path = join(
          this.stateDirectory,
          "artifacts",
          `interrupted-${session.operationId}.json`,
        );
        this.ledger.assertArtifacts();
        writeFileSync(path, candidateOutput(output), {
          flag: "wx",
          mode: 0o600,
          flush: true,
        });
        stopped = this.change(id, (delivery) => {
          delivery.evidence.push({ kind: "interrupted-turn", path });
        });
      } catch {}
    if (
      !completed ||
      lapse ||
      stopped.feature?.session?.state !== "stopped" ||
      stopped.phase === "paused" ||
      stopped.phase === "cancelled" ||
      stopped.ownership.fence !== session.fence ||
      this.featureBudget(stopped).activeMs >=
        this.featureBudget(stopped).allowanceMs
    )
      return stopped;
    try {
      const fresh = inspectOnboarding(
        snapshot.repository,
        this.onboardingOptions,
      );
      if (
        !fresh.ready ||
        fresh.policy?.sha256 !== snapshot.authorityPolicySha256 ||
        JSON.stringify(runtime.pins) !== pins
      )
        throw Error();
      candidateSource(snapshot.repository, source.revision);
      featureBranch(
        snapshot.repository,
        prepared.feature!.branch!,
        snapshot.publicationHistory?.[0]?.sourceRevision ?? source.revision,
      );
      const output = await this.observe(runtime.collect(session));
      if (
        !output ||
        output.operationId !== session.operationId ||
        output.fence !== session.fence
      )
        throw Error();
      const finalAuthority = inspectOnboarding(
        snapshot.repository,
        this.onboardingOptions,
      );
      if (
        !finalAuthority.ready ||
        finalAuthority.policy?.sha256 !== snapshot.authorityPolicySha256 ||
        repositoryIdentity(snapshot.repository, finalAuthority) !==
          snapshot.ownership.key ||
        JSON.stringify(runtime.pins) !== pins
      )
        throw Error();
      candidateSource(snapshot.repository, source.revision);
      featureBranch(
        snapshot.repository,
        prepared.feature!.branch!,
        snapshot.publicationHistory?.[0]?.sourceRevision ?? source.revision,
      );
      if (repairId)
        protectValidationInputs(
          validationContract(
            this.onboardingOptions.policyPath,
            snapshot.authorityPolicySha256 ?? undefined,
          ),
          source.files,
          output.files.map((f) => ({
            path: f.path,
            bytes: f.bytes,
            executable: f.executable ?? false,
          })),
        );
      const payload = candidateOutput(output),
        path = join(
          this.stateDirectory,
          "artifacts",
          `candidate-${session.operationId}.json`,
        );
      writeFileSync(path, payload, { flag: "wx", mode: 0o600, flush: true });
      return this.change(id, (delivery) => {
        if (
          delivery.ownership.fence !== session.fence ||
          delivery.phase !== "blocked" ||
          delivery.feature?.session?.operationId !== session.operationId ||
          delivery.feature.session.state !== "stopped" ||
          (repairId &&
            (delivery.repair?.attempts.at(-1)?.id !== repairId ||
              delivery.repair.attempts.at(-1)?.state !== "running"))
        )
          throw Error();
        delivery.feature.candidate = {
          path,
          sha256: candidateDigest(payload),
          inputSha256: input.digest,
          validation: "not-run",
        };
        if (repairId)
          delivery.repair!.attempts.at(-1)!.candidateSha256 =
            delivery.feature.candidate.sha256;
        delivery.feature.outcome = "admitted";
        delivery.blocker.nextAction =
          "Validate the exact isolated candidate before signing or publication; production remains disabled.";
      });
    } catch {
      return this.status(id);
    }
  }

  async stopFeature(
    id: string,
    expectedOperationId?: string,
  ): Promise<Delivery> {
    const snapshot = this.status(id),
      session = snapshot.feature?.session;
    if (
      !session ||
      session.state === "stopped" ||
      (expectedOperationId && session.operationId !== expectedOperationId)
    )
      return snapshot;
    const runtime = this.coordination.featureRuntime,
      expectedPins = JSON.stringify(snapshot.feature?.pins);
    const sameBinding = () =>
      runtime?.mode === "controlled" &&
      JSON.stringify(runtime.pins) === expectedPins;
    let response: Awaited<ReturnType<FeatureRuntime["stop"]>> | undefined;
    try {
      if (sameBinding())
        response = await this.observe(runtime!.stop(structuredClone(session)));
    } catch {}
    return this.change(id, (delivery) => {
      if (
        delivery.feature?.session?.operationId !== session.operationId ||
        delivery.feature.session.state === "stopped"
      )
        return;
      try {
        this.chargeCoding(delivery);
      } catch {
        this.featureBudget(delivery).activeMs =
          this.featureBudget(delivery).allowanceMs;
      }
      if (delivery.repair) delete delivery.repair.checkpoint;
      const stopped =
        sameBinding() &&
        response?.operationId === session.operationId &&
        response.fence === session.fence &&
        response.stopped === true &&
        response.remainingProcesses === 0;
      delivery.feature.session!.state = stopped ? "stopped" : "uncertain";
      delivery.feature.outcome = stopped
        ? this.featureBudget(delivery).activeMs >=
          this.featureBudget(delivery).allowanceMs
          ? "exhausted"
          : "failed"
        : "uncertain";
      if (!["paused", "cancelled"].includes(delivery.phase))
        delivery.phase = "blocked";
      if (
        stopped &&
        delivery.blocker.code === "UNCERTAIN_SESSION" &&
        sessionsQuiescent(delivery)
      )
        delivery.blocker = this.disabledBlocker();
      if (!stopped)
        delivery.blocker = {
          code: "UNCERTAIN_SESSION",
          message:
            "Coding worker shutdown is unverified; output import is forbidden.",
          nextAction:
            "Recover the exact coding session with the same trusted runtime.",
        };
      else if (needsResumeRecovery(delivery.feature.session!))
        delivery.blocker = this.resumeRecoveryBlocker();
    });
  }

  extendCoding(id: string, addedMinutes: number): Delivery {
    if (
      !Number.isSafeInteger(addedMinutes) ||
      addedMinutes < 1 ||
      addedMinutes > 1440
    )
      throw new DeliveryError("Extend coding by 1 to 1440 minutes.");
    return this.change(id, (delivery) => {
      const feature = delivery.feature;
      if (
        !delivery.ownership.held ||
        !feature ||
        feature.outcome !== "exhausted" ||
        feature.session?.state !== "stopped" ||
        delivery.phase !== "blocked"
      )
        throw new DeliveryError(
          "Only stopped exhausted coding work may receive an owner extension.",
        );
      feature.allowanceMs += addedMinutes * 60000;
      (feature.extensions ??= []).push({
        addedMs: addedMinutes * 60000,
        at: new Date().toISOString(),
      });
      feature.outcome = "failed";
      delivery.blocker = this.disabledBlocker();
    });
  }

  async run(id: string): Promise<Delivery> {
    const worker = this.coordination.worker;
    const snapshot = this.status(id);
    if (snapshot.onlineAccess && snapshot.onlineAccess.state !== "stopped")
      throw new DeliveryError("Recover online canary shutdown first.");
    if (!snapshot.ownership.held || snapshot.phase === "queued")
      throw new DeliveryError(
        "Only the repository owner delivery may dispatch work.",
      );
    if (snapshot.execution && snapshot.execution.state !== "stopped")
      throw new DeliveryError(
        "Reconcile the existing running or uncertain session before dispatch.",
      );
    if (
      !["blocked", "preparing"].includes(snapshot.phase) ||
      snapshot.blocker.code === "UNCERTAIN_SESSION"
    )
      throw new DeliveryError(
        "Resolve delivery controls and blockers before dispatch.",
      );
    const onboarding = inspectOnboarding(
      snapshot.repository,
      this.onboardingOptions,
    );
    const sameAuthority =
      onboarding.policy?.sha256 === snapshot.authorityPolicySha256 &&
      repositoryIdentity(snapshot.repository, onboarding) ===
        snapshot.ownership.key;
    this.change(id, (delivery) => {
      if (
        delivery.ownership.fence !== snapshot.ownership.fence ||
        delivery.phase !== snapshot.phase
      )
        throw new DeliveryError(
          "Delivery authority changed; inspect status before retrying.",
        );
      delivery.onboarding = onboarding;
      if (!onboarding.ready || !sameAuthority) delivery.phase = "blocked";
      if (!sameAuthority)
        delivery.blocker = {
          code: "DELIVERY_NOT_ENABLED",
          message:
            "Onboarding authority differs from the delivery's pinned policy or repository identity.",
          nextAction:
            "Safely release ownership and resubmit after the owner verifies the changed authority.",
        };
    });
    snapshot.onboarding = onboarding;
    let qualified = false;
    try {
      qualified =
        worker?.qualified(structuredClone(snapshot), this.stateDirectory) ===
        true;
    } catch {
      /* Qualification errors cannot carry credentials across the boundary. */
    }
    if (!snapshot.onboarding.ready || !sameAuthority || !worker || !qualified)
      throw new DeliveryError(
        "Worker dispatch requires current onboarding, unchanged owner policy and trusted host qualification; release and resubmit changed authority.",
      );
    const usage = (await this.checkUsage(id)).usage!;
    if (!this.usageGate.permits(usage))
      throw new DeliveryError(
        "Subscription usage requires owner approval or an allowance reset before dispatch.",
      );
    const planned = this.change(id, (delivery, ownership) => {
      if (
        !sessionsQuiescent(delivery) ||
        delivery.usage?.checkId !== usage.checkId ||
        delivery.phase !== snapshot.phase ||
        delivery.ownership.fence !== snapshot.ownership.fence ||
        !delivery.ownership.held
      )
        throw new DeliveryError(
          "Delivery authority changed; inspect status before retrying.",
        );
      this.lifecycle.proposeWorker(delivery, () => ownership.advanceFence(), {
        resume: true,
        state: "proposed",
      });
      const boundUsage = this.usageGate.bind(
        delivery.usage,
        delivery.execution!.operationId,
      );
      if (!boundUsage)
        throw new DeliveryError(
          "Usage allowance changed before worker dispatch.",
        );
      delivery.usage = boundUsage;
      delivery.phase = "preparing";
    });
    const session = planned.execution!;
    this.change(id, (delivery) => {
      if (
        delivery.ownership.fence !== session.fence ||
        delivery.phase !== "preparing"
      )
        throw new DeliveryError("Delivery authority changed before dispatch.");
      delivery.execution!.state = "dispatched";
      delivery.phase = "implementing";
    });
    session.state = "dispatched";
    try {
      const response = await this.observe(
        worker.start(structuredClone(session), () => {
          const current = this.status(id);
          return (
            current.phase === "implementing" &&
            current.ownership.held &&
            current.ownership.fence === session.fence &&
            current.execution?.operationId === session.operationId &&
            this.usageGate.permits(current.usage, {
              operationId: session.operationId,
            })
          );
        }),
      );
      const result = this.recordReceipt(id, session, response, false);
      if (
        result.phase === "implementing" &&
        result.execution?.state === "running"
      )
        this.monitorUsage(id, session.operationId);
      return result;
    } catch {
      return this.recordReceipt(id, session, undefined, false);
    }
  }

  async checkUsage(id: string): Promise<Delivery> {
    const snapshot = this.status(id);
    let observation: SubscriptionObservation | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      observation = await Promise.race([
        this.coordination.subscription?.() ?? Promise.resolve(undefined),
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => resolve(undefined), 5000);
        }),
      ]);
    } catch {
      /* A missing usage observation requires approval, never raw provider errors. */
    } finally {
      clearTimeout(timer);
    }
    return this.change(id, (delivery) => {
      if (
        delivery.ownership.fence !== snapshot.ownership.fence ||
        delivery.phase !== snapshot.phase
      )
        throw new DeliveryError(
          "Delivery authority changed during usage inspection.",
        );
      delivery.usage = this.usageGate.observe(
        observation,
        delivery.usage,
        delivery.qualification?.subscriptionMediation?.mechanismDecision
          ?.usageAccountId,
      );
    });
  }

  /** Owner approval to restart coding after a usage interruption. It is bound
   * to the delivery, the interrupted operation and the feature's account, and
   * is consumed by one re-dispatch, which still needs fresh usage authority. */
  approveCodingRestart(id: string): Delivery {
    return this.change(id, (delivery) => {
      const f = delivery.feature,
        interrupted = unrestartedInterruption(f);
      if (
        !interrupted ||
        pendingRestart(f) ||
        !f!.usageAccountId ||
        !sessionsQuiescent(delivery) ||
        !delivery.ownership.held ||
        delivery.phase === "cancelled"
      )
        throw new DeliveryError(
          "Approve a coding restart only for an owned delivery whose stopped coding turn was interrupted by usage, once per interruption.",
        );
      (f!.restartApprovals ??= []).push({
        interruptedOperationId: interrupted.operationId,
        accountId: f!.usageAccountId,
        approvedAt: new Date().toISOString(),
      });
    });
  }

  approveUsage(id: string, checkId: string): Delivery {
    return this.change(id, (delivery) => {
      const approved = this.usageGate.approve(delivery.usage, checkId);
      if (
        !approved ||
        !sessionsQuiescent(delivery) ||
        !delivery.ownership.held ||
        !["blocked", "preparing", "paused"].includes(delivery.phase)
      )
        throw new DeliveryError(
          "Approve a fresh usage check for an owned stopped delivery; exhaustion cannot be overridden.",
        );
      delivery.usage = approved;
    });
  }

  async pollUsage(id: string): Promise<Delivery> {
    const observed = await this.checkUsage(id);
    const usage = observed.usage!;
    // Usage identifies the endorsed usage-reader account, never the vault one.
    // Status re-verifies the protected decision record's pins.
    const endorsed =
      this.status(id).qualification?.subscriptionMediation?.mechanismDecision;
    if (
      observed.onlineAccess?.state === "dispatched" &&
      // A dispatched run blocks re-qualification, so only absence can occur.
      (!endorsed ||
        !this.usageGate.permits(usage, {
          operationId: observed.onlineAccess.runId,
          accountId: endorsed.usageAccountId,
          scope: observed.onlineAccess.usageScope,
        }))
    )
      return this.recoverOnline(id);
    if (
      observed.phase === "implementing" &&
      !this.usageGate.permits(usage, {
        operationId: observed.execution!.operationId,
      })
    )
      return this.pause(id);
    return observed;
  }

  private monitorUsage(id: string, operationId: string): void {
    const timer = setInterval(() => {
      void (async () => {
        try {
          const current = this.status(id);
          if (
            current.phase !== "implementing" ||
            current.execution?.operationId !== operationId
          ) {
            clearInterval(timer);
            return;
          }
          const observed = await this.pollUsage(id);
          if (observed.phase !== "implementing") clearInterval(timer);
        } catch {
          clearInterval(timer);
          try {
            const current = this.status(id);
            if (
              current.phase === "implementing" &&
              current.execution?.operationId === operationId
            )
              await this.pause(id);
          } catch {
            /* Shutdown uncertainty remains durable. */
          }
        }
      })();
    }, workerUsagePollMs);
    timer.unref();
  }

  async qualify(id: string): Promise<Delivery> {
    const snapshot = this.status(id);
    if (snapshot.onlineAccess && snapshot.onlineAccess.state !== "stopped")
      throw new DeliveryError(
        "Recover online canary shutdown before qualification.",
      );
    if (snapshot.execution && snapshot.execution.state !== "stopped")
      throw new DeliveryError(
        "Stop and reconcile the worker before qualification probes.",
      );
    let qualification = unavailableQualification();
    try {
      qualification =
        (await this.coordination.worker?.probe?.(
          structuredClone(snapshot),
          this.stateDirectory,
        )) ?? qualification;
    } catch {
      /* Retain fixed unknown evidence, never provider error text. */
    }
    qualification.runtimeVersions = stampQualificationVersions();
    if (
      !qualificationVersionsMatch(qualification.runtimeVersions) &&
      qualification.offlineAdmission
    )
      qualification.offlineAdmission.allowed = false;
    return this.change(id, (delivery) => {
      if (
        delivery.ownership.fence !== snapshot.ownership.fence ||
        delivery.phase !== snapshot.phase
      )
        throw new DeliveryError(
          "Delivery authority changed during qualification.",
        );
      const intendedPlatform =
        this.coordination.worker?.qualificationPlatform ??
        snapshot.qualification?.intendedPlatform;
      if (intendedPlatform) qualification.intendedPlatform = intendedPlatform;
      else delete qualification.intendedPlatform;
      delivery.qualification = qualification;
      projectSubscriptionDecision(delivery, this.stateDirectory);
    });
  }

  async qualifyWindowsControls(id: string): Promise<Delivery> {
    return this.qualifyControls(id, "win32");
  }

  async qualifyMacosControls(id: string): Promise<Delivery> {
    return this.qualifyControls(id, "darwin");
  }

  private async qualifyControls(
    id: string,
    platform: "win32" | "darwin",
  ): Promise<Delivery> {
    const runtime = this.coordination.windowsControls;
    if (!runtime || runtime.version !== hostControlsVersion)
      throw new DeliveryError("A trusted host controls runtime is required.");
    const before = await this.qualify(id);
    if (
      !before.ownership.held ||
      before.phase !== "blocked" ||
      before.qualification?.offlineAdmission?.binding?.platform !== platform ||
      !before.qualification.offlineAdmission.allowed ||
      before.qualification.mode !== runtime.mode
    )
      throw new DeliveryError(
        "Controls require an owned stopped admitted platform binding.",
      );
    const evidence = await runtime.qualify(before);
    const after = await this.qualify(id);
    if (
      evidence.version !== runtime.version ||
      evidence.nativeVersion !==
        sha256(readFileSync(new URL("./podman-native.js", import.meta.url))) ||
      evidence.mode !== runtime.mode ||
      evidence.outcome !== "passed" ||
      evidence.productionEnabled !== false ||
      evidence.bindingSha256 !== after.qualification?.bindingSha256 ||
      evidence.policySha256 !== after.qualification?.policySha256 ||
      evidence.operationId !== after.execution?.operationId ||
      after.execution.state !== "stopped" ||
      !after.ownership.held ||
      after.phase !== "blocked" ||
      evidence.checks.length !== hostControlNames.length ||
      !hostControlNames.every((name) =>
        evidence.checks.some(
          (check) =>
            check.name === name && /^[a-f0-9]{64}$/.test(check.evidenceSha256),
        ),
      ) ||
      evidence.censuses.length < 2 ||
      !evidence.censuses.every(
        (c) =>
          c.observedProcesses >= 8 &&
          c.remainingProcesses === 0 &&
          /^[a-f0-9]{64}$/.test(c.censusSha256),
      )
    )
      throw new DeliveryError(
        "Host controls evidence or ownership did not verify.",
      );
    return this.change(id, (d) => {
      if (
        d.ownership.fence !== after.ownership.fence ||
        !d.ownership.held ||
        d.execution?.operationId !== evidence.operationId ||
        d.execution.state !== "stopped" ||
        d.phase !== "blocked"
      )
        throw new DeliveryError("Host controls authority changed.");
      d.windowsControls = structuredClone(evidence);
    });
  }

  /** Fixed synthetic workload only. Admission never enables feature delivery. */
  async offlineCanary(
    id: string,
    files = [{ path: "canary.txt", sha256: sha256(canaryInput) }],
  ): Promise<Delivery> {
    const qualified = await this.qualify(id);
    const admission = qualified.qualification?.offlineAdmission;
    const syntheticScope = subscriptionDecisionScope(admission?.binding);
    const runtime = this.coordination.offline;
    const pins = {
      bindingSha256: qualified.qualification?.bindingSha256 ?? "",
      policySha256: qualified.qualification?.policySha256 ?? "",
    };
    const refuse = (message: string) =>
      this.change(id, (delivery) => {
        if (delivery.execution && delivery.execution.state !== "stopped")
          throw new DeliveryError(
            "Reconcile the existing worker before an offline canary.",
          );
        delivery.offlineCanary = {
          ...pins,
          mode: runtime?.mode ?? "live",
          outcome: "refused",
          message,
        };
      });
    if (
      !admission?.allowed ||
      !admission.binding ||
      !admission.effective ||
      !/^[a-f0-9]{64}$/.test(pins.bindingSha256) ||
      !/^[a-f0-9]{64}$/.test(pins.policySha256) ||
      !runtime ||
      runtime.mode !== qualified.qualification?.mode ||
      (runtime === this.coordination.synthetic &&
        (!syntheticScope ||
          qualified.qualification?.subscriptionMediation?.mechanismDecision
            ?.scope !== syntheticScope))
    )
      return refuse(
        "Offline canary refused: matching admitted VM bindings and a trusted offline management driver are required.",
      );
    let input: ReturnType<typeof admitFiles>;
    try {
      if (!Array.isArray(files) || files.length !== 1)
        throw Error("Invalid manifest");
      input = admitFiles({ files }, qualified.repository);
      if (
        input[0]?.path !== "canary.txt" ||
        !input[0].bytes.equals(Buffer.from(canaryInput))
      )
        throw Error("Only synthetic input is admitted");
    } catch {
      return refuse(
        "Offline canary refused: provide the fixed synthetic ordinary input without unsafe paths, links, metadata or credentials.",
      );
    }
    const started = this.change(id, (delivery, ownership) => {
      if (
        !delivery.ownership.held ||
        delivery.phase !== "blocked" ||
        !sessionsQuiescent(delivery) ||
        delivery.ownership.fence !== qualified.ownership.fence ||
        delivery.qualification?.bindingSha256 !== pins.bindingSha256 ||
        delivery.qualification?.policySha256 !== pins.policySha256
      )
        throw new DeliveryError(
          "Offline canary requires unchanged exclusive repository ownership and stopped workers.",
        );
      const session = this.lifecycle.proposeWorker(
        delivery,
        () => ownership.advanceFence(),
        { resume: false, state: "dispatched" },
      );
      delivery.offlineCanary = {
        ...pins,
        mode: runtime.mode,
        outcome: "running",
        session: structuredClone(session),
        inputSha256: sha256(canaryInput),
        message:
          "Synthetic offline canary dispatched; collection requires verified stop.",
      };
    });
    const session = started.execution!;
    let executed = false;
    try {
      const response = await this.observe(
        runtime.execute({
          ...pins,
          session: structuredClone(session),
          files: input.map((file) => ({
            path: file.path,
            bytes: Buffer.from(file.bytes),
            executable: false,
          })),
          binding: structuredClone(admission.binding),
          effective: structuredClone(admission.effective),
          mayDispatch: () => {
            const current = this.status(id);
            return (
              current.ownership.held &&
              current.ownership.fence === session.fence &&
              current.phase === "blocked" &&
              current.execution?.operationId === session.operationId &&
              current.execution.state === "dispatched" &&
              (runtime !== this.coordination.synthetic ||
                (Boolean(syntheticScope) &&
                  current.qualification?.subscriptionMediation
                    ?.mechanismDecision?.scope === syntheticScope))
            );
          },
        }),
      );
      const same = (
        expected: Record<string, unknown>,
        actual: Record<string, unknown> | undefined,
      ) =>
        Boolean(
          actual &&
            Object.keys(expected).length === Object.keys(actual).length &&
            Object.entries(expected).every(
              ([key, value]) =>
                JSON.stringify(actual[key]) === JSON.stringify(value),
            ),
        );
      executed = Boolean(
        matchesCanary(response, session, pins) &&
          response?.status === "running" &&
          response.fresh === true &&
          same(admission.binding, response.binding) &&
          same(admission.effective, response.effective),
      );
    } catch {
      /* Provider text and uncertain execution never enter durable evidence. */
    }
    // Even failed/timed-out dispatches require revocation and independently verified shutdown.
    let stopped: Delivery;
    try {
      stopped = await this.stopSession(id);
    } catch {
      try {
        return this.change(id, (delivery) => {
          if (
            delivery.execution?.operationId !== session.operationId ||
            delivery.execution.state === "stopped"
          )
            return;
          delivery.execution.state = "uncertain";
          delivery.offlineCanary = {
            ...started.offlineCanary!,
            outcome: "uncertain",
            session: structuredClone(delivery.execution),
            message:
              "Worker stop could not be recorded; collection is forbidden until recovery verifies shutdown.",
          };
          delivery.blocker = {
            code: "UNCERTAIN_SESSION",
            message: "Worker shutdown could not be verified.",
            nextAction:
              "Recover the retained session before dispatch, collection or ownership release.",
          };
        });
      } catch {
        // An unavailable ledger cannot record uncertainty. Its dispatched session
        // already prevents another launch/release and remains recoverable.
        throw new DeliveryError(
          "Offline worker stop could not be recorded; reconcile the durable session before continuing.",
        );
      }
    }
    const stoppedSession = stopped.execution!;
    if (
      stoppedSession.operationId !== session.operationId ||
      stoppedSession.state !== "stopped" ||
      stopped.phase !== "blocked" ||
      !stopped.ownership.held
    )
      return this.status(id);
    let output: ReturnType<typeof collectCanary> | undefined;
    if (executed && stopped.phase === "blocked") {
      try {
        const response = await this.observe(
          runtime.collect(structuredClone(stoppedSession), { ...pins }),
        );
        if (
          matchesCanary(response, stoppedSession, pins) &&
          response?.status === "stopped"
        )
          output = collectCanary(response);
      } catch {
        /* Unsafe, changing or unavailable output is rejected without retaining it. */
      }
    }
    let createdArtifact: string | undefined;
    try {
      return this.change(id, (delivery) => {
        if (
          delivery.execution?.operationId !== session.operationId ||
          delivery.execution.state !== "stopped" ||
          delivery.ownership.fence !== stoppedSession.fence ||
          !delivery.ownership.held ||
          delivery.phase !== "blocked"
        )
          throw new DeliveryError(
            "Offline canary authority changed; output was not imported.",
          );
        delivery.offlineCanary = {
          ...started.offlineCanary!,
          session: structuredClone(delivery.execution),
          ...(stopped.offlineCanary?.shutdownProof
            ? { shutdownProof: stopped.offlineCanary.shutdownProof }
            : {}),
          outcome: output ? "completed" : "rejected",
          ...(output ? { outputSha256: output.sha256 } : {}),
          message: output
            ? "Synthetic offline round trip completed; production delivery remains disabled."
            : "Offline canary execution or output could not be verified; no output imported.",
        };
        delivery.blocker = this.disabledBlocker();
        if (output) {
          const path = join(
            this.stateDirectory,
            "artifacts",
            `${id}-${session.operationId}-offline.json`,
          );
          this.ledger.assertArtifacts();
          writeFileSync(
            path,
            JSON.stringify({ ...delivery.offlineCanary, output }),
            {
              flag: "wx",
              mode: 0o600,
              flush: true,
            },
          );
          createdArtifact = path;
          delivery.evidence.push({ kind: "offline-canary", path });
        }
      });
    } catch (error) {
      if (createdArtifact) {
        try {
          unlinkSync(createdArtifact);
        } catch {
          /* Preserve the original transaction error. */
        }
      }
      throw error;
    }
  }

  async syntheticTask(id: string): Promise<Delivery> {
    const runtime = this.coordination.synthetic;
    const qualified = await this.qualify(id);
    const decision = qualifiedDecision(qualified);
    if (
      !runtime ||
      runtime !== this.coordination.offline ||
      runtime.version !== syntheticTaskVersion ||
      !decision
    )
      throw new DeliveryError(
        "Synthetic work requires a trusted fixed task runtime and independent positive authentication; no inference is authorized.",
      );
    const files = admitFiles(
      {
        files: [
          { path: "index.html", sha256: sha256(syntheticSiteInput) },
          { path: "validate.sh", sha256: sha256(syntheticSiteValidator) },
        ],
      },
      qualified.repository,
    );
    runtime.stage(files);
    const completed = await this.offlineCanary(id);
    const canary = completed.offlineCanary;
    const session = completed.execution;
    let result: SyntheticTaskResult | undefined;
    if (
      canary?.outcome === "completed" &&
      session?.state === "stopped" &&
      canary.shutdownProof?.remainingProcesses === 0
    ) {
      try {
        const collected = await this.observe(
          runtime.collectTask(session, canary),
        );
        if (
          collected?.operationId === session.operationId &&
          collected.version === runtime.version &&
          collected.inputSha256 === sha256(syntheticSiteInput) &&
          collected.output === syntheticSiteOutput &&
          collected.outputSha256 === sha256(syntheticSiteOutput) &&
          collected.validation === "passed" &&
          collected.negativeValidation === "passed" &&
          collected.httpValidation === "passed" &&
          /^[a-f0-9]{64}$/.test(collected.collectionSha256)
        )
          result = collected;
      } catch {
        /* Unverified results cannot become imported task evidence. */
      }
    }
    return this.change(id, (delivery) => {
      if (
        !session ||
        delivery.execution?.operationId !== session.operationId ||
        delivery.execution.state !== "stopped" ||
        delivery.ownership.fence !== completed.ownership.fence ||
        !delivery.ownership.held ||
        delivery.phase !== "blocked"
      )
        throw new DeliveryError(
          "Synthetic task authority changed; no output imported.",
        );
      delivery.syntheticTask = {
        bindingSha256: canary?.bindingSha256 ?? "",
        policySha256: canary?.policySha256 ?? "",
        version: runtime.version,
        mode: runtime.mode,
        outcome: result ? "completed" : "refused",
        session: structuredClone(session),
        ...(result ? { result } : {}),
        ...(canary?.shutdownProof
          ? { shutdownProof: canary.shutdownProof }
          : {}),
        productionEnabled: false,
      };
    });
  }

  private async observe<T>(
    pending: Promise<T>,
    timeoutMs?: number,
  ): Promise<T | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        pending,
        new Promise<undefined>((resolve) => {
          timer = setTimeout(
            () => resolve(undefined),
            Math.min(
              this.coordination.observationTimeoutMs ??
                defaultObservationTimeoutMs,
              timeoutMs ?? defaultObservationTimeoutMs,
            ),
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private recordReceipt(
    id: string,
    session: WorkerSession,
    response: WorkerReceipt | undefined,
    stopping: boolean,
    shutdownProof?: {
      observedProcesses: number;
      remainingProcesses: number;
      censusSha256: string;
    },
  ): Delivery {
    return this.lifecycle.recordReceipt(
      id,
      session,
      response,
      stopping,
      shutdownProof,
    );
  }

  async pause(id: string): Promise<Delivery> {
    this.change(id, (delivery, ownership) => {
      this.chargeCoding(delivery);
      if (delivery.phase === "cancelled")
        throw new DeliveryError("A cancelled delivery cannot be paused.");
      if (delivery.phase !== "paused") {
        delivery.priorPhase = delivery.phase;
        delivery.phase = "paused";
        this.controlEvent(delivery, "pause");
        if (delivery.ownership.held) ownership.advanceFence();
      }
    });
    return this.lifecycle.stopAll(id);
  }

  resume(id: string): Delivery {
    if (pendingCleanup(this.status(id)))
      throw new DeliveryError("Reconcile cleanup before resuming.");
    if (pendingMainSync(this.status(id)))
      throw new DeliveryError(
        "Reconcile main synchronization before resuming.",
      );
    if (mergePending(this.status(id)))
      throw new DeliveryError("Reconcile merge before this control.");
    return this.change(id, (delivery, ownership) => {
      if (
        delivery.publication?.effects.some(
          (e) => e.state === "dispatched" || e.state === "uncertain",
        )
      )
        throw new DeliveryError("Reconcile publication before this control.");
      if (unresolvedReviewEffect(delivery))
        throw new DeliveryError(
          "Reconcile review resolution before this control.",
        );
      if (
        delivery.prChecks?.runs.some(
          (r) =>
            r.diagnostic &&
            ["dispatched", "uncertain"].includes(r.diagnostic.state),
        )
      )
        throw new DeliveryError(
          "Reconcile the PR diagnostic rerun before this control.",
        );
      if (delivery.repair?.attempts.some((a) => a.state !== "stopped"))
        throw new DeliveryError("Recover the repair cycle before resuming.");
      if (delivery.validation?.attempts.some((a) => a.state !== "stopped"))
        throw new DeliveryError(
          "Recover validation descendant shutdown before this control.",
        );
      if (
        delivery.feature?.session &&
        delivery.feature.session.state !== "stopped"
      )
        throw new DeliveryError(
          "Recover coding worker shutdown before this control.",
        );
      if (delivery.onlineAccess && delivery.onlineAccess.state !== "stopped")
        throw new DeliveryError(
          "Recover online canary shutdown before resuming.",
        );
      if (!sessionsQuiescent(delivery))
        throw new DeliveryError(
          "Recover retained session shutdown before resuming.",
        );
      if (delivery.phase === "cancelled")
        throw new DeliveryError("A cancelled delivery cannot be resumed.");
      if (
        delivery.phase === "blocked" &&
        delivery.blocker.code === "UNCERTAIN_SESSION"
      ) {
        if (delivery.execution?.state !== "stopped")
          throw new DeliveryError("Reconcile worker shutdown before resuming.");
        delivery.blocker = this.disabledBlocker();
        this.controlEvent(delivery, "resume");
      }
      if (delivery.phase === "paused") {
        if (delivery.execution && delivery.execution.state !== "stopped")
          throw new DeliveryError("Reconcile worker shutdown before resuming.");
        delivery.phase = delivery.priorPhase ?? "blocked";
        if (!delivery.ownership.held) delivery.phase = "queued";
        if (
          delivery.phase === "implementing" ||
          delivery.phase === "preparing" ||
          delivery.phase === "validating" ||
          delivery.phase === "publishing"
        )
          delivery.phase = "preparing";
        if (delivery.blocker.code === "UNCERTAIN_SESSION")
          delivery.blocker = this.disabledBlocker();
        delete delivery.priorPhase;
        this.controlEvent(delivery, "resume");
      }
      if (delivery.phase === "queued" && !delivery.ownership.held)
        ownership.reclaimQueued();
    });
  }

  async cancel(id: string): Promise<Delivery> {
    this.change(id, (delivery, ownership) => {
      this.chargeCoding(delivery);
      if (delivery.phase !== "cancelled") {
        delivery.priorPhase = delivery.phase;
        delivery.phase = "cancelled";
        this.controlEvent(delivery, "cancel");
        if (delivery.ownership.held) ownership.advanceFence();
      }
    });
    return this.lifecycle.stopAll(id);
  }

  async recover(id: string): Promise<Delivery> {
    if (this.status(id).cleanup) return this.reconcileCleanup(id);
    if (this.status(id).mainSync) return this.reconcileMainSync(id);
    if (this.status(id).mainChecks) return this.monitorMainChecks(id);
    if (mergeSealed(this.status(id))) return this.reconcileMerge(id);
    if (
      this.status(id).publication?.outcome === "published" &&
      this.status(id).review
    )
      return this.monitorReview(id);
    if (
      this.status(id).publication?.outcome === "published" &&
      this.status(id).prChecks
    )
      return this.monitorPRChecks(id);
    if (
      this.status(id).publication?.effects.some(
        (e) => e.state === "dispatched" || e.state === "uncertain",
      )
    )
      return this.reconcilePublication(id);
    const repair = this.status(id).repair?.attempts.at(-1);
    if (repair && repair.state !== "stopped") {
      if (
        this.status(id).validation?.attempts.some((a) => a.state !== "stopped")
      )
        await this.stopValidation(id);
      const session = this.status(id).feature?.session;
      if (session && session.state !== "stopped")
        await this.stopFeature(id, session.operationId);
      return this.finishRepair(id, repair.id);
    }
    if (this.status(id).validation?.attempts.some((a) => a.state !== "stopped"))
      return this.stopValidation(id);
    const coding = this.status(id).feature?.session;
    if (coding && coding.state !== "stopped") {
      const stopped = await this.stopFeature(id, coding.operationId);
      // A resume lost mid-preparation may have moved the predecessor's home.
      return stopped.feature?.session &&
        needsResumeRecovery(stopped.feature.session)
        ? this.recoverResume(id)
        : stopped;
    }
    if (coding && needsResumeRecovery(coding)) return this.recoverResume(id);
    let delivery = this.status(id);
    if (delivery.onlineAccess && delivery.onlineAccess.state !== "stopped")
      delivery = await this.recoverOnline(id);
    if (!delivery.execution || delivery.execution.state === "stopped")
      return delivery;
    const recovered = await this.stopSession(id);
    if (
      delivery.phase === "implementing" &&
      recovered.phase === "implementing" &&
      recovered.execution?.state === "stopped"
    ) {
      return this.change(id, (current) => {
        if (
          current.phase === "implementing" &&
          current.execution?.state === "stopped"
        )
          current.phase = "preparing";
      });
    }
    return recovered;
  }

  /** Return a home an interrupted resume may have moved. Uncertainty blocks
   * coding until the same trusted runtime verifies the exact transfer. */
  private async recoverResume(id: string): Promise<Delivery> {
    const snapshot = this.status(id),
      session = snapshot.feature?.session,
      runtime = this.coordination.featureRuntime;
    if (!session || !needsResumeRecovery(session)) return snapshot;
    let recovered = false;
    try {
      if (this.sameCodingRuntime(snapshot) && runtime!.recover) {
        const receipt = await this.observe(
          runtime!.recover(
            codingBinding(session),
            codingBinding(session.resumeFrom!),
          ),
        );
        recovered =
          sameOperation(receipt, session) && receipt!.recovered === true;
      }
    } catch {}
    if (recovered) return this.settleResume(id, session, "recovered");
    // Recovery refuses a launched resume; the guest's thread record decides.
    return this.reconcileResume(id, session, false);
  }

  /** The owner's explicit decision to quarantine an unresolved resume lineage:
   * its retained home is never reused and coding restarts without resuming. */
  async retireResume(id: string): Promise<Delivery> {
    const snapshot = this.status(id),
      session = snapshot.feature?.session;
    if (
      !session ||
      !needsResumeRecovery(session) ||
      !snapshot.ownership.held ||
      session.fence !== snapshot.ownership.fence
    )
      throw new DeliveryError(
        "Only the owning delivery may retire an interrupted coding resume.",
      );
    return this.reconcileResume(id, session, true);
  }

  /** The owner's explicit cleanup of a retired resume lineage: the guest
   * removes the session folders and stopped containers of the retired
   * successor and every predecessor in its chain, keeping their records as
   * tombstones. Recorded once; an unverified cleanup records nothing. */
  async cleanupRetiredLineage(
    id: string,
    operationId: string,
  ): Promise<Delivery> {
    const snapshot = this.status(id),
      runtime = this.coordination.featureRuntime,
      retirement = snapshot.feature?.retirements?.find(
        (r) => r.operationId === operationId,
      ),
      retired = retirement?.session;
    if (
      !retired ||
      retirement!.cleanedAt ||
      !snapshot.ownership.held ||
      !sessionsQuiescent(snapshot) ||
      !this.sameCodingRuntime(snapshot) ||
      !runtime!.cleanup
    )
      throw new DeliveryError(
        "Clean up only a retired resume lineage with a recorded binding, once, for an owned quiescent delivery with the same trusted coding runtime.",
      );
    let receipt: CodingCleanup | undefined;
    try {
      receipt = await this.observe(runtime!.cleanup(retired));
    } catch {}
    if (
      !sameOperation(receipt, retired) ||
      !Number.isSafeInteger(receipt!.cleaned) ||
      receipt!.cleaned < 1
    )
      throw new DeliveryError(
        "Retired lineage cleanup is unverified; nothing was recorded, and it can be retried.",
      );
    // Retirements are never removed; a concurrent duplicate cleanup only
    // re-records the same idempotent removal.
    return this.change(id, (delivery) => {
      const retirement = delivery.feature!.retirements!.find(
        (r) => r.operationId === operationId,
      )!;
      retirement.cleanedAt = new Date().toISOString();
      retirement.cleaned = receipt!.cleaned;
    });
  }

  /** Callers have checked that `session` still needs resume recovery;
   * settlement re-checks it inside the durable transaction. */
  private async reconcileResume(
    id: string,
    session: CodingSession,
    retire: boolean,
  ) {
    const snapshot = this.status(id),
      runtime = this.coordination.featureRuntime;
    let outcome: ResumeReconciliation | undefined;
    try {
      if (this.sameCodingRuntime(snapshot) && runtime!.reconcile) {
        const receipt = await this.observe(
          runtime!.reconcile(
            codingBinding(session),
            codingBinding(session.resumeFrom!),
            retire,
          ),
        );
        if (sameOperation(receipt, session)) outcome = receipt!.outcome;
      }
    } catch {}
    return this.settleResume(
      id,
      session,
      outcome === "adopted" || outcome === "retired" ? outcome : undefined,
    );
  }

  /** Record a verified resume settlement, or keep coding blocked. */
  private settleResume(
    id: string,
    session: CodingSession,
    settlement: "recovered" | "adopted" | "retired" | undefined,
  ): Delivery {
    return this.change(id, (delivery) => {
      const current = delivery.feature?.session;
      if (
        current?.operationId !== session.operationId ||
        !needsResumeRecovery(current)
      )
        return;
      if (!settlement) {
        delivery.blocker = this.resumeRecoveryBlocker();
        return;
      }
      // An adopted successor started its thread in the guest: it is the
      // next predecessor, exactly as if the controller had observed it.
      if (settlement === "adopted") current.threadStarted = true;
      else current.resumeRecovery = settlement;
      if (settlement === "retired")
        (delivery.feature!.retirements ??= []).push({
          operationId: current.operationId,
          at: new Date().toISOString(),
          session: codingBinding(current),
        });
      if (
        delivery.blocker.code === "UNCERTAIN_SESSION" &&
        sessionsQuiescent(delivery)
      )
        delivery.blocker = this.disabledBlocker();
    });
  }

  /** The configured runtime is the same trusted binding the feature pinned. */
  private sameCodingRuntime(snapshot: Delivery): boolean {
    const runtime = this.coordination.featureRuntime;
    return (
      runtime?.mode === "controlled" &&
      JSON.stringify(runtime.pins) === JSON.stringify(snapshot.feature?.pins)
    );
  }

  private resumeRecoveryBlocker(): Delivery["blocker"] {
    return {
      code: "UNCERTAIN_SESSION",
      message:
        "An interrupted coding resume left its retained session home unverified.",
      nextAction:
        "Recover this delivery with the same trusted runtime. If the guest never recorded the resumed thread, only an explicit owner decision to retire the resume lineage lets coding restart fresh.",
    };
  }

  private stopSession(id: string): Promise<Delivery> {
    return this.lifecycle.stopWorker(id);
  }

  private disabledBlocker(): Delivery["blocker"] {
    return {
      code: "DELIVERY_NOT_ENABLED",
      message:
        "Feature delivery requires qualified implementation and validation adapters.",
      nextAction:
        "Complete repository onboarding, host qualification and remaining delivery implementation before execution.",
    };
  }

  release(id: string): Delivery {
    if (pendingCleanup(this.status(id)))
      throw new DeliveryError("Reconcile cleanup before releasing ownership.");
    if (pendingMainSync(this.status(id)))
      throw new DeliveryError(
        "Reconcile main synchronization before releasing ownership.",
      );
    if (mergePending(this.status(id)))
      throw new DeliveryError("Reconcile merge before this control.");
    return this.change(id, (delivery, ownership) => {
      if (
        delivery.publication?.effects.some(
          (e) => e.state === "dispatched" || e.state === "uncertain",
        )
      )
        throw new DeliveryError("Reconcile publication before this control.");
      if (unresolvedReviewEffect(delivery))
        throw new DeliveryError(
          "Reconcile review resolution before this control.",
        );
      if (
        delivery.prChecks?.runs.some(
          (r) =>
            r.diagnostic &&
            ["dispatched", "uncertain"].includes(r.diagnostic.state),
        )
      )
        throw new DeliveryError(
          "Reconcile the PR diagnostic rerun before this control.",
        );
      if (delivery.repair?.attempts.some((a) => a.state !== "stopped"))
        throw new DeliveryError(
          "Recover the repair cycle before releasing ownership.",
        );
      if (delivery.validation?.attempts.some((a) => a.state !== "stopped"))
        throw new DeliveryError(
          "Recover validation descendant shutdown before this control.",
        );
      if (
        delivery.feature?.session &&
        delivery.feature.session.state !== "stopped"
      )
        throw new DeliveryError(
          "Recover coding worker shutdown before this control.",
        );
      if (delivery.onlineAccess && delivery.onlineAccess.state !== "stopped")
        throw new DeliveryError(
          "Recover online canary shutdown before releasing ownership.",
        );
      if (!delivery.ownership.held) return;
      if (delivery.execution && delivery.execution.state !== "stopped")
        throw new DeliveryError(
          "Reconcile worker shutdown before releasing repository ownership.",
        );
      if (
        !["paused", "cancelled", "blocked", "completed"].includes(
          delivery.phase,
        )
      )
        throw new DeliveryError(
          "Stop the delivery before releasing repository ownership.",
        );
      if (!sessionsQuiescent(delivery))
        throw new DeliveryError(
          "Recover retained session shutdown before releasing ownership.",
        );
      ownership.release();
      this.controlEvent(delivery, "release");
    });
  }

  private controlEvent(
    delivery: Delivery,
    action: "pause" | "resume" | "cancel" | "release",
  ): void {
    (delivery.controls ??= []).push({ action, at: new Date().toISOString() });
  }

  private change(
    id: string,
    work: (delivery: Delivery, ownership: OwnershipTransaction) => void,
  ): Delivery {
    return this.ledger.update(id, work);
  }
}
