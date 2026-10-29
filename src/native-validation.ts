import { ownerAdmission, type OwnerAdmission } from "./coding-admission.js";
import {
  fetchNpmCache,
  npmCachePlan,
  npmRegistry,
  type NpmCache,
  type RegistryReader,
} from "./dependency-cache.js";
import {
  validationDigest,
  type ValidationAttempt,
  type ValidationCheck,
  type ValidationEnvironment,
  type ValidationResult,
  type ValidationRuntime,
} from "./isolated-validation.js";

/** Exact measurements a live validation transport must still present. */
export interface ValidationPins {
  /** Image ID of the owner-loaded image every check runs in. */
  imageSha256: string;
  /** Digest of the trusted guest management program. */
  policySha256: string;
  /** Digest of the host, engine, VM and authority binding. */
  bindingSha256: string;
}
export const validationPinFields = Object.freeze([
  "imageSha256",
  "policySha256",
  "bindingSha256",
] as const);
const sha256 = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function validValidationPins(pins: ValidationPins): boolean {
  return Boolean(
    pins &&
      typeof pins === "object" &&
      validationPinFields.every((field) => sha256(pins[field])),
  );
}

/** The only network policy this slice enforces: none. Checks get no
 * network, registry or cache; dependency installs are out of scope. */
export const offlineValidationNetworkPolicy = Object.freeze({
  version: 1,
  network: "none",
  registries: Object.freeze([]),
  caches: Object.freeze([]),
});
export const offlineValidationNetworkPolicySha256 = validationDigest(
  offlineValidationNetworkPolicy,
);
/** The prepared npm cache policy (owner decisions, 29 October): still no
 * network in any container; the one declared registry is reached only by
 * the host, for the tarballs the candidate's lockfile pins. */
export const preparedNpmValidationNetworkPolicy = Object.freeze({
  version: 1,
  network: "none",
  registries: Object.freeze([npmRegistry]),
  caches: Object.freeze(["prepared-npm"]),
});
/** The environment an owner contract declares for checks that install the
 * candidate's npm dependencies offline from a prepared cache. */
export function preparedNpmValidationEnvironment(
  imageSha256: string,
): ValidationEnvironment {
  return {
    ...offlineValidationEnvironment(imageSha256),
    networkPolicySha256: validationDigest(preparedNpmValidationNetworkPolicy),
    registries: [npmRegistry],
    caches: ["prepared-npm"],
  };
}
/** The environment an owner contract must declare to use this runtime. */
export function offlineValidationEnvironment(
  imageSha256: string,
): ValidationEnvironment {
  if (!sha256(imageSha256)) throw Error("Invalid validation image");
  return {
    imageSha256,
    networkPolicySha256: offlineValidationNetworkPolicySha256,
    registries: [],
    caches: [],
    browser: false,
    database: false,
    synthetic: true,
  };
}

/** A private, owner-written per-host record admitting one live validation
 * transport at exactly these pins. It is separate from coding admission. */
export type ValidationAdmission = OwnerAdmission<ValidationPins>;
export function ownerValidationAdmission(
  path: string,
  options: { clock?: () => number } = {},
): ValidationAdmission {
  return ownerAdmission(
    path,
    {
      scope: "aios-native-validation-admission-v1",
      label: "validation",
      fields: validationPinFields,
      valid: validValidationPins,
    },
    options,
  );
}

/** An attempt's prepared npm cache: the verified `<sha512>.tgz` files of
 * one plan, installed offline once before the attempt's first check. */
export interface ValidationDependencies {
  planSha256: string;
  files: { path: string; bytes: Buffer }[];
  installTimeoutMs: number;
}
/** The attempt's install: a layer digest when installed, else why not. */
export interface ValidationInstall {
  state: "installed" | "failed";
  exitCode: number;
  timedOut: boolean;
  layerSha256: string | null;
}
/** One check of one attempt, as data. The transport binds the attempt to
 * `treeSha256` and to a manifest digest of exactly these `files`, which it
 * materializes once; each check starts from a fresh copy of them. */
export interface ValidationRunRequest {
  operationId: string;
  fence: number;
  treeSha256: string;
  files: { path: string; bytes: Buffer; executable: boolean }[];
  check: { id: string; command: string[]; timeoutMs: number };
  /** With these, each check also sees the installed layer, read-only. */
  dependencies?: ValidationDependencies;
  /** Checked before every effect; false stops dispatch and polling. */
  mayDispatch(): boolean;
}
export interface ValidationRunResult {
  operationId: string;
  fence: number;
  checkId: string;
  exitCode: number;
  /** True when the guest's own deadline ended the check. */
  timedOut: boolean;
  pins: ValidationPins;
  /** For a request with dependencies. A failed install ends the check
   * unrun, reporting the install's exit and deadline instead. */
  dependencies?: ValidationInstall;
}
/** Trusted isolated management boundary for validation checks. */
export interface IsolatedValidationTransport {
  readonly mode: "controlled" | "live";
  inspect(): Promise<ValidationPins>;
  run(request: ValidationRunRequest): Promise<ValidationRunResult>;
  /** Fences the attempt, stops every check and measures the final tree. */
  stop(attempt: { operationId: string; fence: number }): Promise<{
    operationId: string;
    fence: number;
    stopped: boolean;
    remainingProcesses: number;
    treeSha256: string;
  }>;
}

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
/** A check's id, argv and timeout within the owner contract's bounds. Both
 * the runtime and the native transport re-check them at their boundaries. */
export function validCheckBounds(check: {
  id: unknown;
  command: unknown;
  timeoutMs: unknown;
}): boolean {
  return (
    !!check &&
    typeof check.id === "string" &&
    check.id.length > 0 &&
    check.id.length <= 2000 &&
    Array.isArray(check.command) &&
    check.command.length >= 1 &&
    check.command.length <= 32 &&
    check.command.every(
      (arg) =>
        typeof arg === "string" &&
        arg.length > 0 &&
        arg.length <= 2000 &&
        !/[\u0000-\u001f\u007f]/.test(arg),
    ) &&
    Number.isSafeInteger(check.timeoutMs) &&
    (check.timeoutMs as number) >= 1 &&
    (check.timeoutMs as number) <= 120000
  );
}

/** Offline validation over a pinned transport. A controlled transport is the
 * test seam; a live one runs only while the owner's validation record names
 * its exact pins. Production delivery stays disabled either way. */
export class PinnedValidationRuntime implements ValidationRuntime {
  readonly mode = "controlled" as const;
  readonly pins: ValidationPins;
  readonly bindingSha256: string;
  private readonly environment: ValidationEnvironment;
  /** Each attempt's prepared cache, fetched once on the host. */
  private readonly caches = new Map<string, Promise<NpmCache>>();
  constructor(
    pins: ValidationPins,
    private readonly transport: IsolatedValidationTransport,
    private readonly admission?: ValidationAdmission,
    /** With a registry reader, checks install the candidate's npm
     * dependencies offline from a prepared cache. */
    private readonly dependencies?: { reader: RegistryReader },
  ) {
    this.pins = Object.freeze({
      imageSha256: pins?.imageSha256,
      policySha256: pins?.policySha256,
      bindingSha256: pins?.bindingSha256,
    });
    if (!validValidationPins(this.pins) || !this.admitted())
      throw Error("Unqualified validation transport");
    this.environment = dependencies
      ? preparedNpmValidationEnvironment(this.pins.imageSha256)
      : offlineValidationEnvironment(this.pins.imageSha256);
    this.bindingSha256 = validationDigest({
      scope: "aios-native-validation-runtime-v1",
      pins: this.pins,
    });
    Object.freeze(this.environment);
  }
  /** The transport is controlled, or the owner record still names these pins. */
  private admitted(): boolean {
    if (this.transport.mode === "controlled") return !this.admission;
    if (this.transport.mode !== "live" || !this.admission) return false;
    try {
      const admitted = this.admission.pins();
      return validationPinFields.every(
        (field) => admitted[field] === this.pins[field],
      );
    } catch {
      return false;
    }
  }
  private same(observed: ValidationPins | undefined): boolean {
    return (
      !!observed &&
      validationPinFields.every((field) => observed[field] === this.pins[field])
    );
  }
  async inspect() {
    if (!this.admitted() || !this.same(await this.transport.inspect()))
      throw Error("Validation binding changed");
    return {
      mode: this.mode,
      bindingSha256: this.bindingSha256,
      environment: structuredClone(this.environment),
    };
  }
  async execute(
    request: ValidationAttempt & {
      check: ValidationCheck;
      files: { path: string; bytes: Buffer; executable: boolean }[];
      mayDispatch(): boolean;
    },
  ): Promise<ValidationResult> {
    const { mayDispatch, check } = request;
    if (
      !this.admitted() ||
      request.bindingSha256 !== this.bindingSha256 ||
      request.environmentSha256 !== validationDigest(this.environment) ||
      !uuid.test(String(request.operationId)) ||
      !Number.isSafeInteger(request.fence) ||
      request.fence < 1 ||
      !sha256(request.treeSha256) ||
      !Array.isArray(request.files) ||
      check?.scope !== "local" ||
      !validCheckBounds(check) ||
      typeof mayDispatch !== "function" ||
      !this.same(await this.transport.inspect()) ||
      !mayDispatch()
    )
      throw Error("Validation execution refused");
    const unrun = (status: "failure" | "cancelled"): ValidationResult => ({
      checkId: check.id,
      status,
      publisher: check.publisher,
      treeSha256: request.treeSha256,
      environmentSha256: request.environmentSha256,
      artifacts: [],
    });
    let cache: NpmCache | undefined;
    if (this.dependencies) {
      // A lockfile that cannot be planned fails the check; a cache that
      // cannot be fetched leaves it unrun.
      const lockfile = request.files.find(
        (file) => file.path === "package-lock.json",
      );
      if (!lockfile) return unrun("failure");
      let plan;
      try {
        plan = npmCachePlan(Buffer.from(lockfile.bytes));
      } catch {
        return unrun("failure");
      }
      const key = request.operationId + ":" + plan.planSha256;
      if (!this.caches.has(key))
        this.caches.set(
          key,
          fetchNpmCache(plan, { reader: this.dependencies.reader }),
        );
      try {
        cache = await this.caches.get(key)!;
      } catch {
        this.caches.delete(key);
        return unrun("cancelled");
      }
      if (!this.admitted() || !mayDispatch())
        throw Error("Validation execution refused");
    }
    const run: ValidationRunRequest = Object.freeze({
      operationId: request.operationId,
      fence: request.fence,
      treeSha256: request.treeSha256,
      files: request.files.map((file) => ({
        path: file.path,
        bytes: Buffer.from(file.bytes),
        executable: file.executable,
      })),
      check: Object.freeze({
        id: check.id,
        command: [...check.command],
        timeoutMs: check.timeoutMs,
      }),
      // Every effect needs a fresh record read and the caller's authority.
      mayDispatch: () => this.admitted() && mayDispatch() && this.admitted(),
      ...(cache
        ? {
            dependencies: {
              planSha256: cache.planSha256,
              files: cache.files.map((file) => ({
                path: file.path,
                bytes: Buffer.from(file.bytes),
              })),
              // The controller times each check with its own bound, so the
              // first check's install fits in the same one.
              installTimeoutMs: check.timeoutMs,
            },
          }
        : {}),
    });
    const result = await this.transport.run(run);
    if (
      !result ||
      result.operationId !== run.operationId ||
      result.fence !== run.fence ||
      result.checkId !== check.id ||
      !Number.isSafeInteger(result.exitCode) ||
      result.exitCode < 0 ||
      result.exitCode > 255 ||
      typeof result.timedOut !== "boolean" ||
      !this.same(result.pins) ||
      !this.admitted() ||
      (cache !== undefined) !== (result.dependencies !== undefined) ||
      (result.dependencies !== undefined &&
        !(
          (result.dependencies.state === "installed" &&
            sha256(result.dependencies.layerSha256)) ||
          (result.dependencies.state === "failed" &&
            result.dependencies.layerSha256 === null)
        ))
    )
      throw Error("Untrusted validation result");
    // A failed install fails the unrun check whatever npm exited with: a
    // clean exit can still leave a layer that could not be admitted.
    const installFailed = result.dependencies?.state === "failed";
    return {
      checkId: check.id,
      status: result.timedOut
        ? "timeout"
        : result.exitCode === 0 && !installFailed
          ? "success"
          : "failure",
      publisher: check.publisher,
      treeSha256: request.treeSha256,
      environmentSha256: request.environmentSha256,
      // The installed layer, as evidence beside the tested tree.
      artifacts: result.dependencies?.layerSha256
        ? [
            { name: "npm-cache-plan", sha256: cache!.planSha256 },
            {
              name: "npm-dependency-layer",
              sha256: result.dependencies.layerSha256,
            },
          ]
        : [],
    };
  }
  async stop(attempt: ValidationAttempt) {
    for (const key of this.caches.keys())
      if (key.startsWith(attempt.operationId + ":")) this.caches.delete(key);
    // Always attempt exact-attempt shutdown, even when pins or the record
    // changed. A receipt is trusted only after a fresh independent inspection.
    const receipt = {
      ...(await this.transport.stop({
        operationId: attempt.operationId,
        fence: attempt.fence,
      })),
    };
    if (!this.admitted() || !this.same(await this.transport.inspect()))
      throw Error("Validation management binding changed");
    return receipt;
  }
}
