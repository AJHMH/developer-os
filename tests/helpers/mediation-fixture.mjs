import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeliveryController } from "../../dist/controller.js";
import {
  gatewayRequest,
  subscriptionGatewayVersion,
} from "../../dist/subscription-gateway.js";
import { modelRelayVersion } from "../../dist/model-relay.js";
import { initializeWindowsAuthDirectory } from "../../dist/windows-auth-store.js";
import { ownWindowsFixturePaths } from "./windows-fixture-owner.mjs";

const hash = (v) => createHash("sha256").update(v).digest("hex");
const macosNative =
  "0129f94f4f1197bd75f6c4265889061f386ed302bbc50c6e57e3e0660dfb28a7";

/** Give a coding fixture a worker probe and an owner-endorsed macOS mediation
 * decision for `accountId`, through the public qualification path. Returns
 * `regress()`, which fails the probe's gateway evidence, and `withdraw()`,
 * which removes the protected decision record again. */
export async function mediatedCoding(f, t, accountId) {
  const owner = realpathSync(mkdtempSync(join(tmpdir(), "aios-mediation-")));
  t.after(() => rmSync(owner, { recursive: true, force: true }));
  if (process.platform === "win32") initializeWindowsAuthDirectory(owner);
  const policy = join(owner, "pins.json"),
    registration = join(owner, "registration.json");
  writeFileSync(policy, "synthetic independent pins", { mode: 0o600 });
  writeFileSync(registration, "synthetic registration", { mode: 0o600 });
  const id = f.delivery.id,
    probe = {
      ready: false,
      liveReady: false,
      mode: "controlled",
      checkedAt: new Date().toISOString(),
      probes: [],
      blockers: ["Production disabled"],
      policySha256: hash(readFileSync(policy)),
      bindingSha256: "a".repeat(64),
      offlineAdmission: {
        allowed: true,
        scope: "offline-probe-only",
        binding: { platform: "darwin", arch: "arm64", provider: "applehv" },
      },
      subscriptionMediation: {
        qualified: false,
        hostGateway: "passed",
        hostGatewayVersion: subscriptionGatewayVersion,
        gatewayIntegration: "passed",
        workerExecutableSha256: macosNative,
        codexCredentialIsolation: "passed",
        endpointEnforcement: "passed",
        deliveryCapabilities: "passed",
        relayDeliveryId: id,
        subscriptionInference: "not-run",
        nextAction: "Synthetic only",
      },
    };
  const run = "00000000-0000-4000-8000-000000000021",
    recordPath = join(f.state, "subscription-decision-" + id + ".json"),
    consumed = join(f.state, "inference-" + run + ".consumed");
  writeFileSync(consumed, "one-shot approval consumed\n", { mode: 0o600 });
  writeFileSync(
    recordPath,
    JSON.stringify({
      schema: 1,
      deliveryId: id,
      repositorySha256: hash(realpathSync(f.repository)),
      runId: run,
      observedAt: new Date().toISOString(),
      accountId,
      policyPath: policy,
      policySha256: probe.policySha256,
      bindingSha256: probe.bindingSha256,
      registrationPath: registration,
      registrationSha256: hash(readFileSync(registration)),
      gatewayVersion: subscriptionGatewayVersion,
      relayVersion: modelRelayVersion,
      nativeVersion: hash(
        readFileSync(new URL("../../dist/podman-native.js", import.meta.url)),
      ),
      workerExecutableSha256: macosNative,
      requestSha256: hash(gatewayRequest),
      subscriptionInference: "passed",
      gatewayRevoked: true,
      workerRemaining: 0,
      relayRemaining: 0,
    }),
    { mode: 0o600 },
  );
  ownWindowsFixturePaths([f.state, policy, registration, recordPath, consumed]);
  f.controller = new DeliveryController(f.state, f.options, {
    featurePlanner: f.criteria,
    featureRuntime: f.runtime,
    subscription: () => f.subscription(),
    validationRuntime: f.validation,
    clock: () => f.now,
    worker: { probe: async () => structuredClone(probe) },
  });
  const qualified = await f.controller.qualify(id);
  assert.equal(
    qualified.qualification.subscriptionMediation.mechanismDecision?.qualified,
    true,
    "the synthetic decision must genuinely qualify",
  );
  return {
    // The host evidence regresses; the protected record stays untouched.
    regress: () => (probe.subscriptionMediation.gatewayIntegration = "failed"),
    withdraw: async () => {
      unlinkSync(recordPath);
      await f.controller.qualify(id);
    },
  };
}
