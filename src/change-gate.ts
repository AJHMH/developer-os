import { createHash } from "node:crypto";

/** ADR 0005: the delivery controller's deterministic classification of a pull
 * request head. A gated change (destructive or wide-impact) needs the owner's
 * merge approval; an ungated one merges once every other required gate passes.
 * The input comes from a trusted observation of the head's diff, never from
 * the coding worker's own claim. */

export type ChangedFileStatus =
  | "added"
  | "modified"
  | "removed"
  | "renamed"
  | "copied"
  | "changed";

export interface ChangedFile {
  path: string;
  status: ChangedFileStatus;
  /** Present exactly when the status is renamed or copied. */
  previousPath?: string;
  additions: number;
  deletions: number;
}

export interface ChangeGateObservation {
  head: string;
  base: string;
  /** False when the trusted observer could not list every changed file. */
  complete: boolean;
  /** False when the base is not an ancestor of the head (history rewrite). */
  baseIsAncestor: boolean;
  files: ChangedFile[];
}

/** The owner's per-repository gate rules. Paths are globs: `*` matches within
 * one path segment and `**` across segments. */
export interface ChangeGateContract {
  maxFiles: number;
  maxLines: number;
  /** The controller's own authority: credentials, admission, merge, cleanup,
   * workflows and protection configuration. Any change here is wide-impact. */
  authorityPaths: string[];
  /** Persisted data the owner relies on. Changing or removing it is
   * destructive. */
  dataPaths: string[];
}

export interface ChangeGateEvidence {
  head: string;
  base: string;
  contractSha256: string;
  gated: boolean;
  destructive: string[];
  wideImpact: string[];
  files: number;
  lines: number;
}

/** The contract a repository gets until its owner declares its own. */
export function defaultChangeGateContract(): ChangeGateContract {
  return {
    maxFiles: 20,
    maxLines: 600,
    authorityPaths: [".github/**", "**/CODEOWNERS"],
    dataPaths: [],
  };
}

const revision = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const count = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const statuses: readonly ChangedFileStatus[] = [
  "added",
  "modified",
  "removed",
  "renamed",
  "copied",
  "changed",
];

/** A repository-relative path with no empty, `.` or `..` segments. */
function repositoryPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096)
    return false;
  if (value.startsWith("/") || /[\0\\]/.test(value)) return false;
  return value.split("/").every((s) => s !== "" && s !== "." && s !== "..");
}

function glob(value: unknown): value is string {
  if (!repositoryPath(value)) return false;
  return value
    .split("/")
    .every((s) => s === "**" || (!s.includes("**") && s.length > 0));
}

/** Matches a path against a glob, segment by segment. */
export function matchesGlob(pattern: string, path: string): boolean {
  const p = pattern.split("/"),
    s = path.split("/");
  const segment = (pat: string, seg: string) =>
    new RegExp(
      "^" +
        pat.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*") +
        "$",
    ).test(seg);
  const walk = (i: number, j: number): boolean => {
    if (i === p.length) return j === s.length;
    if (p[i] === "**")
      return walk(i + 1, j) || (j < s.length && walk(i, j + 1));
    return j < s.length && segment(p[i]!, s[j]!) && walk(i + 1, j + 1);
  };
  return walk(0, 0);
}

export function validChangeGateContract(
  value: unknown,
): value is ChangeGateContract {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    Object.keys(c).sort().join(",") ===
      "authorityPaths,dataPaths,maxFiles,maxLines" &&
    count(c.maxFiles) &&
    (c.maxFiles as number) >= 1 &&
    count(c.maxLines) &&
    (c.maxLines as number) >= 1 &&
    Array.isArray(c.authorityPaths) &&
    c.authorityPaths.length <= 256 &&
    c.authorityPaths.every(glob) &&
    Array.isArray(c.dataPaths) &&
    c.dataPaths.length <= 256 &&
    c.dataPaths.every(glob)
  );
}

export function changeGateContractSha256(contract: ChangeGateContract): string {
  const canonical = JSON.stringify({
    authorityPaths: [...contract.authorityPaths].sort(),
    dataPaths: [...contract.dataPaths].sort(),
    maxFiles: contract.maxFiles,
    maxLines: contract.maxLines,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function admitFiles(files: unknown): ChangedFile[] {
  if (!Array.isArray(files) || files.length > 3000)
    throw Error("Unverified changed files");
  const seen = new Set<string>();
  return files.map((f) => {
    const file = f as Record<string, unknown>;
    const moved = file.status === "renamed" || file.status === "copied";
    if (
      !file ||
      typeof file !== "object" ||
      !repositoryPath(file.path) ||
      !statuses.includes(file.status as ChangedFileStatus) ||
      moved !== (file.previousPath !== undefined) ||
      (moved && !repositoryPath(file.previousPath)) ||
      !count(file.additions) ||
      !count(file.deletions) ||
      seen.has(file.path as string)
    )
      throw Error("Unverified changed files");
    seen.add(file.path as string);
    return {
      path: file.path as string,
      status: file.status as ChangedFileStatus,
      ...(moved ? { previousPath: file.previousPath as string } : {}),
      additions: file.additions as number,
      deletions: file.deletions as number,
    };
  });
}

/** Classifies one head. Malformed input throws rather than classifying, so a
 * caller can never mistake an unverified diff for an ungated one. */
export function classifyChange(
  observation: ChangeGateObservation,
  contract: ChangeGateContract,
): ChangeGateEvidence {
  if (!validChangeGateContract(contract))
    throw Error("Invalid change gate contract");
  const o = observation;
  if (
    !o ||
    !revision(o.head) ||
    !revision(o.base) ||
    typeof o.complete !== "boolean" ||
    typeof o.baseIsAncestor !== "boolean"
  )
    throw Error("Unverified change observation");
  const files = admitFiles(o.files);
  const lines = files.reduce((n, f) => n + f.additions + f.deletions, 0);
  const matches = (patterns: string[], ...paths: (string | undefined)[]) =>
    paths.some(
      (path) =>
        path !== undefined && patterns.some((p) => matchesGlob(p, path)),
    );

  const destructive: string[] = [];
  if (!o.baseIsAncestor) destructive.push("rewrites history");
  for (const f of files) {
    if (f.status === "removed") destructive.push(`deletes ${f.path}`);
    else if (
      f.status !== "added" &&
      matches(contract.dataPaths, f.path, f.previousPath)
    )
      destructive.push(`alters persisted data ${f.previousPath ?? f.path}`);
  }

  const wideImpact: string[] = [];
  if (!o.complete) wideImpact.push("changed file list is incomplete");
  if (files.length > contract.maxFiles)
    wideImpact.push(
      `changes ${files.length} files, over the limit of ${contract.maxFiles}`,
    );
  if (lines > contract.maxLines)
    wideImpact.push(
      `changes ${lines} lines, over the limit of ${contract.maxLines}`,
    );
  for (const f of files)
    if (matches(contract.authorityPaths, f.path, f.previousPath))
      wideImpact.push(`touches controller authority ${f.path}`);

  return {
    head: o.head,
    base: o.base,
    contractSha256: changeGateContractSha256(contract),
    gated: destructive.length > 0 || wideImpact.length > 0,
    destructive,
    wideImpact,
    files: files.length,
    lines,
  };
}
