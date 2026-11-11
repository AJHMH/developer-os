import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import type { RegistryReader } from "./dependency-cache.js";
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

/** Whether the owner policy at `path` declares the prepared npm cache for its
 * validation contract (#265). It only chooses which runtime the CLI builds:
 * the controller still refuses a runtime whose environment isn't exactly the
 * contract's, so a wrong answer refuses rather than runs. */
export function ownerPolicyDeclaresPreparedNpm(path: string | undefined) {
  if (!path) return false;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 65536) return false;
    const caches = JSON.parse(readFileSync(path, "utf8"))?.validationContract
      ?.environment?.caches;
    return Array.isArray(caches) && caches.includes("prepared-npm");
  } catch {
    return false;
  }
}

/** The owner-admitted native validation runtime for `machine`, at the
 * record's pins and its image. Checks run offline. With a registry `reader`,
 * the host fetches and verifies exactly the tarballs the candidate's lockfile
 * pins, and each attempt installs them offline from that prepared cache in its
 * own container; without one there are no dependency installs. */
export function nativeValidationRuntime(
  machine: string,
  admissionPath: string,
  dependencies?: { reader: RegistryReader },
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
    dependencies,
  );
}
