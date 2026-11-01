// Owner-run: records a delivery's mediation decision from one fixed-worker
// inference through the host-only subscription gateway (ADR 0002), so that a
// routed `code-feature` turn can use it. Promoted from the retained macOS and
// Windows acceptance flows in `.scratch/aios-v1-implementation/`.
//
//   prepare: qualify the delivery with the fixed worker, check its mediation
//     evidence and write a plan naming it. No credential is read.
//   execute: spend the owner's one-shot approval of that plan, run the one
//     fixed inference, check its proof and write the protected decision
//     record. The owner then endorses its usage account with
//     scripts/endorse-subscription-usage.mjs.
//
// Production stays disabled; the decision authorizes no inference itself.
import { createHash, randomUUID } from "node:crypto";
import {
  constants,
  copyFileSync,
  existsSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const hex = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
/** A plan the owner has not approved within this window lapses. */
export const mediationPlanMs = 60 * 60_000;
const planPath = (state, runId) =>
  join(state, `mediation-inference-${runId}.plan.json`);
// The name the decision projection checks for the spent approval.
const consumedPath = (state, runId) =>
  join(state, `inference-${runId}.consumed`);
const evidenceFields = [
  "deliveryId",
  "accountId",
  "hostId",
  "requestSha256",
  "policySha256",
  "bindingSha256",
  "gatewayVersion",
  "workerExecutableSha256",
];

/** The delivery's fresh fixed-worker qualification, with every mediation
 * result the decision projection will require. */
async function mediationEvidence({
  controller,
  deliveryId,
  accountId,
  hostId,
}) {
  const { gatewayRequest, subscriptionGatewayVersion } = await import(
    "../dist/subscription-gateway.js"
  );
  const delivery = await controller.qualify(deliveryId);
  const q = delivery.qualification,
    m = q?.subscriptionMediation;
  if (
    q?.offlineAdmission?.allowed !== true ||
    !hex(q.policySha256) ||
    !hex(q.bindingSha256) ||
    m?.hostGateway !== "passed" ||
    m.hostGatewayVersion !== subscriptionGatewayVersion ||
    m.gatewayIntegration !== "passed" ||
    m.codexCredentialIsolation !== "passed" ||
    m.endpointEnforcement !== "passed" ||
    m.deliveryCapabilities !== "passed" ||
    m.relayDeliveryId !== deliveryId ||
    !hex(m.workerExecutableSha256)
  )
    throw Error(
      "The fixed worker's mediation evidence for this delivery has not passed. Qualify it with the fixed worker (qualify --adversarial) first.",
    );
  return {
    repository: delivery.repository,
    evidence: {
      deliveryId,
      accountId,
      hostId,
      requestSha256: hash(gatewayRequest),
      policySha256: q.policySha256,
      bindingSha256: q.bindingSha256,
      gatewayVersion: subscriptionGatewayVersion,
      workerExecutableSha256: m.workerExecutableSha256,
    },
  };
}

/** The owner's plan in the controller's private state: what the one-shot
 * approval names. */
export async function prepareMediationInference({
  controller,
  state,
  deliveryId,
  accountId,
  hostId,
  protect = () => {},
  now = Date.now(),
}) {
  const { evidence } = await mediationEvidence({
    controller,
    deliveryId,
    accountId,
    hostId,
  });
  const plan = {
    schema: 1,
    runId: randomUUID(),
    ...evidence,
    maxRequests: 1,
    createdAt: new Date(now).toISOString(),
    expiresAt: now + mediationPlanMs,
  };
  const path = planPath(state, plan.runId);
  writeFileSync(path, JSON.stringify(plan, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
  protect([path]);
  return plan;
}

/** Spend the owner's approval of plan `runId`, run the one fixed inference,
 * and record the delivery's decision once its proof passes. `account` reads
 * the owner's credential; it is reached only through the gateway, after the
 * approval is spent. Returns the record. */
export async function executeMediationInference({
  controller,
  native,
  state,
  deliveryId,
  accountId,
  hostId,
  policyPath,
  registrationPath,
  account,
  runId,
  unknownUsageApproved,
  protect = () => {},
  now = Date.now(),
}) {
  const { HostSubscriptionGateway } = await import(
    "../dist/subscription-gateway.js"
  );
  const { inferenceWindowMs } = await import("../dist/subscription-account.js");
  const { modelRelayVersion } = await import("../dist/model-relay.js");
  // The fixed gateway reads no usage; the owner accepts that explicitly.
  if (unknownUsageApproved !== true)
    throw Error(
      "The run must approve unknown usage, as the fixed gateway reads none.",
    );
  const refused = () =>
    Error("The approval does not match a current plan for this delivery.");
  if (!uuid.test(runId ?? "")) throw refused();
  let plan;
  try {
    plan = JSON.parse(readFileSync(planPath(state, runId), "utf8"));
  } catch {
    throw refused();
  }
  const { repository, evidence } = await mediationEvidence({
    controller,
    deliveryId,
    accountId,
    hostId,
  });
  if (
    plan.schema !== 1 ||
    plan.runId !== runId ||
    plan.maxRequests !== 1 ||
    evidenceFields.some((field) => plan[field] !== evidence[field]) ||
    !Number.isSafeInteger(plan.expiresAt) ||
    now >= plan.expiresAt
  )
    throw refused();
  // Spent before any credential can be read: one approval, one inference.
  const consumed = consumedPath(state, runId);
  try {
    writeFileSync(consumed, "one-shot approval consumed\n", {
      flag: "wx",
      mode: 0o600,
      flush: true,
    });
  } catch (error) {
    if (error.code === "EEXIST")
      throw Error("This run's approval is already spent.");
    throw error;
  }
  protect([consumed]);
  let gateway;
  try {
    const proof = await native.inferThroughGateway(
      repository,
      deliveryId,
      () =>
        (gateway = new HostSubscriptionGateway(
          {
            runId,
            deliveryId,
            accountId,
            hostId,
            requestSha256: plan.requestSha256,
            expiresAt: Date.now() + inferenceWindowMs,
            unknownUsageApproved: true,
          },
          account,
        )),
    );
    if (
      proof?.explicitResume !== "passed" ||
      proof.resumeInferenceRequests !== 0 ||
      proof.shutdown?.remainingProcesses !== 0 ||
      proof.relayShutdownRemaining !== 0 ||
      proof.binarySha256 !== plan.workerExecutableSha256 ||
      proof.gatewayVersion !== plan.gatewayVersion
    )
      throw Error("The inference proof did not pass; no decision is recorded.");
  } finally {
    gateway?.revoke();
  }
  const record = {
    schema: 1,
    deliveryId,
    repositorySha256: hash(realpathSync(repository)),
    runId,
    observedAt: new Date().toISOString(),
    accountId,
    policyPath,
    policySha256: plan.policySha256,
    bindingSha256: plan.bindingSha256,
    registrationPath,
    registrationSha256: hash(readFileSync(registrationPath)),
    gatewayVersion: plan.gatewayVersion,
    relayVersion: modelRelayVersion,
    nativeVersion: hash(
      readFileSync(new URL("../dist/podman-native.js", import.meta.url)),
    ),
    workerExecutableSha256: plan.workerExecutableSha256,
    requestSha256: plan.requestSha256,
    subscriptionInference: "passed",
    gatewayRevoked: true,
    workerRemaining: 0,
    relayRemaining: 0,
  };
  // A replaced decision is kept beside the new one; an interrupted write
  // leaves the previous record in place.
  const path = join(state, `subscription-decision-${deliveryId}.json`);
  const bytes = JSON.stringify(record, null, 2) + "\n";
  if (existsSync(path)) {
    const backup = `${path}.before-${runId}`;
    copyFileSync(path, backup, constants.COPYFILE_EXCL);
    protect([backup]);
    const replacement = `${path}.new-${runId}`;
    writeFileSync(replacement, bytes, { flag: "wx", mode: 0o600, flush: true });
    protect([replacement]);
    renameSync(replacement, path);
  } else writeFileSync(path, bytes, { flag: "wx", mode: 0o600, flush: true });
  protect([path]);
  return record;
}

const usage = `Usage (owner-run, on the delivery's host, after the fixed worker qualified it):
  node scripts/record-mediation-decision.mjs prepare --state-dir DIR --id DELIVERY --podman-machine MACHINE --worker-policy PINS --auth-directory DIR --auth-account ACCOUNT
  node scripts/record-mediation-decision.mjs execute (the same options) --approve-run RUN --approve-unknown-usage`;

async function main(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "state-dir": { type: "string" },
      id: { type: "string" },
      "podman-machine": { type: "string" },
      "worker-policy": { type: "string" },
      "auth-directory": { type: "string" },
      "auth-account": { type: "string" },
      "approve-run": { type: "string" },
      "approve-unknown-usage": { type: "boolean" },
    },
  });
  const [action] = positionals;
  const required = [
    "state-dir",
    "id",
    "podman-machine",
    "worker-policy",
    "auth-directory",
    "auth-account",
  ];
  if (
    positionals.length !== 1 ||
    !["prepare", "execute"].includes(action) ||
    required.some((name) => !values[name]) ||
    (action === "prepare") !==
      (values["approve-run"] === undefined &&
        values["approve-unknown-usage"] === undefined)
  )
    throw Error(usage);
  if (
    !(
      (process.platform === "darwin" && process.arch === "arm64") ||
      (process.platform === "win32" && process.arch === "x64")
    )
  )
    throw Error("Run this on the delivery's macOS arm64 or Windows x64 host.");
  const { DeliveryController } = await import("../dist/controller.js");
  const { NativePodmanDriver } = await import("../dist/podman-native.js");
  const { PodmanHostAdapter } = await import("../dist/podman-host.js");
  const { hostRegistration, vaultAccount } = await import(
    "../dist/general-sessions.js"
  );
  const { hostCredentialVault } = await import("../dist/credential-vault.js");
  const { assertPrivateAuthStorage } = await import(
    "../dist/private-storage.js"
  );
  const state = realpathSync(values["state-dir"]);
  assertPrivateAuthStorage(state, "directory");
  const authDirectory = values["auth-directory"];
  const { hostId } = hostRegistration(authDirectory);
  const policyPath = realpathSync(values["worker-policy"]);
  const native = new NativePodmanDriver(
    values["podman-machine"],
    state,
    policyPath,
  );
  const controller = new DeliveryController(
    state,
    {},
    {
      worker: new PodmanHostAdapter({
        machine: native.machine,
        policyPath,
        native,
        adversarial: true,
      }),
    },
  );
  let protect = () => {};
  if (process.platform === "win32") {
    const { windowsAuthStore } = await import("../dist/windows-auth-store.js");
    protect = (paths) => windowsAuthStore(state, paths);
  }
  const inputs = {
    controller,
    state,
    deliveryId: values.id,
    accountId: values["auth-account"],
    hostId,
    protect,
  };
  if (action === "prepare") {
    const plan = await prepareMediationInference(inputs);
    return {
      status: "prepared",
      runId: plan.runId,
      expiresAt: new Date(plan.expiresAt).toISOString(),
      inferenceExecuted: false,
      next: "Approve this run ID to spend it on one fixed inference.",
    };
  }
  const record = await executeMediationInference({
    ...inputs,
    native,
    policyPath,
    registrationPath: realpathSync(join(authDirectory, "registration.json")),
    // Opened only at the gateway's one provider request.
    account: vaultAccount(
      hostCredentialVault(authDirectory, true),
      values["auth-account"],
      hostId,
    ),
    runId: values["approve-run"],
    unknownUsageApproved: values["approve-unknown-usage"] === true,
  });
  return {
    status: "recorded",
    runId: record.runId,
    deliveryEnabled: false,
    next: "Endorse the usage account with scripts/endorse-subscription-usage.mjs.",
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main(process.argv.slice(2)).then(
    (result) => console.log(JSON.stringify(result)),
    (error) => {
      // Only this script's own messages; never provider or credential detail.
      const message = String(error?.message ?? "");
      console.error(
        JSON.stringify({
          status: "refused",
          error: /^(Usage|Run this|The |This run)/.test(message)
            ? message
            : "The run was refused. Check fresh pins, the exact unused approval and host credential expiry; there are no retries, refresh or paid fallback.",
          deliveryEnabled: false,
        }),
      );
      process.exitCode = 1;
    },
  );
