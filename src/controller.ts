import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
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
  offline?: OfflineCanaryRuntime;
  subscription?: SubscriptionReader;
  worker?: WorkerAdapter;
  observationTimeoutMs?: number;
}

export interface Delivery {
  id: string;
  phase:
    | "blocked"
    | "queued"
    | "paused"
    | "cancelled"
    | "preparing"
    | "implementing";
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
      return JSON.parse(String(row.document)) as Delivery;
    });
  }

  list(): { deliveries: Delivery[] } {
    return this.withDatabase((db) => ({
      deliveries: db
        .prepare("SELECT document FROM deliveries ORDER BY rowid")
        .all()
        .map((row) => JSON.parse(String(row.document)) as Delivery),
    }));
  }

  async run(id: string): Promise<Delivery> {
    const worker = this.coordination.worker;
    const snapshot = this.status(id);
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
    return this.change(id, (delivery) => {
      if (
        delivery.ownership.fence !== snapshot.ownership.fence ||
        delivery.phase !== snapshot.phase
      )
        throw new DeliveryError(
          "Delivery authority changed during qualification.",
        );
      delivery.qualification = qualification;
    });
  }

  /** Fixed synthetic workload only. Admission never enables feature delivery. */
  async offlineCanary(
    id: string,
    files = [{ path: "canary.txt", sha256: sha256(canaryInput) }],
  ): Promise<Delivery> {
    const qualified = await this.qualify(id);
    const admission = qualified.qualification?.offlineAdmission;
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
      runtime.mode !== qualified.qualification?.mode
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
        delivery.ownership.fence !== qualified.ownership.fence ||
        delivery.qualification?.bindingSha256 !== pins.bindingSha256 ||
        delivery.qualification?.policySha256 !== pins.policySha256 ||
        (delivery.execution && delivery.execution.state !== "stopped")
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
              current.execution.state === "dispatched"
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

  private async observe<T>(pending: Promise<T>): Promise<T | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        pending,
        new Promise<undefined>((resolve) => {
          timer = setTimeout(
            () => resolve(undefined),
            this.coordination.observationTimeoutMs ?? 30000,
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
      if (delivery.phase === "cancelled")
        throw new DeliveryError("A cancelled delivery cannot be paused.");
      if (delivery.phase !== "paused") {
        delivery.priorPhase = delivery.phase;
        delivery.phase = "paused";
        this.controlEvent(delivery, "pause");
        if (delivery.ownership.held) this.advanceFence(delivery, db);
      }
    });
    return paused.execution && paused.execution.state !== "stopped"
      ? this.stopSession(id)
      : paused;
  }

  resume(id: string): Delivery {
    return this.change(id, (delivery, db) => {
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
        if (delivery.phase === "implementing" || delivery.phase === "preparing")
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
      if (delivery.phase !== "cancelled") {
        delivery.priorPhase = delivery.phase;
        delivery.phase = "cancelled";
        this.controlEvent(delivery, "cancel");
        if (delivery.ownership.held) this.advanceFence(delivery, db);
      }
    });
    return cancelled.execution && cancelled.execution.state !== "stopped"
      ? this.stopSession(id)
      : cancelled;
  }

  async recover(id: string): Promise<Delivery> {
    const delivery = this.status(id);
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
    return this.change(id, (delivery, db) => {
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
