// Preparation never opens the credential vault or invokes a subscription provider.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DeliveryController } from "../../dist/controller.js";
import { NativePodmanDriver } from "../../dist/podman-native.js";
import { PodmanHostAdapter } from "../../dist/podman-host.js";
import {
  HostSubscriptionGateway,
  gatewayRequest,
  subscriptionGatewayVersion,
} from "../../dist/subscription-gateway.js";
import { windowsAuthStore } from "../../dist/windows-auth-store.js";
import { prepareSubscriptionAuth } from "../../dist/subscription-auth.js";
const repository = "C:/Users/mraar/.developer-os/ticket19-native/repo";
const state = "C:/Users/mraar/.developer-os/ticket19-native/state";
const authDirectory =
  "C:/Users/mraar/.developer-os-model-auth/windows-ticket24";
const accountId =
  "6eb3ba924beedc723aaedd7d0a9a0f33b2a3ab65da012ec2bd5e07437b35f439";
const deliveryId = "46f3cefb-57e3-48fa-be4f-24fae4b37505";
const hash = (v) => createHash("sha256").update(v).digest("hex");
assert.equal(process.platform, "win32");
assert.equal(process.arch, "x64");
const args = process.argv.slice(2);
const executing = args.includes("--execute");
const policyPath = args[args.indexOf("--policy") + 1];
const artifact = new URL(
  "ticket24-windows-main-1b5b545-gateway-inference-plan.json",
  import.meta.url,
);
let gateway;
try {
  assert.ok(args.includes("--policy"));
  assert.ok(
    args.every(
      (a, i) =>
        [
          "--execute",
          "--policy",
          "--approve-run",
          "--approve-unknown-usage",
        ].includes(a) || ["--policy", "--approve-run"].includes(args[i - 1]),
    ),
  );
  const native = new NativePodmanDriver(
    "aios-podman-noshare",
    state,
    policyPath,
  );
  const worker = new PodmanHostAdapter({
    machine: native.machine,
    policyPath,
    native,
    adversarial: true,
  });
  const controller = new DeliveryController(state, {}, { worker });
  const observed = await controller.qualify(deliveryId);
  const q = observed.qualification;
  assert.equal(observed.execution.state, "stopped");
  assert.equal(q.offlineAdmission.allowed, true);
  assert.equal(q.subscriptionMediation.gatewayIntegration, "passed");
  assert.equal(
    q.subscriptionMediation.hostGatewayVersion,
    subscriptionGatewayVersion,
  );
  assert.equal(q.subscriptionMediation.codexCredentialIsolation, "passed");
  assert.equal(q.subscriptionMediation.relayDeliveryId, deliveryId);
  assert.equal(q.subscriptionMediation.qualified, false);
  assert.equal(q.subscriptionMediation.endpointEnforcement, "passed");
  assert.deepEqual(q.subscriptionMediation.deliveryCapabilityChecks, [
    "cross-delivery",
    "namespace",
    "revocation",
    "quota",
    "expiry",
  ]);
  writeFileSync(
    new URL(
      "ticket24-windows-main-1b5b545-gateway-observation.json",
      import.meta.url,
    ),
    JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        scope:
          "Actual isolated Codex through VM relay to host-only subscription gateway with synthetic account/provider; no live inference",
        qualification: q,
      },
      null,
      2,
    ) + "\n",
  );
  const registration = prepareSubscriptionAuth(
    authDirectory,
    repository,
    state,
  );
  if (!executing) {
    const plan = {
      runId: randomUUID(),
      preparedAt: new Date().toISOString(),
      expiresAt: Date.now() + 3600000,
      accountId,
      hostId: registration.hostId,
      deliveryId,
      request: JSON.parse(gatewayRequest),
      requestSha256: hash(gatewayRequest),
      policySha256: q.policySha256,
      bindingSha256: q.bindingSha256,
      gatewayVersion: subscriptionGatewayVersion,
      workerExecutableSha256: q.subscriptionMediation.workerExecutableSha256,
      upstream: "POST https://api.openai.com/v1/responses",
      maxRequests: 1,
      retries: 0,
      refresh: false,
      deadlineSeconds: 30,
      maxResponseBytes: 65536,
      usage:
        "unknown remaining subscription usage; exact run requires separate approval",
      worker:
        "isolated actual Codex 0.161.0 through VM management relay and host gateway; no tools/context forwarded upstream",
      credentialLocation:
        "host-only Windows CurrentUser DPAPI and trusted host memory",
      inferenceExecuted: false,
    };
    writeFileSync(artifact, JSON.stringify(plan, null, 2) + "\n");
    console.log(
      JSON.stringify({
        status: "prepared",
        runId: plan.runId,
        inferenceExecuted: false,
      }),
    );
  } else {
    const plan = JSON.parse(readFileSync(artifact, "utf8"));
    assert.ok(
      args.includes("--approve-run") &&
        args.includes("--approve-unknown-usage"),
    );
    assert.equal(args[args.indexOf("--approve-run") + 1], plan.runId);
    assert.match(plan.runId, /^[a-f0-9-]{36}$/);
    assert.ok(
      Number.isSafeInteger(plan.expiresAt) &&
        plan.expiresAt > Date.now() &&
        plan.expiresAt <= Date.now() + 3600000,
    );
    for (const [key, value] of Object.entries({
      accountId,
      hostId: registration.hostId,
      deliveryId,
      requestSha256: hash(gatewayRequest),
      policySha256: q.policySha256,
      bindingSha256: q.bindingSha256,
      gatewayVersion: subscriptionGatewayVersion,
      workerExecutableSha256: q.subscriptionMediation.workerExecutableSha256,
    }))
      assert.equal(plan[key], value);
    assert.equal(hash(JSON.stringify(plan.request)), hash(gatewayRequest));
    // Durable consumption is outside candidate storage and precedes credential access.
    writeFileSync(
      join(state, `inference-${plan.runId}.consumed`),
      "one-shot approval consumed\n",
      { flag: "wx", mode: 0o600, flush: true },
    );
    const beginGateway = () => {
      assert.ok(plan.expiresAt > Date.now());
      gateway = new HostSubscriptionGateway(
        {
          runId: plan.runId,
          deliveryId,
          accountId,
          hostId: registration.hostId,
          requestSha256: plan.requestSha256,
          expiresAt: Date.now() + 30000,
          unknownUsageApproved: true,
        },
        () =>
          JSON.parse(
            Buffer.from(
              windowsAuthStore(authDirectory).read(accountId),
              "base64",
            ).toString("utf8"),
          ),
      );
      return gateway;
    };
    const proof = await native.inferThroughGateway(
      repository,
      deliveryId,
      beginGateway,
    );
    const result = {
      observedAt: new Date().toISOString(),
      runId: plan.runId,
      scope:
        "One fixed actual Codex turn through host-only subscription gateway",
      subscriptionInference: "passed",
      gatewayRevoked: true,
      deliveryEnabled: false,
      proof,
    };
    writeFileSync(
      new URL(
        "ticket24-windows-main-1b5b545-gateway-inference-observation.json",
        import.meta.url,
      ),
      JSON.stringify(result, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({
        status: "completed",
        runId: plan.runId,
        deliveryEnabled: false,
      }),
    );
  }
} catch {
  if (gateway)
    writeFileSync(
      new URL(
        "ticket24-windows-main-1b5b545-gateway-inference-observation.json",
        import.meta.url,
      ),
      JSON.stringify(
        {
          observedAt: new Date().toISOString(),
          runId: args[args.indexOf("--approve-run") + 1],
          status: "refused",
          scope: "Actual Codex through host-only subscription gateway",
          approvalConsumed: true,
          gateway: gateway.observation,
          subscriptionInference:
            gateway.observation.providerAttempts > 0 ? "unverified" : "not-run",
          deliveryEnabled: false,
        },
        null,
        2,
      ) + "\n",
    );
  console.error(
    JSON.stringify({
      status: "refused",
      nextAction:
        "Check fresh source/VM pins, exact unused approval and host credential expiry. No retries, refresh or paid fallback.",
      deliveryEnabled: false,
    }),
  );
  process.exitCode = 1;
} finally {
  gateway?.revoke();
}
