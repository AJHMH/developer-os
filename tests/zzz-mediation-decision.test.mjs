import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DeliveryController } from "../dist/controller.js";
import { subscriptionGatewayVersion } from "../dist/subscription-gateway.js";
import { endorseUsageAccount } from "../dist/subscription-endorsement.js";
import {
  executeMediationInference,
  prepareMediationInference,
} from "../scripts/record-mediation-decision.mjs";
import { syntheticMediation } from "../scripts/synthetic-mediation.mjs";
import { codingFixture } from "./helpers/feature-fixture.mjs";

const accountId = "a".repeat(64);
const usageAccount = createHash("sha256")
  .update("owner@example.test")
  .digest("hex");
const hostId = "urn:uuid:" + randomUUID();

// A CLI delivery whose fixed worker qualified with passing gateway evidence,
// and no decision record yet: the synthetic stand-in's record is withdrawn,
// keeping its owner pins and registration for the real record to name.
async function qualifiedDelivery(t) {
  const f = codingFixture(t);
  const id = f.delivery.id;
  const mediation = await syntheticMediation({
    state: f.state,
    deliveryId: id,
    repository: f.repository,
  });
  t.after(mediation.remove);
  const { policyPath, registrationPath } = JSON.parse(
    readFileSync(mediation.recordPath, "utf8"),
  );
  mediation.withdraw();
  const controller = new DeliveryController(f.state, f.options, {
    worker: { probe: async () => structuredClone(mediation.probe) },
  });
  const workerExecutableSha256 =
    mediation.probe.subscriptionMediation.workerExecutableSha256;
  const reads = [];
  const native = {
    gateways: [],
    proof: {
      explicitResume: "passed",
      resumeInferenceRequests: 0,
      shutdown: { remainingProcesses: 0 },
      relayShutdownRemaining: 0,
      binarySha256: workerExecutableSha256,
      gatewayVersion: subscriptionGatewayVersion,
    },
    async inferThroughGateway(repository, deliveryId, begin) {
      assert.equal(deliveryId, id);
      // The markers already spent when the gateway may first be opened.
      this.consumedAtInference = readdirSync(f.state).filter((name) =>
        name.endsWith(".consumed"),
      );
      const gateway = begin();
      const revoke = gateway.revoke.bind(gateway);
      gateway.revoke = () => ((this.revoked = true), revoke());
      this.gateways.push(gateway);
      return structuredClone(this.proof);
    },
  };
  const inputs = {
    controller,
    state: f.state,
    deliveryId: id,
    accountId,
    hostId,
    policyPath,
    registrationPath,
    account: () => (reads.push(accountId), {}),
  };
  return { f, id, inputs, native, reads, mediation };
}

test("prepare names the qualified fixed worker's evidence and reads no credential", async (t) => {
  const { f, id, inputs, reads, mediation } = await qualifiedDelivery(t);
  const plan = await prepareMediationInference(inputs);
  assert.equal(plan.deliveryId, id);
  assert.equal(plan.accountId, accountId);
  assert.equal(plan.hostId, hostId);
  assert.equal(plan.policySha256, mediation.probe.policySha256);
  assert.equal(plan.maxRequests, 1);
  const path = join(f.state, `mediation-inference-${plan.runId}.plan.json`);
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), plan);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(reads, []);
  // Without passing gateway evidence there is nothing to plan.
  mediation.regress();
  await assert.rejects(
    prepareMediationInference(inputs),
    /fixed worker's mediation evidence/,
  );
});

test("refused mediation evidence names where the probe stopped", async (t) => {
  const { inputs, mediation } = await qualifiedDelivery(t);
  mediation.regress();
  const { probe } = mediation;
  await assert.rejects(prepareMediationInference(inputs), (error) => {
    assert.doesNotMatch(error.message, /stopped at/);
    return true;
  });
  for (const [change, named] of [
    [
      (q) => {
        q.subscriptionMediation.workerBlocker = "codex-protocol-deadline";
        q.subscriptionMediation.workerDiagnostic = {
          elapsedMs: 41000,
          failureKind: "timeout",
        };
      },
      /stopped at codex-protocol-deadline after 41000 ms\./,
    ],
    [
      (q) => {
        delete q.subscriptionMediation.workerBlocker;
        delete q.subscriptionMediation.workerDiagnostic;
        q.adversarialBlocker = "isolation-probe";
      },
      /stopped at isolation-probe\./,
    ],
    [
      (q) => {
        q.adversarialDiagnostic = {
          step: "isolate",
          failure: "timeout",
          stepElapsedMs: 90004,
          elapsedMs: 90011,
        };
      },
      /stopped at isolation-probe \(isolate, timeout\) after 90004 ms\./,
    ],
    [
      (q) => {
        q.adversarialDiagnostic = {
          step: "codex-stream",
          failure: "exit",
          exitStatus: 255,
          stepElapsedMs: 41000,
          elapsedMs: 70000,
        };
      },
      /stopped at isolation-probe \(codex-stream, exit 255\) after 41000 ms\./,
    ],
    [
      (q) => {
        delete q.adversarialBlocker;
        delete q.adversarialDiagnostic;
        q.offlineAdmission.refusal = "binding";
      },
      /stopped at binding\./,
    ],
  ]) {
    change(probe);
    await assert.rejects(prepareMediationInference(inputs), named);
  }
});

test("execute spends the one-shot approval before any credential, then records the decision", async (t) => {
  const { f, id, inputs, native } = await qualifiedDelivery(t);
  const plan = await prepareMediationInference(inputs);
  const record = await executeMediationInference({
    ...inputs,
    native,
    runId: plan.runId,
    unknownUsageApproved: true,
  });
  assert.ok(
    native.consumedAtInference.includes(`inference-${plan.runId}.consumed`),
  );
  assert.equal(native.gateways.length, 1);
  assert.equal(native.revoked, true);
  assert.equal(record.runId, plan.runId);
  assert.equal(record.usageAccountId, undefined);
  assert.equal(
    readFileSync(join(f.state, `inference-${plan.runId}.consumed`), "utf8"),
    "one-shot approval consumed\n",
  );
  // The owner endorses the usage account, and the decision then qualifies.
  const recordPath = join(f.state, `subscription-decision-${id}.json`);
  await endorseUsageAccount({
    state: f.state,
    deliveryId: id,
    reader: async () => ({
      observedAt: new Date().toISOString(),
      accountId: usageAccount,
      authMode: "chatgpt",
      windows: [
        {
          id: "primary",
          usedPercent: 10,
          resetsAt: Math.floor(Date.now() / 1000) + 3600,
        },
      ],
      exhausted: false,
    }),
    expectedUsageAccountId: usageAccount,
    confirm: true,
  });
  const decision = (await inputs.controller.qualify(id)).qualification
    .subscriptionMediation.mechanismDecision;
  assert.equal(decision.qualified, true);
  assert.equal(decision.runId, plan.runId);
  assert.equal(decision.accountId, accountId);
  assert.equal(decision.usageAccountId, usageAccount);
  assert.equal(decision.inferenceAuthorized, false);
  // The approval is spent: the same run never infers again.
  await assert.rejects(
    executeMediationInference({
      ...inputs,
      native,
      runId: plan.runId,
      unknownUsageApproved: true,
    }),
    /already spent/,
  );
  assert.equal(native.gateways.length, 1);
});

test("an approval that does not match a current plan spends nothing", async (t) => {
  const { f, inputs, native, mediation } = await qualifiedDelivery(t);
  const plan = await prepareMediationInference(inputs);
  const execute = (overrides) =>
    executeMediationInference({
      ...inputs,
      native,
      runId: plan.runId,
      unknownUsageApproved: true,
      ...overrides,
    });
  for (const [overrides, reason] of [
    [{ unknownUsageApproved: false }, /unknown usage/],
    [{ runId: "not-a-run" }, /current plan/],
    [{ runId: randomUUID() }, /current plan/],
    [{ accountId: "b".repeat(64) }, /current plan/],
    [{ hostId: "urn:uuid:" + randomUUID() }, /current plan/],
    [{ now: plan.expiresAt }, /current plan/],
  ])
    await assert.rejects(execute(overrides), reason);
  // Drifted worker evidence since the plan refuses too.
  mediation.probe.policySha256 = "f".repeat(64);
  await assert.rejects(
    execute({}),
    /fixed worker's mediation evidence|current plan/,
  );
  assert.equal(native.gateways.length, 0);
  assert.equal(
    existsSync(join(f.state, `inference-${plan.runId}.consumed`)),
    false,
  );
});

test("an inference whose proof fails is spent and records no decision", async (t) => {
  const { f, id, inputs, native } = await qualifiedDelivery(t);
  const plan = await prepareMediationInference(inputs);
  native.proof.shutdown.remainingProcesses = 1;
  await assert.rejects(
    executeMediationInference({
      ...inputs,
      native,
      runId: plan.runId,
      unknownUsageApproved: true,
    }),
    /inference proof/,
  );
  assert.ok(existsSync(join(f.state, `inference-${plan.runId}.consumed`)));
  assert.equal(
    existsSync(join(f.state, `subscription-decision-${id}.json`)),
    false,
  );
});

test("a refused inference names where it stopped, with no credential detail", async (t) => {
  const { f, id, inputs, native } = await qualifiedDelivery(t);
  const refuse = async (fail) => {
    const plan = await prepareMediationInference(inputs);
    native.inferThroughGateway = async (repository, deliveryId, begin) => {
      fail(begin);
      throw Error("Unverified inference bridge");
    };
    const error = await executeMediationInference({
      ...inputs,
      native,
      runId: plan.runId,
      unknownUsageApproved: true,
    }).catch((error) => error);
    assert.ok(existsSync(join(f.state, `inference-${plan.runId}.consumed`)));
    assert.equal(
      existsSync(join(f.state, `subscription-decision-${id}.json`)),
      false,
    );
    // The owner sees it through the routed runner, which keeps 300 characters.
    assert.ok(error.message.length <= 300, error.message);
    return error.message;
  };
  // The provider refused the gateway's one request.
  const provider = await refuse((begin) => {
    const gateway = begin();
    Object.assign(gateway, {
      phase: "provider-request",
      providerAttempts: 1,
      providerStatus: 401,
    });
  });
  assert.match(provider, /^The live inference was refused/);
  assert.match(provider, /Unverified inference bridge/);
  assert.match(provider, /gateway phase provider-request/);
  assert.match(provider, /1 provider request/);
  assert.match(provider, /provider status 401/);
  // The worker failed before it asked the gateway for anything.
  const isolation = await refuse(() => {});
  assert.match(isolation, /the gateway was never opened/);
  // An unlisted error is named only as such.
  const unlisted = await refuse(() => {
    throw Error("token sk-secret");
  });
  assert.match(unlisted, /an unlisted error/);
  assert.doesNotMatch(unlisted, /sk-secret/);
});

test("a reply the gateway rejects keeps the gateway's content-free summary beside the spent approval", async (t) => {
  const { f, inputs, native } = await qualifiedDelivery(t);
  const plan = await prepareMediationInference(inputs);
  native.inferThroughGateway = async (repository, deliveryId, begin) => {
    const gateway = begin();
    // What the gateway itself records while checking a reply: labels and
    // counts only. The bridge reports the rejection as its own error.
    Object.assign(gateway, {
      phase: "response-validation",
      providerAttempts: 1,
    });
    Object.assign(gateway.stream, {
      format: "event-stream-or-invalid",
      records: 3,
      eventTypes: ["response.created", "response.in_progress", "other"],
    });
    throw Error("Gateway transport unavailable");
  };
  const error = await executeMediationInference({
    ...inputs,
    native,
    runId: plan.runId,
    unknownUsageApproved: true,
  }).catch((error) => error);
  const name = `inference-${plan.runId}.refusal.json`;
  assert.match(error.message, /"Gateway transport unavailable"/);
  assert.match(error.message, /gateway phase response-validation/);
  assert.ok(error.message.includes(name), error.message);
  assert.ok(error.message.length <= 300, error.message);
  const path = join(f.state, name);
  const summary = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(summary.runId, plan.runId);
  assert.equal(summary.refusal, "Gateway transport unavailable");
  assert.equal(summary.gateway.phase, "response-validation");
  assert.deepEqual(summary.gateway.stream.eventTypes, [
    "response.created",
    "response.in_progress",
    "other",
  ]);
  assert.equal(statSync(path).mode & 0o777, 0o600);
});

test("a new decision keeps the one it replaces", async (t) => {
  const { f, id, inputs, native } = await qualifiedDelivery(t);
  const run = async () => {
    const plan = await prepareMediationInference(inputs);
    await executeMediationInference({
      ...inputs,
      native,
      runId: plan.runId,
      unknownUsageApproved: true,
    });
    return plan.runId;
  };
  const first = await run();
  const recordPath = join(f.state, `subscription-decision-${id}.json`);
  const before = readFileSync(recordPath);
  const second = await run();
  assert.deepEqual(readFileSync(`${recordPath}.before-${second}`), before);
  assert.equal(JSON.parse(readFileSync(recordPath, "utf8")).runId, second);
  assert.notEqual(first, second);
});

test("the owner's command names every input, and approves only on execute", () => {
  const script = fileURLToPath(
    new URL("../scripts/record-mediation-decision.mjs", import.meta.url),
  );
  const inputs = [
    "--state-dir",
    "/owner/state",
    "--id",
    randomUUID(),
    "--podman-machine",
    "aios-test",
    "--worker-policy",
    "/owner/pins.json",
    "--auth-directory",
    "/owner/auth",
    "--auth-account",
    accountId,
  ];
  for (const args of [
    [],
    ["prepare"],
    ["prepare", ...inputs.slice(2)],
    ["prepare", ...inputs, "--approve-run", randomUUID()],
    ["execute", ...inputs],
    ["record", ...inputs],
  ]) {
    const run = spawnSync(process.execPath, [script, ...args], {
      encoding: "utf8",
    });
    assert.equal(run.status, 1, args.join(" "));
    assert.match(JSON.parse(run.stderr).error, /^Usage/);
  }
});
