import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { syntheticRelayCanary, modelRelayVersion } from "./model-relay.js";

export interface SubscriptionMediationReport {
  qualified: false;
  protocol: "passed" | "not-run";
  syntheticRelay: "passed" | "not-run";
  relayRevocation: "passed" | "not-run";
  relayVersion?: string;
  modelFrameTransport: "passed" | "not-run";
  workerProtocol: "passed" | "not-run";
  codexCredentialIsolation: "passed" | "not-run";
  workerExecutableSha256?: string;
  workerBlocker?: string;
  scope: "host-capability-only";
  codexVersion?: "0.161.0";
  executableSha256?: string;
  credentialIsolation: "passed" | "not-run";
  credentialIsolationScope: "synthetic-restricted-alpine" | "not-run";
  endpointEnforcement: "not-run";
  subscriptionInference: "not-run";
  nextAction: string;
}

export function unqualifiedMediation(): SubscriptionMediationReport {
  return {
    qualified: false,
    protocol: "not-run",
    syntheticRelay: "not-run",
    relayRevocation: "not-run",
    modelFrameTransport: "not-run",
    workerProtocol: "not-run",
    codexCredentialIsolation: "not-run",
    scope: "host-capability-only",
    credentialIsolation: "not-run",
    credentialIsolationScope: "not-run",
    endpointEnforcement: "not-run",
    subscriptionInference: "not-run",
    nextAction:
      "Run separate authorize-auth setup with owner browser consent and host-only storage, then qualify a trusted model-only relay, endpoint enforcement and VM credential isolation before online inference; do not copy owner authentication files or use paid API fallback.",
  };
}

function inside(parent: string, child: string): boolean {
  const part = relative(realpathSync(parent), child);
  return (
    part === "" ||
    (part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part))
  );
}

/** Credential-free capability observation only. No login, inference, tools,
 * account refresh, billing or owner configuration is requested. A successful
 * RPC cannot qualify the relay, network boundary or subscription entitlement. */
export async function inspectCodexMediation(
  executable: string | undefined,
  repository: string,
  authority: string,
): Promise<SubscriptionMediationReport> {
  const report = unqualifiedMediation();
  report.syntheticRelay = await syntheticRelayCanary();
  report.relayRevocation = report.syntheticRelay;
  if (report.relayRevocation === "passed")
    report.relayVersion = modelRelayVersion;
  if (!executable) return report;
  let home: string | undefined;
  try {
    if (!isAbsolute(executable)) throw Error();
    const entry = lstatSync(executable);
    const path = realpathSync(executable);
    if (
      !(
        (process.platform === "win32" && process.arch === "x64") ||
        (process.platform === "darwin" && process.arch === "arm64")
      ) ||
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      entry.nlink !== 1 ||
      (process.platform === "win32"
        ? path.toLowerCase() !== resolve(executable).toLowerCase()
        : path !== resolve(executable)) ||
      inside(repository, path) ||
      inside(authority, path)
    )
      throw Error();
    const digest = () =>
      createHash("sha256").update(readFileSync(path)).digest("hex");
    const before = digest();
    // Official @openai/codex 0.161.0 native packages, independently verified
    // for each host. Version text alone cannot admit an executable.
    const expected =
      process.platform === "darwin"
        ? "12ac11d2c7eee27cfae34393986d7b7c9ed0dea537cb749831cdd7033893e6de"
        : "a0f89acca07a511734cac7fddee26b2106fab68918717bc90df16104a0760a30";
    if (before !== expected) throw Error();
    home = mkdtempSync(join(tmpdir(), "aios-auth-capability-"));
    const env = {
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
    };
    const version = spawnSync(path, ["--version"], {
      env,
      cwd: home,
      shell: false,
      windowsHide: true,
      encoding: "utf8",
      timeout: 4000,
      maxBuffer: 65536,
    });
    if (
      version.status !== 0 ||
      version.stdout.trim() !== "codex-cli 0.161.0" ||
      digest() !== before
    )
      throw Error();
    report.codexVersion = "0.161.0";
    report.executableSha256 = before;
    const passed = await new Promise<boolean>((resolve) => {
      const child = spawn(
        path,
        [
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
        ],
        {
          env,
          cwd: home,
          shell: false,
          windowsHide: true,
          stdio: ["pipe", "pipe", "ignore"],
        },
      );
      let buffer = "",
        total = 0,
        result = false,
        ended = false;
      const finish = (value: boolean) => {
        if (ended) return;
        ended = true;
        result = value;
        child.stdin.end();
        child.kill();
      };
      const timer = setTimeout(() => finish(false), 4000);
      child.on("error", () => {
        clearTimeout(timer);
        resolve(false);
      });
      child.on("close", () => {
        clearTimeout(timer);
        resolve(result);
      });
      child.stdin.on("error", () => finish(false));
      const send = (value: object) =>
        child.stdin.write(JSON.stringify(value) + "\n");
      child.stdout.on("data", (chunk: Buffer) => {
        if (ended) return;
        total += chunk.length;
        if (total > 65536) return finish(false);
        buffer += chunk.toString("utf8");
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          try {
            const message = JSON.parse(line);
            if (message.error) return finish(false);
            if (message.id === 1 && message.result) {
              send({ method: "initialized" });
              send({
                method: "account/read",
                id: 2,
                params: { refreshToken: false },
              });
            } else if (message.id === 2) {
              finish(
                message.result?.account === null &&
                  message.result?.requiresOpenaiAuth === false,
              );
              return;
            }
          } catch {
            return finish(false);
          }
        }
      });
      send({
        method: "initialize",
        id: 1,
        params: {
          clientInfo: { name: "developer_os_capability", version: "0.1.0" },
          capabilities: {},
        },
      });
    });
    if (passed && digest() === before) {
      report.protocol = "passed";
    }
  } catch {
    /* Never retain raw paths, protocol output or error details. */
  } finally {
    if (home) rmSync(home, { recursive: true, force: true });
  }
  return report;
}
