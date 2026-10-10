// Explicit credential-free host capability observation. No inference/login.
// node .scratch/aios-v1-implementation/codex-mediation-acceptance.mjs <absolute-codex-executable>
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeliveryController } from "../../dist/controller.js";
import { PodmanHostAdapter } from "../../dist/podman-host.js";

const root = mkdtempSync(join(tmpdir(), "aios-auth-acceptance-"));
try {
  const repository = join(root, "repo");
  mkdirSync(repository);
  const state = join(root, "state");
  const controller = new DeliveryController(state, {}, {
    worker: new PodmanHostAdapter({ machine: "aios-unenrolled", codexExecutable: process.argv[2] }),
  });
  const delivery = controller.start({ repository, request: "Credential-free authentication capability observation" });
  const result = await controller.qualify(delivery.id);
  assert.equal(result.qualification.subscriptionMediation.protocol, "passed");
  assert.equal(result.qualification.subscriptionMediation.syntheticRelay, "passed");
  assert.equal(result.qualification.subscriptionMediation.qualified, false);
  assert.equal(result.qualification.liveReady, false);
  assert.equal(result.execution, undefined);
  assert.deepEqual(new DeliveryController(state).status(delivery.id).qualification, result.qualification);
  const evidence = { checkedAt: new Date().toISOString(), scope: "credential-free host app-server protocol and fixed synthetic host-loopback transport canaries; no production relay, VM, authorization or inference qualification", report: result.qualification.subscriptionMediation, productionReady: result.qualification.liveReady, dispatched: false };
  writeFileSync(new URL("ticket21-protocol-observation.json", import.meta.url), JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence));
} finally { rmSync(root, { recursive: true, force: true }); }
