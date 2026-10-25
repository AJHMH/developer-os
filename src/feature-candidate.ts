import { realpathSync } from "node:fs";
import { redact } from "./redaction.js";
import type { CodingAdmission } from "./coding-admission.js";
import { gatewayModel } from "./inference-contract.js";

export interface FeaturePlan {
  requires?: ("browser" | "database")[];
  criteria: string[];
  verification: string[];
  ambiguity: string | null;
}
/** Trusted planning boundary. Repository text cannot select privileged effects. */
export interface FeaturePlanner {
  plan(request: string): Promise<FeaturePlan>;
}
export interface FeatureEvidence extends FeaturePlan {
  mode: "controlled";
  outcome:
    | "planned"
    | "needs-info"
    | "coding"
    | "failed"
    | "exhausted"
    | "uncertain"
    | "admitted";
  sourceRevision?: string;
  branch?: string;
  pins?: CodingPins;
  session?: CodingSession;
  candidate?: {
    path: string;
    sha256: string;
    inputSha256: string;
    validation: "not-run" | "passed";
  };
  extensions?: { addedMs: number; at: string }[];
  /** Coding turns stopped because their usage authority lapsed. */
  usageInterruptions?: { operationId: string; at: string }[];
  /** Owner approvals to restart coding after a usage interruption. Each names
   * the interrupted operation and the feature's account. `operationId` is the
   * latest re-dispatch bound to it, and `dispatched` marks the one that
   * reached dispatch, which spends the approval. */
  restartApprovals?: {
    interruptedOperationId: string;
    accountId: string;
    approvedAt: string;
    operationId?: string;
    dispatched?: true;
  }[];
  /** The endorsed usage account of the mediation decision this feature's
   * coding is linked to. */
  mediationUsageAccountId?: string;
  /** The model-only subscription account the first coding launch used. */
  usageAccountId?: string;
  /** Resumes that continued a conversation onto a moved main. */
  baseMoves?: { operationId: string; from: string; to: string; at: string }[];
  /** Owner decisions retiring an unresolved resume lineage. `session` is the
   * retired successor's binding; `cleanedAt` and `cleaned` record the owner's
   * later cleanup of the whole lineage. */
  retirements?: {
    operationId: string;
    at: string;
    session?: CodingSession;
    cleanedAt?: string;
    cleaned?: number;
  }[];
  clarifications?: string[];
  allowanceMs: number;
  activeMs: number;
  activeCheckpoint?: { at: number; runnerId: string };
}
export function featurePlan(plan: FeaturePlan | undefined): FeatureEvidence {
  const texts = (values: unknown): values is string[] =>
    Array.isArray(values) &&
    values.length > 0 &&
    values.length <= 32 &&
    values.every(
      (value) =>
        typeof value === "string" &&
        value.trim() &&
        value.length <= 2000 &&
        !/[\u0000-\u001f\u007f]/.test(value) &&
        redact(value) === value,
    );
  if (
    !plan ||
    (plan.requires !== undefined &&
      (!Array.isArray(plan.requires) ||
        plan.requires.length > 2 ||
        !plan.requires.every((r) => r === "browser" || r === "database"))) ||
    !texts(plan.criteria) ||
    !texts(plan.verification) ||
    (plan.ambiguity !== null && !texts([plan.ambiguity]))
  )
    throw Error("Feature criteria could not be established safely.");
  return {
    ...(plan.requires ? { requires: [...plan.requires] } : {}),
    mode: "controlled",
    criteria: [...plan.criteria],
    verification: [...plan.verification],
    ambiguity: plan.ambiguity,
    outcome: plan.ambiguity ? "needs-info" : "planned",
    allowanceMs: 120 * 60 * 1000,
    activeMs: 0,
  };
}

export interface CodingPins {
  cliVersion: string;
  cliSha256: string;
  /** The code-mode host beside the CLI, from the same package. */
  codeModeHostSha256: string;
  policySha256: string;
  bindingSha256: string;
}
export interface CodingSession {
  operationId: string;
  fence: number;
  state: "running" | "stopped" | "uncertain";
  intent: "start" | "resume";
  threadId?: string;
  /** The exact stopped session whose retained home a resume continues. */
  resumeFrom?: CodingSession;
  /** Durable: this operation's CLI thread was observed starting. */
  threadStarted?: boolean;
  /** Durable: an interrupted resume returned its home to `resumeFrom`, or
   * the owner retired its lineage so coding restarts without resuming. */
  resumeRecovery?: "recovered" | "retired";
  /** The main revision this operation's workspace was built from. */
  sourceRevision?: string;
  /** A resume onto a moved main: the predecessor's revision and this one's. */
  baseMove?: { from: string; to: string };
}
/** The latest usage interruption, unless an owner-approved restart has
 * already dispatched past it. */
export function unrestartedInterruption(feature: FeatureEvidence | undefined) {
  const latest = feature?.usageInterruptions?.at(-1);
  return latest &&
    !feature!.restartApprovals?.some(
      (a) =>
        a.interruptedOperationId === latest.operationId &&
        a.dispatched === true,
    )
    ? latest
    : undefined;
}

/** A resume that stopped without observing its thread may have moved the
 * predecessor's retained home and must be recovered before coding continues. */
export function needsResumeRecovery(session: CodingSession): boolean {
  return (
    session.intent === "resume" &&
    session.state === "stopped" &&
    !!session.resumeFrom &&
    !session.threadStarted &&
    session.resumeRecovery === undefined
  );
}
/** Only the management identity crosses the runtime boundary. */
export function codingBinding(session: CodingSession): CodingSession {
  return {
    operationId: session.operationId,
    fence: session.fence,
    state: session.state,
    intent: session.intent,
    ...(session.threadId ? { threadId: session.threadId } : {}),
    ...(session.resumeFrom
      ? { resumeFrom: codingBinding(session.resumeFrom) }
      : {}),
  };
}
export interface CodingRecovery {
  operationId: string;
  fence: number;
  recovered: true;
}
export type ResumeReconciliation = "adopted" | "retired" | "unresolved";
export const resumeReconciliations: readonly ResumeReconciliation[] = [
  "adopted",
  "retired",
  "unresolved",
];
export interface CodingReconciliation {
  operationId: string;
  fence: number;
  outcome: ResumeReconciliation;
}
/** A retired lineage's session folders and stopped containers were removed;
 * `cleaned` counts its sessions, whose guest records remain as tombstones. */
export interface CodingCleanup {
  operationId: string;
  fence: number;
  cleaned: number;
}
/** ADR 0002: a coding session's only model route, the session relay on the
 * worker's own loopback. The capability is the relay's revocable value, never
 * the host credential, and reaches Codex only through `modelRouteVariable`. */
export interface ModelRoute {
  deliveryId: string;
  capability: string;
  decisionSha256: string;
}
export const modelRoutePort = 18091;
export const modelRouteVariable = "AIOS_MODEL_ROUTE";
export function validModelRoute(route: unknown): route is ModelRoute {
  return (
    !!route &&
    typeof route === "object" &&
    JSON.stringify(Object.keys(route).sort()) ===
      '["capability","decisionSha256","deliveryId"]' &&
    Object.values(route).every((value) => typeof value === "string") &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      (route as ModelRoute).deliveryId,
    ) &&
    /^[a-f0-9]{64}$/.test((route as ModelRoute).capability) &&
    /^[a-f0-9]{64}$/.test((route as ModelRoute).decisionSha256)
  );
}
/** The locked Codex argv before the prompt. Offline turns keep Codex's own
 * workspace-write sandbox. A routed turn runs with full access inside the
 * hardened container, the only sandbox that can start there (ADR 0002
 * amendment), and fixed provider overrides with no config file. */
export function lockedCodingArgv(
  threadId: string | undefined,
  route?: ModelRoute,
): string[] {
  const sandbox = route ? "danger-full-access" : "workspace-write";
  const provider = "model_providers.aios.";
  const overrides = route
    ? [
        'model_provider="aios"',
        `${provider}name="AIOS session relay"`,
        `${provider}base_url="http://127.0.0.1:${modelRoutePort}/v1"`,
        `${provider}env_key="${modelRouteVariable}"`,
        `${provider}wire_api="responses"`,
        `${provider}requires_openai_auth=false`,
        `${provider}supports_websockets=false`,
        `${provider}http_headers.X-AIOS-Delivery="${route.deliveryId}"`,
        `model="${gatewayModel}"`,
      ].flatMap((value) => ["-c", value])
    : [];
  // `exec resume` has no --sandbox flag; pin the same mode by explicit override.
  return threadId
    ? [
        "exec",
        "resume",
        "--json",
        "--skip-git-repo-check",
        "-c",
        `sandbox_mode="${sandbox}"`,
        ...overrides,
        threadId,
      ]
    : [
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--sandbox",
        sandbox,
        ...overrides,
      ];
}

export interface CodingRequest extends CodingSession {
  baseRefresh?: {
    from: {
      revision: string;
      files: { path: string; bytes: Buffer; executable: boolean }[];
    };
    to: {
      revision: string;
      files: { path: string; bytes: Buffer; executable: boolean }[];
    };
  };
  argv: string[];
  branch: string;
  sourceRevision: string;
  inputSha256: string;
  onEvent(event: unknown): boolean;
  files: { path: string; bytes: Buffer; executable: boolean }[];
  pins: CodingPins;
  /** Present only for a mediated general session (ADR 0002). */
  modelRoute?: ModelRoute;
  allowanceMs: number;
  mayDispatch(): boolean;
  checkpoint(): boolean;
}
export interface CodingResult {
  operationId: string;
  fence: number;
  exitCode: number;
  events: unknown[];
}
export interface CodingCollection {
  complete: boolean;
  operationId: string;
  fence: number;
  files: {
    path: string;
    bytes: Buffer;
    ordinary: boolean;
    links: number;
    beforeSha256: string;
    afterSha256: string;
    executable?: boolean;
  }[];
}
/** Controlled host boundary for ticket 05. No production coding adapter is
 * installed. An adapter must transfer plain files to an isolated worker, honor
 * the dispatch/active-time gates, execute the exact pinned CLI, preserve explicit
 * sessions, stop every descendant and collect only through stopped management.
 * Synthetic observations never establish native qualification or provider access. */
export interface FeatureRuntime {
  readonly mode: "controlled";
  readonly pins: CodingPins;
  execute(request: CodingRequest): Promise<CodingResult>;
  /** Return a home stranded by an interrupted, never-launched resume. */
  recover?(
    session: CodingSession,
    resumeFrom: CodingSession,
  ): Promise<CodingRecovery>;
  /** Settle a launched resume by the guest's own thread record; `retire` is
   * the owner's explicit decision to quarantine an unresolved lineage. */
  reconcile?(
    session: CodingSession,
    resumeFrom: CodingSession,
    retire: boolean,
  ): Promise<CodingReconciliation>;
  /** Remove a retired lineage's session folders and stopped containers on
   * the owner's explicit decision; guest records stay as tombstones. */
  cleanup?(session: CodingSession): Promise<CodingCleanup>;
  stop(session: CodingSession): Promise<{
    operationId: string;
    fence: number;
    stopped: boolean;
    remainingProcesses: number;
  }>;
  collect(session: CodingSession): Promise<CodingCollection>;
}

export const codingPinFields = Object.freeze([
  "cliVersion",
  "cliSha256",
  "codeModeHostSha256",
  "policySha256",
  "bindingSha256",
] as const);
/** While a turn streams, a record read this recently still admits it. */
const admissionStreamMaxAgeMs = 1000;

export function validCodingPins(pins: CodingPins): boolean {
  return Boolean(
    pins &&
      /^\d+\.\d+\.\d+$/.test(pins.cliVersion) &&
      [
        pins.cliSha256,
        pins.codeModeHostSha256,
        pins.policySha256,
        pins.bindingSha256,
      ].every((x) => /^[a-f0-9]{64}$/.test(x)),
  );
}
export function codingTurn(
  result: CodingResult,
  expectedThread?: string,
): { threadId: string; completed: boolean } {
  if (
    !Array.isArray(result.events) ||
    result.events.length > 4096 ||
    Buffer.byteLength(JSON.stringify(result.events)) > 65536
  )
    throw Error("Invalid coding events");
  let thread: string | undefined,
    started = false,
    terminal = false,
    completed = false;
  for (const item of result.events) {
    if (!item || typeof item !== "object" || terminal)
      throw Error("Invalid coding ordering");
    const event = item as Record<string, unknown>;
    if (event.type === "thread.started") {
      if (
        thread ||
        started ||
        typeof event.thread_id !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
          event.thread_id,
        ) ||
        (expectedThread && expectedThread !== event.thread_id)
      )
        throw Error("Invalid coding session");
      thread = event.thread_id;
    } else if (event.type === "turn.started") {
      if (!thread || started) throw Error("Invalid coding turn");
      started = true;
    } else if (
      event.type === "turn.completed" ||
      event.type === "turn.failed"
    ) {
      if (!started) throw Error("Invalid coding completion");
      terminal = true;
      completed = event.type === "turn.completed" && result.exitCode === 0;
    } else if (
      ["item.started", "item.updated", "item.completed"].includes(
        String(event.type),
      )
    ) {
      const value = event.item as Record<string, unknown> | undefined;
      if (
        !started ||
        !value ||
        ![
          "agent_message",
          "reasoning",
          "command_execution",
          "file_change",
          "todo_list",
        ].includes(String(value.type))
      )
        throw Error("Unsupported coding item");
    } else throw Error("Unsupported coding event");
  }
  if (!thread) throw Error("Missing coding session");
  return { threadId: thread, completed };
}

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { admitFiles, admittedPath } from "./workspace.js";
import { hostGitCwd } from "./host-git.js";
import type { SessionGateway } from "./session-relay.js";
export const candidateDigest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
/** The ambient environment without any GIT_* input, plus fixed settings. It
 * is built on first use and reused: reading every variable of `process.env`
 * costs as much as starting git itself, and a variable set later never
 * reaches git, so GIT_* input stays excluded. */
let candidateEnvironment: Readonly<Record<string, string | undefined>>;
function candidateGitEnvironment() {
  return (candidateEnvironment ??= Object.freeze({
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !key.toUpperCase().startsWith("GIT_"),
      ),
    ),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_OPTIONAL_LOCKS: "0",
  }));
}
/** One hardened git process: no hooks, fsmonitor or attribute files, no
 * ambient GIT_* input, and a trusted working directory. */
function candidateGitProcess(repository: string, args: string[]) {
  const env = candidateGitEnvironment();
  return spawnSync(
    "git",
    [
      "-c",
      "core.hooksPath=" + (process.platform === "win32" ? "NUL" : "/dev/null"),
      "-c",
      "core.fsmonitor=false",

      "-c",
      "core.untrackedCache=false",
      "-c",
      "core.attributesFile=" +
        (process.platform === "win32" ? "NUL" : "/dev/null"),
      "-C",
      repository,
      ...args,
    ],
    {
      env,
      cwd: hostGitCwd,
      timeout: 5000,
      maxBuffer: 128 * 1024 * 1024,
      windowsHide: true,
    },
  );
}
function candidateGit(repository: string, args: string[]): Buffer {
  const result = candidateGitProcess(repository, args);
  if (result.status !== 0)
    throw Error("Candidate repository observation failed");
  return result.stdout;
}
export function candidateSource(repository: string, expected?: string) {
  return observedSource(repository, expected);
}
/** One observation of a clean checkout. With `mainBranch`, the same rev-parse
 * that reads HEAD also reads that branch, which must name the same commit. */
function observedSource(
  repository: string,
  expected?: string,
  mainBranch?: string,
) {
  // status may run clean/process filters. Reject helper/include declarations
  // before any working-tree observation can start a helper.
  // candidateGit excludes system/global configuration and ambient GIT_* input.
  // The complete list retains local and worktree declarations (even overridden
  // ones), plus our fixed command options; includes remain disabled.
  const configuration = candidateGit(repository, [
    "config",
    "--no-includes",
    "--null",
    "--list",
  ])
    .toString()
    .split("\0");
  if (
    configuration.some((entry) =>
      /^(?:filter\..+\.(?:clean|smudge|process)|include(?:if\..+)?\.path)\n/i.test(
        entry,
      ),
    )
  )
    throw Error("Unreviewed Git helpers are forbidden");

  const identity = candidateGit(repository, [
    "rev-parse",
    "--show-toplevel",
    "HEAD",
    // `--` makes rev-parse refuse anything that is not a revision.
    ...(mainBranch === undefined ? [] : ["refs/heads/" + mainBranch, "--"]),
  ])
    .toString()
    .trimEnd()
    .split("\n");
  // Read from the end so an embedded newline in the root survives.
  if (mainBranch !== undefined) {
    // The echoed `--`, then the branch's commit, then HEAD's.
    identity.pop();
    if (identity.pop() !== identity.at(-1))
      throw Error("Baseline must be unchanged main");
  }
  const revision = identity.pop()!;
  const top = identity.join("\n").trim();
  if (
    (process.platform === "win32"
      ? realpathSync.native(top).toLowerCase()
      : realpathSync.native(top)) !==
    (process.platform === "win32"
      ? realpathSync.native(repository).toLowerCase()
      : realpathSync.native(repository))
  )
    throw Error("Changed Git worktree root");
  if (
    !/^[a-f0-9]{40}$/.test(revision) ||
    (expected && expected !== revision) ||
    candidateGit(repository, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ]).length
  )
    throw Error("Preserve changed repository work before coding");
  const entries = candidateGit(repository, ["ls-tree", "-r", "-z", revision])
    .toString()
    .split("\0")
    .filter(Boolean);
  const manifest = entries.map((entry) => {
    const match = entry.match(/^(100644|100755) blob [a-f0-9]{40}\t(.+)$/s);
    if (
      !match ||
      !admittedPath(match[2]!) ||
      /(?:^|\/)\.git(?:config|modules|attributes)$/i.test(match[2]!)
    )
      throw Error("Unsafe source entry");
    const path = match[2]!,
      bytes = candidateGit(repository, [
        "cat-file",
        "blob",
        revision + ":" + path,
      ]);
    return {
      path,
      sha256: candidateDigest(bytes),
      executable: match[1] === "100755",
    };
  });
  const files = admitFiles({ files: manifest }, repository).map(
    (file, index) => ({ ...file, executable: manifest[index]!.executable }),
  );
  return { revision, files, digest: candidateDigest(JSON.stringify(manifest)) };
}
/** Read an immutable previous baseline after a clean current source was verified. */
export function candidateRevisionFiles(repository: string, revision: string) {
  if (!/^[a-f0-9]{40}$/.test(revision))
    throw Error("Invalid baseline revision");
  const entries = candidateGit(repository, ["ls-tree", "-r", "-z", revision])
    .toString()
    .split("\0")
    .filter(Boolean);
  let total = 0;
  const paths = new Set<string>();
  if (entries.length > 10000) throw Error("Oversized baseline");
  return entries.map((entry) => {
    const match = entry.match(/^(100644|100755) blob [a-f0-9]{40}\t(.+)$/s);
    if (
      !match ||
      !admittedPath(match[2]!) ||
      /(?:^|\/)\.git(?:config|modules|attributes)$/i.test(match[2]!)
    )
      throw Error("Unsafe baseline entry");
    const path = match[2]!,
      key = path.normalize("NFC").toLowerCase();
    if (paths.has(key)) throw Error("Ambiguous baseline path");
    paths.add(key);
    const bytes = candidateGit(repository, [
      "cat-file",
      "blob",
      revision + ":" + path,
    ]);
    if (
      bytes.length > 16 * 1024 * 1024 ||
      (total += bytes.length) > 128 * 1024 * 1024
    )
      throw Error("Oversized baseline");
    return { path, bytes, executable: match[1] === "100755" };
  });
}
export function featureBranch(
  repository: string,
  branch: string,
  revision: string,
) {
  const current = candidateGitProcess(repository, [
    "rev-parse",
    "--verify",
    "refs/heads/" + branch,
  ]);
  if (current.status === 0) {
    if (current.stdout.toString().trim() !== revision)
      throw Error("Feature branch changed");
  } else
    candidateGit(repository, [
      "update-ref",
      "refs/heads/" + branch,
      revision,
      "0".repeat(40),
    ]);
}
/** The earlier main the feature branch must advance from to reach
 * `revision`, or undefined when it already points there or doesn't exist yet.
 * A branch with its own commits, or a main that moved backwards, refuses. */
export function featureBranchAdvance(
  repository: string,
  branch: string,
  revision: string,
): string | undefined {
  const current = candidateGitProcess(repository, [
    "rev-parse",
    "--verify",
    "refs/heads/" + branch,
  ]);
  const previous = current.stdout?.toString().trim();
  if (current.status !== 0 || previous === revision) return undefined;
  if (
    !/^[a-f0-9]{40}$/.test(previous) ||
    candidateGitProcess(repository, [
      "merge-base",
      "--is-ancestor",
      previous,
      revision,
    ]).status !== 0
  )
    throw Error("Feature branch changed");
  return previous;
}
/** Before any candidate exists, move the feature branch from an earlier main
 * to the current one with a compare-and-swap. */
export function advanceFeatureBranch(
  repository: string,
  branch: string,
  revision: string,
) {
  const previous = featureBranchAdvance(repository, branch, revision);
  if (previous)
    candidateGit(repository, [
      "update-ref",
      "refs/heads/" + branch,
      revision,
      previous,
    ]);
}
export function candidateOutput(receipt: CodingCollection): string {
  if (
    receipt.complete !== true ||
    !Array.isArray(receipt.files) ||
    receipt.files.length === 0 ||
    receipt.files.length > 10000
  )
    throw Error("Invalid output");
  const paths = new Set<string>();
  let total = 0;
  const files = receipt.files.map((file) => {
    if (
      !admittedPath(file.path) ||
      /(?:^|\/)\.git(?:config|modules|attributes)$/i.test(file.path) ||
      paths.has(file.path.normalize("NFC").toLowerCase()) ||
      file.ordinary !== true ||
      file.links !== 1 ||
      !Buffer.isBuffer(file.bytes) ||
      file.bytes.length > 16 * 1024 * 1024 ||
      (total += file.bytes.length) > 128 * 1024 * 1024
    )
      throw Error("Unsafe output");
    paths.add(file.path.normalize("NFC").toLowerCase());
    const bytes = Buffer.from(file.bytes),
      hash = candidateDigest(bytes);
    if (
      hash !== file.beforeSha256 ||
      hash !== file.afterSha256 ||
      redact(bytes.toString()) !== bytes.toString()
    )
      throw Error("Changed output");
    return {
      path: file.path,
      bytes: bytes.toString("base64"),
      executable: file.executable === true,
      sha256: hash,
    };
  });
  for (const path of paths) {
    const components = path.split("/");
    for (let count = 1; count < components.length; count++)
      if (paths.has(components.slice(0, count).join("/")))
        throw Error("Conflicting output paths");
  }
  return JSON.stringify(files.sort((a, b) => a.path.localeCompare(b.path)));
}

import { StringDecoder } from "node:string_decoder";
/** Trusted isolated-management transport. inspect measures the worker executable
 * and immutable host/policy binding independently of worker JSON. run must check
 * those expected pins and call request.mayDispatch() immediately before each
 * worker effect after asynchronous preparation. Use argv (never a shell), and close the
 * CLI output stream before resolving. No host coding executor is provided. */
export interface IsolatedCodingTransport {
  readonly mode: "controlled" | "live";
  inspect(session: CodingSession): Promise<CodingPins>;
  /** `gateway` serves a routed request's relay; it never crosses to a
   * worker. Slice 4 wires it; until then routed turns are refused. */
  run(
    request: CodingRequest,
    stdout: (bytes: Buffer) => void,
    gateway?: SessionGateway,
  ): Promise<{
    operationId: string;
    fence: number;
    exitCode: number;
    pins: CodingPins;
  }>;
  recoverInterruptedResume?(
    session: CodingSession,
    resumeFrom: CodingSession,
  ): Promise<CodingRecovery & { pins: CodingPins }>;
  reconcileInterruptedResume?(
    session: CodingSession,
    resumeFrom: CodingSession,
    retire: boolean,
  ): Promise<CodingReconciliation & { pins: CodingPins }>;
  cleanupRetiredLineage?(
    session: CodingSession,
  ): Promise<CodingCleanup & { pins: CodingPins }>;
  stop: FeatureRuntime["stop"];
  collect: FeatureRuntime["collect"];
}
/** Bind the admitted core launch data across asynchronous pin inspection.
 * The digest is local dispatch fencing, never a qualification or credential. */
function codingLaunchBinding(request: CodingRequest): string {
  const manifest = (files: CodingRequest["files"]) =>
    files.map(({ path, bytes, executable }) => ({
      path,
      sha256: candidateDigest(bytes),
      executable,
    }));
  return candidateDigest(
    JSON.stringify({
      operationId: request.operationId,
      fence: request.fence,
      state: request.state,
      intent: request.intent,
      threadId: request.threadId,
      resumeFrom: request.resumeFrom && codingBinding(request.resumeFrom),
      baseMove: request.baseMove,
      branch: request.branch,
      sourceRevision: request.sourceRevision,
      inputSha256: request.inputSha256,
      pins: request.pins,
      argv: request.argv,
      modelRoute: request.modelRoute,
      allowanceMs: request.allowanceMs,
      files: manifest(request.files),
      baseRefresh: request.baseRefresh && {
        from: {
          revision: request.baseRefresh.from.revision,
          files: manifest(request.baseRefresh.from.files),
        },
        to: {
          revision: request.baseRefresh.to.revision,
          files: manifest(request.baseRefresh.to.files),
        },
      },
    }),
  );
}
/** Executable pinned CLI adapter; the transport owns the independently qualified
 * isolation boundary. A controlled transport never proves native compatibility.
 * A live transport is admitted only by an owner record naming these exact pins.
 * The record is re-read before dispatch, on results and receipts, and at least
 * once a second while a turn streams, so revoking or changing it stops further
 * work. Either way the runtime keeps the controller's controlled contract; an
 * admitted live transport claims no native qualification. */
export class PinnedCodingRuntime implements FeatureRuntime {
  readonly mode = "controlled" as const;
  readonly pins: CodingPins;
  constructor(
    pins: CodingPins,
    private readonly transport: IsolatedCodingTransport,
    private readonly admission?: CodingAdmission,
  ) {
    this.pins = Object.freeze(structuredClone(pins));
    if (!validCodingPins(pins) || !this.admitted())
      throw Error("Unqualified coding transport");
  }
  /** The transport is controlled, or the owner record still names these pins. */
  private admitted(maxAgeMs = 0): boolean {
    if (this.transport.mode === "controlled") return !this.admission;
    if (this.transport.mode !== "live" || !this.admission) return false;
    try {
      const admitted = this.admission.pins(maxAgeMs);
      return codingPinFields.every(
        (field) => admitted[field] === this.pins[field],
      );
    } catch {
      return false;
    }
  }
  async execute(request: CodingRequest): Promise<CodingResult> {
    const expected = JSON.stringify(this.pins);
    const admittedLaunch = codingLaunchBinding(request);
    const { mayDispatch, checkpoint, onEvent } = request;
    if (
      !this.admitted() ||
      JSON.stringify(request.pins) !== expected ||
      JSON.stringify(await this.transport.inspect(request)) !== expected ||
      codingLaunchBinding(request) !== admittedLaunch ||
      request.mayDispatch !== mayDispatch ||
      request.checkpoint !== checkpoint ||
      request.onEvent !== onEvent ||
      !mayDispatch()
    )
      throw Error("Coding executable or authority changed");
    const copyFiles = (files: CodingRequest["files"]) =>
      files.map((file) => ({ ...file, bytes: Buffer.from(file.bytes) }));
    const launch: CodingRequest = {
      ...request,
      argv: [...request.argv],
      pins: { ...request.pins },
      ...(request.modelRoute ? { modelRoute: { ...request.modelRoute } } : {}),
      ...(request.resumeFrom
        ? { resumeFrom: codingBinding(request.resumeFrom) }
        : {}),
      ...(request.baseMove ? { baseMove: { ...request.baseMove } } : {}),
      files: copyFiles(request.files),
      ...(request.baseRefresh
        ? {
            baseRefresh: {
              from: {
                ...request.baseRefresh.from,
                files: copyFiles(request.baseRefresh.from.files),
              },
              to: {
                ...request.baseRefresh.to,
                files: copyFiles(request.baseRefresh.to.files),
              },
            },
          }
        : {}),
      mayDispatch: () =>
        launchUnchanged() && mayDispatch() && launchUnchanged(),
      checkpoint: () =>
        launchUnchanged(admissionStreamMaxAgeMs) &&
        checkpoint() &&
        launchUnchanged(admissionStreamMaxAgeMs),
      onEvent,
    };
    const launchUnchanged = (maxAgeMs = 0) =>
      this.admitted(maxAgeMs) &&
      JSON.stringify(this.pins) === expected &&
      codingLaunchBinding(launch) === admittedLaunch;
    Object.freeze(launch);

    const decoder = new StringDecoder("utf8"),
      events: unknown[] = [];
    let pending = "",
      count = 0,
      closed = false;
    const frame = (line: string) => {
      if (!line.trim()) return;
      const event: unknown = JSON.parse(line);
      if (
        !event ||
        typeof event !== "object" ||
        events.length >= 4096 ||
        !launch.checkpoint()
      )
        throw Error("Invalid coding frame");
      if (
        (event as Record<string, unknown>).type === "thread.started" &&
        !onEvent(event)
      )
        throw Error("Invalid coding session");
      events.push(event);
    };
    const result = await this.transport.run(launch, (bytes) => {
      if (closed || !Buffer.isBuffer(bytes) || (count += bytes.length) > 65536)
        throw Error("Coding stream is unavailable or oversized");
      pending += decoder.write(bytes);
      while (pending.includes("\n")) {
        const at = pending.indexOf("\n");
        frame(pending.slice(0, at));
        pending = pending.slice(at + 1);
      }
    });
    closed = true;
    pending += decoder.end();
    if (pending.trim()) frame(pending);
    if (
      result.operationId !== launch.operationId ||
      result.fence !== launch.fence ||
      JSON.stringify(result.pins) !== expected ||
      !launchUnchanged()
    )
      throw Error("Coding result binding changed");
    // Validate the full observed transcript, not only its final frame.
    const execution = {
      operationId: result.operationId,
      fence: result.fence,
      exitCode: result.exitCode,
      events: structuredClone(events),
    };
    codingTurn(execution, launch.threadId);
    return execution;
  }
  private async inspectSession(session: CodingSession): Promise<void> {
    const observed = await this.transport.inspect(session);
    if (
      !this.admitted() ||
      JSON.stringify(observed) !== JSON.stringify(this.pins)
    )
      throw Error("Coding management binding changed");
  }
  async stop(session: CodingSession) {
    const binding = Object.freeze(structuredClone(session));
    // Always attempt exact-session shutdown, even when execution pins changed.
    // A receipt only becomes trusted after a fresh independent observation.
    const receipt = { ...(await this.transport.stop(binding)) };
    await this.inspectSession(binding);
    return receipt;
  }
  async recover(
    session: CodingSession,
    resumeFrom: CodingSession,
  ): Promise<CodingRecovery> {
    const binding = Object.freeze(codingBinding(session)),
      previous = Object.freeze(codingBinding(resumeFrom));
    if (!this.transport.recoverInterruptedResume)
      throw Error("Resume recovery is unsupported by this transport");
    await this.inspectSession(binding);
    const receipt = await this.transport.recoverInterruptedResume(
      binding,
      previous,
    );
    if (
      receipt.operationId !== binding.operationId ||
      receipt.fence !== binding.fence ||
      receipt.recovered !== true ||
      JSON.stringify(receipt.pins) !== JSON.stringify(this.pins)
    )
      throw Error("Resume recovery binding changed");
    await this.inspectSession(binding);
    return {
      operationId: receipt.operationId,
      fence: receipt.fence,
      recovered: true,
    };
  }
  async reconcile(
    session: CodingSession,
    resumeFrom: CodingSession,
    retire: boolean,
  ): Promise<CodingReconciliation> {
    const binding = Object.freeze(codingBinding(session)),
      previous = Object.freeze(codingBinding(resumeFrom));
    if (!this.transport.reconcileInterruptedResume)
      throw Error("Resume reconciliation is unsupported by this transport");
    await this.inspectSession(binding);
    const receipt = await this.transport.reconcileInterruptedResume(
      binding,
      previous,
      retire,
    );
    if (
      receipt.operationId !== binding.operationId ||
      receipt.fence !== binding.fence ||
      !resumeReconciliations.includes(receipt.outcome) ||
      JSON.stringify(receipt.pins) !== JSON.stringify(this.pins)
    )
      throw Error("Resume reconciliation binding changed");
    await this.inspectSession(binding);
    return {
      operationId: receipt.operationId,
      fence: receipt.fence,
      outcome: receipt.outcome,
    };
  }
  async cleanup(session: CodingSession): Promise<CodingCleanup> {
    const binding = Object.freeze(codingBinding(session));
    if (!this.transport.cleanupRetiredLineage)
      throw Error("Retired lineage cleanup is unsupported by this transport");
    await this.inspectSession(binding);
    const receipt = await this.transport.cleanupRetiredLineage(binding);
    if (
      receipt.operationId !== binding.operationId ||
      receipt.fence !== binding.fence ||
      !Number.isSafeInteger(receipt.cleaned) ||
      receipt.cleaned < 1 ||
      JSON.stringify(receipt.pins) !== JSON.stringify(this.pins)
    )
      throw Error("Retired lineage cleanup binding changed");
    await this.inspectSession(binding);
    return {
      operationId: receipt.operationId,
      fence: receipt.fence,
      cleaned: receipt.cleaned,
    };
  }
  async collect(session: CodingSession) {
    const binding = Object.freeze(structuredClone(session));
    await this.inspectSession(binding);
    const receipt = await this.transport.collect(binding);
    await this.inspectSession(binding);
    return receipt;
  }
}

export function candidateMainSource(repository: string, defaultBranch: string) {
  return observedSource(repository, undefined, defaultBranch);
}
