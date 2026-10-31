import { createHash } from "node:crypto";
import { ownerCodingAdmission } from "./coding-admission.js";
import { PinnedCodingRuntime } from "./feature-candidate.js";
import { NativePodmanCodingTransport } from "./podman-coding.js";

/** The authority a machine's native coding sessions are labelled with; the
 * native acceptances use the same derivation, so the CLI can stop and recover
 * the sessions they started. */
export function nativeCodingAuthority(machine: string): string {
  return createHash("sha256")
    .update("issue04-native-offline-lifecycle-v1:" + machine)
    .digest("hex");
}

/** The owner-admitted native coding runtime for `machine`. Its pins are the
 * owner's record, re-measured against the guest at every effect, so a changed
 * machine still gets its exact-session stop attempted but never trusted.
 * Production delivery stays disabled. */
export function nativeCodingRuntime(
  machine: string,
  admissionPath: string,
): PinnedCodingRuntime {
  const admission = ownerCodingAdmission(admissionPath);
  return new PinnedCodingRuntime(
    admission.pins(),
    new NativePodmanCodingTransport(machine, nativeCodingAuthority(machine)),
    admission,
  );
}
