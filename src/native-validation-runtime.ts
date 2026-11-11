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

/** The validation environment the owner policy at `path` declares, or
 * nothing when it can't be read. It only chooses which runtime the CLI
 * builds: the controller still refuses a runtime whose environment isn't
 * exactly the contract's, so a wrong answer refuses rather than runs. */
function declaredEnvironment(path: string | undefined): unknown {
  if (!path) return undefined;
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size > 65536) return undefined;
    return JSON.parse(readFileSync(path, "utf8"))?.validationContract
      ?.environment;
  } catch {
    return undefined;
  }
}
/** Whether the owner policy at `path` declares the prepared npm cache for its
 * validation contract (#265). */
export function ownerPolicyDeclaresPreparedNpm(path: string | undefined) {
  const caches = (declaredEnvironment(path) as { caches?: unknown })?.caches;
  return Array.isArray(caches) && caches.includes("prepared-npm");
}
/** Whether the owner policy at `path` declares a database for its E2E
 * checks (#265). */
export function ownerPolicyDeclaresDatabase(path: string | undefined) {
  return (
    (declaredEnvironment(path) as { database?: unknown })?.database === true
  );
}
/** Whether the owner policy at `path` declares a browser for its E2E checks
 * (#265). */
export function ownerPolicyDeclaresBrowser(path: string | undefined) {
  return (declaredEnvironment(path) as { browser?: unknown })?.browser === true;
}

/** The owner-admitted native validation runtime for `machine`, at the
 * record's pins and its images. Checks run offline. With a registry `reader`,
 * the host fetches and verifies exactly the tarballs the candidate's lockfile
 * pins, and each attempt installs them offline from that prepared cache in its
 * own container; without one there are no dependency installs. With
 * `database`, each E2E check gets a disposable PostgreSQL from the record's
 * database image; with `browser`, each runs in the record's browser image. */
export function nativeValidationRuntime(
  machine: string,
  admissionPath: string,
  options: {
    reader?: RegistryReader;
    database?: boolean;
    browser?: boolean;
  } = {},
): PinnedValidationRuntime {
  const admission = ownerValidationAdmission(admissionPath);
  const pins = admission.pins();
  return new PinnedValidationRuntime(
    pins,
    new NativePodmanValidationTransport(
      machine,
      nativeValidationAuthority(machine),
      pins.imageSha256,
      {
        ...(pins.databaseImageSha256
          ? { databaseImageSha256: pins.databaseImageSha256 }
          : {}),
        ...(pins.browserImageSha256
          ? { browserImageSha256: pins.browserImageSha256 }
          : {}),
      },
    ),
    admission,
    options,
  );
}
