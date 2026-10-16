import { realpathSync } from "node:fs";
import { redact } from "./redaction.js";

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
  policySha256: string;
  bindingSha256: string;
}
export interface CodingSession {
  operationId: string;
  fence: number;
  state: "running" | "stopped" | "uncertain";
  intent: "start" | "resume";
  threadId?: string;
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
  stop(session: CodingSession): Promise<{
    operationId: string;
    fence: number;
    stopped: boolean;
    remainingProcesses: number;
  }>;
  collect(session: CodingSession): Promise<CodingCollection>;
}

export function validCodingPins(pins: CodingPins): boolean {
  return Boolean(
    pins &&
      /^\d+\.\d+\.\d+$/.test(pins.cliVersion) &&
      [pins.cliSha256, pins.policySha256, pins.bindingSha256].every((x) =>
        /^[a-f0-9]{64}$/.test(x),
      ),
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
export const candidateDigest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
function candidateGit(repository: string, args: string[]): Buffer {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.toUpperCase().startsWith("GIT_"),
    ),
  );
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_OPTIONAL_LOCKS: "0",
  });
  const result = spawnSync(
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
    { env, timeout: 5000, maxBuffer: 128 * 1024 * 1024, windowsHide: true },
  );
  if (result.status !== 0)
    throw Error("Candidate repository observation failed");
  return result.stdout;
}
export function candidateSource(repository: string, expected?: string) {
  // status may run clean/process filters. Inspect local configuration without
  // following includes before any working-tree observation can start a helper.
  const configuration = ["--local", "--worktree"].flatMap((scope) =>
    candidateGit(repository, [
      "config",
      scope,
      "--no-includes",
      "--null",
      "--list",
    ])
      .toString()
      .split("\0"),
  );
  if (
    configuration.some((entry) =>
      /^(?:filter\..+\.(?:clean|smudge|process)|include(?:if\..+)?\.path)\n/i.test(
        entry,
      ),
    )
  )
    throw Error("Unreviewed Git helpers are forbidden");

  const top = candidateGit(repository, ["rev-parse", "--show-toplevel"])
    .toString()
    .trim();
  if (
    (process.platform === "win32"
      ? realpathSync.native(top).toLowerCase()
      : realpathSync.native(top)) !==
    (process.platform === "win32"
      ? realpathSync.native(repository).toLowerCase()
      : realpathSync.native(repository))
  )
    throw Error("Changed Git worktree root");
  const revision = candidateGit(repository, ["rev-parse", "HEAD"])
    .toString()
    .trim();
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
  const current = spawnSync(
    "git",
    ["-C", repository, "rev-parse", "--verify", "refs/heads/" + branch],
    { encoding: "utf8", timeout: 5000 },
  );
  if (current.status === 0) {
    if (current.stdout.trim() !== revision)
      throw Error("Feature branch changed");
  } else
    candidateGit(repository, [
      "update-ref",
      "refs/heads/" + branch,
      revision,
      "0".repeat(40),
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
  run(
    request: CodingRequest,
    stdout: (bytes: Buffer) => void,
  ): Promise<{
    operationId: string;
    fence: number;
    exitCode: number;
    pins: CodingPins;
  }>;
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
      branch: request.branch,
      sourceRevision: request.sourceRevision,
      inputSha256: request.inputSha256,
      pins: request.pins,
      argv: request.argv,
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
 * isolation boundary. This controlled adapter never proves native compatibility. */
export class PinnedCodingRuntime implements FeatureRuntime {
  readonly mode = "controlled" as const;
  readonly pins: CodingPins;
  constructor(
    pins: CodingPins,
    private readonly transport: IsolatedCodingTransport,
  ) {
    if (!validCodingPins(pins) || transport.mode !== "controlled")
      throw Error("Unqualified coding transport");
    this.pins = Object.freeze(structuredClone(pins));
  }
  async execute(request: CodingRequest): Promise<CodingResult> {
    const expected = JSON.stringify(this.pins);
    const admittedLaunch = codingLaunchBinding(request);
    const { mayDispatch, checkpoint, onEvent } = request;
    if (
      this.transport.mode !== "controlled" ||
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
      checkpoint: () => launchUnchanged() && checkpoint() && launchUnchanged(),
      onEvent,
    };
    const launchUnchanged = () =>
      this.transport.mode === "controlled" &&
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
      this.transport.mode !== "controlled" ||
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
  async collect(session: CodingSession) {
    const binding = Object.freeze(structuredClone(session));
    await this.inspectSession(binding);
    const receipt = await this.transport.collect(binding);
    await this.inspectSession(binding);
    return receipt;
  }
}

export function candidateMainSource(repository: string, defaultBranch: string) {
  const source = candidateSource(repository);
  const main = candidateGit(repository, [
    "rev-parse",
    "--verify",
    "refs/heads/" + defaultBranch,
  ])
    .toString()
    .trim();
  if (main !== source.revision) throw Error("Baseline must be unchanged main");
  return source;
}
