import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  type ClaudeCodingPins,
  type CodingPins,
  claudeCodingPinFields,
  validClaudeCodingPins,
} from "./feature-candidate.js";
import {
  assertOwnerControlledStorage,
  assertPrivateAuthStorage,
} from "./private-storage.js";

/** Claude Code turns have their own scope, so no Codex-era record
 * (`aios-native-coding-admission-v1`) admits them. */
export const claudeCodingAdmissionScope = "aios-claude-coding-admission-v1";

/** An owner-written, per-host record that admits one live transport at
 * exactly these pins. Editing or removing the file, or any pin change, revokes
 * admission at the next check. It never lives in a repository. */
export interface OwnerAdmission<P> {
  readonly path: string;
  /** The admitted pins, read afresh unless a read succeeded within
   * `maxAgeMs`; throws when the record is unusable. */
  pins(maxAgeMs?: number): P;
}
/** Owner coding admission: one live coding transport at exact coding pins. */
export type CodingAdmission = OwnerAdmission<CodingPins>;

/** True when `folder`, or any folder above it, holds a Git repository. Real
 * paths are walked too, so a symlinked ancestor cannot hide a repository. */
function insideRepository(folder: string): boolean {
  const roots = [folder];
  try {
    roots.push(realpathSync(folder));
  } catch {}
  return roots.some((root) => {
    for (let at = root; ; at = dirname(at)) {
      if (existsSync(join(at, ".git"))) return true;
      if (dirname(at) === at) return false;
    }
  });
}

/** Read the private file's bytes through one descriptor bound to the checked
 * file. */
function readPrivateBytes(file: string, maxBytes: number): Buffer {
  assertOwnerControlledStorage(dirname(file), "directory", 4096, "readable");
  assertPrivateAuthStorage(file, "file", maxBytes);
  const checked = lstatSync(file);
  const descriptor = openSync(
    file,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const opened = fstatSync(descriptor);
    if (
      !opened.isFile() ||
      opened.dev !== checked.dev ||
      opened.ino !== checked.ino ||
      opened.size > maxBytes
    )
      throw Error();
    return readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}
/** Read the private record through one descriptor bound to the checked file. */
function readRecord(file: string, maxBytes = 4096): unknown {
  return JSON.parse(readPrivateBytes(file, maxBytes).toString("utf8"));
}

/** The bytes of a private, owner-held file of up to `maxBytes`, read afresh
 * from an absolute path outside every repository. */
export function readOwnerBytes(path: string, maxBytes = 4096): Buffer {
  if (typeof path !== "string" || !isAbsolute(path))
    throw Error("Owner record path must be absolute");
  const file = resolve(path);
  if (insideRepository(dirname(file)))
    throw Error("Owner records never live in a repository");
  return readPrivateBytes(file, maxBytes);
}
/** A private, owner-written record of up to `maxBytes`, read afresh from an
 * absolute path outside every repository. */
export function readOwnerRecord(path: string, maxBytes = 4096): unknown {
  return JSON.parse(readOwnerBytes(path, maxBytes).toString("utf8"));
}
export { insideRepository };

/** What an owner record admits: its scope, exact pin fields and pin check.
 * `label` names the record in refusals, for example "coding". */
export interface OwnerAdmissionKind<P> {
  readonly scope: string;
  readonly label: string;
  readonly fields: readonly (keyof P & string)[];
  /** Pins a record may also name; each one present is admitted with it. */
  readonly optional?: readonly (keyof P & string)[];
  valid(pins: P): boolean;
}

/** A private, owner-written per-host record admitting exactly `kind`'s pins.
 * It is re-read at every check unless a read succeeded within `maxAgeMs`. */
export function ownerAdmission<P>(
  path: string,
  kind: OwnerAdmissionKind<P>,
  options: { clock?: () => number } = {},
): OwnerAdmission<P> {
  const clock = options.clock ?? Date.now;
  const title = kind.label[0]!.toUpperCase() + kind.label.slice(1);
  if (typeof path !== "string" || !isAbsolute(path))
    throw Error(`${title} admission record path must be absolute`);
  const file = resolve(path);
  if (insideRepository(dirname(file)))
    throw Error(`${title} admission records never live in a repository`);
  let last: { at: number; pins: P } | undefined;
  const admission: OwnerAdmission<P> = {
    path: file,
    pins(maxAgeMs = 0) {
      const now = clock();
      if (maxAgeMs > 0 && last && now >= last.at && now - last.at <= maxAgeMs)
        return { ...last.pins };
      last = undefined;
      try {
        if (insideRepository(dirname(file))) throw Error();
        const value = readRecord(file);
        if (!value || typeof value !== "object" || Array.isArray(value))
          throw Error();
        const record = value as Record<string, unknown>;
        const pins = record.pins as P;
        if (
          Object.keys(record).sort().join() !== "approvedAt,pins,scope" ||
          record.scope !== kind.scope ||
          typeof record.approvedAt !== "string" ||
          new Date(record.approvedAt).toISOString() !== record.approvedAt ||
          Date.parse(record.approvedAt) > now ||
          !pins ||
          typeof pins !== "object" ||
          Object.keys(pins).some(
            (key) =>
              !kind.fields.includes(key as keyof P & string) &&
              !kind.optional?.includes(key as keyof P & string),
          ) ||
          !kind.fields.every((field) => Object.hasOwn(pins, field)) ||
          !kind.valid(pins)
        )
          throw Error();
        const named = [...kind.fields, ...(kind.optional ?? [])].filter(
          (field) => Object.hasOwn(pins, field),
        );
        const admitted = Object.fromEntries(
          named.map((field) => [field, pins[field]]),
        ) as P;
        last = { at: now, pins: admitted };
        return { ...admitted };
      } catch {
        throw Error(`Owner ${kind.label} admission is missing or invalid`);
      }
    },
  };
  return Object.freeze(admission);
}

/** Owner coding admission for Claude Code turns: the Claude pin shape under
 * its own scope. */
export function ownerClaudeCodingAdmission(
  path: string,
  options: { clock?: () => number } = {},
): OwnerAdmission<ClaudeCodingPins> {
  return ownerAdmission(
    path,
    {
      scope: claudeCodingAdmissionScope,
      label: "coding",
      fields: claudeCodingPinFields,
      valid: validClaudeCodingPins,
    },
    options,
  );
}
