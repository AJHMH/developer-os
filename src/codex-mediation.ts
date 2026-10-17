import { lstatSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { pinnedHostCodex, readCodexAccount } from "./codex-app-server.js";
import { hostGatewayCanary } from "./gateway-canary.js";
import { modelRelayVersion, syntheticRelayCanary } from "./model-relay.js";
import { pathContains } from "./path-containment.js";
import { subscriptionGatewayVersion } from "./subscription-gateway.js";

export interface SubscriptionMediationReport {
  workerDiagnostic?: import("./native-diagnostics.js").NativeProbeDiagnostic;
  qualified: false;
  decisionPins?: import("./subscription-decision.js").SubscriptionDecisionPins;
  mechanismDecision?: {
    qualified: true;
    scope:
      | "macos-fixed-codex-subscription"
      | "windows-fixed-codex-subscription";
    runId: string;
    observedAt: string;
    accountId: string;
    requestSha256: string;
    gatewayVersion: string;
    workerExecutableSha256: string;
    bindingSha256: string;
    inferenceAuthorized: false;
  };
  protocol: "passed" | "not-run";
  syntheticRelay: "passed" | "not-run";
  relayRevocation: "passed" | "not-run";
  relayVersion?: string;
  modelFrameTransport: "passed" | "not-run";
  workerProtocol: "passed" | "not-run";
  explicitResume?: "passed";
  codexCredentialIsolation: "passed" | "not-run";
  workerExecutableSha256?: string;
  workerBlocker?: string;
  scope: "host-capability-only";
  codexVersion?: "0.161.0";
  executableSha256?: string;
  credentialIsolation: "passed" | "not-run";
  credentialIsolationScope: "synthetic-restricted-alpine" | "not-run";
  endpointEnforcement: "passed" | "not-run";
  deliveryCapabilities: "passed" | "not-run";
  deliveryCapabilityChecks?: string[];
  relayDeliveryId?: string;
  endpointScope?: "synthetic-codex-relay";
  hostGateway: "passed" | "not-run";
  hostGatewayVersion?: string;
  gatewayIntegration: "passed" | "not-run";
  gatewayScope?: "synthetic-host-subscription";
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
    deliveryCapabilities: "not-run",
    hostGateway: "not-run",
    gatewayIntegration: "not-run",
    subscriptionInference: "not-run",
    nextAction:
      "Run separate authorize-auth setup with owner browser consent and host-only storage, then qualify a trusted model-only relay, endpoint enforcement and VM credential isolation before online inference; do not copy owner authentication files or use paid API fallback.",
  };
}

function inside(parent: string, child: string): boolean {
  return pathContains(realpathSync(parent), child);
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
  report.hostGateway = await hostGatewayCanary();
  if (report.hostGateway === "passed")
    report.hostGatewayVersion = subscriptionGatewayVersion;
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
    home = mkdtempSync(join(tmpdir(), "aios-auth-capability-"));
    const observed = await readCodexAccount(pinnedHostCodex(path), {
      policy: "isolated",
      home,
    });
    if (
      observed &&
      observed.account === null &&
      observed.requiresOpenaiAuth === false
    ) {
      report.protocol = "passed";
      report.codexVersion = "0.161.0";
      report.executableSha256 = observed.executableSha256;
    }
  } catch {
    /* Never retain raw paths, protocol output or error details. */
  } finally {
    if (home) rmSync(home, { recursive: true, force: true });
  }
  return report;
}
