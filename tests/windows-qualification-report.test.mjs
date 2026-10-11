import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  realpathSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DeliveryController } from "../dist/controller.js";
import { PodmanHostAdapter } from "../dist/podman-host.js";
import { windowsWorkerQualificationReport } from "../dist/windows-qualification.js";
import { isolationProbes } from "../dist/qualification.js";

const digest = (value) => createHash("sha256").update(value).digest("hex");

function fixture(t, effectiveOverrides = {}, bindingOverrides = {}) {
  const root = realpathSync(
    mkdtempSync(join(tmpdir(), "aios-windows-report-")),
  );
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "repo"),
    state = join(root, "state");
  mkdirSync(repository);
  const binding = {
    platform: "win32",
    arch: "x64",
    osVersion: "10.0.26100",
    provider: "hyperv",
    machine: "aios-report-test",
    hostId: "a".repeat(64),
    engineVersion: "6.0.2",
    vmImageSha256: "b".repeat(64),
    template: "example.org/worker@sha256:" + "c".repeat(64),
    workerVersion: "0.161.0",
    policyVersion: "offline-v1",
    ...bindingOverrides,
  };
  const effective = {
    hypervisor: true,
    dedicated: true,
    mounts: [],
    managementExposed: false,
    rootful: false,
    network: "none",
    readOnly: true,
    user: "65534:65534",
    capabilities: [],
    noNewPrivileges: true,
    ...effectiveOverrides,
  };
  const policyPath = join(root, "pins.json");
  writeFileSync(policyPath, JSON.stringify({ schema: 1, binding }), {
    mode: 0o600,
  });
  const worker = new PodmanHostAdapter({
    policyPath,
    machine: binding.machine,
    mode: "controlled",
    observe: () => ({ binding, effective }),
  });
  const controller = new DeliveryController(state, {}, { worker });
  const delivery = controller.start({ repository, request: "Report status" });
  return { binding, controller, delivery, repository, state };
}

test("public report binds a controlled Windows observation but leaves native gates blocked", async (t) => {
  const f = fixture(t);
  const qualified = await f.controller.qualify(f.delivery.id);
  assert.equal(qualified.qualification.offlineAdmission.allowed, true);

  const report = f.controller.qualificationReport(f.delivery.id);
  assert.deepEqual(report.target, {
    platform: "win32",
    arch: "x64",
    provider: "hyperv",
  });
  assert.equal(report.source.evidenceMode, "controlled");
  assert.equal(report.checks.hostBinding.result, "passed");
  assert.equal(report.checks.hostBinding.evidenceMode, "controlled");
  assert.equal(report.checks.offlineTransfer.result, "not-run");
  assert.equal(report.checks.authentication.result, "not-run");
  assert.equal(report.outcome, "blocked");
  assert.equal(report.productionEnabled, false);
  assert.match(report.blockers.join(" "), /native Windows/i);
});

test("public CLI emits the same report and refuses a weakened Windows observation", async (t) => {
  const f = fixture(t, { noNewPrivileges: false });
  const qualified = await f.controller.qualify(f.delivery.id);
  assert.equal(qualified.qualification.offlineAdmission.allowed, false);

  const cli = new URL("../dist/cli.js", import.meta.url).pathname;
  const result = spawnSync(
    process.execPath,
    [
      cli,
      "qualification-report",
      "--id",
      f.delivery.id,
      "--state-dir",
      f.state,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.checks.hostBinding.result, "failed");
  assert.equal(report.outcome, "blocked");
  assert.equal(report.productionEnabled, false);
  assert.equal(JSON.stringify(report).includes("/repo"), false);
});

test("a positively admitted macOS binding cannot satisfy the Windows report", async (t) => {
  const f = fixture(
    t,
    {},
    {
      platform: "darwin",
      arch: "arm64",
      osVersion: "27.2.0",
      provider: "applehv",
    },
  );
  const qualified = await f.controller.qualify(f.delivery.id);
  assert.equal(qualified.qualification.offlineAdmission.allowed, true);

  const report = f.controller.qualificationReport(f.delivery.id);
  assert.equal(report.target.platform, "win32");
  assert.equal(report.checks.hostBinding.result, "failed");
  assert.equal(report.outcome, "blocked");
  assert.equal(report.productionEnabled, false);
});

test("an unqualified delivery reports unavailable evidence without making assumptions", (t) => {
  const f = fixture(t);
  const report = f.controller.qualificationReport(f.delivery.id);
  assert.equal(report.source.evidenceMode, "unavailable");
  assert.equal(report.checks.hostBinding.result, "not-run");
  assert.equal(report.checks.offlineTransfer.result, "not-run");
  assert.equal(report.checks.adversarialIsolation.result, "not-run");
  assert.equal(report.checks.onlinePolicy.result, "not-run");
  assert.equal(report.checks.usageGate.result, "not-run");
  assert.equal(report.checks.fencingRecovery.evidenceMode, "unavailable");
  assert.equal(report.source.binding, undefined);
  assert.equal(report.outcome, "blocked");
  assert.equal(report.productionEnabled, false);
});

test("report validates each Windows binding field and effective control", async (t) => {
  const f = fixture(t);
  const qualified = await f.controller.qualify(f.delivery.id);
  const invalidCases = [
    [
      "OS build",
      (d) =>
        (d.qualification.offlineAdmission.binding.osVersion = "10.0.19045"),
    ],
    [
      "missing OS build",
      (d) => delete d.qualification.offlineAdmission.binding.osVersion,
    ],
    [
      "machine name",
      (d) => (d.qualification.offlineAdmission.binding.machine = "other"),
    ],
    [
      "missing machine name",
      (d) => delete d.qualification.offlineAdmission.binding.machine,
    ],
    [
      "host identity",
      (d) => (d.qualification.offlineAdmission.binding.hostId = "invalid"),
    ],
    [
      "image digest",
      (d) =>
        (d.qualification.offlineAdmission.binding.vmImageSha256 = "invalid"),
    ],
    [
      "template digest",
      (d) =>
        (d.qualification.offlineAdmission.binding.template =
          "example.org/worker:latest"),
    ],
    [
      "missing template",
      (d) => delete d.qualification.offlineAdmission.binding.template,
    ],
    [
      "engine version",
      (d) =>
        (d.qualification.offlineAdmission.binding.engineVersion = "latest"),
    ],
    [
      "missing engine version",
      (d) => delete d.qualification.offlineAdmission.binding.engineVersion,
    ],
    [
      "worker version",
      (d) =>
        (d.qualification.offlineAdmission.binding.workerVersion = "latest"),
    ],
    [
      "missing worker version",
      (d) => delete d.qualification.offlineAdmission.binding.workerVersion,
    ],
    [
      "hypervisor",
      (d) => (d.qualification.offlineAdmission.effective.hypervisor = false),
    ],
    [
      "dedicated VM",
      (d) => (d.qualification.offlineAdmission.effective.dedicated = false),
    ],
    [
      "management exposure",
      (d) =>
        (d.qualification.offlineAdmission.effective.managementExposed = true),
    ],
    [
      "rootless mode",
      (d) => (d.qualification.offlineAdmission.effective.rootful = true),
    ],
    [
      "network isolation",
      (d) => (d.qualification.offlineAdmission.effective.network = "bridge"),
    ],
    [
      "read-only filesystem",
      (d) => (d.qualification.offlineAdmission.effective.readOnly = false),
    ],
    [
      "worker identity",
      (d) => (d.qualification.offlineAdmission.effective.user = "0:0"),
    ],
    [
      "no-new-privileges",
      (d) =>
        (d.qualification.offlineAdmission.effective.noNewPrivileges = false),
    ],
    [
      "mounts",
      (d) => (d.qualification.offlineAdmission.effective.mounts = ["/host"]),
    ],
    [
      "capabilities",
      (d) =>
        (d.qualification.offlineAdmission.effective.capabilities = [
          "SYS_ADMIN",
        ]),
    ],
    ["binding digest", (d) => (d.qualification.bindingSha256 = "invalid")],
    ["policy digest", (d) => (d.qualification.policySha256 = "invalid")],
  ];

  for (const [label, invalidate] of invalidCases) {
    const delivery = structuredClone(qualified);
    invalidate(delivery);
    assert.equal(
      windowsWorkerQualificationReport(delivery).checks.hostBinding.result,
      "failed",
      label,
    );
  }
});

test("report accepts complete controlled evidence while retaining production blockers", async (t) => {
  const f = fixture(t);
  const qualified = structuredClone(await f.controller.qualify(f.delivery.id));
  const q = qualified.qualification;
  const digestValue = "d".repeat(64);
  q.adversarial = {
    scope: "synthetic-windows-controls",
    challengeId: "123e4567-e89b-42d3-a456-426614174000",
    probeVersion: digestValue,
    escapeAttempts: [
      "passed-escape-unshare",
      "passed-escape-chroot",
      "passed-escape-cgroup",
      "passed-escape-proc",
    ],
  };
  q.probes = isolationProbes.map((name) => ({
    name,
    outcome: "passed",
    evidenceSha256: digestValue,
  }));
  q.bindingSha256 = digestValue;
  q.policySha256 = digestValue;
  qualified.offlineCanary = {
    mode: "controlled",
    outcome: "completed",
    bindingSha256: digestValue,
    policySha256: digestValue,
    inputSha256: digestValue,
    outputSha256: digestValue,
    shutdownProof: { remainingProcesses: 0, censusSha256: digestValue },
  };
  qualified.onlineAccess = {
    mode: "controlled",
    outcome: "passed",
    state: "stopped",
    productionEnabled: false,
    runId: "run-report-test",
    usageScope: "account-window",
    accountId: "account-1",
    policyVersion: "policy-1",
    bindingSha256: digestValue,
    hostPolicySha256: digestValue,
    proof: {
      runId: "run-report-test",
      policyVersion: "policy-1",
      model: "passed",
      dependency: "passed",
      bypass: "passed",
    },
    shutdown: { revoked: true, remainingProcesses: 0 },
  };
  qualified.usage = {
    checkId: "usage-1",
    scope: "account-window",
    accountId: "account-1",
    checkedAt: new Date().toISOString(),
    decision: "ready",
  };

  const passedControlledReport = windowsWorkerQualificationReport(qualified);
  assert.equal(passedControlledReport.checks.offlineTransfer.result, "passed");
  assert.equal(
    passedControlledReport.checks.adversarialIsolation.result,
    "passed",
  );
  assert.equal(passedControlledReport.checks.onlinePolicy.result, "passed");
  assert.equal(passedControlledReport.checks.usageGate.result, "passed");
  assert.equal(passedControlledReport.checks.fencingRecovery.result, "passed");
  assert.equal(passedControlledReport.outcome, "blocked");
  assert.equal(passedControlledReport.productionEnabled, false);
  const refusedOnline = structuredClone(qualified);
  refusedOnline.onlineAccess.outcome = "refused";
  assert.equal(
    windowsWorkerQualificationReport(refusedOnline).checks.onlinePolicy.result,
    "failed",
  );

  const approvedUsage = structuredClone(qualified);
  approvedUsage.usage.decision = "approval-required";
  approvedUsage.usage.approval = {
    scope: approvedUsage.usage.scope,
    operationId: approvedUsage.onlineAccess.runId,
    at: new Date().toISOString(),
  };
  assert.equal(
    windowsWorkerQualificationReport(approvedUsage).checks.usageGate.result,
    "passed",
  );
  const wrongApproval = structuredClone(approvedUsage);
  wrongApproval.usage.approval.operationId = "another-run";
  assert.equal(
    windowsWorkerQualificationReport(wrongApproval).checks.usageGate.result,
    "not-run",
  );
  const incompleteCanary = structuredClone(qualified);
  delete incompleteCanary.offlineCanary.outputSha256;
  assert.equal(
    windowsWorkerQualificationReport(incompleteCanary).checks.offlineTransfer
      .result,
    "failed",
  );
  const liveEvidence = structuredClone(qualified);
  liveEvidence.qualification.mode = "live";
  liveEvidence.offlineCanary.mode = "live";
  assert.equal(
    windowsWorkerQualificationReport(liveEvidence).checks.fencingRecovery
      .evidenceMode,
    "live",
  );

  const uncertainRecovery = structuredClone(qualified);
  uncertainRecovery.recovery = [{ outcome: "uncertain" }];
  assert.equal(
    windowsWorkerQualificationReport(uncertainRecovery).checks.fencingRecovery
      .result,
    "not-run",
  );
  const badEscape = structuredClone(qualified);
  badEscape.qualification.adversarial.escapeAttempts[0] =
    "failed-escape-unshare";
  assert.equal(
    windowsWorkerQualificationReport(badEscape).checks.adversarialIsolation
      .result,
    "failed",
  );
  const expiredUsage = structuredClone(qualified);
  expiredUsage.usage.checkedAt = new Date(Date.now() - 61000).toISOString();
  assert.equal(
    windowsWorkerQualificationReport(expiredUsage).checks.usageGate.result,
    "not-run",
  );
});
