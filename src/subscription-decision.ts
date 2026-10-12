import { windowsAuthStore } from "./windows-auth-store.js";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  gatewayRequest,
  subscriptionGatewayVersion,
} from "./subscription-gateway.js";
import { modelRelayVersion } from "./model-relay.js";
import {
  assertPrivateAuthStorage,
  assertOwnerControlledStorage,
} from "./subscription-auth.js";
import type { Delivery } from "./controller.js";

const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const hex = (value: unknown) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const uuid = (value: unknown) =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const within = (root: string, path: string) => {
  const rel = relative(root, path);
  return (
    rel === "" ||
    (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(".." + sep))
  );
};

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
    if (windows && process.platform === "win32") windowsAuthStore(state);
    assertPrivateAuthStorage(state, "directory");
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
      if (windows && process.platform === "win32")
        windowsAuthStore(resolve(path, ".."), [path]);
      return readFileSync(path);
    };
    if (within(repository, realpathSync(state))) throw Error();
    const recordPath = join(
      realpathSync(state),
      "subscription-decision-" + delivery.id + ".json",
    );
    const r = JSON.parse(read(recordPath).toString("utf8"));
    if (
      r.schema !== 1 ||
      r.deliveryId !== delivery.id ||
      r.repositorySha256 !== hash(repository) ||
      !uuid(r.runId) ||
      !hex(r.accountId) ||
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
      requestSha256: r.requestSha256,
      gatewayVersion: r.gatewayVersion,
      workerExecutableSha256: r.workerExecutableSha256,
      bindingSha256: r.bindingSha256,
      inferenceAuthorized: false,
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
