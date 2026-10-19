import { randomUUID } from "node:crypto";
import type { CoordinationOptions, Delivery } from "./controller.js";
import { DeliveryError } from "./errors.js";
import { needsResumeRecovery } from "./feature-candidate.js";
import { matchesCanary } from "./offline-canary.js";
import type { OnlineStop } from "./online-access.js";
import type { WorkerQualification } from "./qualification.js";

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

interface LifecyclePorts {
  read(id: string): Delivery;
  change(
    id: string,
    update: (delivery: Delivery, advanceFence: () => number) => void,
  ): Delivery;
  observe<T>(pending: Promise<T>): Promise<T | undefined>;
  runnerId: string;
  clock(): number;
  runtimes: Pick<CoordinationOptions, "worker" | "offline" | "online">;
  disabledBlocker(): Delivery["blocker"];
  stopValidation(id: string): Promise<Delivery>;
  stopFeature(id: string): Promise<Delivery>;
  finishRepair(id: string, repairId: string): Delivery;
}

/** All current and retained process sessions must independently be stopped.
 * Repair attempts are orchestration allowances, not process sessions. */
export function sessionsQuiescent(delivery: Delivery): boolean {
  // A stopped resume that may have moved its predecessor's home is retained.
  if (
    delivery.feature?.session &&
    needsResumeRecovery(delivery.feature.session)
  )
    return false;
  return [
    delivery.execution,
    ...(delivery.sessions ?? []),
    delivery.offlineCanary?.session,
    delivery.onlineAccess,
    ...(delivery.onlineRuns ?? []),
    delivery.feature?.session,
    ...(delivery.validation?.attempts ?? []),
  ].every((session) => !session || session.state === "stopped");
}

/** Owns worker/offline/online receipt identity and verified shutdown. It updates
 * existing durable documents through the caller's transaction, never raw SQL. */
export class SessionLifecycle {
  constructor(private readonly ports: LifecyclePorts) {}
  /** Called within the ledger transaction after workflow admission. */
  proposeWorker(
    delivery: Delivery,
    advanceFence: () => number,
    options: { resume: boolean; state: "proposed" | "dispatched" },
  ): WorkerSession {
    if (!delivery.ownership.held || !sessionsQuiescent(delivery))
      throw new DeliveryError(
        "Session dispatch requires ownership and verified shutdown.",
      );
    const previous = delivery.execution;
    const resumed = options.resume ? previous : undefined;
    const session: WorkerSession = {
      deliveryId: delivery.id,
      intent: resumed ? "resume" : "start",
      repositoryKey: delivery.ownership.key,
      operationId: randomUUID(),
      sandboxId: resumed?.sandboxId ?? randomUUID(),
      workerSessionId: resumed?.workerSessionId ?? randomUUID(),
      runnerId: this.ports.runnerId,
      fence: advanceFence(),
      state: options.state,
    };
    if (previous) (delivery.sessions ??= []).push(structuredClone(previous));
    delivery.execution = session;
    return session;
  }
  dispatchOnline(
    delivery: Delivery,
    advanceFence: () => number,
    plan: Omit<NonNullable<Delivery["onlineAccess"]>, "fence">,
  ): void {
    if (!delivery.ownership.held || !sessionsQuiescent(delivery))
      throw new DeliveryError(
        "Session dispatch requires ownership and verified shutdown.",
      );
    if (delivery.onlineAccess)
      (delivery.onlineRuns ??= []).push(structuredClone(delivery.onlineAccess));
    delivery.onlineAccess = { ...structuredClone(plan), fence: advanceFence() };
  }
  async stopOnline(id: string): Promise<Delivery> {
    const snapshot = this.ports.read(id),
      plan = snapshot.onlineAccess;
    if (!plan || plan.state === "stopped") return snapshot;
    let stop: OnlineStop | undefined;
    try {
      stop = await this.ports.observe(
        this.ports.runtimes.online?.stop(plan.runId) ??
          Promise.resolve(undefined),
      );
    } catch {}
    return this.ports.change(id, (delivery) => {
      if (delivery.onlineAccess?.runId !== plan.runId) {
        (delivery.recovery ??= []).push({
          at: new Date(this.ports.clock()).toISOString(),
          outcome: "late-response",
          fence: plan.fence,
        });
        return;
      }
      if (delivery.onlineAccess.state === "stopped") return;
      if (
        stop?.runId === plan.runId &&
        stop.revoked === true &&
        stop.remainingProcesses === 0
      ) {
        delivery.onlineAccess.state = "stopped";
        delivery.onlineAccess.shutdown = stop;
        if (
          delivery.blocker.code === "UNCERTAIN_SESSION" &&
          sessionsQuiescent(delivery)
        )
          delivery.blocker = this.ports.disabledBlocker();
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

  recordReceipt(
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
    return this.ports.change(id, (delivery) => {
      if (
        delivery.ownership.fence !== session.fence ||
        delivery.execution?.operationId !== session.operationId ||
        delivery.execution.fence !== session.fence
      ) {
        (delivery.recovery ??= []).push({
          at: new Date(this.ports.clock()).toISOString(),
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
            at: new Date(this.ports.clock()).toISOString(),
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
          at: new Date(this.ports.clock()).toISOString(),
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

  async stopWorker(id: string): Promise<Delivery> {
    const stopped = this.ports.change(id, (delivery, advanceFence) => {
      if (!delivery.execution || delivery.execution.state === "stopped") return;
      const fence = advanceFence();
      delivery.execution.fence = fence;
      delivery.execution.runnerId = this.ports.runnerId;
      delivery.execution.state = "stopping";
    });
    const session = stopped.execution;
    if (!session || session.state === "stopped") return stopped;
    try {
      if (stopped.offlineCanary?.session?.operationId === session.operationId) {
        const pins = stopped.offlineCanary;
        const response =
          this.ports.runtimes.offline?.mode === pins.mode
            ? await this.ports.observe(
                this.ports.runtimes.offline.stop(structuredClone(session), {
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
      const pending = this.ports.runtimes.worker?.fenceAndStop(
        structuredClone(session),
      );
      const response = pending ? await this.ports.observe(pending) : undefined;
      return this.recordReceipt(id, session, response, true);
    } catch {
      return this.recordReceipt(id, session, undefined, true);
    }
  }

  async stopAll(id: string): Promise<Delivery> {
    let current = this.ports.read(id);
    if (
      current.validation?.attempts.some(
        (attempt) => attempt.state !== "stopped",
      )
    )
      await this.ports.stopValidation(id);
    current = this.ports.read(id);
    if (current.feature?.session && current.feature.session.state !== "stopped")
      await this.ports.stopFeature(id);
    current = this.ports.read(id);
    if (current.onlineAccess && current.onlineAccess.state !== "stopped")
      await this.stopOnline(id);
    const repair = this.ports.read(id).repair?.attempts.at(-1);
    if (repair && repair.state !== "stopped")
      this.ports.finishRepair(id, repair.id);
    return this.stopWorker(id);
  }
}
