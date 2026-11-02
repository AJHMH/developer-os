import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { hostTarget } from "./host-target.js";

export interface CodexExecutable {
  path: string;
  sha256: string;
  argumentsPrefix?: readonly string[];
}
export type CodexSessionContext =
  | { policy: "owner" }
  | { policy: "isolated"; home: string };
export interface CodexAccountSession {
  account: any;
  requiresOpenaiAuth: unknown;
  rateLimits?: any;
  executableSha256: string;
}
/** Why an account read returned nothing. Bounded labels only: provider
 * errors, paths and protocol output never leave the reader. */
export type CodexReadRefusal =
  | "executable-path"
  | "executable-size"
  | "executable-hash"
  | "version"
  | "transport"
  | "exited"
  | "timeout"
  | "output-limit"
  | "rpc-error"
  | "protocol"
  | "stop";
export type CodexAccountObservation =
  | { session: CodexAccountSession }
  | { refusal: CodexReadRefusal };
const sessionDeadlineMs = 4000;
/** How long a stopped app-server may take to exit before it is killed and its
 * read discarded. The pinned Windows codex has taken longer than 250 ms. */
export const stopGraceMs = 5000;
/** A bound before hashing; the pin is the control. The pinned native Windows
 * codex 0.161.0 is 317 MiB. */
export const maxExecutableBytes = 512 * 1024 * 1024;
const outputLimits = { owner: 256 * 1024, isolated: 64 * 1024 };
export function pinnedHostCodex(path: string): CodexExecutable {
  return {
    path,
    sha256: hostTarget(process.platform, process.arch)?.nativeCodexSha256 ?? "",
  };
}
function executionContext(context: CodexSessionContext) {
  if (context.policy === "owner")
    return {
      cwd:
        process.platform === "win32"
          ? (process.env.SystemRoot ?? "C:\\Windows")
          : "/",
      env: process.env,
    };
  const home = context.home;
  return {
    cwd: home,
    env: {
      SystemRoot: process.env.SystemRoot,
      PATH:
        process.platform === "win32"
          ? `${process.env.SystemRoot}\\System32`
          : "/usr/bin:/bin",
      CODEX_HOME: home,
      HOME: home,
      USERPROFILE: home,
      APPDATA: home,
      LOCALAPPDATA: home,
      TEMP: home,
      TMP: home,
    },
  };
}
/** Only initialize and read account/allowance metadata. Environment policy and
 * executable identity are explicit; this client cannot request login or inference. */
export async function readCodexAccount(
  executable: CodexExecutable,
  context: CodexSessionContext,
  includeRateLimits = false,
): Promise<CodexAccountSession | undefined> {
  const observed = await observeCodexAccount(
    executable,
    context,
    includeRateLimits,
  );
  return "session" in observed ? observed.session : undefined;
}
/** `readCodexAccount`, naming why a read returned nothing. */
export async function observeCodexAccount(
  executable: CodexExecutable,
  context: CodexSessionContext,
  includeRateLimits = false,
): Promise<CodexAccountObservation> {
  let stage: CodexReadRefusal = "executable-path";
  executable = {
    ...executable,
    argumentsPrefix: [...(executable.argumentsPrefix ?? [])],
  };
  context =
    context.policy === "owner"
      ? { policy: "owner" }
      : { policy: "isolated", home: context.home };
  try {
    if (
      !isAbsolute(executable.path) ||
      !/^[a-f0-9]{64}$/.test(executable.sha256)
    )
      return { refusal: stage };
    const entry = lstatSync(executable.path),
      canonical = realpathSync(executable.path);
    if (entry.isFile() && entry.size > maxExecutableBytes)
      return { refusal: "executable-size" };
    if (
      !entry.isFile() ||
      entry.size < 1 ||
      entry.isSymbolicLink() ||
      entry.nlink !== 1 ||
      (process.platform === "win32"
        ? canonical.toLowerCase() !== resolve(executable.path).toLowerCase()
        : canonical !== resolve(executable.path))
    )
      return { refusal: stage };
    const digest = () =>
      createHash("sha256").update(readFileSync(canonical)).digest("hex");
    if (digest() !== executable.sha256) return { refusal: "executable-hash" };
    stage = "version";
    const execution = executionContext(context),
      prefix = [...(executable.argumentsPrefix ?? [])];
    if (context.policy === "isolated") {
      const version = spawnSync(canonical, [...prefix, "--version"], {
        ...execution,
        shell: false,
        windowsHide: true,
        encoding: "utf8",
        timeout: sessionDeadlineMs,
        maxBuffer: 65536,
      });
      if (
        version.status !== 0 ||
        version.stdout.trim() !== "codex-cli 0.161.0" ||
        digest() !== executable.sha256
      )
        return { refusal: stage };
    }
    stage = "transport";
    const args =
      context.policy === "owner"
        ? ["app-server"]
        : [
            "app-server",
            "-c",
            'cli_auth_credentials_store="file"',
            "-c",
            'model_provider="aios_capability"',
            "-c",
            'model_providers.aios_capability.name="Credential-free capability"',
            "-c",
            'model_providers.aios_capability.base_url="http://127.0.0.1:9/v1"',
            "-c",
            'model_providers.aios_capability.wire_api="responses"',
            "-c",
            "model_providers.aios_capability.requires_openai_auth=false",
          ];
    return await new Promise((resolveResult) => {
      const child = spawn(canonical, [...prefix, ...args], {
        ...execution,
        stdio: ["pipe", "pipe", "ignore"],
        shell: false,
        windowsHide: true,
      });
      let pending = "",
        total = 0,
        stopping = false,
        closed = false,
        initialized = false;
      let result: CodexAccountSession | undefined,
        refusal: CodexReadRefusal = "exited",
        reaper: ReturnType<typeof setTimeout> | undefined;
      const replies = new Map<number, any>(),
        decoder = new StringDecoder("utf8");
      const complete = () => {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        clearTimeout(reaper);
        try {
          if (stopping && digest() !== executable.sha256)
            refusal = "executable-hash";
          resolveResult(
            stopping && result && refusal !== "executable-hash"
              ? { session: result }
              : { refusal },
          );
        } catch {
          resolveResult({ refusal: "executable-hash" });
        }
      };
      const finish = (
        value?: CodexAccountSession,
        reason: CodexReadRefusal = "protocol",
      ) => {
        if (stopping) return;
        stopping = true;
        result = value;
        refusal = reason;
        clearTimeout(timer);
        reaper = setTimeout(() => {
          result = undefined;
          refusal = "stop";
          child.kill("SIGKILL");
          complete();
        }, stopGraceMs);
        child.stdin.end();
        child.kill();
      };
      const timer = setTimeout(
        () => finish(undefined, "timeout"),
        sessionDeadlineMs,
      );
      const send = (message: object) =>
        child.stdin.write(JSON.stringify(message) + "\n");
      child.on("error", () => {
        finish(undefined, "transport");
        complete();
      });
      child.once("close", complete);
      child.stdin.on("error", () => finish(undefined, "transport"));
      child.stdout.on("data", (chunk: Buffer) => {
        if (stopping) return;
        total += chunk.length;
        if (total > outputLimits[context.policy])
          return finish(undefined, "output-limit");
        pending += decoder.write(chunk);
        let newline;
        while (!stopping && (newline = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          try {
            const message = JSON.parse(line);
            if (message.error) return finish(undefined, "rpc-error");
            if (message.id === undefined) {
              if (typeof message.method !== "string") return finish();
              continue;
            }
            if (message.id === 1) {
              if (initialized || !message.result) return finish();
              initialized = true;
              send({ method: "initialized" });
              send({
                method: "account/read",
                id: 2,
                params: { refreshToken: false },
              });
              if (includeRateLimits)
                send({ method: "account/rateLimits/read", id: 3 });
            } else {
              if (
                !initialized ||
                ![2, ...(includeRateLimits ? [3] : [])].includes(message.id) ||
                replies.has(message.id) ||
                !message.result
              )
                return finish();
              replies.set(message.id, message.result);
            }
            if (replies.has(2) && (!includeRateLimits || replies.has(3))) {
              const response = replies.get(2);
              if (!("account" in response)) return finish();
              finish({
                account: response.account,
                requiresOpenaiAuth: response.requiresOpenaiAuth,
                executableSha256: executable.sha256,
                ...(includeRateLimits ? { rateLimits: replies.get(3) } : {}),
              });
            }
          } catch {
            return finish();
          }
        }
      });
      send({
        method: "initialize",
        id: 1,
        params: {
          clientInfo: {
            name:
              context.policy === "owner"
                ? "developer_os_usage"
                : "developer_os_capability",
            version: "0.1.0",
          },
          capabilities: {},
        },
      });
    });
  } catch {
    return { refusal: stage };
  }
}
