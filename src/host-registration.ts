import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { DeliveryError } from "./errors.js";
import { pathContains } from "./path-containment.js";
import { assertPrivateAuthStorage } from "./private-storage.js";
import { redact } from "./redaction.js";

/** The owner's non-secret host registration in the private auth directory.
 * Its host ID binds the stored Anthropic account record (ADR 0006). */
export interface HostRegistration {
  schema: 1;
  hostId: string;
  agentName: "Developer OS";
}
export function validHostRegistration(
  value: unknown,
): value is HostRegistration {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.schema === 1 &&
    record.agentName === "Developer OS" &&
    typeof record.hostId === "string" &&
    /^urn:uuid:[a-f0-9-]{36}$/.test(record.hostId) &&
    Object.keys(record).sort().join(",") === "agentName,hostId,schema"
  );
}

/** The host registration in the owner's private auth directory. */
export function hostRegistration(directory: string): HostRegistration {
  const file = join(directory, "registration.json");
  assertPrivateAuthStorage(directory, "directory");
  assertPrivateAuthStorage(file, "file");
  const record = JSON.parse(readFileSync(file, "utf8"));
  if (!validHostRegistration(record))
    throw Error("The host registration is invalid");
  return record;
}

function canonical(path: string): string {
  const missing: string[] = [];
  let parent = resolve(path);
  while (!existsSync(parent)) {
    missing.unshift(basename(parent));
    const next = dirname(parent);
    if (next === parent) throw Error();
    parent = next;
  }
  if (
    lstatSync(parent).isSymbolicLink() ||
    realpathSync(parent).toLowerCase() !== parent.toLowerCase()
  )
    throw Error();
  return join(realpathSync(parent), ...missing);
}
function inside(parent: string, child: string): boolean {
  return pathContains(parent, child);
}

/** Separate owner setup, not worker qualification: prepares only the
 * non-secret host registration, keeping an existing one. It opens no browser
 * and stores no credential. */
export function prepareHostRegistration(
  directory: string,
  repository: string,
  authority: string,
) {
  try {
    if (
      ![directory, repository, authority].every(isAbsolute) ||
      redact(directory) !== directory
    )
      throw Error();
    const target = canonical(directory),
      repo = canonical(repository),
      state = canonical(authority);
    if (
      !lstatSync(repo).isDirectory() ||
      inside(repo, target) ||
      inside(target, repo) ||
      inside(state, target) ||
      inside(target, state)
    )
      throw Error();
    mkdirSync(target, { recursive: true, mode: 0o700 });
    if (
      lstatSync(target).isSymbolicLink() ||
      !lstatSync(target).isDirectory() ||
      canonical(target).toLowerCase() !== target.toLowerCase()
    )
      throw Error();
    assertPrivateAuthStorage(target, "directory");
    const path = join(target, "registration.json");
    let registration: { schema: number; hostId: string; agentName: string };
    if (existsSync(path)) {
      assertPrivateAuthStorage(path, "file");
      const entry = lstatSync(path);
      if (
        !entry.isFile() ||
        entry.isSymbolicLink() ||
        entry.nlink !== 1 ||
        entry.size > 4096
      )
        throw Error();
      registration = JSON.parse(readFileSync(path, "utf8"));
      if (!validHostRegistration(registration)) throw Error();
    } else {
      registration = {
        schema: 1,
        hostId: `urn:uuid:${randomUUID()}`,
        agentName: "Developer OS",
      };
      const serialized = JSON.stringify(registration, null, 2) + "\n";
      writeFileSync(path, serialized, {
        flag: "wx",
        mode: 0o600,
        flush: true,
      });
    }
    return {
      status: "prepared" as const,
      hostId: registration.hostId,
      agentName: registration.agentName,
      registrationPath: path,
      credentialsStored: false,
      deliveryEnabled: false,
    };
  } catch {
    throw new DeliveryError(
      "Authentication setup requires ordinary external storage separate from the candidate and controller ledger; preserve existing registration material and check paths before retrying.",
    );
  }
}
