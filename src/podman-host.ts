import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { arch, homedir, platform, release } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import type {
  Delivery,
  WorkerAdapter,
  WorkerSession,
  WorkerReceipt,
} from "./controller.js";
import {
  unavailableQualification,
  type WorkerQualification,
} from "./qualification.js";

export interface PodmanObservation {
  binding: Record<string, unknown>;
  effective: Record<string, unknown>;
  configurationIntent?: { hostSharesConfigured: boolean; rootful: boolean };
}
interface Options {
  machine: string;
  policyPath?: string;
  mode?: "controlled";
  observe?: () => PodmanObservation;
}
const bindingKeys = [
  "platform",
  "arch",
  "osVersion",
  "provider",
  "machine",
  "hostId",
  "engineVersion",
  "vmImageSha256",
  "template",
  "workerVersion",
  "policyVersion",
] as const;
const effectiveKeys = [
  "hypervisor",
  "dedicated",
  "mounts",
  "managementExposed",
  "rootful",
  "network",
  "readOnly",
  "user",
  "capabilities",
  "noNewPrivileges",
] as const;
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
function ordinary(path: string): string {
  if (!isAbsolute(path)) throw Error("Invalid path");
  const entry = lstatSync(path);
  if (
    !entry.isFile() ||
    entry.isSymbolicLink() ||
    entry.nlink !== 1 ||
    entry.size > 65536
  )
    throw Error("Invalid file");
  return realpathSync(path);
}
function inside(parent: string, child: string): boolean {
  const rel = relative(realpathSync(parent), child);
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  );
}
function command(executable: string, args: string[]): string {
  const result = spawnSync(executable, args, {
    cwd: process.env.SystemRoot ?? "C:\\Windows",
    encoding: "utf8",
    timeout: 10000,
    maxBuffer: 65536,
    shell: false,
    windowsHide: true,
  });
  if (result.error || result.status !== 0)
    throw Error("Observation unavailable");
  return result.stdout;
}
/** Read-only host observations. Config intent is never promoted to effective worker policy.
 * VM image provenance, dedication and effective worker controls remain unknown until
 * a trusted enforcement driver supplies them. No VM is created, started or modified. */
function observeWindows(machine: string): PodmanObservation {
  if (
    platform() !== "win32" ||
    arch() !== "x64" ||
    !/^aios-[a-z0-9-]+$/.test(machine)
  )
    throw Error("Unsupported host");
  const configPath = ordinary(
    join(
      homedir(),
      ".config",
      "containers",
      "podman",
      "machine",
      "hyperv",
      `${machine}.json`,
    ),
  );
  const config = JSON.parse(readFileSync(configPath, "utf8"));
  if (
    config.Name !== machine ||
    config.Version !== 1 ||
    !config.HyperVHypervisor
  )
    throw Error("Unknown configuration");
  const executable = [
    join(process.env.LOCALAPPDATA ?? "", "Programs", "Podman", "podman.exe"),
    join(homedir(), "AppData", "Local", "Programs", "Podman", "podman.exe"),
  ].find((path) => isAbsolute(path) && existsSync(path));
  if (!executable) throw Error("Missing executable");
  const version = JSON.parse(
    command(executable, [
      "--connection",
      machine,
      "version",
      "--format",
      "json",
    ]),
  );
  return {
    binding: {
      platform: platform(),
      arch: arch(),
      osVersion: release(),
      provider: "hyperv",
      machine,
      engineVersion: version.Server?.Version,
    },
    effective: {},
    ...(Array.isArray(config.Mounts) &&
    typeof config.HostUser?.Rootful === "boolean"
      ? {
          configurationIntent: {
            hostSharesConfigured: config.Mounts.length !== 0,
            rootful: config.HostUser.Rootful,
          },
        }
      : {}),
  };
}

/** Offline prerequisite admission is deliberately distinct from production qualification. */
export class PodmanHostAdapter implements WorkerAdapter {
  constructor(private readonly options: Options) {
    if (options.observe && options.mode !== "controlled")
      throw Error("Custom observations require controlled mode");
  }
  async probe(
    delivery: Delivery,
    authorityDirectory: string,
  ): Promise<WorkerQualification> {
    const report = unavailableQualification();
    report.mode = this.options.mode ?? "live";
    report.blockers = [
      "Production worker execution and inference remain disabled; offline admission does not establish isolation qualification.",
    ];
    report.offlineAdmission = { allowed: false, scope: "offline-probe-only" };
    let observed: PodmanObservation;
    try {
      observed = this.options.observe
        ? this.options.observe()
        : observeWindows(this.options.machine);
      const binding: Record<string, string> = {};
      for (const key of bindingKeys) {
        const value = observed.binding[key];
        if (
          typeof value === "string" &&
          /^[A-Za-z0-9._:/@-]{1,256}$/.test(value)
        )
          binding[key] = value;
      }
      report.offlineAdmission.binding = binding;
      if (
        observed.configurationIntent &&
        typeof observed.configurationIntent.hostSharesConfigured ===
          "boolean" &&
        typeof observed.configurationIntent.rootful === "boolean"
      )
        report.offlineAdmission.configurationIntent = {
          hostSharesConfigured:
            observed.configurationIntent.hostSharesConfigured,
          rootful: observed.configurationIntent.rootful,
        };
      const effective: Record<string, string | boolean | string[]> = {};
      for (const key of effectiveKeys) {
        const value = observed.effective[key];
        if (
          typeof value === "boolean" ||
          (typeof value === "string" &&
            ["none", "65534:65534"].includes(value)) ||
          (Array.isArray(value) && value.length === 0)
        )
          effective[key] = value;
      }
      report.offlineAdmission.effective = effective;
      if (!this.options.policyPath) throw Error("Missing policy");
      const policyPath = ordinary(this.options.policyPath);
      if (
        inside(delivery.repository, policyPath) ||
        inside(authorityDirectory, policyPath)
      )
        throw Error("Untrusted policy");
      const raw = readFileSync(policyPath, "utf8");
      const policy = JSON.parse(raw);
      if (
        policy.schema !== 1 ||
        !policy.binding ||
        Object.keys(policy).some(
          (key) => !["schema", "binding"].includes(key),
        ) ||
        Object.keys(policy.binding).length !== bindingKeys.length
      )
        throw Error("Invalid policy");
      report.policySha256 = digest(raw);
      for (const key of bindingKeys)
        if (!binding[key] || binding[key] !== policy.binding[key])
          throw Error("Changed binding");
      if (
        binding.platform !== "win32" ||
        binding.arch !== "x64" ||
        binding.provider !== "hyperv" ||
        binding.machine !== this.options.machine ||
        !/^aios-[a-z0-9-]+$/.test(binding.machine!) ||
        !/^10\.0\.(\d+)$/.test(binding.osVersion!) ||
        Number(binding.osVersion!.split(".")[2]) < 22000 ||
        !/^[a-f0-9]{64}$/.test(binding.hostId!) ||
        !/^[a-f0-9]{64}$/.test(binding.vmImageSha256!) ||
        !/^[a-z0-9./_-]+@sha256:[a-f0-9]{64}$/.test(binding.template!) ||
        !/^\d+\.\d+\.\d+$/.test(binding.engineVersion!) ||
        !/^\d+\.\d+\.\d+$/.test(binding.workerVersion!)
      )
        throw Error("Unsupported binding");
      if (
        effective.hypervisor !== true ||
        effective.dedicated !== true ||
        effective.managementExposed !== false ||
        effective.rootful !== false ||
        effective.network !== "none" ||
        effective.readOnly !== true ||
        effective.user !== "65534:65534" ||
        effective.noNewPrivileges !== true ||
        !Array.isArray(effective.mounts) ||
        effective.mounts.length !== 0 ||
        !Array.isArray(effective.capabilities) ||
        effective.capabilities.length !== 0
      )
        throw Error("Unsafe effective policy");
      report.bindingSha256 = digest(
        JSON.stringify(bindingKeys.map((key) => [key, binding[key]])),
      );
      report.offlineAdmission.allowed = true;
    } catch {
      report.blockers.push(
        "Offline admission refused: provide an external ordinary pin policy and fresh matching Windows Hyper-V bindings, image provenance, dedicated VM and enforced restricted worker configuration; unknown observations cannot qualify.",
      );
    }
    return report;
  }
  qualified(): boolean {
    return false;
  }
  async start(): Promise<WorkerReceipt> {
    throw Error("Production worker execution is not qualified");
  }
  async fenceAndStop(session: WorkerSession): Promise<WorkerReceipt> {
    return { ...session, status: "unknown" };
  }
}
