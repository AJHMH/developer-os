// Prepare by default. --execute is for a separately approved one-shot run only.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DeliveryController } from "../../dist/controller.js";
import { NativePodmanDriver } from "../../dist/podman-native.js";
import { PodmanHostAdapter } from "../../dist/podman-host.js";
import { macKeychainStore } from "../../dist/keychain-store.js";
import { prepareSubscriptionAuth } from "../../dist/subscription-auth.js";
import { RevocableModelGrant } from "../../dist/model-relay.js";
const state = "/Users/aaronhoward/.developer-os/ticket4-macos/state";
const repository = "/Users/aaronhoward/.developer-os/ticket4-macos/input";
const authDirectory = "/Users/aaronhoward/.developer-os-model-auth";
const accountId =
  "397124263a7a93863a363c03d1245fa439396ec2edfde186df75802bb7b68f2b";
const id = "29727630-9a13-4050-a217-7a554b04448e";
const policyPath =
  "/Users/aaronhoward/.developer-os/ticket4-macos/pins-ticket21-frame.json";
const expected = "AIOS model-only inference complete";
const request = {
  model: "gpt-6.1-sol",
  input: [{ role: "user", content: `Say exactly: ${expected}` }],
  store: false,
  stream: true,
};
const body = JSON.stringify(request);
const hash = (v) => createHash("sha256").update(v).digest("hex");
const artifact = new URL("ticket21-inference-plan.json", import.meta.url);
const args = process.argv.slice(2);
const executing = args.includes("--execute");
const native = new NativePodmanDriver("aios-macos-noshare", state, policyPath);
const worker = new PodmanHostAdapter({
  machine: native.machine,
  policyPath,
  native,
  adversarial: true,
});
const controller = new DeliveryController(state, {}, { worker });
let grant;
try {
  if (
    args.some(
      (a, i) =>
        !["--execute", "--approve-run", "--approve-unknown-usage"].includes(
          a,
        ) && args[i - 1] !== "--approve-run",
    )
  )
    throw Error();
  const observed = await controller.qualify(id);
  assert.equal(observed.execution.state, "stopped");
  const q = observed.qualification;
  assert.equal(q.offlineAdmission.allowed, true);
  assert.equal(q.subscriptionMediation.credentialIsolation, "passed");
  assert.equal(
    q.subscriptionMediation.credentialIsolationScope,
    "synthetic-restricted-alpine",
  );
  assert.equal(q.subscriptionMediation.relayRevocation, "passed");
  assert.equal(q.subscriptionMediation.modelFrameTransport, "passed");
  if (!executing) {
    const plan = {
      runId: randomUUID(),
      preparedAt: new Date().toISOString(),
      expiresAt: Date.now() + 3600000,
      accountId,
      deliveryId: id,
      request,
      requestSha256: hash(body),
      policySha256: q.policySha256,
      bindingSha256: q.bindingSha256,
      relayVersion: q.subscriptionMediation.relayVersion,
      usage:
        "unknown; separate explicit approval required for this account and run",
      upstream: "POST https://api.openai.com/v1/responses",
      deadlineSeconds: 30,
      maxResponseBytes: 65536,
      maxRequests: 1,
      retries: 0,
      expectedOutput: expected,
      worker:
        "restricted Alpine stdin fixture; no Codex tools or production dispatch",
      credentialLocation: "trusted host memory and macOS Keychain only",
      inferenceExecuted: false,
    };
    writeFileSync(artifact, JSON.stringify(plan, null, 2) + "\n");
    console.log(
      JSON.stringify({
        status: "prepared",
        runId: plan.runId,
        inferenceExecuted: false,
        deliveryEnabled: false,
      }),
    );
  } else {
    const plan = JSON.parse(readFileSync(artifact, "utf8"));
    const approval = args[args.indexOf("--approve-run") + 1];
    assert.ok(
      args.includes("--approve-run") &&
        args.includes("--approve-unknown-usage"),
    );
    assert.equal(approval, plan.runId);
    assert.match(approval, /^[a-f0-9-]{36}$/);
    assert.ok(
      plan.expiresAt > Date.now() && plan.expiresAt <= Date.now() + 3600000,
    );
    assert.equal(plan.accountId, accountId);
    assert.equal(plan.requestSha256, hash(body));
    assert.equal(plan.policySha256, q.policySha256);
    assert.equal(plan.bindingSha256, q.bindingSha256);
    assert.equal(plan.relayVersion, q.subscriptionMediation.relayVersion);
    // This one-shot grant explicitly approves UNKNOWN usage, not a financial cap.
    // Consume outside the candidate before credential access; crashes cannot replay.
    writeFileSync(
      join(state, `inference-${approval}.consumed`),
      "one-shot approval consumed\n",
      { flag: "wx", mode: 0o600 },
    );
    const registration = prepareSubscriptionAuth(
      authDirectory,
      repository,
      state,
    );
    const account = JSON.parse(
      Buffer.from(
        macKeychainStore(authDirectory).read(accountId),
        "base64",
      ).toString("utf8"),
    );
    assert.equal(
      hash(
        JSON.stringify([
          account.issuer,
          account.clientId,
          account.subject,
          account.hostId,
        ]),
      ),
      accountId,
    );
    assert.equal(account.issuer, "https://auth.openai.com");
    assert.equal(account.hostId, registration.hostId);
    assert.equal(account.planUsageAuthorized, true);
    assert.ok(
      account.scopes.includes("resource.invoke") &&
        account.scopes.includes("chatgpt.tokens.use.direct"),
    );
    assert.ok(
      Number.isSafeInteger(account.expiresAt) &&
        account.expiresAt > Date.now() + 30000,
    );
    assert.ok(
      typeof account.accessToken === "string" && account.accessToken.length > 0,
    );
    // No refresh or account switching: expired credentials refuse before inference.
    const emitted = native.modelFrame(repository, "request", body);
    assert.equal(Buffer.from(emitted.frame, "base64").toString(), body);
    grant = new RevocableModelGrant();
    assert.ok(grant.permits(grant.capability));
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      redirect: "error",
      signal: grant.signal,
      headers: {
        authorization: `Bearer ${account.accessToken}`,
        "content-type": "application/json",
      },
      body,
    });
    if (!response.ok) throw Error();
    const reader = response.body?.getReader();
    if (!reader) throw Error();
    let bytes = 0;
    const chunks = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 65536) throw Error();
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel();
    }
    if (grant.revoked) throw Error();
    let completed = false,
      failed = false,
      output = "";
    for (const record of Buffer.concat(chunks)
      .toString("utf8")
      .replace(/\r\n/g, "\n")
      .split("\n\n")) {
      const data = record
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      const event = JSON.parse(data);
      if (event.type === "response.output_text.delta") output += event.delta;
      if (
        event.type === "response.completed" &&
        event.response?.status === "completed"
      )
        completed = true;
      if (
        ["error", "response.failed", "response.incomplete"].includes(event.type)
      )
        failed = true;
    }
    assert.ok(completed && !failed);
    assert.equal(output.trim(), expected);
    grant.revoke();
    assert.equal(grant.permits(grant.capability), false);
    const returned = native.modelFrame(repository, "response", expected);
    assert.equal(Buffer.from(returned.frame, "base64").toString(), expected);
    console.log(
      JSON.stringify({
        status: "completed",
        runId: approval,
        subscriptionInference: "passed",
        scope: "fixed restricted Alpine stdin fixture only",
        relayRevoked: true,
        deliveryEnabled: false,
      }),
    );
  }
} catch {
  // Never print provider bodies, tokens, raw assertion values or Keychain records.
  console.error(
    JSON.stringify({
      status: "refused",
      nextAction:
        "Inspect current VM pins, qualification, one-shot approval and separate credential expiry; no automatic retry, refresh or paid fallback.",
      deliveryEnabled: false,
    }),
  );
  process.exitCode = 1;
} finally {
  grant?.revoke();
}
