// Explicit host acceptance runner; never part of the automatic unit-test suite.
// node .scratch/aios-v1-implementation/macos-roundtrip-acceptance.mjs <delivery-id> <external-pins>
// Requires prior explicit pin-offline enrollment and a stopped, owned synthetic delivery.
import assert from "node:assert/strict";
import {
  readFileSync,
  writeFileSync,
  linkSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DeliveryController } from "../../dist/controller.js";
import { PodmanHostAdapter } from "../../dist/podman-host.js";
import { NativePodmanDriver } from "../../dist/podman-native.js";

const id = process.argv[2];
assert.match(id ?? "", /^[a-f0-9-]{36}$/);
const root = join(homedir(), ".developer-os", "ticket4-macos");
const state = join(root, "state");
const pins = process.argv[3];
assert.ok(pins);
const machine = "aios-macos-noshare";
const native = new NativePodmanDriver(machine, state, pins);
const worker = new PodmanHostAdapter({ machine, policyPath: pins, native });
const controller = new DeliveryController(
  state,
  {},
  { worker, offline: native },
);
const initial = controller.status(id);
assert.equal(initial.ownership.held, true);
assert.equal(initial.phase, "blocked");
assert.equal(process.platform, "darwin");
assert.equal(process.arch, "arm64");
const originalInput = readFileSync(join(initial.repository, "canary.txt"));
assert.equal(originalInput.toString(), "AIOS offline canary input\n");
const checks = [];

const badPins = join(root, "changed-pins.json");
assert.equal(existsSync(badPins), false);
const policy = JSON.parse(readFileSync(pins));
policy.binding.vmImageSha256 = "0".repeat(64);
writeFileSync(badPins, JSON.stringify(policy), { flag: "wx" });
try {
  const changed = new NativePodmanDriver(machine, state, badPins);
  const rejected = await new DeliveryController(
    state,
    {},
    {
      worker: new PodmanHostAdapter({
        machine,
        policyPath: badPins,
        native: changed,
      }),
      offline: changed,
    },
  ).qualify(id);
  assert.equal(rejected.qualification.offlineAdmission.allowed, false);
  checks.push("changed VM-image pins refused before worker launch");
} finally {
  unlinkSync(badPins);
}

const metadata = await controller.offlineCanary(id, [
  { path: ".git/config", sha256: "0".repeat(64) },
]);
assert.equal(metadata.offlineCanary.outcome, "refused");
checks.push("Git metadata input refused through native admission path");

const inputPath = join(initial.repository, "canary.txt");
const hardlink = join(initial.repository, "canary-hardlink.txt");
linkSync(inputPath, hardlink);
try {
  assert.equal(
    (await controller.offlineCanary(id)).offlineCanary.outcome,
    "refused",
  );
  checks.push("hard-linked native input refused");
} finally {
  unlinkSync(hardlink);
}

writeFileSync(inputPath, "token=synthetic-native-secret\n");
try {
  assert.equal(
    (await controller.offlineCanary(id)).offlineCanary.outcome,
    "refused",
  );
  checks.push("credential-like native input refused");
} finally {
  writeFileSync(inputPath, originalInput);
}

let collectionAttempted = false;
const uncertainRuntime = {
  mode: "live",
  execute: (request) => native.execute(request),
  stop: async (session, bindings) => ({
    ...(await native.stop(session, bindings)),
    descendantsStopped: false,
  }),
  collect: async () => {
    collectionAttempted = true;
    assert.fail("uncertain shutdown cannot collect");
  },
};
const uncertain = await new DeliveryController(
  state,
  {},
  { worker, offline: uncertainRuntime },
).offlineCanary(id);
assert.equal(uncertain.offlineCanary.outcome, "uncertain");
assert.equal(collectionAttempted, false);
assert.throws(() => controller.release(id), /shutdown/i);
const recovered = await new DeliveryController(
  state,
  {},
  { offline: native },
).recover(id);
assert.equal(recovered.execution.state, "stopped");
checks.push(
  "unknown shutdown blocks collection/release; new controller reconciles exact native session",
);

let nativeStop;
const observedRuntime = {
  mode: "live",
  execute: (request) => native.execute(request),
  stop: async (session, bindings) =>
    (nativeStop = await native.stop(session, bindings)),
  collect: (session, bindings) => native.collect(session, bindings),
};
const result = await new DeliveryController(
  state,
  {},
  { worker, offline: observedRuntime },
).offlineCanary(id);
assert.equal(result.qualification.offlineAdmission.allowed, true);
assert.equal(result.qualification.offlineAdmission.binding.provider, "applehv");
assert.equal(result.qualification.offlineAdmission.binding.arch, "arm64");
assert.equal(result.qualification.liveReady, false);
assert.equal(result.qualification.ready, false);
assert.equal(result.offlineCanary.outcome, "completed");
assert.equal(result.offlineCanary.mode, "live");
assert.equal(result.execution.state, "stopped");
assert.ok(nativeStop.evidence.observedProcesses >= 8);
assert.equal(nativeStop.evidence.remainingProcesses, 0);
const evidence = result.evidence
  .filter((e) => e.kind === "offline-canary")
  .at(-1);
const artifact = JSON.parse(readFileSync(evidence.path));
assert.equal(artifact.output.content, "AIOS offline canary complete\n");
assert.deepEqual(
  new DeliveryController(state).status(id).offlineCanary,
  result.offlineCanary,
);
checks.push(
  "fresh actual offline worker completes input transfer, verified shutdown and artifact collection",
);

writeFileSync(
  ".scratch/aios-v1-implementation/ticket25-macos-current-roundtrip.json",
  JSON.stringify(
    {
      observedAt: new Date().toISOString(),
      machine,
      deliveryId: id,
      checks,
      qualification: result.qualification,
      canary: result.offlineCanary,
      artifact,
      nativeShutdown: nativeStop.evidence,
      scope:
        "Fixed synthetic macOS AppleHV ARM64 round trip only; no inference, repository scripts, owner credential imports or production qualification.",
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    outcome: "completed",
    checks,
    session: result.execution,
    artifact: artifact.output,
  }),
);
