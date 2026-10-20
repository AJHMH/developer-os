import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { Delivery } from "./controller.js";
import { modelRelayVersion } from "./model-relay.js";
import { pathContains } from "./path-containment.js";
import {
  assertOwnerControlledStorage,
  assertPrivateAuthStorage,
  assertStorageMetadata,
} from "./private-storage.js";
import {
  gatewayRequest,
  subscriptionGatewayVersion,
} from "./subscription-gateway.js";

const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const decisionSourceVersion = hash(
  Buffer.concat([
    readFileSync(new URL(import.meta.url)),
    readFileSync(new URL("./podman-native.js", import.meta.url)),
    readFileSync(new URL("./vm-management.js", import.meta.url)),
    readFileSync(new URL("./host-target.js", import.meta.url)),
    readFileSync(new URL("./gateway-canary.js", import.meta.url)),
    readFileSync(new URL("./codex-app-server.js", import.meta.url)),
    readFileSync(new URL("./private-storage.js", import.meta.url)),
    readFileSync(new URL("./path-containment.js", import.meta.url)),
  ]),
);
export interface SubscriptionDecisionPins {
  sourceVersion: string;
  repository: string;
  bindingSha256: string;
  policySha256: string;
  files: { path: string; sha256: string }[];
  directories: { path: string; access: "private" | "readable" }[];
}
export const hex = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const within = pathContains;

/** The protected mediation decision record for a delivery, in the controller's
 * resolved state directory. */
export const subscriptionDecisionPath = (state: string, deliveryId: string) =>
  join(state, "subscription-decision-" + deliveryId + ".json");

export function subscriptionDecisionScope(binding?: Record<string, string>) {
  if (
    binding?.platform === "win32" &&
    binding.arch === "x64" &&
    binding.provider === "hyperv"
  )
    return "windows-fixed-codex-subscription" as const;
  if (
    binding?.platform === "darwin" &&
    binding.arch === "arm64" &&
    binding.provider === "applehv"
  )
    return "macos-fixed-codex-subscription" as const;
  return undefined;
}

/** Operator-endorsed evidence lives only in protected controller state. There is
 * deliberately no candidate receipt import or inference-authorizing API. */
export function projectSubscriptionDecision(
  delivery: Delivery,
  state: string,
): Delivery {
  const q = delivery.qualification,
    mediation = q?.subscriptionMediation;
  if (!q || !mediation) return delivery;
  delete mediation.mechanismDecision;
  delete mediation.decisionPins;
  try {
    const repository = realpathSync(delivery.repository);
    const binding = q.offlineAdmission?.binding;
    const windows =
      binding?.platform === "win32" &&
      binding.arch === "x64" &&
      binding.provider === "hyperv";
    const macos =
      binding?.platform === "darwin" &&
      binding.arch === "arm64" &&
      binding.provider === "applehv";
    if (!windows && !macos) throw Error();
    assertPrivateAuthStorage(state, "directory");
    const files = new Map<string, string>(),
      directories = new Map<string, "private" | "readable">([
        [state, "private"],
      ]);
    const read = (
      path: string,
      parentAccess: "private" | "readable" = "private",
    ) => {
      if (
        !isAbsolute(path) ||
        realpathSync(path) !== resolve(path) ||
        within(repository, path)
      )
        throw Error();
      assertOwnerControlledStorage(
        resolve(path, ".."),
        "directory",
        4096,
        parentAccess,
      );
      assertPrivateAuthStorage(path, "file", 65536);
      const bytes = readFileSync(path);
      files.set(path, hash(bytes));
      const parent = resolve(path, "..");
      directories.set(
        parent,
        directories.get(parent) === "private" ? "private" : parentAccess,
      );
      return bytes;
    };
    if (within(repository, realpathSync(state))) throw Error();
    const recordPath = subscriptionDecisionPath(
      realpathSync(state),
      delivery.id,
    );
    const r = JSON.parse(read(recordPath).toString("utf8"));
    if (
      r.schema !== 1 ||
      r.deliveryId !== delivery.id ||
      r.repositorySha256 !== hash(repository) ||
      !uuid(r.runId) ||
      !hex(r.accountId) ||
      !hex(r.usageAccountId) ||
      !hex(r.bindingSha256) ||
      !hex(r.workerExecutableSha256) ||
      !Number.isFinite(Date.parse(r.observedAt)) ||
      Date.parse(r.observedAt) > Date.now() ||
      r.subscriptionInference !== "passed" ||
      r.gatewayRevoked !== true ||
      r.workerRemaining !== 0 ||
      r.relayRemaining !== 0 ||
      r.requestSha256 !== hash(gatewayRequest) ||
      r.gatewayVersion !== subscriptionGatewayVersion ||
      r.relayVersion !== modelRelayVersion ||
      r.nativeVersion !==
        hash(readFileSync(new URL("./podman-native.js", import.meta.url)))
    )
      throw Error();
    if (
      read(
        join(realpathSync(state), "inference-" + r.runId + ".consumed"),
      ).toString() !== "one-shot approval consumed\n" ||
      !hex(r.registrationSha256) ||
      hash(read(r.registrationPath)) !== r.registrationSha256 ||
      hash(read(r.policyPath, "readable")) !== r.policySha256
    )
      throw Error();
    if (
      q.offlineAdmission?.allowed !== true ||
      q.policySha256 !== r.policySha256 ||
      q.bindingSha256 !== r.bindingSha256 ||
      mediation.hostGateway !== "passed" ||
      mediation.hostGatewayVersion !== r.gatewayVersion ||
      mediation.gatewayIntegration !== "passed" ||
      mediation.workerExecutableSha256 !== r.workerExecutableSha256 ||
      mediation.codexCredentialIsolation !== "passed" ||
      mediation.endpointEnforcement !== "passed" ||
      mediation.deliveryCapabilities !== "passed" ||
      mediation.relayDeliveryId !== delivery.id
    )
      throw Error();
    mediation.mechanismDecision = {
      qualified: true,
      scope: windows
        ? "windows-fixed-codex-subscription"
        : "macos-fixed-codex-subscription",
      runId: r.runId,
      observedAt: r.observedAt,
      accountId: r.accountId,
      usageAccountId: r.usageAccountId,
      requestSha256: r.requestSha256,
      gatewayVersion: r.gatewayVersion,
      workerExecutableSha256: r.workerExecutableSha256,
      bindingSha256: r.bindingSha256,
      inferenceAuthorized: false,
    };
    mediation.decisionPins = {
      sourceVersion: decisionSourceVersion,
      repository,
      bindingSha256: r.bindingSha256,
      policySha256: r.policySha256,
      files: [...files].map(([path, sha256]) => ({ path, sha256 })),
      directories: [...directories].map(([path, access]) => ({ path, access })),
    };
    mediation.nextAction =
      "The pinned supported-host fixed-request mediation mechanism has positive evidence. Its approval is consumed; production delivery remains disabled. Implement and qualify separate online dispatch, dependency access and usage/re-dispatch gates before feature delivery.";
    q.ready = false;
    q.liveReady = false;
  } catch {
    /* Missing, untrusted or drifted evidence grants no positive decision. */
  }
  return delivery;
}

/** Read-only verification of a persisted qualification snapshot. It checks source,
 * binding and evidence pins, not credentials or ACLs. Every dispatch path performs
 * explicit qualification again before using host authority. */
export function verifySubscriptionDecision(delivery: Delivery): Delivery {
  const q = delivery.qualification,
    mediation = q?.subscriptionMediation,
    decision = mediation?.mechanismDecision,
    pins = mediation?.decisionPins;
  if (!mediation || !decision) return delivery;
  try {
    if (
      !pins ||
      pins.sourceVersion !== decisionSourceVersion ||
      realpathSync(delivery.repository) !== pins.repository ||
      q?.offlineAdmission?.allowed !== true ||
      q.bindingSha256 !== pins.bindingSha256 ||
      q.policySha256 !== pins.policySha256 ||
      decision.bindingSha256 !== pins.bindingSha256 ||
      decision.scope !==
        subscriptionDecisionScope(q.offlineAdmission.binding) ||
      decision.requestSha256 !== hash(gatewayRequest) ||
      decision.gatewayVersion !== subscriptionGatewayVersion ||
      mediation.workerExecutableSha256 !== decision.workerExecutableSha256 ||
      decision.inferenceAuthorized !== false
    )
      throw Error();
    for (const directory of pins.directories) {
      if (realpathSync(directory.path) !== resolve(directory.path))
        throw Error();
      assertStorageMetadata(
        directory.path,
        "directory",
        4096,
        directory.access,
      );
    }
    for (const file of pins.files) {
      if (realpathSync(file.path) !== resolve(file.path)) throw Error();
      assertStorageMetadata(file.path, "file", 65536);
      if (hash(readFileSync(file.path)) !== file.sha256) throw Error();
    }
  } catch {
    delete mediation.mechanismDecision;
    delete mediation.decisionPins;
  }
  q!.ready = false;
  q!.liveReady = false;
  return delivery;
}
