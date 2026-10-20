import assert from "node:assert/strict";
import test from "node:test";
import { evaluateQualificationRules } from "../dist/qualification-rules.js";
import { qualificationRuntimeVersions } from "../dist/qualification-versions.js";
import { isolationProbes } from "../dist/qualification.js";

const now = Date.parse("2026-10-17T12:00:00Z"),
  sha = "a".repeat(64),
  scope = "allowance";
function evidence() {
  return {
    id: "delivery",
    qualification: {
      mode: "controlled",
      runtimeVersions: { ...qualificationRuntimeVersions },
      bindingSha256: sha,
      policySha256: sha,
      offlineAdmission: {
        allowed: true,
        binding: {
          platform: "win32",
          arch: "x64",
          provider: "hyperv",
          osVersion: "10.0.22000",
          machine: "aios-fixture",
          hostId: sha,
          vmImageSha256: sha,
          template: "example.org/worker@sha256:" + sha,
          engineVersion: "6.0.0",
          workerVersion: "0.161.0",
        },
        effective: {
          hypervisor: true,
          dedicated: true,
          managementExposed: false,
          rootful: false,
          network: "none",
          readOnly: true,
          user: "65534:65534",
          noNewPrivileges: true,
          mounts: [],
          capabilities: [],
        },
      },
      probes: [],
    },
  };
}
function onlineEvidence() {
  const d = evidence();
  d.onlineAccess = {
    runId: "run",
    accountId: "owner",
    // The run's endorsed usage-reader account differs from its vault account.
    usageAccountId: "owner-usage",
    usageScope: scope,
    mode: "controlled",
    state: "stopped",
    outcome: "passed",
    productionEnabled: false,
    policyVersion: "policy",
    bindingSha256: sha,
    hostPolicySha256: sha,
    proof: {
      runId: "run",
      policyVersion: "policy",
      model: "passed",
      dependency: "passed",
      bypass: "passed",
    },
    shutdown: { revoked: true, remainingProcesses: 0 },
    usageAuthorization: {
      authorizedAt: new Date(now).toISOString(),
      usage: {
        checkId: "check",
        checkedAt: new Date(now).toISOString(),
        decision: "ready",
        scope,
        accountId: "owner-usage",
      },
    },
  };
  return d;
}

test("named host and transfer rules refuse source-pin drift and unverified shutdown", () => {
  const d = evidence();
  assert.equal(
    evaluateQualificationRules(d, false, now).checks.hostBinding.result,
    "passed",
  );
  assert.equal(
    evaluateQualificationRules(d, true, now).checks.hostBinding.result,
    "failed",
  );
  d.qualification.runtimeVersions.worker = "b".repeat(64);
  assert.equal(
    evaluateQualificationRules(d, false, now).checks.hostBinding.result,
    "failed",
  );
  d.qualification.runtimeVersions = { ...qualificationRuntimeVersions };
  d.offlineCanary = {
    mode: "controlled",
    outcome: "completed",
    bindingSha256: sha,
    policySha256: sha,
    inputSha256: sha,
    outputSha256: sha,
    shutdownProof: { remainingProcesses: 0 },
  };
  assert.equal(
    evaluateQualificationRules(d, false, now).checks.offlineTransfer.result,
    "passed",
  );
  d.offlineCanary.shutdownProof.remainingProcesses = 1;
  assert.equal(
    evaluateQualificationRules(d, false, now).checks.offlineTransfer.result,
    "failed",
  );
});

test("historical usage uses the shared gate at its recorded authorization instant", () => {
  const d = onlineEvidence(),
    read = () =>
      evaluateQualificationRules(d, false, now + 100000).checks.usageGate
        .result;
  assert.equal(read(), "passed");
  const usage = d.onlineAccess.usageAuthorization.usage;
  usage.decision = "approval-required";
  usage.approval = {
    scope,
    at: new Date(now).toISOString(),
    operationId: "run",
  };
  assert.equal(read(), "passed");
  usage.approval.operationId = "other";
  assert.equal(read(), "not-run");
  usage.approval.operationId = "run";
  usage.approval.at = new Date(now + 1).toISOString();
  assert.equal(read(), "not-run");
  usage.decision = "ready";
  usage.checkedAt = new Date(now + 1).toISOString();
  assert.equal(read(), "not-run");
});

test("failed isolation probes cannot be upgraded and retained active sessions block fencing", () => {
  const d = evidence();
  d.qualification.adversarial = {
    scope: "synthetic-windows-controls",
    challengeId: "123e4567-e89b-42d3-a456-426614174000",
    probeVersion: sha,
    escapeAttempts: ["unshare", "chroot", "cgroup", "proc"].map(
      (name) => "passed-escape-" + name,
    ),
  };
  d.qualification.probes = isolationProbes.map((name) => ({
    name,
    outcome: "passed",
    evidenceSha256: sha,
  }));
  d.offlineCanary = {
    mode: "controlled",
    outcome: "completed",
    bindingSha256: sha,
    policySha256: sha,
    inputSha256: sha,
    outputSha256: sha,
    shutdownProof: { remainingProcesses: 0 },
  };
  let checks = evaluateQualificationRules(d, false, now).checks;
  assert.equal(checks.adversarialIsolation.result, "passed");
  assert.equal(checks.fencingRecovery.result, "passed");
  d.onlineRuns = [{ state: "uncertain" }];
  assert.equal(
    evaluateQualificationRules(d, false, now).checks.fencingRecovery.result,
    "not-run",
  );
  d.qualification.probes[0].outcome = "failed";
  assert.equal(
    evaluateQualificationRules(d, false, now).checks.adversarialIsolation
      .result,
    "failed",
  );
});
