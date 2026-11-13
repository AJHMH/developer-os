import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
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
  admitRequest,
  chargeReservation,
  chargeResponse,
  dollarsToPicodollars,
  extendBudget,
  newSpendLedger,
  picodollarsToDollars,
  releaseRequest,
  type ModelUsage,
  type SpendLedger,
} from "./spend-budget.js";
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
  claudeAgent,
  featureBranchName,
  featureBranchPattern,
  advanceFeatureBranch,
  featureBranchAdvance,
  featureBranch,
  needsResumeRecovery,
  featurePlan,
  filesManifestDigest,
  claudeCodingPinFields,
  validClaudeCodingPins,
  recordedProvider,
  sessionProvider,
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
  inspectOnboarding,
  type OnboardingOptions,
  type OnboardingReport,
  ownerChangeGate,
} from "./onboarding.js";
import { pathContains } from "./path-containment.js";
import { samePins, type ProductionAdmission } from "./production-admission.js";
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
import { SessionLifecycle, sessionsQuiescent } from "./session-lifecycle.js";
import type { SessionGateway, SessionRevocation } from "./session-relay.js";
import {
  deliveryMessagesBudget,
  messagesLimits,
  type MessagesBudget,
} from "./messages-gateway.js";

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

const defaultObservationTimeoutMs = 30_000;
function contains(parent: string, child: string): boolean {
  return pathContains(parent, child);
}

export interface FeatureRequest {
  codingMinutes?: number;
  /** The delivery's spend budget in dollars (ADR 0008); default $10. */
  budgetDollars?: number;
  /** The repair allowance's cycles (1 to 100); default 3. */
  repairCycles?: number;
  /** The repair allowance's active minutes (1 to 1440); default 60. */
  repairMinutes?: number;
  repository: string;
  request: string;
  issue?: string;
}

/** Grace beyond a turn's remaining allowance for its final request. */
const sessionGraceMs = 60_000;

/** One metered Claude Code turn's Messages session (ADR 0008). */
export interface MessagesSessionTurn {
  deliveryId: string;
  /** The coding operation the turn runs as. */
  sessionId: string;
  expiresAt: number;
}
/** Opens the host side of a metered Claude Code turn, whose only model
 * authority is the delivery's spend `budget`. The real factory, holding the
 * owner's Anthropic key, is `meteredMessagesSessions`. */
export type MessagesSessionFactory = (
  turn: MessagesSessionTurn,
  budget: MessagesBudget,
) => SessionGateway;

const productionRefusal =
  "Publication and merge need the owner's production admission naming this delivery's coding and validation pins, unchanged since publication; production remains disabled.";

/** The route a metered Claude Code turn records. Its authority is the
 * delivery's spend budget, not a mediation decision, so the digest names the
 * delivery's budget: every turn of a delivery shares it, and a resume keeps
 * it. */
const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function budgetRouteSha256(deliveryId: string): string {
  return sha256("aios-spend-budget-route-v1:" + deliveryId);
}

/** Whether a runtime is Claude Code's, the only coding agent (ADR 0008), with
 * valid pins. */
function validRuntimePins(runtime: FeatureRuntime): boolean {
  return (
    (runtime.agent ?? claudeAgent).provider === "claude" &&
    validClaudeCodingPins(runtime.pins) &&
    !("codeModeHostSha256" in runtime.pins)
  );
}

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
  observationTimeoutMs?: number;
  /** Meters Claude Code coding turns against the spend budget (ADR 0008). */
  messagesSessions?: MessagesSessionFactory;
  /** The owner's production admission (ticket 04). Without it, or for a
   * delivery whose coding or validation ran under other pins, publication and
   * so every later stage refuses. */
  productionAdmission?: ProductionAdmission;
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
  /** The owner's repair allowance at start, when not the default. */
  initialRepairAllowance?: { cycles: number; ms: number };
  /** The owner's spend budget at start, in picodollars, when not the default. */
  initialSpendBudget?: number;
  /** Metered model access charged to this delivery (ADR 0008). */
  spend?: SpendLedger;
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

const budgetExtensionRequired =
  "Coding was interrupted by the spend budget; extend it with extend-budget --id ID --dollars N before coding continues. Work is preserved.";

/** The blocker for a budget interruption (ADR 0008). */
function budgetBlocker(i: {
  needed: number;
  remaining: number;
}): Delivery["blocker"] {
  return {
    code: "DELIVERY_NOT_ENABLED",
    message: `Budget interruption: the next model request could cost up to ${picodollarsToDollars(i.needed)}, and ${picodollarsToDollars(Math.max(0, i.remaining))} of the spend budget remains. Work is preserved.`,
    nextAction:
      "Extend this delivery's spend budget with extend-budget --id ID --dollars N before coding continues.",
  };
}

/** Before any candidate or repair exists, coding may follow a moved main;
 * an admitted candidate refreshes its base through repair instead. */
/** What coding's checks established, for the turn that follows them. */
type CodingPreflight = Awaited<
  ReturnType<DeliveryController["codingPreflight"]>
>;

function mayMoveBase(delivery: Delivery, repairId?: string): boolean {
  return !delivery.feature?.candidate && !delivery.repair && !repairId;
}

/** Once a coding operation reaches dispatch, its base move becomes evidence,
 * once. */
function reachedDispatch(delivery: Delivery, operationId: string) {
  const f = delivery.feature;
  const move =
    f?.session?.operationId === operationId ? f.session.baseMove : undefined;
  if (move && !f!.baseMoves?.some((m) => m.operationId === operationId))
    (f!.baseMoves ??= []).push({
      operationId,
      ...move,
      at: new Date().toISOString(),
    });
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
      stopValidation: (id) => this.stopValidation(id),
      stopFeature: (id) => this.stopFeature(id),
      finishRepair: (id, repairId) => this.finishRepair(id, repairId),
    });
  }
  private get ledger() {
    return new RepositoryLedger(this.stateDirectory);
  }
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
    for (const [value, max] of [
      [input.repairCycles, 100],
      [input.repairMinutes, 1440],
    ] as const)
      if (
        value !== undefined &&
        (!Number.isSafeInteger(value) || value < 1 || value > max)
      )
        throw new DeliveryError(
          "Declare 1 to 100 repair cycles and 1 to 1440 repair minutes.",
        );
    let initialSpendBudget: number | undefined;
    if (input.budgetDollars !== undefined)
      try {
        initialSpendBudget = dollarsToPicodollars(input.budgetDollars);
      } catch {
        throw new DeliveryError(
          "Declare a spend budget in whole cents from $0.01 to $1000.",
        );
      }
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
      ...(input.repairCycles !== undefined || input.repairMinutes !== undefined
        ? {
            initialRepairAllowance: {
              cycles: input.repairCycles ?? 3,
              ms: (input.repairMinutes ?? 60) * 60000,
            },
          }
        : {}),
      ...(initialSpendBudget !== undefined ? { initialSpendBudget } : {}),
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
    return this.ledger.read(id);
  }

  list(): { deliveries: Delivery[] } {
    return { deliveries: this.ledger.list() };
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
    // Merge lands the code, so it re-checks the production admission its
    // publication ran under (ticket 04).
    const d = this.status(id);
    if (!d.publication?.productionSha256 || !this.productionAdmits(d))
      throw new DeliveryError(productionRefusal);
    try {
      return await this.mergeCoordinator(id).merge();
    } catch {
      throw new DeliveryError(
        "Merge requires fresh approved-head gates and the merge the owner policy installs.",
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
      // The pinned owner policy's contract, or the default (ADR 0005).
      changeGate: ownerChangeGate(
        this.onboardingOptions.policyPath,
        d.authorityPolicySha256,
      ),
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
        "Review requires current validated publication, trusted checks, unchanged authority and the review adapter the owner policy installs.",
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
      !featureBranchPattern.test(f.branch) ||
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
    const production = this.productionSha256(d);
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
      ...(production ? { productionSha256: production } : {}),
      policySha256: d.authorityPolicySha256!,
      validationOperationId: v.operationId,
      publicationLogin: policy.publicationLogin,
      appLogin: policy.appLogin,
      approver: policy.approver,
      files: candidate.files,
    };
  }

  /** The owner's production admission digest when it admits exactly the
   * coding pins `d`'s feature ran under and the binding its latest validation
   * attempt recorded (ticket 04); otherwise undefined. */
  private productionSha256(d: Delivery): string | undefined {
    const production = this.coordination.productionAdmission;
    const attempt = d.validation?.attempts.at(-1);
    if (!production || !d.feature?.pins || !attempt) return undefined;
    try {
      const admitted = production.admitted();
      return samePins(d.feature.pins, admitted.coding, claudeCodingPinFields) &&
        admitted.validationBindingSha256 === attempt.bindingSha256
        ? admitted.productionSha256
        : undefined;
    } catch {
      return undefined;
    }
  }
  /** Whether production admits `d` now, under the same record its publication
   * recorded, if it has one. */
  private productionAdmits(d: Delivery): boolean {
    const production = this.productionSha256(d);
    return (
      !!production &&
      (!d.publication?.productionSha256 ||
        d.publication.productionSha256 === production)
    );
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
            this.productionAdmits(this.status(id)) &&
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
    if (!this.productionAdmits(this.status(id)))
      throw new DeliveryError(productionRefusal);
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
    // An owner-facing refusal, after the runtime and authority gates.
    if (stage === "candidate" && !snapshot.feature.candidate)
      throw new DeliveryError(
        "Candidate validation requires an admitted candidate from a completed coding turn.",
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
    // Refuse before the attempt is recorded: a failed attempt spends a cycle
    // and sets the candidate's validation back to not-run.
    const coding = this.coordination.featureRuntime,
      checks = this.coordination.validationRuntime;
    if (
      coding?.mode !== "controlled" ||
      !validRuntimePins(coding) ||
      checks?.mode !== "controlled"
    )
      throw new DeliveryError(
        "Repair needs the controlled coding and validation runtimes; no repair was recorded.",
      );
    // A spent allowance is reported before anything else, even with nothing
    // left to repair; it records nothing.
    const budget = snapshot.repair,
      exhausted =
        budget &&
        (budget.activeMs >= budget.allowanceMs ||
          budget.attempts.length >= budget.allowanceCycles);
    const findings = exhausted
      ? []
      : repairFindings([
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
    // Coding's own refusals come before the attempt too. A base refresh
    // changes the feature's revision inside the attempt, so its coding checks
    // still run there.
    // An exhausted allowance is reported below without coding's checks.
    const preflight =
      baseRefresh || exhausted
        ? undefined
        : await this.codingPreflight(id, {}, attemptId);
    const prepared = this.change(id, (d) => {
      if (
        d.phase !== snapshot.phase ||
        d.ownership.fence !== snapshot.ownership.fence ||
        d.feature?.candidate?.sha256 !== input.digest ||
        d.repair?.attempts.some((a) => a.state !== "stopped")
      )
        throw new DeliveryError("Repair authority changed.");
      const r = (d.repair ??= repairBudget(d.initialRepairAllowance));
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
      const coded = await this.executeFeature(id, {}, attemptId, preflight);
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

  /** Coding's checks before it records a session. They record nothing, and a
   * repair runs them before it records an attempt, so a refusal spends no
   * cycle. */
  private async codingPreflight(
    id: string,
    options: { codingMinutes?: number },
    repairId?: string,
  ) {
    const runtime = this.coordination.featureRuntime,
      agent = runtime?.agent ?? claudeAgent,
      snapshot = this.status(id),
      feature = snapshot.feature;
    if (
      !sessionsQuiescent(snapshot) ||
      snapshot.blocker.code === "UNCERTAIN_SESSION" ||
      !runtime ||
      runtime.mode !== "controlled" ||
      !validRuntimePins(runtime) ||
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
    // A delivery that began coding under Codex (removed, ADR 0008) keeps its
    // `codex/` branch, which the coding guest refuses.
    if (feature.branch && !featureBranchPattern.test(feature.branch))
      throw new DeliveryError(
        "This delivery began coding under Codex, which was removed; start a new delivery.",
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
          feature.branch ?? featureBranchName(id),
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
    // ADR 0008: a Claude Code turn is metered, and the delivery's spend
    // budget is its only model authority.
    if (!this.coordination.messagesSessions)
      throw new DeliveryError(
        "Claude Code coding needs the owner's stored Anthropic key; supply --auth-directory. Production remains disabled.",
      );
    this.settleStaleReservation(id);
    if (this.status(id).spend?.interruption)
      throw new DeliveryError(budgetExtensionRequired);
    return {
      runtime,
      agent,
      snapshot,
      feature,
      source,
      mayMove,
      input,
      minutes,
      validationRuntime,
      route: {
        deliveryId: id,
        decisionSha256: budgetRouteSha256(id),
      } satisfies SessionRoute,
    };
  }

  private async executeFeature(
    id: string,
    options: { codingMinutes?: number } = {},
    repairId?: string,
    preflight?: CodingPreflight,
  ): Promise<Delivery> {
    const {
      runtime,
      agent,
      snapshot,
      feature,
      source,
      mayMove,
      input,
      minutes,
      validationRuntime,
      route,
    } = preflight ?? (await this.codingPreflight(id, options, repairId));
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
      f.branch ??= featureBranchName(id);
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
      // A resume keeps its predecessor's route and coding agent. Every turn
      // of a delivery shares its spend budget's route, so only a session
      // recorded before the spend budget, under a mediation decision, starts
      // a new lineage instead. One agent's CLI never continues another's
      // conversation.
      const sameRoute =
        JSON.stringify(prior?.route) === JSON.stringify(route) &&
        !!prior &&
        sessionProvider(prior) === agent.provider;
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
        ...recordedProvider(agent.provider),
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
          ...recordedProvider(sessionProvider(prior!)),
          at: new Date().toISOString(),
          by: f.session.operationId,
          session: codingBinding(predecessor!),
        });
      // The turn's authority is the spend budget, checked at each model
      // request; nothing is bound to it here.
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
    // The running repair attempt, read after it was checked as active: a
    // repair's preflight ran before the attempt was recorded.
    const attempt = repairId ? prepared.repair!.attempts.at(-1)! : undefined;
    const session = structuredClone(prepared.feature!.session!),
      pins = JSON.stringify(runtime.pins),
      clock = this.coordination.clock ?? Date.now;
    let result: CodingResult | undefined,
      completed = false,
      // A metered turn the spend budget refused (ADR 0008).
      budgetStopped = false;
    const checkpoint = () => {
      const now = clock();
      if (!Number.isSafeInteger(now)) return false;
      const d = this.change(id, (delivery) => {
        if (delivery.feature?.session?.operationId === session.operationId)
          this.chargeCoding(delivery);
      });
      return (
        !budgetStopped &&
        !d.spend?.interruption &&
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
    const prompt = JSON.stringify({
      request: snapshot.request,
      criteria: feature.criteria,
      verification: feature.verification,
      clarifications: feature.clarifications ?? [],
      // A resumed conversation is told its workspace now starts from a new main.
      ...(session.baseMove ? { baseMove: session.baseMove } : {}),
      ...(repairId ? { repairFindings: attempt!.findings } : {}),
    });
    let gateway: SessionGateway | undefined,
      revoked = false;
    // The turn's model session is revoked once, with the first reason.
    const revoke = (reason: SessionRevocation) => {
      if (!gateway || revoked) return;
      revoked = true;
      gateway.revoke(reason);
    };
    let interrupt: (value: undefined) => void;
    const interrupted = new Promise<undefined>((resolve) => {
      interrupt = resolve;
    });
    let monitoring = true;
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
      // A budget interrupted since the preflight stops the session before
      // any turn.
      if (this.status(id).spend?.interruption || !checkpoint()) throw Error();
      // Opened inside the guarded turn, so a refusal still stops the session.
      {
        const ledger = deliveryMessagesBudget(this, id);
        gateway = this.coordination.messagesSessions!(
          {
            deliveryId: id,
            sessionId: session.operationId,
            expiresAt:
              clock() +
              Math.min(
                messagesLimits.sessionMs,
                this.featureBudget(prepared).allowanceMs -
                  this.featureBudget(prepared).activeMs +
                  sessionGraceMs,
              ),
          },
          {
            ...ledger,
            // A refused request is a budget interruption: the turn stops at
            // once, its thread resumable after the owner extends the budget.
            admit: (operationId, reserve) => {
              const admitted = ledger.admit(operationId, reserve);
              if (!admitted && monitoring) {
                budgetStopped = true;
                interrupt(undefined);
              }
              return admitted;
            },
          },
        );
      }
      // The relay's own capability for this turn, never the gateway's, which
      // stays on the host (ADR 0002).
      const modelRoute = {
        ...route,
        capability: randomBytes(32).toString("hex"),
      };
      const argv = [...agent.argv(session.threadId, modelRoute), prompt];
      result = await Promise.race([
        runtime.execute(
          {
            ...session,
            modelRoute,
            branch: prepared.feature!.branch!,
            sourceRevision: source.revision,
            // The files' own manifest digest. A repair's input is named
            // elsewhere by its candidate artifact's digest, which differs.
            inputSha256: filesManifestDigest(input.files),
            onEvent: (event) => {
              if (!checkpoint()) return false;
              const threadId = agent.boundThread(event);
              if (threadId === undefined) return false;
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
            ...(attempt?.baseRefresh
              ? {
                  baseRefresh: {
                    from: {
                      revision: attempt.baseRefresh.from,
                      files: candidateRevisionFiles(
                        snapshot.repository,
                        attempt.baseRefresh.from,
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
              const permitted = checkpoint();
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
      const turn = agent.turn(
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
      let ended: SessionRevocation =
        JSON.stringify(runtime.pins) === pins ? "stopped" : "pin-changed";
      try {
        if (this.status(id).phase === "paused") ended = "paused";
      } catch {}
      revoke(ended);
    }
    let stopped = await this.stopFeature(id, session.operationId);
    // Extending the budget is the owner's authority to continue after a
    // budget interruption (ADR 0008). Stopping may have replaced its
    // blocker, so it is restored.
    const halted = budgetStopped;
    if (budgetStopped)
      stopped = this.change(id, (delivery) => {
        const interruption = delivery.spend?.interruption;
        if (interruption && delivery.blocker.code !== "UNCERTAIN_SESSION")
          delivery.blocker = budgetBlocker(interruption);
      });
    if (
      stopped.feature?.session?.operationId === session.operationId &&
      needsResumeRecovery(stopped.feature.session)
    )
      return this.recoverResume(id);
    // A lapsed turn's workspace is kept as evidence only, never as a
    // candidate (decision G); a refused collection leaves the interruption.
    if (
      halted &&
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
      halted ||
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

  /** The delivery's spend ledger, created at its first use. */
  private ledgerOf(delivery: Delivery): SpendLedger {
    return (delivery.spend ??= newSpendLedger(delivery.initialSpendBudget));
  }

  /** ADR 0008: admits one metered model request whose worst-case `reserve`
   * (picodollars) fits the remaining budget. A refusal is a budget
   * interruption and blocks coding until the owner extends the budget. */
  admitModelRequest(
    id: string,
    operationId: string,
    reserve: number,
  ): { admitted: boolean; delivery: Delivery } {
    let admitted = false;
    const delivery = this.change(id, (d) => {
      if (!d.ownership.held)
        throw new DeliveryError(
          "Only the repository owner delivery may spend its budget.",
        );
      const result = admitRequest(this.ledgerOf(d), operationId, reserve);
      admitted = result.admitted;
      if (!result.admitted) d.blocker = budgetBlocker(result);
    });
    return { admitted, delivery };
  }

  /** A model request left reserved by a stopped coding session never
   * settles itself, and would refuse every later request; its whole
   * reservation is charged, as for usage that cannot be verified. */
  private settleStaleReservation(id: string): void {
    const reserved = this.status(id).spend?.reserved;
    if (!reserved) return;
    this.change(id, (d) => {
      const session = d.feature?.session;
      if (
        d.spend?.reserved?.operationId === reserved.operationId &&
        session?.state === "stopped" &&
        reserved.operationId.startsWith(`${session.operationId}-`)
      )
        chargeReservation(d.spend, reserved.operationId);
    });
  }

  /** Charges an admitted request's actual cost from the provider's usage. */
  chargeModelResponse(
    id: string,
    operationId: string,
    usage: ModelUsage,
  ): { cost: number; overrun: boolean } {
    let charged: { cost: number; overrun: boolean } | undefined;
    this.change(id, (d) => {
      charged = chargeResponse(this.ledgerOf(d), operationId, usage);
    });
    return charged!;
  }

  /** Charges an admitted request's whole reservation when its usage could
   * not be verified. */
  chargeModelReservation(id: string, operationId: string): { cost: number } {
    let cost = 0;
    this.change(id, (d) => {
      cost = chargeReservation(this.ledgerOf(d), operationId).cost;
    });
    return { cost };
  }

  /** Releases an admitted request that never reached the provider. */
  releaseModelRequest(id: string, operationId: string): Delivery {
    return this.change(id, (d) => {
      releaseRequest(this.ledgerOf(d), operationId);
    });
  }

  /** The owner's budget extension: adds whole cents and clears a budget
   * interruption. */
  extendBudget(id: string, dollars: number): Delivery {
    let added: number;
    try {
      added = dollarsToPicodollars(dollars);
    } catch {
      throw new DeliveryError(
        "Extend the spend budget by whole cents from $0.01 to $1000.",
      );
    }
    return this.change(id, (d) => {
      if (!d.ownership.held)
        throw new DeliveryError(
          "Only the repository owner delivery may receive a budget extension.",
        );
      const ledger = this.ledgerOf(d),
        interrupted = ledger.interruption !== undefined;
      extendBudget(ledger, added);
      if (interrupted) d.blocker = this.disabledBlocker();
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
        delivery.blocker = this.disabledBlocker();
        this.controlEvent(delivery, "resume");
      }
      if (delivery.phase === "paused") {
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
    return this.status(id);
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
    const cleaned = await this.verifiedCleanup(
      runtime!.cleanup(retired),
      retired,
      "Retired lineage cleanup is unverified; nothing was recorded, and it can be retried.",
    );
    // Retirements are never removed; a concurrent duplicate cleanup only
    // re-records the same idempotent removal.
    return this.change(id, (delivery) => {
      const retirement = delivery.feature!.retirements!.find(
        (r) => r.operationId === operationId,
      )!;
      retirement.cleanedAt = new Date().toISOString();
      retirement.cleaned = cleaned;
    });
  }

  /** The owner's explicit guest cleanup of a superseded lineage, named by
   * the session coding left when it restarted under another route or
   * provider: the guest removes its session folders and stopped containers,
   * keeps the records as tombstones and marks the head never to be resumed.
   * Only the runtime of the lineage's own provider cleans it (ADR 0003).
   * Recorded once; an unverified cleanup records nothing. */
  async cleanupSupersededLineage(
    id: string,
    operationId: string,
  ): Promise<Delivery> {
    const snapshot = this.status(id),
      runtime = this.coordination.featureRuntime,
      lineage = snapshot.feature?.supersededLineages?.find(
        (l) => l.operationId === operationId,
      );
    if (
      !lineage ||
      lineage.cleanedAt ||
      !snapshot.ownership.held ||
      !sessionsQuiescent(snapshot) ||
      !this.sameCodingRuntime(snapshot) ||
      sessionProvider(lineage) !== (runtime!.agent ?? claudeAgent).provider ||
      !runtime!.cleanupSuperseded
    )
      throw new DeliveryError(
        "Clean up only a recorded superseded lineage, once, for an owned quiescent delivery with the same trusted coding runtime.",
      );
    const cleaned = await this.verifiedCleanup(
      runtime!.cleanupSuperseded(lineage.session),
      lineage.session,
      "Superseded lineage cleanup is unverified; nothing was recorded, and it can be retried.",
    );
    // Superseded lineages are never removed; a concurrent duplicate cleanup
    // only re-records the same idempotent removal.
    return this.change(id, (delivery) => {
      const entry = delivery.feature!.supersededLineages!.find(
        (l) => l.operationId === operationId,
      )!;
      entry.cleanedAt = new Date().toISOString();
      entry.cleaned = cleaned;
    });
  }

  /** A lineage cleanup's session count, from a receipt naming exactly
   * `session`; anything else refuses with `unverified`. */
  private async verifiedCleanup(
    cleanup: Promise<CodingCleanup>,
    session: CodingSession,
    unverified: string,
  ): Promise<number> {
    let receipt: CodingCleanup | undefined;
    try {
      receipt = await this.observe(cleanup);
    } catch {}
    if (
      !sameOperation(receipt, session) ||
      !Number.isSafeInteger(receipt!.cleaned) ||
      receipt!.cleaned < 1
    )
      throw new DeliveryError(unverified);
    return receipt!.cleaned;
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
      if (!delivery.ownership.held) return;
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
