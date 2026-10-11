import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { podmanMachine, podmanCommand } from "./podman-platform.js";
import { NativePodmanDriver } from "./podman-native.js";
import { inspectCodexMediation } from "./codex-mediation.js";
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
  adversarial?: boolean;
  codexExecutable?: string;
  machine: string;
  policyPath?: string;
  mode?: "controlled";
  observe?: () => PodmanObservation;
  native?: NativePodmanDriver;
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
/** Read-only prerequisites cannot establish effective isolation. */
function observeHost(machine: string): PodmanObservation {
  const host = podmanMachine(machine);
  const version = JSON.parse(
    podmanCommand(host, [
      "--connection",
      machine,
      "version",
      "--format",
      "json",
    ]),
  );
  return {
    binding: {
      platform: host.platform,
      arch: host.arch,
      osVersion: host.osVersion,
      provider: host.provider,
      machine,
      engineVersion: version.Server?.Version,
    },
    effective: {},
    configurationIntent: {
      hostSharesConfigured: host.config.Mounts.length !== 0,
      rootful: host.config.HostUser.Rootful,
    },
  };
}

/** Offline prerequisite admission is deliberately distinct from production qualification. */
export class PodmanHostAdapter implements WorkerAdapter {
  constructor(private readonly options: Options) {
    if (
      options.native &&
      (options.mode ||
        options.observe ||
        options.native.machine !== options.machine ||
        options.native.policyPath !== options.policyPath)
    )
      throw Error("Native driver bindings must match the selected adapter");
    if (options.observe && options.mode !== "controlled")
      throw Error("Custom observations require controlled mode");
  }
  async probe(
    delivery: Delivery,
    authorityDirectory: string,
  ): Promise<WorkerQualification> {
    const report = unavailableQualification();
    report.subscriptionMediation = await inspectCodexMediation(
      this.options.codexExecutable,
      delivery.repository,
      authorityDirectory,
    );
    report.mode = this.options.mode ?? "live";
    report.blockers = [
      "Production worker execution and inference remain disabled; offline admission does not establish isolation qualification.",
    ];
    report.offlineAdmission = { allowed: false, scope: "offline-probe-only" };
    let observed: PodmanObservation;
    try {
      if (
        this.options.native &&
        resolve(this.options.native.authorityDirectory).toLowerCase() !==
          resolve(authorityDirectory).toLowerCase()
      )
        throw Error("Changed native authority directory");
      observed = this.options.native
        ? this.options.native.observe(delivery.repository)
        : this.options.observe
          ? this.options.observe()
          : observeHost(this.options.machine);
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
      if (
        observed.configurationIntent?.hostSharesConfigured ||
        observed.configurationIntent?.rootful
      )
        throw Error("Conflicting machine configuration");
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
        !(
          (binding.platform === "win32" &&
            binding.arch === "x64" &&
            binding.provider === "hyperv" &&
            /^10\.0\.(\d+)$/.test(binding.osVersion!) &&
            Number(binding.osVersion!.split(".")[2]) >= 22000) ||
          (binding.platform === "darwin" &&
            binding.arch === "arm64" &&
            binding.provider === "applehv" &&
            /^\d+\.\d+\.\d+$/.test(binding.osVersion!) &&
            Number(binding.osVersion!.split(".")[0]) >= 23)
        ) ||
        binding.machine !== this.options.machine ||
        !/^aios-[a-z0-9-]+$/.test(binding.machine!) ||
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
      if (this.options.adversarial) {
        if (!this.options.native)
          throw Error("Native adversarial driver required");
        try {
          const observed = await this.options.native.probeIsolation(
            delivery.repository,
          );
          if (
            [
              "initialization",
              "binding",
              "host-http-mcp-positive",
              "guest-engine-positive",
              "guest-file-positive",
              "restricted-worker-tooling",
              "worker-tool-cat",
              "worker-tool-wget",
              "worker-tool-unshare",
              "worker-tool-chroot",
              "worker-cgroup-interface",
              "worker-proc-interface",
              "worker-denials",
              "post-host-http-mcp-positive",
              "post-guest-engine-positive",
              "post-guest-file-positive",
            ].includes(observed.blockedStage)
          ) {
            report.adversarialBlocker = observed.blockedStage;
            throw Error();
          }
          if (
            bindingKeys.some((key) => observed.binding?.[key] !== binding[key])
          )
            throw Error();
          if (
            !/^[a-f0-9-]{36}$/.test(observed.challengeId) ||
            !/^[a-f0-9]{64}$/.test(observed.probeVersion) ||
            !Array.isArray(observed.escapeAttempts) ||
            observed.escapeAttempts.length !== 4 ||
            !observed.escapeAttempts.every(
              (value: unknown) =>
                typeof value === "string" &&
                /^(passed|failed)-escape-(unshare|chroot|cgroup|proc)$/.test(
                  value,
                ),
            )
          )
            throw Error();
          report.adversarial = {
            scope:
              binding.platform === "darwin"
                ? "synthetic-macos-controls"
                : "synthetic-windows-controls",
            challengeId: observed.challengeId,
            probeVersion: observed.probeVersion,
            escapeAttempts: observed.escapeAttempts,
          };
          for (const probe of report.probes) {
            const result = observed.probes?.find(
              (value: any) => value.name === probe.name,
            );
            if (
              result &&
              ["passed", "failed"].includes(result.outcome) &&
              /^[a-f0-9]{64}$/.test(result.evidenceSha256)
            ) {
              probe.outcome = result.outcome;
              probe.evidenceSha256 = result.evidenceSha256;
            }
          }
        } catch {
          report.blockers.push(
            "Synthetic host/MCP positive controls could not be verified; adversarial qualification is not run. Restore reachable disposable canaries and retry without relaxing worker isolation.",
          );
        }
      }
    } catch {
      report.blockers.push(
        "Offline admission refused: provide an external ordinary pin policy and fresh matching supported Windows Hyper-V or macOS AppleHV bindings, image provenance, dedicated VM and enforced restricted worker configuration; unknown observations cannot qualify.",
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
