import { dirname, join } from "node:path";
import { lstatSync, readFileSync } from "node:fs";
import {
  candidateDigest,
  candidateOutput,
  type FeatureEvidence,
} from "./feature-candidate.js";
import { redact } from "./redaction.js";
import { autoRunPath } from "./workspace.js";

export type ValidationStage = "baseline" | "candidate";
export type CheckStatus =
  | "success"
  | "failure"
  | "missing"
  | "pending"
  | "skipped"
  | "neutral"
  | "cancelled"
  | "timeout";
export interface ValidationEnvironment {
  imageSha256: string;
  networkPolicySha256: string;
  registries: string[];
  caches: string[];
  browser: boolean;
  database: boolean;
  synthetic: true;
}
export interface ValidationCheck {
  id: string;
  kind:
    | "format"
    | "lint"
    | "type"
    | "coverage"
    | "build"
    | "acceptance"
    | "e2e";
  scope: "local" | "pr" | "main";
  stages: ValidationStage[];
  command: string[];
  publisher: string;
  workflow?: string;
  timeoutMs: number;
  exception?: { statuses: CheckStatus[]; reason: string };
  flake?: { allowDiagnosticPass: true; reason: string };
}
export interface ValidationContract {
  version: 1;
  environment: ValidationEnvironment;
  checks: ValidationCheck[];
  /** Exact application paths only; all validation inputs remain immutable. */
  mutablePaths: string[];
}
export interface ValidationResult {
  checkId: string;
  status: CheckStatus;
  publisher: string;
  treeSha256: string;
  environmentSha256: string;
  artifacts: { name: string; sha256: string }[];
}
export interface ValidationAttempt {
  operationId: string;
  fence: number;
  stage: ValidationStage;
  sourceRevision: string;
  treeSha256: string;
  policySha256: string;
  contractSha256: string;
  criteriaSha256: string;
  environmentSha256: string;
  bindingSha256: string;
  state: "running" | "stopped" | "uncertain";
  outcome:
    | "pending"
    | "passed"
    | "failed"
    | "incomplete"
    | "flaky"
    | "timeout"
    | "stale";
  startedAt: string;
  results: ValidationResult[];
  contract: ValidationContract;
}
export interface ValidationEvidence {
  attempts: ValidationAttempt[];
}
/** Trusted isolated management boundary, never selected by candidate text. No
 * native executor is installed. Each execute must honor the dispatch fence and
 * command timeout; dependencies, browser/database fixtures and scripts stay in
 * the declared isolated environment. stop fences late dispatch and measures the
 * final tree only after every descendant is quiescent. */
export interface ValidationRuntime {
  readonly mode: "controlled";
  readonly bindingSha256: string;
  inspect(): Promise<{
    mode: "controlled";
    bindingSha256: string;
    environment: ValidationEnvironment;
  }>;
  execute(
    request: ValidationAttempt & {
      check: ValidationCheck;
      files: { path: string; bytes: Buffer; executable: boolean }[];
      mayDispatch(): boolean;
    },
  ): Promise<ValidationResult>;
  stop(request: ValidationAttempt): Promise<{
    operationId: string;
    fence: number;
    stopped: boolean;
    remainingProcesses: number;
    treeSha256: string;
  }>;
}
const hash = (v: unknown): v is string =>
  typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const text = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= 2000 &&
  !/[\u0000-\u001f\u007f]/.test(v) &&
  redact(v) === v;
export function validationDigest(value: unknown): string {
  return candidateDigest(JSON.stringify(value));
}
export function validationContract(
  path: string | undefined,
  expected: string | undefined,
): ValidationContract {
  if (!path || !expected) throw Error("Missing owner validation contract");
  const st = lstatSync(path);
  if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || st.size > 65536)
    throw Error("Unsafe owner validation contract");
  const bytes = readFileSync(path);
  if (candidateDigest(bytes) !== expected)
    throw Error("Changed owner validation contract");
  const owner = JSON.parse(bytes.toString());
  const c = owner.validationContract as ValidationContract | undefined;
  if (
    !c ||
    c.version !== 1 ||
    !c.environment ||
    !Array.isArray(c.mutablePaths) ||
    c.mutablePaths.length > 256 ||
    !c.mutablePaths.every(
      (p) =>
        text(p) &&
        !p.startsWith("/") &&
        !p.includes("\\") &&
        !autoRunPath(p) &&
        p
          .split("/")
          .every((part) => part !== "." && part !== ".." && part !== ""),
    ) ||
    !Array.isArray(c.checks) ||
    !c.checks.length ||
    c.checks.length > 64
  )
    throw Error("Invalid owner validation contract");
  const e = c.environment;
  if (
    !hash(e.imageSha256) ||
    !hash(e.networkPolicySha256) ||
    e.synthetic !== true ||
    typeof e.browser !== "boolean" ||
    typeof e.database !== "boolean" ||
    !Array.isArray(e.registries) ||
    !Array.isArray(e.caches) ||
    e.registries.length > 16 ||
    e.caches.length > 16 ||
    ![...e.registries, ...e.caches].every(text)
  )
    throw Error("Invalid validation environment");
  for (const registry of e.registries) {
    const u = new URL(registry);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.search ||
      u.hash
    )
      throw Error("Invalid registry");
  }
  const ids = new Set<string>();
  const checks = c.checks.map((check) => {
    const timeout =
      check.timeoutMs ?? (check.scope === "local" ? NaN : 3600000);
    if (
      !text(check.id) ||
      !text(check.publisher) ||
      ids.has(check.id) ||
      ![
        "format",
        "lint",
        "type",
        "coverage",
        "build",
        "acceptance",
        "e2e",
      ].includes(check.kind) ||
      !["local", "pr", "main"].includes(check.scope) ||
      !Array.isArray(check.stages) ||
      !check.stages.length ||
      !check.stages.every((s) => s === "baseline" || s === "candidate") ||
      !Array.isArray(check.command) ||
      !check.command.length ||
      check.command.length > 32 ||
      !check.command.every(text) ||
      !Number.isSafeInteger(timeout) ||
      timeout < 1 ||
      timeout > (check.scope === "local" ? 120000 : 86400000) ||
      (check.workflow !== undefined && !text(check.workflow))
    )
      throw Error("Invalid validation check");
    ids.add(check.id);
    if (
      check.exception &&
      (!text(check.exception.reason) ||
        !Array.isArray(check.exception.statuses) ||
        !check.exception.statuses.length ||
        !check.exception.statuses.every((s) =>
          ["missing", "pending", "skipped", "neutral", "cancelled"].includes(s),
        ))
    )
      throw Error("Invalid validation exception");
    if (
      check.flake &&
      (check.flake.allowDiagnosticPass !== true || !text(check.flake.reason))
    )
      throw Error("Invalid flake policy");
    return {
      id: check.id,
      kind: check.kind,
      scope: check.scope,
      stages: [...check.stages],
      command: [...check.command],
      publisher: check.publisher,
      timeoutMs: timeout,
      ...(check.workflow ? { workflow: check.workflow } : {}),
      ...(check.exception
        ? {
            exception: {
              statuses: [...check.exception.statuses],
              reason: check.exception.reason,
            },
          }
        : {}),
      ...(check.flake
        ? {
            flake: {
              allowDiagnosticPass: true as const,
              reason: check.flake.reason,
            },
          }
        : {}),
    };
  });
  if (
    !checks.some((c) => c.scope === "pr") ||
    !checks.some((c) => c.scope === "main") ||
    !Array.isArray(owner.requiredChecks) ||
    !owner.requiredChecks.every((name: unknown) =>
      checks.some((c) => c.scope === "pr" && c.id === name),
    )
  )
    throw Error("Required hosted PR/main checks are undeclared");
  for (const stage of ["baseline", "candidate"] as const)
    for (const kind of [
      "format",
      "lint",
      "type",
      "coverage",
      "build",
      ...(stage === "candidate" ? ["acceptance"] : []),
    ])
      if (
        !checks.some(
          (c) =>
            c.scope === "local" && c.stages.includes(stage) && c.kind === kind,
        )
      )
        throw Error("Required local validation is undeclared");
  if (
    (e.browser || e.database) &&
    !checks.some(
      (c) =>
        c.scope === "local" &&
        c.kind === "e2e" &&
        c.stages.includes("candidate"),
    )
  )
    throw Error("Synthetic E2E validation is undeclared");
  return {
    version: 1,
    mutablePaths: [...c.mutablePaths],
    environment: {
      imageSha256: e.imageSha256,
      networkPolicySha256: e.networkPolicySha256,
      registries: [...e.registries],
      caches: [...e.caches],
      browser: e.browser,
      database: e.database,
      synthetic: true,
    },
    checks,
  };
}
export function validationResult(
  value: ValidationResult,
  check: ValidationCheck,
  attempt: ValidationAttempt,
): ValidationResult {
  if (
    !value ||
    value.checkId !== check.id ||
    value.publisher !== check.publisher ||
    value.treeSha256 !== attempt.treeSha256 ||
    value.environmentSha256 !== attempt.environmentSha256 ||
    ![
      "success",
      "failure",
      "missing",
      "pending",
      "skipped",
      "neutral",
      "cancelled",
      "timeout",
    ].includes(value.status) ||
    !Array.isArray(value.artifacts) ||
    value.artifacts.length > 32 ||
    !value.artifacts.every((a) => text(a.name) && hash(a.sha256))
  )
    throw Error("Untrusted validation evidence");
  return {
    checkId: value.checkId,
    status: value.status,
    publisher: value.publisher,
    treeSha256: value.treeSha256,
    environmentSha256: value.environmentSha256,
    artifacts: value.artifacts.map((a) => ({ name: a.name, sha256: a.sha256 })),
  };
}

export function validationCandidate(
  feature: FeatureEvidence,
  stateDirectory: string,
) {
  const candidate = feature.candidate;
  if (
    !candidate ||
    dirname(candidate.path) !== join(stateDirectory, "artifacts")
  )
    throw Error("Missing admitted candidate");
  const st = lstatSync(candidate.path);
  if (
    !st.isFile() ||
    st.isSymbolicLink() ||
    st.nlink !== 1 ||
    st.size > 192 * 1024 * 1024
  )
    throw Error("Unsafe candidate artifact");
  const bytes = readFileSync(candidate.path);
  if (candidateDigest(bytes) !== candidate.sha256)
    throw Error("Candidate artifact changed");
  const entries = JSON.parse(bytes.toString()) as {
    path: string;
    bytes: string;
    sha256: string;
    executable: boolean;
  }[];
  if (!Array.isArray(entries)) throw Error("Invalid candidate artifact");
  const files = entries.map((f) => ({
    path: f.path,
    bytes: Buffer.from(f.bytes, "base64"),
    executable: f.executable,
    ordinary: true,
    links: 1,
    beforeSha256: f.sha256,
    afterSha256: f.sha256,
  }));
  if (
    candidateOutput({
      operationId: "validation",
      fence: 0,
      complete: true,
      files,
    }) !== bytes.toString()
  )
    throw Error("Noncanonical candidate artifact");
  return {
    digest: candidate.sha256,
    files: files.map((f) => ({
      path: f.path,
      bytes: f.bytes,
      executable: f.executable,
    })),
  };
}
export function validationCriteria(feature: FeatureEvidence): string {
  return validationDigest({
    criteria: feature.criteria,
    verification: feature.verification,
    requires: feature.requires ?? [],
  });
}
export function passedBaseline(
  evidence: ValidationEvidence | undefined,
  treeSha256: string,
  sourceRevision: string,
  policySha256: string | undefined | null,
  criteriaSha256: string,
  bindingSha256: string | undefined,
): boolean {
  const attempt = evidence?.attempts
    .filter((a) => a.stage === "baseline")
    .at(-1);
  return (
    !!attempt &&
    attempt.state === "stopped" &&
    attempt.outcome === "passed" &&
    attempt.treeSha256 === treeSha256 &&
    attempt.sourceRevision === sourceRevision &&
    attempt.policySha256 === policySha256 &&
    attempt.criteriaSha256 === criteriaSha256 &&
    attempt.bindingSha256 === bindingSha256
  );
}

export function validationOutcome(
  attempt: ValidationAttempt,
  previous: ValidationAttempt[],
): ValidationAttempt["outcome"] {
  const checks = attempt.contract.checks.filter(
    (c) => c.scope === "local" && c.stages.includes(attempt.stage),
  );
  const allowed = (c: ValidationCheck, r: ValidationResult | undefined) =>
    !!r &&
    (r.status === "success" || !!c.exception?.statuses.includes(r.status));
  if (checks.some((c) => !attempt.results.some((r) => r.checkId === c.id)))
    return "incomplete";
  if (
    checks.some(
      (c) =>
        !allowed(
          c,
          attempt.results.find((r) => r.checkId === c.id),
        ),
    )
  )
    return "failed";
  for (const prior of previous) {
    if (prior.outcome === "passed") continue;
    if (
      prior.outcome !== "failed" ||
      checks.some((c) => {
        const r = prior.results.find((r) => r.checkId === c.id);
        return (
          !allowed(c, r) &&
          !(r?.status === "failure" && c.flake?.allowDiagnosticPass)
        );
      })
    )
      return "flaky";
  }
  return "passed";
}

/** Owner declares only application files as mutable. Everything else, including
 * additions and executable bits, stays identical to the validated main tree.
 * The owner must exclude the full validator/config/test/dependency closure. */
export function protectValidationInputs(
  contract: ValidationContract,
  baseline: { path: string; bytes: Buffer; executable: boolean }[],
  candidate: { path: string; bytes: Buffer; executable: boolean }[],
): void {
  const protectedFiles = (files: typeof baseline) =>
    files
      .filter((f) => !contract.mutablePaths.includes(f.path))
      .map((f) => ({
        path: f.path,
        sha256: candidateDigest(f.bytes),
        executable: f.executable,
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  if (
    validationDigest(protectedFiles(baseline)) !==
    validationDigest(protectedFiles(candidate))
  )
    throw Error(
      "Candidate changed protected validation inputs; owner review is required",
    );
}
