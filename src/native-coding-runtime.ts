import { createHash } from "node:crypto";
import {
  type CodingAdmission,
  claudeCodingAdmissionScope,
  ownerClaudeCodingAdmission,
  ownerCodingAdmission,
  readOwnerRecord,
} from "./coding-admission.js";
import {
  PinnedCodingRuntime,
  claudeAgent,
  codexAgent,
} from "./feature-candidate.js";
import { NativePodmanCodingTransport, claudeGuest } from "./podman-coding.js";

/** The authority a machine's native coding sessions are labelled with; the
 * native acceptances use the same derivation, so the CLI can stop and recover
 * the sessions they started. */
export function nativeCodingAuthority(machine: string): string {
  return createHash("sha256")
    .update("issue04-native-offline-lifecycle-v1:" + machine)
    .digest("hex");
}

/** The owner-admitted native coding runtime for `machine`, on the worker
 * the owner's record names (`ownerCodingWorker`). Its pins are the
 * owner's record, re-measured against the guest at every effect, so a changed
 * machine still gets its exact-session stop attempted but never trusted.
 * Production delivery stays disabled. */
export function nativeCodingRuntime(
  machine: string,
  admissionPath: string,
): PinnedCodingRuntime {
  const worker = ownerCodingWorker(machine, admissionPath);
  return new PinnedCodingRuntime(
    worker.admission.pins(),
    worker.transport,
    worker.admission,
    worker.agent === "claude" ? claudeAgent : codexAgent,
  );
}

/** The coding worker an owner's record names, for the owner-run native
 * scripts: a record with the Claude Code scope (ADR 0008) names the Claude
 * Code guest under its own admission, and any other record the Codex guest.
 * An unreadable record names Codex, whose admission then refuses it. */
export function ownerCodingWorker(
  machine: string,
  admissionPath: string,
): {
  agent: "claude" | "codex";
  transport: NativePodmanCodingTransport;
  admission: CodingAdmission;
} {
  let claude = false;
  try {
    const record = readOwnerRecord(admissionPath) as { scope?: unknown };
    claude = record?.scope === claudeCodingAdmissionScope;
  } catch {}
  const authority = nativeCodingAuthority(machine);
  return claude
    ? {
        agent: "claude",
        transport: new NativePodmanCodingTransport(
          machine,
          authority,
          claudeGuest,
        ),
        admission: ownerClaudeCodingAdmission(admissionPath),
      }
    : {
        agent: "codex",
        transport: new NativePodmanCodingTransport(machine, authority),
        admission: ownerCodingAdmission(admissionPath),
      };
}
