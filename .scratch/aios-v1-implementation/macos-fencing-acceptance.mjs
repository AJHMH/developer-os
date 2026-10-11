// Explicit synthetic native acceptance; never part of the automatic test suite.
// node .scratch/aios-v1-implementation/macos-fencing-acceptance.mjs <delivery-id> <external-pins>
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { DeliveryController } from "../../dist/controller.js";
import { PodmanHostAdapter } from "../../dist/podman-host.js";
import { NativePodmanDriver } from "../../dist/podman-native.js";

const crashing = process.argv[2] === "--crash-child";
const id = process.argv[crashing ? 3 : 2];
const policyPath = process.argv[crashing ? 4 : 3];
assert.match(id ?? "", /^[a-f0-9-]{36}$/);
assert.ok(policyPath);
assert.equal(process.platform, "darwin");
assert.equal(process.arch, "arm64");
const state = join(homedir(), ".developer-os", "ticket4-macos", "state");
const machine = "aios-macos-noshare";
const native = new NativePodmanDriver(machine, state, policyPath);
const worker = new PodmanHostAdapter({ machine, policyPath, native });
const controller = new DeliveryController(
  state,
  {},
  { worker, offline: native },
);

if (crashing) {
  const offline = {
    mode: "live",
    execute: async (request) => {
      await native.execute(request);
      console.log(JSON.stringify({ syntheticEffectAccepted: true }));
      await new Promise(() => {
        setInterval(() => {}, 1000);
      });
    },
    stop: (session, pins) => native.stop(session, pins),
    collect: (session, pins) => native.collect(session, pins),
  };
  await new DeliveryController(state, {}, { worker, offline }).offlineCanary(
    id,
  );
} else {
  const initial = controller.status(id);
  assert.equal(initial.phase, "blocked");
  assert.equal(initial.execution.state, "stopped");
  assert.equal(initial.ownership.held, true);
  // Preserve a real durable unknown-usage decision, without reading account credentials.
  const usage = JSON.stringify((await controller.checkUsage(id)).usage);
  const checks = [];
  const censuses = [];
  const roundtrip = await controller.offlineCanary(id);
  assert.equal(roundtrip.offlineCanary.outcome, "completed");
  assert.ok(roundtrip.offlineCanary.shutdownProof.observedProcesses >= 8);
  assert.equal(roundtrip.offlineCanary.shutdownProof.remainingProcesses, 0);
  censuses.push(roundtrip.offlineCanary.shutdownProof);
  checks.push(
    "larger synthetic descendant tree independently stopped before collection",
  );

  let accepted, release, request, receipt;
  const running = new Promise((resolve) => {
    accepted = resolve;
  });
  const offline = {
    mode: "live",
    execute: async (input) => {
      request = input;
      receipt = await native.execute(input);
      accepted();
      return new Promise((resolve) => {
        release = resolve;
      });
    },
    stop: (session, pins) => native.stop(session, pins),
    collect: () => assert.fail("paused stale execution cannot collect"),
  };
  const pending = new DeliveryController(
    state,
    {},
    { worker, offline },
  ).offlineCanary(id);
  await running;
  const competitor = controller.start({
    repository: initial.repository,
    request: "Synthetic concurrent ownership canary",
  });
  assert.equal(competitor.phase, "queued");
  assert.equal(competitor.ownership.held, false);
  assert.equal(competitor.execution, undefined);
  await controller.cancel(competitor.id);
  const paused = await controller.pause(id);
  assert.equal(paused.execution.state, "stopped");
  assert.equal(paused.phase, "paused");
  assert.ok(paused.offlineCanary.shutdownProof.observedProcesses >= 8);
  censuses.push(paused.offlineCanary.shutdownProof);
  assert.equal(request.mayDispatch(), false);
  await assert.rejects(() =>
    native.execute({ ...request, mayDispatch: () => true }),
  );
  release(receipt);
  const late = await pending;
  assert.equal(late.phase, "paused");
  assert.equal(late.execution.state, "stopped");
  assert.equal(late.offlineCanary.outcome, "rejected");
  assert.equal(late.evidence.length, roundtrip.evidence.length);
  await controller.resume(id);
  checks.push(
    "concurrent request queues; pause stops descendants; guest journal rejects deliberately delayed stale sender; late receipt cannot collect",
  );

  const child = spawn(
    process.execPath,
    [
      new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
      "--crash-child",
      id,
      policyPath,
    ],
    { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
  );
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(Error("Synthetic crash child did not reach accepted effect")),
        30000,
      );
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
        if (output.includes('"syntheticEffectAccepted":true')) {
          clearTimeout(timer);
          resolve();
        }
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("exit", () => {
        clearTimeout(timer);
        reject(Error("Synthetic child exited before crash injection"));
      });
    });
    const exited = new Promise((resolve) => child.once("close", resolve));
    child.kill();
    await exited;
    const reopened = new DeliveryController(
      state,
      {},
      { worker, offline: native },
    );
    const orphan = reopened.status(id);
    assert.equal(orphan.execution.state, "dispatched");
    assert.throws(() => reopened.release(id), /shutdown/i);
    await assert.rejects(
      () => reopened.offlineCanary(id),
      /Stop and reconcile/i,
    );
    const recovered = await reopened.recover(id);
    assert.equal(recovered.execution.state, "stopped");
    assert.equal(recovered.ownership.held, true);
    assert.ok(recovered.offlineCanary.shutdownProof.observedProcesses >= 8);
    assert.equal(recovered.offlineCanary.shutdownProof.remainingProcesses, 0);
    assert.equal(JSON.stringify(recovered.usage), usage);
    assert.equal(recovered.execution.operationId, orphan.execution.operationId);
    censuses.push(recovered.offlineCanary.shutdownProof);
    assert.deepEqual(
      new DeliveryController(state).status(id).offlineCanary,
      recovered.offlineCanary,
    );
    checks.push(
      "controller killed after native acceptance and before outcome; orphan forbids release/redispatch; new controller stops exact session and preserves usage/work",
    );
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  const final = await controller.offlineCanary(id);
  assert.equal(final.offlineCanary.outcome, "completed");
  assert.equal(final.qualification.liveReady, false);
  assert.equal(final.qualification.ready, false);
  censuses.push(final.offlineCanary.shutdownProof);
  writeFileSync(
    new URL("ticket4-macos-fencing.json", import.meta.url),
    JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        scope:
          "macOS AppleHV ARM64 fixed synthetic offline native lifecycle only; production resume/inference remain unqualified",
        checks,
        censuses,
        qualification: final.qualification,
        session: final.execution,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ checks, censuses, productionReady: false }));
}
