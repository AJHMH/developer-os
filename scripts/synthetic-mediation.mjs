// A synthetic, owner-endorsed mediation decision for offline runs (Issue 04):
// a worker probe whose gateway evidence passed, and the protected decision
// record the controller re-qualifies, in a disposable owner folder. It is a
// stand-in that claims no inference and no qualification.
import { createHash, randomUUID } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ownWindowsPaths } from "./windows-owner.mjs";

const hash = (v) => createHash("sha256").update(v).digest("hex");
const macosNative =
  "0129f94f4f1197bd75f6c4265889061f386ed302bbc50c6e57e3e0660dfb28a7";

/** A macOS mediation decision for delivery `deliveryId` in controller
 * `state`, endorsing `usageAccountId` as its usage-reader account (without
 * it the record awaits endorsement and does not qualify). `accountId` is the
 * decision's credential account. Returns the worker `probe` for the
 * controller, `recordPath`, `write()`, which records a new decision (a new
 * run), `withdraw()`, which removes the record, `regress()`, which fails the
 * probe's gateway evidence, and `remove()` for the owner folder. */
export async function syntheticMediation({
  state,
  deliveryId,
  repository,
  usageAccountId,
  accountId = "a".repeat(64),
  runId = "00000000-0000-4000-8000-000000000021",
}) {
  const { gatewayRequest, subscriptionGatewayVersion } = await import(
    "../dist/subscription-gateway.js"
  );
  const { modelRelayVersion } = await import("../dist/model-relay.js");
  const { initializeWindowsAuthDirectory } = await import(
    "../dist/windows-auth-store.js"
  );
  const nativeVersion = hash(
    readFileSync(new URL("../dist/podman-native.js", import.meta.url)),
  );
  const owner = realpathSync(mkdtempSync(join(tmpdir(), "aios-mediation-")));
  if (process.platform === "win32") initializeWindowsAuthDirectory(owner);
  const policy = join(owner, "pins.json"),
    registration = join(owner, "registration.json");
  writeFileSync(policy, "synthetic independent pins", { mode: 0o600 });
  writeFileSync(registration, "synthetic registration", { mode: 0o600 });
  const probe = {
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
      relayDeliveryId: deliveryId,
      subscriptionInference: "not-run",
      nextAction: "Synthetic only",
    },
  };
  const recordPath = join(
    state,
    "subscription-decision-" + deliveryId + ".json",
  );
  let run = runId;
  const write = () => {
    const consumed = join(state, "inference-" + run + ".consumed");
    writeFileSync(consumed, "one-shot approval consumed\n", { mode: 0o600 });
    writeFileSync(
      recordPath,
      JSON.stringify({
        schema: 1,
        deliveryId,
        repositorySha256: hash(realpathSync(repository)),
        runId: run,
        observedAt: new Date().toISOString(),
        // The vault credential account differs from the usage-reader account.
        accountId,
        // Omitted for a record that still awaits the owner's endorsement.
        ...(usageAccountId === undefined ? {} : { usageAccountId }),
        policyPath: policy,
        policySha256: probe.policySha256,
        bindingSha256: probe.bindingSha256,
        registrationPath: registration,
        registrationSha256: hash(readFileSync(registration)),
        gatewayVersion: subscriptionGatewayVersion,
        relayVersion: modelRelayVersion,
        nativeVersion,
        workerExecutableSha256: macosNative,
        requestSha256: hash(gatewayRequest),
        subscriptionInference: "passed",
        gatewayRevoked: true,
        workerRemaining: 0,
        relayRemaining: 0,
      }),
      { mode: 0o600 },
    );
    ownWindowsPaths([state, policy, registration, recordPath, consumed]);
  };
  write();
  return {
    probe,
    recordPath,
    // A new decision: another run, observed now.
    write: () => {
      run = randomUUID();
      write();
    },
    withdraw: () => unlinkSync(recordPath),
    // The host evidence regresses; the protected record stays untouched.
    regress: () => (probe.subscriptionMediation.gatewayIntegration = "failed"),
    remove: () => rmSync(owner, { recursive: true, force: true }),
  };
}
