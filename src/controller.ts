import {
  MainSyncCoordinator,
  pendingMainSync,
  type MainSyncEvidence,
  type MainSyncRuntime,
  type MainSyncTarget,
} from "./main-sync.js";
import {
  MainChecksCoordinator,
  type MainChecksEvidence,
  type MainChecksRuntime,
} from "./main-checks.js";
import {
  MergeCoordinator,
  mergePending,
  mergeSealed,
  type MergeRuntime,
  type MergeEvidence,
} from "./conditional-merge.js";
import {
  ReviewCoordinator,
  unresolvedReviewEffect,
  type ReviewRuntime,
  type ReviewEvidence,
  type ReviewThread,
} from "./review.js";
import {
  PRChecksCoordinator,
  type PRChecksRuntime,
  type PRChecksEvidence,
} from "./pr-checks.js";
import {
  PublicationCoordinator,
  type PublicationRuntime,
  type PublicationEvidence,
  type PublicationInput,
} from "./publication.js";
import { repairBudget, repairFindings, type RepairEvidence } from "./repair.js";
import {
  validationOutcome,
  validationCandidate,
  protectValidationInputs,
  validationCriteria,
  passedBaseline,
  validationContract,
  validationDigest,
  validationResult,
  type ValidationRuntime,
  type ValidationEvidence,
  type ValidationAttempt,
  type ValidationStage,
  type ValidationResult,
} from "./isolated-validation.js";
import {
  gatewayRequest,
  subscriptionGatewayVersion,
} from "./subscription-gateway.js";
import {
  windowsControlsVersion,
  windowsControlNames,
  type WindowsControlsEvidence,
  type WindowsControlsRuntime,
} from "./windows-controls.js";
import {
  onlinePolicyVersion,
  onlineUsagePermits,
  type OnlineAccessRuntime,
  type OnlineAccessEvidence,
  type OnlineProof,
  type OnlineStop,
  type PreparedOnline,
} from "./online-access.js";
import {
  projectSubscriptionDecision,
  subscriptionDecisionScope,
} from "./subscription-decision.js";
import { randomUUID } from "node:crypto";
import {
  syntheticSiteInput,
  syntheticSiteOutput,
  syntheticSiteValidator,
  syntheticTaskVersion,
  type SyntheticTaskRuntime,
  type SyntheticTaskEvidence,
  type SyntheticTaskResult,
} from "./synthetic-task.js";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { DatabaseSync } from "node:sqlite";
import { redact } from "./redaction.js";
import {
  featurePlan,
  candidateSource,
  candidateMainSource,
  candidateRevisionFiles,
  featureBranch,
  candidateOutput,
  candidateDigest,
  codingTurn,
  validCodingPins,
  type FeatureRuntime,
  type CodingResult,
  type FeaturePlanner,
  type FeatureEvidence,
} from "./feature-candidate.js";
import { admitFiles } from "./workspace.js";
import {
  canaryInput,
  collectCanary,
  matchesCanary,
  sha256,
  type OfflineCanaryRuntime,
  type OfflineCanaryEvidence,
} from "./offline-canary.js";
import {
  assessSubscription,
  type SubscriptionReader,
  type UsageReport,
} from "./subscription.js";
import {
  unavailableQualification,
  type WorkerQualification,
} from "./qualification.js";
import {
  inspectOnboarding,
  type OnboardingReport,
  type OnboardingOptions,
} from "./onboarding.js";
import {
  windowsWorkerQualificationReport,
  macosWorkerQualificationReport,
  type WindowsWorkerQualificationReport,
} from "./windows-qualification.js";

/** Only fixed, non-input-derived messages may cross the public error boundary. */
export class DeliveryError extends Error {}

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

function assertStorageEntry(path: string, directory: boolean): void {
  try {
    const entry = lstatSync(path);
    if (
      entry.isSymbolicLink() ||
      (directory ? !entry.isDirectory() : !entry.isFile() || entry.nlink !== 1)
    ) {
      throw new DeliveryError(
        "Controller storage must use ordinary files and directories, not links.",
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function contains(parent: string, child: string): boolean {
  const difference = relative(parent, child);
  return (
    difference === "" ||
    (difference !== ".." &&
      !difference.startsWith(`..${sep}`) &&
      !isAbsolute(difference))
  );
}

export interface FeatureRequest {
  codingMinutes?: number;
  repository: string;
  request: string;
  issue?: string;
}

export interface WorkerSession {
  deliveryId: string;
  intent: "start" | "resume";
  repositoryKey: string;
  operationId: string;
  sandboxId: string;
  workerSessionId: string;
  runnerId: string;
  fence: number;
  state:
    | "proposed"
    | "dispatched"
    | "running"
    | "stopping"
    | "stopped"
    | "uncertain";
}
export interface WorkerReceipt extends WorkerSession {
  status: "running" | "stopped" | "unknown";
}
/** Trusted host boundary. A stopped receipt guarantees the fence invalidates old
 * dispatches and all session descendants are quiescent, including late starts.
 * Qualification pins a single authority directory per host. Dispatch honors
 * explicit start/resume intent and checks the repository fence; shutdown retains
 * sandbox files for an explicit session resume rather than deleting work.
 * Ticket 4 supplies a qualified implementation; the CLI has no worker adapter. */
export interface WorkerAdapter {
  readonly qualificationPlatform?: "darwin" | "win32" | undefined;
  probe?(
    delivery: Delivery,
    authorityDirectory: string,
  ): Promise<WorkerQualification>;
  qualified(delivery: Delivery, authorityDirectory: string): boolean;
  start(
    session: WorkerSession,
    mayDispatch?: () => boolean,
  ): Promise<WorkerReceipt>;
  fenceAndStop(session: WorkerSession): Promise<WorkerReceipt>;
}
export interface CoordinationOptions {
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
  windowsControls?: WindowsControlsRuntime;
  synthetic?: SyntheticTaskRuntime;
  offline?: OfflineCanaryRuntime;
  online?: OnlineAccessRuntime;
  subscription?: SubscriptionReader;
  worker?: WorkerAdapter;
  observationTimeoutMs?: number;
}

export interface Delivery {
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
    | "main-synchronized";
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
  windowsControls?: WindowsControlsEvidence;
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
  evidence: { kind: "request" | "offline-canary"; path: string }[];
}

/** Public durable delivery controls. The CLI supplies no live worker adapter. */
export class DeliveryController {
  private readonly stateDirectory: string;
  private readonly runnerId = randomUUID();

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
    const artifact = join(this.stateDirectory, "artifacts", `${id}.json`);
    const onboarding = inspectOnboarding(repository, this.onboardingOptions);
    const key = this.repositoryKey(repository, onboarding);
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
    this.withDatabase((db) => {
      db.exec("BEGIN IMMEDIATE");
      let createdArtifact = false;
      try {
        const owner = db
          .prepare(
            "SELECT delivery_id, fence FROM repository_owners WHERE repository = ?",
          )
          .get(key);
        if (owner?.delivery_id) {
          delivery.phase = "queued";
        } else {
          delivery.ownership = {
            held: true,
            fence: Number(owner?.fence ?? 0) + 1,
            key,
          };
          db.prepare(
            "INSERT INTO repository_owners (repository, delivery_id, fence) VALUES (?, ?, ?) ON CONFLICT(repository) DO UPDATE SET delivery_id = excluded.delivery_id, fence = excluded.fence",
          ).run(key, id, delivery.ownership.fence);
        }
        writeFileSync(
          artifact,
          JSON.stringify(
            {
              deliveryId: id,
              request: delivery.request,
              issue: delivery.issue,
            },
            null,
            2,
          ),
          { flag: "wx", mode: 0o600, flush: true },
        );
        createdArtifact = true;
        db.prepare("INSERT INTO deliveries (id, document) VALUES (?, ?)").run(
          id,
          JSON.stringify(delivery),
        );
        db.exec("COMMIT");
      } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        if (createdArtifact) unlinkSync(artifact);
        throw error;
      }
    });
    return delivery;
  }

  status(id: string): Delivery {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
    )
      throw new DeliveryError("Provide a valid delivery ID.");
    return this.withDatabase((db) => {
      const row = db
        .prepare("SELECT document FROM deliveries WHERE id = ?")
        .get(id);
      if (!row) throw new DeliveryError("Delivery not found.");
      return projectSubscriptionDecision(
        JSON.parse(String(row.document)) as Delivery,
        this.stateDirectory,
      );
    });
  }

  /** Read a version-bound qualification snapshot without running probes. */
  qualificationReport(id: string): WindowsWorkerQualificationReport {
    const delivery = this.status(id);
    return (delivery.qualification?.intendedPlatform ??
      delivery.qualification?.offlineAdmission?.binding?.platform) === "darwin"
      ? macosWorkerQualificationReport(delivery)
      : windowsWorkerQualificationReport(delivery);
  }

  list(): { deliveries: Delivery[] } {
    return this.withDatabase((db) => ({
      deliveries: db
        .prepare("SELECT document FROM deliveries ORDER BY rowid")
        .all()
        .map((row) =>
          projectSubscriptionDecision(
            JSON.parse(String(row.document)) as Delivery,
            this.stateDirectory,
          ),
        ),
    }));
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
      decision =
        qualified.qualification?.subscriptionMediation?.mechanismDecision;
    if (
      !decision?.qualified ||
      decision.scope !==
        subscriptionDecisionScope(
          qualified.qualification?.offlineAdmission?.binding,
        )
    )
      throw new DeliveryError(
        "Positive fixed-request authentication mediation is required.",
      );
    const checked = await this.checkUsage(id),
      usage = checked.usage!;
    if (
      usage.decision === "exhausted" ||
      (usage.accountId && usage.accountId !== decision.accountId)
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
        (delivery.execution && delivery.execution.state !== "stopped") ||
        (delivery.onlineAccess && delivery.onlineAccess.state !== "stopped")
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
      (before.execution && before.execution.state !== "stopped") ||
      (before.onlineAccess && before.onlineAccess.state !== "stopped")
    )
      throw new DeliveryError(
        "Online canary requires an owned stopped delivery and trusted runtime; recover uncertain sessions first.",
      );
    const qualified = await this.qualify(id);
    const decision =
      qualified.qualification?.subscriptionMediation?.mechanismDecision;
    if (
      !decision?.qualified ||
      decision.scope !==
        subscriptionDecisionScope(
          qualified.qualification?.offlineAdmission?.binding,
        ) ||
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
    if (exact?.approval && usage.decision === "approval-required")
      usage.approval = { scope: usage.scope, at: new Date().toISOString() };
    if (
      (usage.accountId && usage.accountId !== decision.accountId) ||
      usage.decision === "exhausted" ||
      (usage.decision === "approval-required" &&
        (!usage.approval ||
          usage.approval.operationId ||
          Date.now() - Date.parse(usage.approval.at) > 60000))
    )
      throw new DeliveryError(
        "Fresh account-scoped subscription usage approval is required; exhaustion cannot be overridden.",
      );
    const dependency = runtime.dependencyPlan?.(before.repository);
    if (
      exact &&
      JSON.stringify(exact.plan.dependency) !== JSON.stringify(dependency)
    )
      throw new DeliveryError("Exact artifact plan changed.");
    const started = this.change(id, (delivery, db) => {
      if (
        delivery.ownership.fence !== before.ownership.fence ||
        !delivery.ownership.held ||
        delivery.phase !== before.phase ||
        delivery.usage?.checkId !== usage.checkId ||
        (delivery.onlineAccess && delivery.onlineAccess.state !== "stopped") ||
        (delivery.execution && delivery.execution.state !== "stopped")
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
      if (delivery.onlineAccess)
        (delivery.onlineRuns ??= []).push(
          structuredClone(delivery.onlineAccess),
        );
      delivery.onlineAccess = {
        runId: exact?.plan.runId ?? randomUUID(),
        ...(exact?.plan.inference ? { inference: exact.plan.inference } : {}),
        deliveryId: id,
        repository: before.repository,
        fence: this.advanceFence(delivery, db),
        accountId: decision.accountId,
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
      };
      if (delivery.usage?.approval)
        delivery.usage.approval.operationId = delivery.onlineAccess.runId;
    });
    const plan = started.onlineAccess!;
    const authorize = async () => {
      try {
        const current = await this.checkUsage(id);
        const fresh = this.status(id);
        const u = current.usage!;
        const allowed =
          fresh.ownership.held &&
          fresh.ownership.fence === plan.fence &&
          fresh.phase === before.phase &&
          fresh.onlineAccess?.runId === plan.runId &&
          fresh.onlineAccess.state === "dispatched" &&
          fresh.qualification?.subscriptionMediation?.mechanismDecision
            ?.accountId === plan.accountId &&
          onlineUsagePermits(u, plan);
        if (!allowed) return false;
        const authorizedAt = new Date().toISOString();
        this.change(id, (delivery) => {
          if (
            !delivery.ownership.held ||
            delivery.ownership.fence !== plan.fence ||
            delivery.phase !== before.phase ||
            delivery.onlineAccess?.runId !== plan.runId ||
            delivery.onlineAccess.state !== "dispatched" ||
            !onlineUsagePermits(delivery.usage, plan)
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
    }, 30000);
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

  private async recoverOnline(id: string): Promise<Delivery> {
    const snapshot = this.status(id),
      plan = snapshot.onlineAccess;
    if (!plan || plan.state === "stopped") return snapshot;
    let stop: OnlineStop | undefined;
    try {
      stop = await this.observe(
        this.coordination.online?.stop(plan.runId) ??
          Promise.resolve(undefined),
      );
    } catch {}
    return this.change(id, (delivery) => {
      if (
        delivery.onlineAccess?.runId !== plan.runId ||
        delivery.onlineAccess.state === "stopped"
      )
        return;
      if (
        stop?.runId === plan.runId &&
        stop.revoked === true &&
        stop.remainingProcesses === 0
      ) {
        delivery.onlineAccess.state = "stopped";
        delivery.onlineAccess.shutdown = stop;
        if (
          delivery.blocker.code === "UNCERTAIN_SESSION" &&
          (!delivery.execution || delivery.execution.state === "stopped")
        )
          delivery.blocker = this.disabledBlocker();
        delivery.onlineAccess.outcome = "refused";
      } else {
        delivery.onlineAccess.state = "uncertain";
        delivery.onlineAccess.outcome = "uncertain";
        delivery.blocker = {
          code: "UNCERTAIN_SESSION",
          message: "Online canary shutdown is uncertain.",
          nextAction:
            "Recover with the same trusted online runtime; production remains disabled.",
        };
      }
    });
  }

  private mainSyncCoordinator(id: string) {
    return new MainSyncCoordinator(
      {
        status: () => this.status(id),
        change: (update) => this.change(id, update),
        observe: (p) => this.observe(p),
        input: (): MainSyncTarget => {
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
            m.bindingSha256 !==
              this.coordination.mainChecksRuntime?.bindingSha256 ||
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
        },
      },
      this.coordination.mainSyncRuntime,
    );
  }
  async syncMain(id: string): Promise<Delivery> {
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
      this.repositoryKey(snapshot.repository, onboarding) !==
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
      (d.execution && d.execution.state !== "stopped") ||
      (d.onlineAccess && d.onlineAccess.state !== "stopped") ||
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
      this.repositoryKey(d.repository, onboarding) !== d.ownership.key
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
      (snapshot.execution && snapshot.execution.state !== "stopped") ||
      (snapshot.onlineAccess && snapshot.onlineAccess.state !== "stopped") ||
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
      this.repositoryKey(snapshot.repository, onboarding) !==
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
    if (
      stage === "baseline" &&
      snapshot.feature.session &&
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
        this.repositoryKey(snapshot.repository, fresh) ===
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
        (!d.execution || d.execution.state === "stopped") &&
        (!d.onlineAccess || d.onlineAccess.state === "stopped")
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
      (snapshot.execution && snapshot.execution.state !== "stopped") ||
      (snapshot.onlineAccess && snapshot.onlineAccess.state !== "stopped") ||
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
      (snapshot.execution && snapshot.execution.state !== "stopped") ||
      (snapshot.onlineAccess && snapshot.onlineAccess.state !== "stopped") ||
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
      this.repositoryKey(snapshot.repository, onboarding) !==
        snapshot.ownership.key
    )
      throw new DeliveryError(
        "Feature onboarding authority is unavailable or changed.",
      );
    let source: ReturnType<typeof candidateSource>;
    try {
      source = candidateSource(snapshot.repository, feature.sourceRevision);
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
      f.session = {
        operationId: randomUUID(),
        fence: delivery.ownership.fence,
        state: "running",
        intent: !repairId && f.session?.threadId ? "resume" : "start",
        ...(!repairId && f.session?.threadId
          ? { threadId: f.session.threadId }
          : {}),
      };
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
    const argv = session.threadId
      ? ["exec", "resume", "--json", "--skip-git-repo-check", session.threadId]
      : [
          "exec",
          "--json",
          "--skip-git-repo-check",
          "--sandbox",
          "workspace-write",
        ];
    argv.push(
      JSON.stringify({
        request: snapshot.request,
        criteria: feature.criteria,
        verification: feature.verification,
        clarifications: feature.clarifications ?? [],
        ...(repairId
          ? { repairFindings: snapshot.repair!.attempts.at(-1)!.findings }
          : {}),
      }),
    );
    let interrupt: (value: undefined) => void;
    const interrupted = new Promise<undefined>((resolve) => {
      interrupt = resolve;
    });
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
      featureBranch(
        snapshot.repository,
        prepared.feature!.branch!,
        snapshot.publicationHistory?.[0]?.sourceRevision ?? source.revision,
      );
      if (!checkpoint()) throw Error();
      result = await Promise.race([
        runtime.execute({
          ...session,
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
            if (session.threadId && session.threadId !== threadId) return false;
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
          mayDispatch: checkpoint,
          checkpoint,
        }),
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
        if (delivery.feature?.session?.operationId === session.operationId)
          delivery.feature.session.threadId = turn.threadId;
      });
      checkpoint();
    } catch {
      /* Only fixed safe status crosses the controller boundary. */
    } finally {
      clearTimeout(deadline);
      clearInterval(heartbeat);
    }
    const stopped = await this.stopFeature(id, session.operationId);
    if (
      !completed ||
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
        this.repositoryKey(snapshot.repository, finalAuthority) !==
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
        (!delivery.execution || delivery.execution.state === "stopped") &&
        (!delivery.onlineAccess || delivery.onlineAccess.state === "stopped")
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
      this.repositoryKey(snapshot.repository, onboarding) ===
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
    if (
      usage.decision === "exhausted" ||
      (usage.decision === "approval-required" &&
        (!usage.approval ||
          usage.approval.operationId !== undefined ||
          Date.now() - Date.parse(usage.approval.at) > 60000))
    )
      throw new DeliveryError(
        "Subscription usage requires owner approval or an allowance reset before dispatch.",
      );
    const planned = this.change(id, (delivery, db) => {
      if (
        (delivery.onlineAccess && delivery.onlineAccess.state !== "stopped") ||
        (delivery.execution && delivery.execution.state !== "stopped") ||
        delivery.usage?.checkId !== usage.checkId ||
        delivery.phase !== snapshot.phase ||
        delivery.ownership.fence !== snapshot.ownership.fence ||
        !delivery.ownership.held
      )
        throw new DeliveryError(
          "Delivery authority changed; inspect status before retrying.",
        );
      const fence = this.advanceFence(delivery, db);
      const previous = delivery.execution;
      if (previous) (delivery.sessions ??= []).push(structuredClone(previous));
      delivery.execution = {
        deliveryId: id,
        intent: previous ? "resume" : "start",
        repositoryKey: delivery.ownership.key,
        operationId: randomUUID(),
        sandboxId: previous?.sandboxId ?? randomUUID(),
        workerSessionId: previous?.workerSessionId ?? randomUUID(),
        runnerId: this.runnerId,
        fence,
        state: "proposed",
      };
      if (delivery.usage?.approval)
        delivery.usage.approval.operationId = delivery.execution.operationId;
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
            current.usage?.decision !== "exhausted" &&
            (current.usage?.decision === "ready" ||
              current.usage?.approval?.operationId === session.operationId)
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
    let observation;
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
    const report = assessSubscription(observation);
    const endorsedAccount =
      snapshot.qualification?.subscriptionMediation?.mechanismDecision
        ?.accountId;
    if (report.scope === "unknown" && endorsedAccount) {
      report.accountId = endorsedAccount;
      report.scope = sha256(
        JSON.stringify({ account: endorsedAccount, windows: "unknown" }),
      );
    }
    return this.change(id, (delivery) => {
      if (
        delivery.ownership.fence !== snapshot.ownership.fence ||
        delivery.phase !== snapshot.phase
      )
        throw new DeliveryError(
          "Delivery authority changed during usage inspection.",
        );
      if (
        delivery.usage?.approval?.scope === report.scope &&
        report.decision !== "exhausted"
      )
        report.approval = delivery.usage.approval;
      delivery.usage = report;
    });
  }

  approveUsage(id: string, checkId: string): Delivery {
    return this.change(id, (delivery) => {
      const usage = delivery.usage;
      if (
        !usage ||
        usage.checkId !== checkId ||
        usage.decision !== "approval-required" ||
        Date.now() - Date.parse(usage.checkedAt) > 60000 ||
        (delivery.execution && delivery.execution.state !== "stopped") ||
        (delivery.onlineAccess && delivery.onlineAccess.state !== "stopped") ||
        !delivery.ownership.held ||
        !["blocked", "preparing", "paused"].includes(delivery.phase)
      )
        throw new DeliveryError(
          "Approve a fresh usage check for an owned stopped delivery; exhaustion cannot be overridden.",
        );
      usage.approval = { scope: usage.scope, at: new Date().toISOString() };
    });
  }

  async pollUsage(id: string): Promise<Delivery> {
    const observed = await this.checkUsage(id);
    const usage = observed.usage!;
    if (
      observed.onlineAccess?.state === "dispatched" &&
      !onlineUsagePermits(usage, observed.onlineAccess)
    )
      return this.recoverOnline(id);
    if (
      observed.phase === "implementing" &&
      (usage.decision === "exhausted" ||
        (usage.decision === "approval-required" &&
          usage.approval?.operationId !== observed.execution?.operationId))
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
    }, 30000);
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
    return projectSubscriptionDecision(
      this.change(id, (delivery) => {
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
      }),
      this.stateDirectory,
    );
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
    if (!runtime || runtime.version !== windowsControlsVersion)
      throw new DeliveryError(
        "A trusted Windows controls runtime is required.",
      );
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
      evidence.checks.length !== windowsControlNames.length ||
      !windowsControlNames.every((name) =>
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
        "Windows controls evidence or ownership did not verify.",
      );
    return this.change(id, (d) => {
      if (
        d.ownership.fence !== after.ownership.fence ||
        !d.ownership.held ||
        d.execution?.operationId !== evidence.operationId ||
        d.execution.state !== "stopped" ||
        d.phase !== "blocked"
      )
        throw new DeliveryError("Windows controls authority changed.");
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
    const started = this.change(id, (delivery, db) => {
      if (
        !delivery.ownership.held ||
        delivery.phase !== "blocked" ||
        (delivery.onlineAccess && delivery.onlineAccess.state !== "stopped") ||
        (delivery.execution && delivery.execution.state !== "stopped") ||
        delivery.ownership.fence !== qualified.ownership.fence ||
        delivery.qualification?.bindingSha256 !== pins.bindingSha256 ||
        delivery.qualification?.policySha256 !== pins.policySha256
      )
        throw new DeliveryError(
          "Offline canary requires unchanged exclusive repository ownership and stopped workers.",
        );
      const fence = this.advanceFence(delivery, db);
      const session: WorkerSession = {
        deliveryId: id,
        intent: "start",
        repositoryKey: delivery.ownership.key,
        operationId: randomUUID(),
        sandboxId: randomUUID(),
        workerSessionId: randomUUID(),
        runnerId: this.runnerId,
        fence,
        state: "dispatched",
      };
      if (delivery.execution)
        (delivery.sessions ??= []).push(structuredClone(delivery.execution));
      delivery.execution = session;
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
          assertStorageEntry(join(this.stateDirectory, "artifacts"), true);
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
    const decision =
      qualified.qualification?.subscriptionMediation?.mechanismDecision;
    if (
      !runtime ||
      runtime !== this.coordination.offline ||
      runtime.version !== syntheticTaskVersion ||
      !decision?.qualified ||
      decision.scope !==
        subscriptionDecisionScope(
          qualified.qualification?.offlineAdmission?.binding,
        )
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
              this.coordination.observationTimeoutMs ?? 30000,
              timeoutMs ?? 30000,
            ),
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private advanceFence(delivery: Delivery, db: DatabaseSync): number {
    const fence = delivery.ownership.fence + 1;
    const updated = db
      .prepare(
        "UPDATE repository_owners SET fence = ? WHERE repository = ? AND delivery_id = ? AND fence = ?",
      )
      .run(
        fence,
        delivery.ownership.key,
        delivery.id,
        delivery.ownership.fence,
      );
    if (updated.changes !== 1)
      throw new DeliveryError(
        "Repository ownership changed; reconcile before continuing.",
      );
    delivery.ownership.fence = fence;
    return fence;
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
    return this.change(id, (delivery) => {
      if (
        delivery.ownership.fence !== session.fence ||
        delivery.execution?.operationId !== session.operationId ||
        delivery.execution.fence !== session.fence
      ) {
        (delivery.recovery ??= []).push({
          at: new Date().toISOString(),
          outcome: "late-response",
          fence: session.fence,
        });
        return;
      }
      const matches =
        response &&
        [
          "deliveryId",
          "repositoryKey",
          "operationId",
          "sandboxId",
          "workerSessionId",
          "runnerId",
          "fence",
        ].every(
          (key) =>
            response[key as keyof WorkerReceipt] ===
            session[key as keyof WorkerSession],
        );
      const state = matches ? response.status : "unknown";
      if (state === "stopped" || (!stopping && state === "running")) {
        delivery.execution.state = state;
        if (stopping)
          (delivery.recovery ??= []).push({
            at: new Date().toISOString(),
            outcome: "stopped",
            fence: session.fence,
          });
      } else {
        delivery.execution.state = "uncertain";
        delivery.blocker = {
          code: "UNCERTAIN_SESSION",
          message: "Worker outcome or descendant shutdown is not verified.",
          nextAction:
            "Reconcile the explicit sandbox and worker session; do not dispatch or release ownership until stopped.",
        };
        if (delivery.phase !== "paused" && delivery.phase !== "cancelled")
          delivery.phase = "blocked";
        (delivery.recovery ??= []).push({
          at: new Date().toISOString(),
          outcome: "uncertain",
          fence: session.fence,
        });
      }
      if (
        delivery.offlineCanary?.session?.operationId === session.operationId
      ) {
        delivery.offlineCanary.session = structuredClone(delivery.execution);
        if (
          stopping &&
          state === "stopped" &&
          shutdownProof &&
          Number.isSafeInteger(shutdownProof.observedProcesses) &&
          shutdownProof.observedProcesses >= 0 &&
          shutdownProof.observedProcesses <= 32 &&
          shutdownProof.remainingProcesses === 0 &&
          /^[a-f0-9]{64}$/.test(shutdownProof.censusSha256)
        ) {
          delivery.offlineCanary.shutdownProof = {
            observedProcesses: shutdownProof.observedProcesses,
            remainingProcesses: 0,
            censusSha256: shutdownProof.censusSha256,
          };
        }
        delivery.offlineCanary.outcome =
          state === "stopped" ? "rejected" : "uncertain";
        delivery.offlineCanary.message =
          state === "stopped"
            ? "Worker stopped; output collection has not been verified."
            : "Worker shutdown is uncertain; output collection is forbidden.";
      }
    });
  }

  async pause(id: string): Promise<Delivery> {
    const paused = this.change(id, (delivery, db) => {
      this.chargeCoding(delivery);
      if (delivery.phase === "cancelled")
        throw new DeliveryError("A cancelled delivery cannot be paused.");
      if (delivery.phase !== "paused") {
        delivery.priorPhase = delivery.phase;
        delivery.phase = "paused";
        this.controlEvent(delivery, "pause");
        if (delivery.ownership.held) this.advanceFence(delivery, db);
      }
    });
    if (paused.validation?.attempts.some((a) => a.state !== "stopped"))
      await this.stopValidation(id);
    if (paused.feature?.session && paused.feature.session.state !== "stopped")
      await this.stopFeature(id);
    if (paused.onlineAccess && paused.onlineAccess.state !== "stopped")
      await this.recoverOnline(id);
    const repair = this.status(id).repair?.attempts.at(-1);
    if (repair && repair.state !== "stopped") this.finishRepair(id, repair.id);
    return paused.execution && paused.execution.state !== "stopped"
      ? this.stopSession(id)
      : this.status(id);
  }

  resume(id: string): Delivery {
    if (pendingMainSync(this.status(id)))
      throw new DeliveryError(
        "Reconcile main synchronization before resuming.",
      );
    if (mergePending(this.status(id)))
      throw new DeliveryError("Reconcile merge before this control.");
    return this.change(id, (delivery, db) => {
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
      if (delivery.phase === "queued" && !delivery.ownership.held) {
        const owner = db
          .prepare(
            "SELECT delivery_id, fence FROM repository_owners WHERE repository = ?",
          )
          .get(delivery.ownership.key);
        if (owner && owner.delivery_id === null) {
          const fence = Number(owner.fence) + 1;
          db.prepare(
            "UPDATE repository_owners SET delivery_id = ?, fence = ? WHERE repository = ? AND delivery_id IS NULL",
          ).run(id, fence, delivery.ownership.key);
          delivery.ownership = { ...delivery.ownership, held: true, fence };
          delivery.phase = "blocked";
        }
      }
    });
  }

  async cancel(id: string): Promise<Delivery> {
    const cancelled = this.change(id, (delivery, db) => {
      this.chargeCoding(delivery);
      if (delivery.phase !== "cancelled") {
        delivery.priorPhase = delivery.phase;
        delivery.phase = "cancelled";
        this.controlEvent(delivery, "cancel");
        if (delivery.ownership.held) this.advanceFence(delivery, db);
      }
    });
    if (cancelled.validation?.attempts.some((a) => a.state !== "stopped"))
      await this.stopValidation(id);
    if (
      cancelled.feature?.session &&
      cancelled.feature.session.state !== "stopped"
    )
      await this.stopFeature(id);
    if (cancelled.onlineAccess && cancelled.onlineAccess.state !== "stopped")
      await this.recoverOnline(id);
    const repair = this.status(id).repair?.attempts.at(-1);
    if (repair && repair.state !== "stopped") this.finishRepair(id, repair.id);
    return cancelled.execution && cancelled.execution.state !== "stopped"
      ? this.stopSession(id)
      : this.status(id);
  }

  async recover(id: string): Promise<Delivery> {
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
    if (coding && coding.state !== "stopped")
      return this.stopFeature(id, coding.operationId);
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

  private async stopSession(id: string): Promise<Delivery> {
    const stopped = this.change(id, (delivery, db) => {
      if (!delivery.execution || delivery.execution.state === "stopped") return;
      const fence = this.advanceFence(delivery, db);
      delivery.execution.fence = fence;
      delivery.execution.runnerId = this.runnerId;
      delivery.execution.state = "stopping";
    });
    const session = stopped.execution;
    if (!session || session.state === "stopped") return stopped;
    try {
      if (stopped.offlineCanary?.session?.operationId === session.operationId) {
        const pins = stopped.offlineCanary;
        const response =
          this.coordination.offline?.mode === pins.mode
            ? await this.observe(
                this.coordination.offline.stop(structuredClone(session), {
                  bindingSha256: pins.bindingSha256,
                  policySha256: pins.policySha256,
                }),
              )
            : undefined;
        return this.recordReceipt(
          id,
          session,
          matchesCanary(response, session, pins) &&
            response?.revoked === true &&
            response.descendantsStopped === true &&
            response.status === "stopped"
            ? response
            : undefined,
          true,
          response?.evidence,
        );
      }
      const pending = this.coordination.worker?.fenceAndStop(
        structuredClone(session),
      );
      const response = pending ? await this.observe(pending) : undefined;
      return this.recordReceipt(id, session, response, true);
    } catch {
      return this.recordReceipt(id, session, undefined, true);
    }
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
    if (pendingMainSync(this.status(id)))
      throw new DeliveryError(
        "Reconcile main synchronization before releasing ownership.",
      );
    if (mergePending(this.status(id)))
      throw new DeliveryError("Reconcile merge before this control.");
    return this.change(id, (delivery, db) => {
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
      if (!["paused", "cancelled", "blocked"].includes(delivery.phase))
        throw new DeliveryError(
          "Stop the delivery before releasing repository ownership.",
        );
      const key = delivery.ownership.key;
      const fence = delivery.ownership.fence + 1;
      delivery.ownership = { held: false, fence, key };
      this.controlEvent(delivery, "release");
      db.prepare(
        "UPDATE repository_owners SET delivery_id = NULL, fence = ? WHERE repository = ? AND delivery_id = ?",
      ).run(fence, key, id);
      const next = db
        .prepare("SELECT document FROM deliveries WHERE id <> ? ORDER BY rowid")
        .all(id)
        .map((row) => JSON.parse(String(row.document)) as Delivery)
        .find(
          (candidate) =>
            candidate.ownership.key === key && candidate.phase === "queued",
        );
      if (next) {
        next.phase = "blocked";
        next.ownership = { held: true, fence: fence + 1, key };
        db.prepare(
          "UPDATE repository_owners SET delivery_id = ?, fence = ? WHERE repository = ?",
        ).run(next.id, next.ownership.fence, key);
        db.prepare("UPDATE deliveries SET document = ? WHERE id = ?").run(
          JSON.stringify(next),
          next.id,
        );
      }
    });
  }

  private repositoryKey(
    repository: string,
    onboarding?: OnboardingReport,
  ): string {
    return onboarding?.canonicalRepository
      ? `github:${onboarding.canonicalRepository.name.toLowerCase()}`
      : `path:${process.platform === "win32" ? repository.toLowerCase() : repository}`;
  }

  private controlEvent(
    delivery: Delivery,
    action: "pause" | "resume" | "cancel" | "release",
  ): void {
    (delivery.controls ??= []).push({ action, at: new Date().toISOString() });
  }

  private change(
    id: string,
    work: (delivery: Delivery, db: DatabaseSync) => void,
  ): Delivery {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
    )
      throw new DeliveryError("Provide a valid delivery ID.");
    return this.withDatabase((db) => {
      db.exec("BEGIN IMMEDIATE");
      const row = db
        .prepare("SELECT document FROM deliveries WHERE id = ?")
        .get(id);
      if (!row) throw new DeliveryError("Delivery not found.");
      const delivery = JSON.parse(String(row.document)) as Delivery;
      work(delivery, db);
      db.prepare("UPDATE deliveries SET document = ? WHERE id = ?").run(
        JSON.stringify(delivery),
        id,
      );
      db.exec("COMMIT");
      return delivery;
    });
  }

  private withDatabase<T>(work: (db: DatabaseSync) => T): T {
    const artifacts = join(this.stateDirectory, "artifacts");
    assertStorageEntry(artifacts, true);
    const ledger = join(this.stateDirectory, "deliveries.sqlite");
    for (const path of [ledger, `${ledger}-wal`, `${ledger}-shm`])
      assertStorageEntry(path, false);
    mkdirSync(join(this.stateDirectory, "artifacts"), {
      recursive: true,
      mode: 0o700,
    });
    const db = new DatabaseSync(ledger);
    try {
      db.exec("PRAGMA busy_timeout = 5000;");
      db.exec("BEGIN IMMEDIATE");
      const version = Number(
        db.prepare("PRAGMA user_version").get()?.user_version,
      );
      if (version > 2)
        throw new DeliveryError("This ledger requires a newer controller.");
      if (version === 0) {
        db.exec(
          "CREATE TABLE deliveries (id TEXT PRIMARY KEY, document TEXT NOT NULL); PRAGMA user_version = 1;",
        );
      }
      if (version < 2) {
        db.exec(
          "CREATE TABLE repository_owners (repository TEXT PRIMARY KEY, delivery_id TEXT, fence INTEGER NOT NULL); PRAGMA user_version = 2;",
        );
        for (const row of db
          .prepare("SELECT id, document FROM deliveries ORDER BY rowid")
          .all()) {
          const delivery = JSON.parse(String(row.document)) as Delivery;
          delivery.onboarding ??= inspectOnboarding(delivery.repository, {});
          delivery.authorityPolicySha256 =
            delivery.onboarding?.policy?.sha256 ?? null;
          const key = this.repositoryKey(
            delivery.repository,
            delivery.onboarding,
          );
          const owner = db
            .prepare(
              "SELECT delivery_id FROM repository_owners WHERE repository = ?",
            )
            .get(key);
          delivery.ownership = { held: !owner, fence: owner ? 0 : 1, key };
          if (owner) delivery.phase = "queued";
          else
            db.prepare("INSERT INTO repository_owners VALUES (?, ?, 1)").run(
              key,
              delivery.id,
            );
          db.prepare("UPDATE deliveries SET document = ? WHERE id = ?").run(
            JSON.stringify(delivery),
            delivery.id,
          );
        }
      }
      db.exec("COMMIT");
      db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
      return work(db);
    } finally {
      if (db.isTransaction) db.exec("ROLLBACK");
      db.close();
    }
  }
}
