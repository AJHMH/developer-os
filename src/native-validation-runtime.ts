import { createHash } from "node:crypto";
import {
  PinnedValidationRuntime,
  ownerValidationAdmission,
} from "./native-validation.js";
import { NativePodmanValidationTransport } from "./podman-validation.js";

/** The authority a machine's native validation attempts are labelled with,
 * separate from coding's; the native acceptances use the same derivation, so
 * the CLI can stop the attempts they started. */
export function nativeValidationAuthority(machine: string): string {
  return createHash("sha256")
    .update("issue04-native-offline-validation-v1:" + machine)
    .digest("hex");
}

/** The owner-admitted native validation runtime for `machine`, at the
 * record's pins and its image. Checks run offline, with no dependency
 * installs. Production delivery stays disabled. */
export function nativeValidationRuntime(
  machine: string,
  admissionPath: string,
): PinnedValidationRuntime {
  const admission = ownerValidationAdmission(admissionPath);
  const pins = admission.pins();
  return new PinnedValidationRuntime(
    pins,
    new NativePodmanValidationTransport(
      machine,
      nativeValidationAuthority(machine),
      pins.imageSha256,
    ),
    admission,
  );
}
