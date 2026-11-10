import { createHash } from "node:crypto";
import {
  type CodingAdmission,
  ownerClaudeCodingAdmission,
} from "./coding-admission.js";
import { PinnedCodingRuntime, claudeAgent } from "./feature-candidate.js";
import { NativePodmanCodingTransport, claudeGuest } from "./podman-coding.js";

/** The authority a machine's native coding sessions are labelled with; the
 * native acceptances use the same derivation, so the CLI can stop and recover
 * the sessions they started. */
export function nativeCodingAuthority(machine: string): string {
  return createHash("sha256")
    .update("issue04-native-offline-lifecycle-v1:" + machine)
    .digest("hex");
}

/** The owner-admitted native coding runtime for `machine`, on the Claude
 * Code worker (`ownerCodingWorker`). Its pins are the owner's record,
 * re-measured against the guest at every effect, so a changed machine still
 * gets its exact-session stop attempted but never trusted. Production delivery
 * stays disabled. */
export function nativeCodingRuntime(
  machine: string,
  admissionPath: string,
): PinnedCodingRuntime {
  const worker = ownerCodingWorker(machine, admissionPath);
  return new PinnedCodingRuntime(
    worker.admission.pins(),
    worker.transport,
    worker.admission,
    claudeAgent,
  );
}

/** The coding worker for the owner-run native scripts: the Claude Code guest
 * (ADR 0008), under the owner's Claude Code admission record. A record of any
 * other scope, such as an old Codex record, is refused when it is read. */
export function ownerCodingWorker(
  machine: string,
  admissionPath: string,
): {
  agent: "claude";
  transport: NativePodmanCodingTransport;
  admission: CodingAdmission;
} {
  return {
    agent: "claude",
    transport: new NativePodmanCodingTransport(
      machine,
      nativeCodingAuthority(machine),
      claudeGuest,
    ),
    admission: ownerClaudeCodingAdmission(admissionPath),
  };
}
