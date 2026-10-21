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
  type CodingPins,
  codingPinFields,
  validCodingPins,
} from "./feature-candidate.js";
import {
  assertOwnerControlledStorage,
  assertPrivateAuthStorage,
} from "./private-storage.js";

const scope = "aios-native-coding-admission-v1";

/** An owner-written, per-host record that admits one live coding transport at
 * exactly these pins. Editing or removing the file, or any pin change, revokes
 * admission at the next check. It never lives in a repository. */
export interface CodingAdmission {
  readonly path: string;
  /** The admitted pins, read afresh unless a read succeeded within
   * `maxAgeMs`; throws when the record is unusable. */
  pins(maxAgeMs?: number): CodingPins;
}

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

/** Read the private record through one descriptor bound to the checked file. */
function readRecord(file: string): unknown {
  assertOwnerControlledStorage(dirname(file), "directory", 4096, "readable");
  assertPrivateAuthStorage(file, "file", 4096);
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
      opened.size > 4096
    )
      throw Error();
    return JSON.parse(readFileSync(descriptor, "utf8"));
  } finally {
    closeSync(descriptor);
  }
}

export function ownerCodingAdmission(
  path: string,
  options: { clock?: () => number } = {},
): CodingAdmission {
  const clock = options.clock ?? Date.now;
  if (typeof path !== "string" || !isAbsolute(path))
    throw Error("Coding admission record path must be absolute");
  const file = resolve(path);
  if (insideRepository(dirname(file)))
    throw Error("Coding admission records never live in a repository");
  let last: { at: number; pins: CodingPins } | undefined;
  const admission: CodingAdmission = {
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
        const pins = record.pins as CodingPins;
        if (
          Object.keys(record).sort().join() !== "approvedAt,pins,scope" ||
          record.scope !== scope ||
          typeof record.approvedAt !== "string" ||
          new Date(record.approvedAt).toISOString() !== record.approvedAt ||
          Date.parse(record.approvedAt) > now ||
          !pins ||
          typeof pins !== "object" ||
          Object.keys(pins).sort().join() !==
            [...codingPinFields].sort().join() ||
          !validCodingPins(pins)
        )
          throw Error();
        const admitted = Object.fromEntries(
          codingPinFields.map((field) => [field, pins[field]]),
        ) as unknown as CodingPins;
        last = { at: now, pins: admitted };
        return { ...admitted };
      } catch {
        throw Error("Owner coding admission is missing or invalid");
      }
    },
  };
  return Object.freeze(admission);
}
