import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { podmanMachine, podmanCommand } from "./podman-platform.js";

const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");

/** Host facts every native management call binds: the dedicated machine's
 * configuration, the engine executable's bytes and the engine client version. */
export function managementHost(machine: string) {
  const host = podmanMachine(machine);
  const executable = digest(readFileSync(host.executable));
  const version = JSON.parse(
    podmanCommand(host, [
      "--connection",
      machine,
      "version",
      "--format",
      "json",
    ]),
  ).Client?.Version;
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw Error("Invalid native engine version");
  return { machine, host, executable, version: version as string };
}
export type ManagementHost = ReturnType<typeof managementHost>;

/** Runs a fixed trusted management `program` in the VM over `podman machine
 * ssh`. The request crosses only as base64 JSON data bound to `R`; output and
 * time are bounded. `label` names the transport in refusals, e.g. "coding". */
export function runManagement(
  { machine, host }: ManagementHost,
  request: Record<string, unknown>,
  program: string,
  label: string,
  action: string,
  permit?: () => boolean,
): Promise<unknown> {
  const input = `import json,base64\nR=json.loads(base64.b64decode('${Buffer.from(JSON.stringify(request)).toString("base64")}'))\n${program}`;
  return new Promise((accept, reject) => {
    if (permit && !permit()) {
      reject(Error(`Native ${label} authority changed`));
      return;
    }
    const child = spawn(
      host.executable,
      ["machine", "ssh", machine, "/usr/bin/python3", "-I"],
      {
        cwd: host.cwd,
        env: host.env,
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let size = 0,
      output = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(Error(`Native ${label} observation timed out`));
    }, 45000);
    const failed = () => {
      clearTimeout(timer);
      reject(Error(`Native ${label} ${action} observation unavailable`));
    };
    child.on("error", failed);
    child.stdin.on("error", failed);
    child.stdout.on("data", (bytes: Buffer) => {
      if ((size += bytes.length) > 8 * 1024 * 1024) {
        child.kill();
        failed();
      } else output += bytes.toString("utf8");
    });
    child.stderr.on("data", () => {});
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        failed();
        return;
      }
      try {
        accept(JSON.parse(output));
      } catch {
        failed();
      }
    });
    child.stdin.end(input);
  });
}

/** Opens a long-lived channel running `program` in the VM, for a management
 * action that keeps talking after its first line (the session relay). The
 * program and its `R` cross as one base64 stdin line, as for the fixed
 * worker's relay; stdin then stays open for frames. */
export function openManagementChannel(
  { machine, host }: ManagementHost,
  request: Record<string, unknown>,
  program: string,
) {
  const input = `import json,base64\nR=json.loads(base64.b64decode('${Buffer.from(JSON.stringify(request)).toString("base64")}'))\n${program}`;
  const child = spawn(
    host.executable,
    [
      "machine",
      "ssh",
      machine,
      "/usr/bin/python3",
      "-I",
      "-u",
      "-c",
      "'import sys,base64;exec(base64.b64decode(sys.stdin.readline()))'",
    ],
    {
      cwd: host.cwd,
      env: host.env,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  child.stdin.write(Buffer.from(input).toString("base64") + "\n");
  return child;
}

/** True when the guest's VM observation has the expected shape and the host
 * engine executable is still the one measured before the call. */
export function validGuestBinding(
  { host, executable }: ManagementHost,
  binding: unknown,
): binding is Record<string, unknown> {
  if (!binding || typeof binding !== "object" || Array.isArray(binding))
    return false;
  const guest = binding as Record<string, unknown>;
  return (
    /^[a-f0-9]{64}$/.test(String(guest.vmImageSha256)) &&
    /^[a-f0-9]{64}$/.test(String(guest.hostId)) &&
    /^\d+\.\d+\.\d+$/.test(String(guest.engineVersion)) &&
    digest(readFileSync(host.executable)) === executable
  );
}

/** The binding digest of a host, its engine, the dedicated VM, the authority
 * and the guest's own observation. Any change requires new owner admission,
 * except Podman's own record of when the VM last started, so a restart keeps
 * the owner's records valid. */
export function managementBindingSha256(
  { machine, host, executable, version }: ManagementHost,
  authority: string,
  guest: unknown,
): string {
  const { LastUp: _lastUp, ...config } = host.config;
  return digest(
    JSON.stringify({
      host: {
        platform: host.platform,
        arch: host.arch,
        osVersion: host.osVersion,
        provider: host.provider,
        machine,
        config,
        executable,
        version,
        hostname: hostname(),
      },
      authority,
      guest,
    }),
  );
}
