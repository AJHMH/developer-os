import { createHash } from "node:crypto";
import type { WorkerReceipt, WorkerSession } from "./controller.js";
import { admittedPath } from "./workspace.js";

export const canaryInput = "AIOS offline canary input\n";
export const canaryOutput = "AIOS offline canary complete\n";
export const sha256 = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export interface CanaryPins {
  bindingSha256: string;
  policySha256: string;
}
export interface CanaryReceipt extends WorkerReceipt, CanaryPins {}
export interface CanaryExecution extends CanaryReceipt {
  fresh: boolean;
  binding: Record<string, string>;
  effective: Record<string, string | boolean | string[]>;
}
export interface CanaryStop extends CanaryReceipt {
  revoked: boolean;
  descendantsStopped: boolean;
  evidence?: {
    observedProcesses: number;
    remainingProcesses: number;
    censusSha256: string;
  };
}
export interface CanaryCollection extends CanaryReceipt {
  files: {
    path: string;
    bytes: Buffer;
    ordinary: boolean;
    links: number;
    beforeSha256: string;
    afterSha256: string;
  }[];
}
/** Trusted VM management boundary, never loaded from a repository or pin policy.
 * execute creates a fresh dedicated restricted worker, copies bytes without host
 * mounts, and runs only the fixed synthetic canary (no scripts or inference).
 * stop revokes dispatch and independently verifies every descendant has stopped.
 * collect observes ordinary output through the stopped VM's management plane,
 * with independent before/after digests. It never restarts the worker for export.
 * Controlled implementations are test observations, not native isolation proof.
 * There is intentionally no host-process or weaker-runtime implementation. */
export interface OfflineCanaryRuntime {
  readonly mode: "controlled" | "live";
  execute(
    request: CanaryPins & {
      session: WorkerSession;
      files: { path: string; bytes: Buffer; executable: false }[];
      binding: Record<string, string>;
      effective: Record<string, string | boolean | string[]>;
      mayDispatch: () => boolean;
    },
  ): Promise<CanaryExecution>;
  stop(session: WorkerSession, pins: CanaryPins): Promise<CanaryStop>;
  collect(session: WorkerSession, pins: CanaryPins): Promise<CanaryCollection>;
}
export interface OfflineCanaryEvidence extends CanaryPins {
  mode: "controlled" | "live";
  outcome: "running" | "completed" | "refused" | "rejected" | "uncertain";
  session?: WorkerSession;
  inputSha256?: string;
  outputSha256?: string;
  message: string;
}
export function matchesCanary(
  receipt: CanaryReceipt | undefined,
  session: WorkerSession,
  pins: CanaryPins,
): boolean {
  return Boolean(
    receipt &&
      [
        "deliveryId",
        "intent",
        "repositoryKey",
        "operationId",
        "sandboxId",
        "workerSessionId",
        "runnerId",
        "fence",
      ].every(
        (key) =>
          receipt[key as keyof WorkerSession] ===
          session[key as keyof WorkerSession],
      ) &&
      receipt.bindingSha256 === pins.bindingSha256 &&
      receipt.policySha256 === pins.policySha256,
  );
}
export function collectCanary(receipt: CanaryCollection): {
  content: string;
  sha256: string;
} {
  if (!Array.isArray(receipt.files) || receipt.files.length !== 1)
    throw Error("Invalid canary output");
  const file = receipt.files[0]!;
  if (
    !admittedPath(file.path) ||
    file.path !== "result.txt" ||
    file.ordinary !== true ||
    file.links !== 1 ||
    !Buffer.isBuffer(file.bytes) ||
    file.bytes.length !== Buffer.byteLength(canaryOutput)
  )
    throw Error("Invalid canary output");
  const bytes = Buffer.from(file.bytes);
  const hash = sha256(bytes);
  if (
    hash !== file.beforeSha256 ||
    hash !== file.afterSha256 ||
    !bytes.equals(Buffer.from(canaryOutput))
  )
    throw Error("Changed or unsafe canary output");
  return { content: canaryOutput, sha256: hash };
}
