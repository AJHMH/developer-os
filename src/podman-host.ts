import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { inspectCodexMediation } from "./codex-mediation.js";
import type {
  Delivery,
  WorkerAdapter,
  WorkerReceipt,
  WorkerSession,
} from "./controller.js";
import { validEffectiveControls, validHostBinding } from "./host-target.js";
import { nativeProbeDiagnostic } from "./native-diagnostics.js";
import { pathContains } from "./path-containment.js";
import { NativePodmanDriver, codexWorkerSha256 } from "./podman-native.js";
import { podmanCommand, podmanMachine } from "./podman-platform.js";
import { stampQualificationVersions } from "./qualification-versions.js";
import {
  unavailableQualification,
  type WorkerQualification,
} from "./qualification.js";
import { subscriptionGatewayVersion } from "./subscription-gateway.js";
import { codexProbeStages } from "./vm-management.js";

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
  return pathContains(realpathSync(parent), child);
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
  get qualificationPlatform(): "darwin" | "win32" | undefined {
    if (this.options.mode === "controlled") return undefined;
    return process.platform === "darwin" ? "darwin" : "win32";
  }
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
    report.runtimeVersions = stampQualificationVersions();
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
        !validHostBinding(binding) ||
        binding.machine !== this.options.machine
      )
        throw Error("Unsupported binding");
      if (!validEffectiveControls(effective))
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
            delivery.id,
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
          if (
            observed.passed === true &&
            [
              "hostFilesDenied",
              "guestFileDenied",
              "environmentScrubbed",
              "mountsAbsent",
              "networkAbsent",
              "positiveControlsBeforeAfter",
            ].every((key) => observed.credentialExclusion?.[key] === true) &&
            report.probes.find((probe) => probe.name === "owner-credentials")
              ?.outcome === "passed"
          ) {
            report.subscriptionMediation.credentialIsolation = "passed";
            report.subscriptionMediation.credentialIsolationScope =
              "synthetic-restricted-alpine";
            if (observed.modelFrameTransport === "passed")
              report.subscriptionMediation.modelFrameTransport = "passed";
            if (
              typeof observed.codex?.blockedStage === "string" &&
              (codexProbeStages as readonly string[]).includes(
                observed.codex.blockedStage,
              )
            ) {
              report.subscriptionMediation.workerBlocker =
                observed.codex.blockedStage;
              const diagnostic = nativeProbeDiagnostic(
                observed.codex.diagnostic,
              );
              if (diagnostic)
                report.subscriptionMediation.workerDiagnostic = diagnostic;
              report.subscriptionMediation.nextAction =
                "Resolve the credential-free Codex worker probe failure, then qualify delivery-scoped endpoint mediation before preparing another live inference; keep owner credentials on the host.";
            }
            if (
              observed.codex?.protocol === "passed" &&
              observed.codex?.credentialIsolation === "passed" &&
              observed.codex?.binarySha256 ===
                codexWorkerSha256(binding.platform!, binding.arch!) &&
              observed.codex?.shutdown?.remainingProcesses === 0
            ) {
              report.subscriptionMediation.workerProtocol = "passed";
              if (
                observed.codex.explicitResume === "passed" &&
                observed.codex.resumeInferenceRequests === 0 &&
                observed.codex.observedCodexProcesses >= 1
              )
                report.subscriptionMediation.explicitResume = "passed";
              report.subscriptionMediation.codexCredentialIsolation = "passed";
              report.subscriptionMediation.workerExecutableSha256 =
                observed.codex.binarySha256;
              report.subscriptionMediation.nextAction =
                "Qualify delivery-scoped model-only endpoint mediation with this isolated Codex worker before preparing another owner-approved inference; keep reusable owner credentials on the host and production delivery disabled.";
              if (
                observed.codex.endpointEnforcement === "passed" &&
                observed.codex.deliveryCapabilities === "passed" &&
                observed.codex.relayScope === "synthetic-codex-relay" &&
                observed.codex.relayDeliveryId === delivery.id &&
                observed.codex.relayShutdownRemaining === 0 &&
                JSON.stringify(observed.codex.capabilityChecks) ===
                  JSON.stringify([
                    "cross-delivery",
                    "namespace",
                    "revocation",
                    "quota",
                    "expiry",
                  ])
              ) {
                report.subscriptionMediation.endpointEnforcement = "passed";
                report.subscriptionMediation.deliveryCapabilities = "passed";
                report.subscriptionMediation.deliveryCapabilityChecks =
                  observed.codex.capabilityChecks;
                report.subscriptionMediation.endpointScope =
                  "synthetic-codex-relay";
                report.subscriptionMediation.relayDeliveryId = delivery.id;
                if (
                  observed.codex.gatewayIntegration === "passed" &&
                  observed.codex.gatewayVersion ===
                    subscriptionGatewayVersion &&
                  report.subscriptionMediation.hostGateway === "passed" &&
                  report.subscriptionMediation.hostGatewayVersion ===
                    subscriptionGatewayVersion
                ) {
                  report.subscriptionMediation.gatewayIntegration = "passed";
                  report.subscriptionMediation.gatewayScope =
                    "synthetic-host-subscription";
                }
                report.subscriptionMediation.nextAction =
                  report.subscriptionMediation.gatewayIntegration === "passed"
                    ? "Prepare a fresh owner-approved one-shot inference through the qualified synthetic host gateway/Codex bridge; live subscription integration remains not-run and production delivery remains disabled."
                    : "Integrate and qualify the host-only subscription gateway with this synthetic Codex relay boundary before preparing a fresh owner-approved inference; production delivery remains disabled.";
              }
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
