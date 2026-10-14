import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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

test("Windows controls qualification requires a trusted runtime and cannot be supplied by candidate evidence", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    async () => f.controller.qualifyWindowsControls(f.delivery.id),
    /trusted Windows controls runtime/i,
  );
  assert.equal(f.controller.status(f.delivery.id).windowsControls, undefined);
});

test("Windows report needs measured supplemental controls and refuses a missing stopped lifecycle session", async (t) => {
  const { windowsControlNames, windowsControlsVersion } = await import(
    "../dist/windows-controls.js"
  );
  const { readFileSync } = await import("node:fs");
  const f = fixture(t),
    d = structuredClone(await f.controller.qualify(f.delivery.id));
  const q = d.qualification;
  q.adversarial = {
    scope: "synthetic-windows-controls",
    challengeId: "123e4567-e89b-42d3-a456-426614174000",
    probeVersion: "d".repeat(64),
    escapeAttempts: [
      "passed-escape-unshare",
      "passed-escape-chroot",
      "passed-escape-cgroup",
      "passed-escape-proc",
    ],
  };
  q.probes = q.probes.map((p) => ({
    name: p.name,
    outcome: [
      "host-files",
      "controller-ledger",
      "owner-credentials",
      "host-docker",
      "skills-mcp-hooks",
      "network-bypass",
      "cross-delivery",
    ].includes(p.name)
      ? "passed"
      : "not-run",
    evidenceSha256: "d".repeat(64),
  }));
  const operationId = "123e4567-e89b-42d3-a456-426614174001";
  d.execution = { operationId, state: "stopped" };
  d.windowsControls = {
    mode: "controlled",
    outcome: "passed",
    productionEnabled: false,
    version: windowsControlsVersion,
    nativeVersion: digest(
      readFileSync(new URL("../dist/podman-native.js", import.meta.url)),
    ),
    operationId,
    bindingSha256: q.bindingSha256,
    policySha256: q.policySha256,
    checks: windowsControlNames.map((name) => ({
      name,
      evidenceSha256: "e".repeat(64),
    })),
    censuses: [1, 2].map(() => ({
      observedProcesses: 8,
      remainingProcesses: 0,
      censusSha256: "f".repeat(64),
    })),
  };
  assert.equal(
    windowsWorkerQualificationReport(d).checks.fencingRecovery.result,
    "passed",
  );
  assert.equal(
    windowsWorkerQualificationReport(d).checks.adversarialIsolation.result,
    "failed",
    "online controls remain missing",
  );
  const complete = structuredClone(d);
  complete.qualification.subscriptionMediation.explicitResume = "passed";
  complete.qualification.subscriptionMediation.mechanismDecision = {
    qualified: true,
    scope: "windows-fixed-codex-subscription",
    bindingSha256: q.bindingSha256,
    inferenceAuthorized: false,
  };
  complete.onlineAccess = {
    mode: "controlled",
    state: "stopped",
    outcome: "passed",
    productionEnabled: false,
    runId: "measured-online",
    policyVersion: "controlled-policy",
    usageScope: "account-window",
    bindingSha256: q.bindingSha256,
    hostPolicySha256: q.policySha256,
    proof: {
      runId: "measured-online",
      policyVersion: "controlled-policy",
      model: "passed",
      dependency: "passed",
      bypass: "passed",
    },
    shutdown: { revoked: true, remainingProcesses: 0 },
  };
  complete.usage = {
    checkId: "fresh-check",
    scope: "account-window",
    decision: "ready",
    checkedAt: new Date().toISOString(),
  };
  assert.equal(
    windowsWorkerQualificationReport(complete).checks.adversarialIsolation
      .result,
    "passed",
  );
  assert.equal(
    windowsWorkerQualificationReport(complete).outcome,
    "blocked",
    "controlled aggregation never qualifies Windows production",
  );
  delete complete.qualification.subscriptionMediation.explicitResume;
  assert.equal(
    windowsWorkerQualificationReport(complete).checks.adversarialIsolation
      .result,
    "failed",
  );
  complete.qualification.subscriptionMediation.explicitResume = "passed";
  complete.qualification.probes.find((p) => p.name === "ssh-gpg").outcome =
    "failed";
  assert.equal(
    windowsWorkerQualificationReport(complete).checks.adversarialIsolation
      .result,
    "failed",
    "supplemental evidence cannot erase an explicit isolation failure",
  );
  d.execution.state = "uncertain";
  assert.equal(
    windowsWorkerQualificationReport(d).checks.fencingRecovery.result,
    "not-run",
  );
  d.execution.state = "stopped";
  d.windowsControls.censuses[1].remainingProcesses = 1;
  assert.equal(
    windowsWorkerQualificationReport(d).checks.fencingRecovery.result,
    "not-run",
  );
  d.windowsControls.censuses[1].remainingProcesses = 0;
  d.windowsControls.nativeVersion = "a".repeat(64);
  assert.equal(
    windowsWorkerQualificationReport(d).checks.fencingRecovery.result,
    "not-run",
  );
});

test("public Windows controls qualifier binds stopped observations and rejects native source drift", async (t) => {
  const { windowsControlsVersion, windowsControlNames } = await import(
    "../dist/windows-controls.js"
  );
  const { readFileSync } = await import("node:fs");
  const { canaryOutput, sha256 } = await import("../dist/offline-canary.js");
  const f = fixture(t),
    q = (await f.controller.qualify(f.delivery.id)).qualification;
  writeFileSync(
    join(f.repository, "canary.txt"),
    "AIOS offline canary input\n",
  );
  let drift = false;
  const offline = {
    mode: "controlled",
    async execute(r) {
      return {
        ...r.session,
        bindingSha256: r.bindingSha256,
        policySha256: r.policySha256,
        status: "running",
        fresh: true,
        binding: r.binding,
        effective: r.effective,
      };
    },
    async stop(s, p) {
      return {
        ...s,
        ...p,
        status: "stopped",
        revoked: true,
        descendantsStopped: true,
        evidence: {
          observedProcesses: 8,
          remainingProcesses: 0,
          censusSha256: "d".repeat(64),
        },
      };
    },
    async collect(s, p) {
      return {
        ...s,
        ...p,
        status: "stopped",
        files: [
          {
            path: "result.txt",
            bytes: Buffer.from(canaryOutput),
            ordinary: true,
            links: 1,
            beforeSha256: sha256(canaryOutput),
            afterSha256: sha256(canaryOutput),
          },
        ],
      };
    },
  };
  const runtime = {
    mode: "controlled",
    version: windowsControlsVersion,
    async qualify() {
      const d = await c.offlineCanary(f.delivery.id);
      return {
        version: windowsControlsVersion,
        nativeVersion: drift
          ? "a".repeat(64)
          : digest(
              readFileSync(
                new URL("../dist/podman-native.js", import.meta.url),
              ),
            ),
        mode: "controlled",
        outcome: "passed",
        productionEnabled: false,
        operationId: d.execution.operationId,
        bindingSha256: q.bindingSha256,
        policySha256: q.policySha256,
        checks: windowsControlNames.map((name) => ({
          name,
          evidenceSha256: "e".repeat(64),
        })),
        censuses: [
          d.offlineCanary.shutdownProof,
          d.offlineCanary.shutdownProof,
        ],
      };
    },
  };
  const c = new DeliveryController(
    f.state,
    {},
    {
      worker: { probe: async () => structuredClone(q) },
      offline,
      windowsControls: runtime,
    },
  );
  const passed = await c.qualifyWindowsControls(f.delivery.id);
  assert.equal(passed.windowsControls.outcome, "passed");
  assert.equal(
    c.qualificationReport(f.delivery.id).checks.fencingRecovery.result,
    "passed",
  );
  assert.equal(c.qualificationReport(f.delivery.id).outcome, "blocked");
  drift = true;
  await assert.rejects(
    () => c.qualifyWindowsControls(f.delivery.id),
    /evidence.*verify/i,
  );
  assert.equal(
    c.status(f.delivery.id).windowsControls.operationId,
    passed.windowsControls.operationId,
  );
});

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

  const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
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

  const report = windowsWorkerQualificationReport(qualified);
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
  const historical = structuredClone(approvedUsage);
  const instant = Date.now() - 120000;
  historical.usage.checkedAt = new Date(instant - 1000).toISOString();
  historical.usage.approval.at = new Date(instant - 500).toISOString();
  historical.onlineAccess.usageAuthorization = {
    authorizedAt: new Date(instant).toISOString(),
    usage: structuredClone(historical.usage),
  };
  assert.equal(
    windowsWorkerQualificationReport(historical).checks.usageGate.result,
    "passed",
    "fresh run-bound dispatch evidence survives elapsed wall time",
  );
  const { onlineUsagePermits } = await import("../dist/online-access.js");
  assert.equal(
    onlineUsagePermits(historical.usage, historical.onlineAccess),
    false,
    "historical qualification does not authorize a future request",
  );
  historical.onlineAccess.usageAuthorization.usage.approval.operationId =
    "other-run";
  assert.equal(
    windowsWorkerQualificationReport(historical).checks.usageGate.result,
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
  const { readFileSync } = await import("node:fs");
  const { onlinePolicyVersion } = await import("../dist/online-access.js");
  liveEvidence.onlineAccess.mode = "live";
  liveEvidence.onlineAccess.policyVersion = onlinePolicyVersion;
  liveEvidence.onlineAccess.proof.policyVersion = onlinePolicyVersion;
  liveEvidence.onlineAccess.runtimeVersion = digest(
    readFileSync(new URL("../dist/online-native.js", import.meta.url)),
  );
  assert.equal(
    windowsWorkerQualificationReport(liveEvidence).checks.onlinePolicy.result,
    "passed",
  );
  liveEvidence.onlineAccess.runtimeVersion = "a".repeat(64);
  assert.equal(
    windowsWorkerQualificationReport(liveEvidence).checks.onlinePolicy.result,
    "failed",
    "native runtime source drift cannot retain positive online evidence",
  );
  assert.equal(
    windowsWorkerQualificationReport(liveEvidence).checks.fencingRecovery
      .evidenceMode,
    "live",
  );

  const uncertainRecovery = structuredClone(qualified);
  const resolvedRecovery = structuredClone(qualified);
  resolvedRecovery.recovery = [
    { outcome: "uncertain", fence: 1 },
    { outcome: "stopped", fence: 2 },
  ];
  assert.equal(
    windowsWorkerQualificationReport(resolvedRecovery).checks.fencingRecovery
      .result,
    "passed",
    "verified recovery retains historical uncertainty without a permanent blocker",
  );
  resolvedRecovery.sessions = [{ state: "uncertain" }];
  assert.equal(
    windowsWorkerQualificationReport(resolvedRecovery).checks.fencingRecovery
      .result,
    "not-run",
    "a later stopped event cannot hide an unresolved retained session",
  );
  resolvedRecovery.sessions = [{ state: "stopped" }];
  resolvedRecovery.recovery.push({ outcome: "uncertain", fence: 3 });
  assert.equal(
    windowsWorkerQualificationReport(resolvedRecovery).checks.fencingRecovery
      .result,
    "not-run",
    "new uncertainty remains a blocker",
  );
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

test("Windows report binds task validation evidence and refuses altered output or worker versions", async (t) => {
  const { syntheticSiteInput, syntheticSiteOutput, syntheticTaskVersion } =
    await import("../dist/synthetic-task.js");
  const f = fixture(t);
  const d = await f.controller.qualify(f.delivery.id);
  d.qualification.subscriptionMediation.mechanismDecision = {
    qualified: true,
    scope: "windows-fixed-codex-subscription",
    bindingSha256: d.qualification.bindingSha256,
    inferenceAuthorized: false,
    requestSha256: "d".repeat(64),
  };
  d.offlineCanary = {
    mode: "controlled",
    outcome: "completed",
    session: {
      operationId: "00000000-0000-4000-8000-000000000024",
      state: "stopped",
    },
    bindingSha256: d.qualification.bindingSha256,
    policySha256: d.qualification.policySha256,
    shutdownProof: { remainingProcesses: 0, censusSha256: "a".repeat(64) },
    inputSha256: "a".repeat(64),
    outputSha256: "b".repeat(64),
  };
  d.syntheticTask = {
    mode: "controlled",
    outcome: "completed",
    version: syntheticTaskVersion,
    bindingSha256: d.qualification.bindingSha256,
    policySha256: d.qualification.policySha256,
    session: d.offlineCanary.session,
    shutdownProof: d.offlineCanary.shutdownProof,
    productionEnabled: false,
    result: {
      operationId: d.offlineCanary.session.operationId,
      version: syntheticTaskVersion,
      inputSha256: digest(syntheticSiteInput),
      outputSha256: digest(syntheticSiteOutput),
      output: syntheticSiteOutput,
      validation: "passed",
      negativeValidation: "passed",
      httpValidation: "passed",
      collectionSha256: "e".repeat(64),
    },
  };
  const report = windowsWorkerQualificationReport(d);
  assert.equal(report.checks.authentication.result, "passed");
  assert.equal(report.checks.syntheticTask.result, "passed");
  assert.equal(report.checks.isolatedValidation.result, "passed");
  assert.equal(report.outcome, "blocked");
  assert.equal(report.productionEnabled, false);
  d.syntheticTask.result.output = "unverified output";
  assert.equal(
    windowsWorkerQualificationReport(d).checks.syntheticTask.result,
    "not-run",
  );
  d.syntheticTask.result.output = syntheticSiteOutput;
  d.syntheticTask.version = "f".repeat(64);
  assert.equal(
    windowsWorkerQualificationReport(d).checks.isolatedValidation.result,
    "not-run",
  );
});

async function nativeControlsScenario(t, refusal, macos = false) {
  const { NativeWindowsControls, windowsControlNames } = await import(
    "../dist/windows-controls.js"
  );
  const fs = (await import("node:fs")).default;
  const cp = (await import("node:child_process")).default;
  const os = (await import("node:os")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const f = fixture(
    t,
    {},
    macos
      ? {
          platform: "darwin",
          arch: "arm64",
          provider: "applehv",
          osVersion: "27.2.0",
        }
      : {},
  );
  writeFileSync(
    join(f.repository, "canary.txt"),
    "AIOS offline canary input\n",
  );
  const qualified = await f.controller.qualify(f.delivery.id);
  const q = structuredClone(qualified.qualification);
  q.mode = "live";
  const effective = q.offlineAdmission.effective;
  const { sha256, canaryOutput } = await import("../dist/offline-canary.js");
  const revoked = new Set();
  const native = {
    mode: "live",
    observe: () => ({ binding: f.binding, effective }),
    machine: f.binding.machine,
    policyPath: join(f.repository, "..", "pins.json"),
    authorityDirectory: f.state,
    async execute(r) {
      if (revoked.has(r.session.operationId) || !r.mayDispatch())
        throw Error("revoked");
      return {
        ...r.session,
        status: "running",
        fresh: true,
        bindingSha256: r.bindingSha256,
        policySha256: r.policySha256,
        binding: f.binding,
        effective,
      };
    },
    async stop(s, p) {
      revoked.add(s.operationId);
      return {
        ...s,
        ...p,
        status: "stopped",
        revoked: true,
        descendantsStopped: true,
        evidence: {
          observedProcesses: 8,
          remainingProcesses: 0,
          censusSha256: "e".repeat(64),
        },
      };
    },
    async collect(s, p) {
      assert.ok(revoked.has(s.operationId));
      return {
        ...s,
        ...p,
        status: "stopped",
        files: [
          {
            path: "result.txt",
            bytes: Buffer.from(canaryOutput),
            ordinary: true,
            links: 1,
            beforeSha256: sha256(canaryOutput),
            afterSha256: sha256(canaryOutput),
          },
        ],
      };
    },
  };
  const originals = {
    lstat: fs.lstatSync,
    realpath: fs.realpathSync,
    read: fs.readFileSync,
    exists: fs.existsSync,
    spawn: cp.spawn,
  };
  const special = (path) =>
    /(?:podman\.exe|aios-report-test\.json)$/.test(String(path));
  t.mock.method(os, "platform", () => "win32");
  t.mock.method(os, "arch", () => "x64");
  t.mock.method(fs, "lstatSync", (p) =>
    special(p)
      ? { isFile: () => true, isSymbolicLink: () => false, nlink: 1, size: 100 }
      : originals.lstat(p),
  );
  t.mock.method(fs, "realpathSync", (p) =>
    special(p) ? String(p) : originals.realpath(p),
  );
  t.mock.method(fs, "existsSync", (p) =>
    special(p) || String(p).endsWith("ssh.exe") ? true : originals.exists(p),
  );
  t.mock.method(fs, "readFileSync", (p, o) =>
    String(p).endsWith("aios-report-test.json")
      ? JSON.stringify({
          Name: f.binding.machine,
          Version: 1,
          HyperVHypervisor: {},
          Mounts: [],
          HostUser: { Rootful: false },
        })
      : originals.read(p, o),
  );
  t.mock.method(cp, "spawnSync", (_exe, _args, options) => {
    const r = JSON.parse(options.input.split("\n")[1]);
    assert.equal(options.shell, false);
    assert.equal(options.windowsHide, true);
    assert.equal(options.timeout, macos ? 90000 : 30000);
    assert.equal(r.platform, macos ? "darwin" : "win32");
    const deadlineProbe = originals.spawn(
      process.env.AIOS_TEST_PYTHON ?? "python",
      [
        "-c",
        "import ast,sys,subprocess,json;source=json.loads(sys.stdin.readline());r=json.loads(sys.stdin.readline());node=next(n for n in ast.walk(ast.parse(source)) if isinstance(n,ast.FunctionDef) and n.name=='pod');subprocess.run=lambda args,**kwargs: subprocess.CompletedProcess(args,0,b'ok') if kwargs['timeout']==(30 if r['platform']=='darwin' else 10) else (_ for _ in ()).throw(AssertionError('wrong guest deadline'));exec(compile(ast.fix_missing_locations(ast.Module(body=[node],type_ignores=[])),'actual-controls','exec'));assert pod('probe')==b'ok'",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    deadlineProbe.stdin.end(
      JSON.stringify(
        Buffer.from(options.input.split("\n")[0], "base64").toString(),
      ) +
        "\n" +
        JSON.stringify(r) +
        "\n",
    );
    guestDeadlineProbes.push(deadlineProbe);
    if (refusal === "allowed-stage" || refusal === "unknown-stage")
      return {
        status: 1,
        stderr: refusal === "allowed-stage" ? "authority" : "synthetic-private",
      };
    return {
      status: 0,
      stdout: JSON.stringify({
        challenge: refusal === "challenge" ? "wrong" : r.challenge,
        operationId: r.session.operationId,
        names: windowsControlNames.slice(0, 3),
        positiveControls: true,
        privilegedDenial: refusal !== "denial",
      }),
    };
  });
  const guestDeadlineProbes = [];
  t.after(async () => {
    for (const probe of guestDeadlineProbes) {
      let error = "";
      probe.stderr.on("data", (chunk) => {
        error += chunk;
      });
      if (probe.exitCode === null)
        await new Promise((resolve) => probe.once("close", resolve));
      assert.equal(probe.exitCode, 0, error);
    }
  });
  let child;
  t.mock.method(cp, "spawn", (exe, _args, options) => {
    assert.equal(exe, process.execPath);
    const script = String.raw`
let text='';for await(const chunk of process.stdin)text+=chunk;
const r=JSON.parse(text);const {DeliveryController}=await import(r.controller);
const q=JSON.parse(process.env.SYNTHETIC_QUALIFICATION);
const offline={mode:'live',execute:async request=>{console.log('AIOS_ACCEPTED');await new Promise(()=>setInterval(()=>{},1000));}};
await new DeliveryController(r.state,{}, {worker:{probe:async()=>q},offline}).offlineCanary(r.id);
`;
    child = originals.spawn(exe, ["--input-type=module", "-e", script], {
      ...options,
      cwd: f.repository,
      env: { ...options.env, SYNTHETIC_QUALIFICATION: JSON.stringify(q) },
    });
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => {
    child?.kill();
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  if (refusal) {
    await assert.rejects(
      new NativeWindowsControls(native).qualify(qualified),
      /(?:boundary|Boundary)/,
    );
    assert.equal(f.controller.status(f.delivery.id).execution.state, "stopped");
    return;
  }
  const result = await new NativeWindowsControls(native).qualify(qualified);
  assert.deepEqual(
    result.checks.map((c) => c.name).toSorted(),
    windowsControlNames.toSorted(),
  );
  assert.equal(result.censuses.length, 2);
  assert.equal(result.productionEnabled, false);
  assert.equal(f.controller.status(f.delivery.id).execution.state, "stopped");
  assert.ok(child.exitCode !== null || child.signalCode !== null);
  assert.ok(
    result.checks.every((c) => /^[a-f0-9]{64}$/.test(c.evidenceSha256)),
  );
}
test("native Windows controls coordinate synthetic boundary denial, revoked sender and killed-controller recovery", (t) =>
  nativeControlsScenario(t));
for (const refusal of ["allowed-stage", "unknown-stage", "challenge", "denial"])
  test(`native Windows controls refuse ${refusal} boundary evidence and still stop the worker`, (t) =>
    nativeControlsScenario(t, refusal));

test("public Mac report requires independent AppleHV evidence and cannot inherit Windows admission", async (t) => {
  const { macosWorkerQualificationReport } = await import(
    "../dist/windows-qualification.js"
  );
  const win = fixture(t);
  const wd = await win.controller.qualify(win.delivery.id);
  assert.equal(
    macosWorkerQualificationReport(wd).checks.hostBinding.result,
    "failed",
  );
  const mac = fixture(
    t,
    {},
    {
      platform: "darwin",
      arch: "arm64",
      osVersion: "27.2.0",
      provider: "applehv",
    },
  );
  await mac.controller.qualify(mac.delivery.id);
  const report = mac.controller.qualificationReport(mac.delivery.id);
  assert.deepEqual(report.target, {
    platform: "darwin",
    arch: "arm64",
    provider: "applehv",
  });
  assert.equal(report.checks.hostBinding.result, "passed");
  assert.equal(report.outcome, "blocked");
  assert.equal(report.productionEnabled, false);
  assert.equal(report.checks.authentication.result, "not-run");
  const wrong = fixture(
    t,
    {},
    {
      platform: "darwin",
      arch: "arm64",
      osVersion: "27.2.0",
      provider: "hyperv",
    },
  );
  const d = await wrong.controller.qualify(wrong.delivery.id);
  assert.equal(
    macosWorkerQualificationReport(d).checks.hostBinding.result,
    "failed",
  );
  await assert.rejects(
    () => mac.controller.qualifyMacosControls(mac.delivery.id),
    /trusted Windows controls runtime/,
  );
});

test("Mac controls exercise boundary denial and exact orphan shutdown through AppleHV", (t) =>
  nativeControlsScenario(t, undefined, true));

test("Mac completion assertion rejects Windows evidence and active retained sessions", async () => {
  const { assertMacosAcceptance } = await import(
    "../scripts/assert-macos-qualification.mjs"
  );
  const names = [
    "hostBinding",
    "offlineTransfer",
    "adversarialIsolation",
    "onlinePolicy",
    "authentication",
    "usageGate",
    "fencingRecovery",
    "syntheticTask",
    "isolatedValidation",
  ];
  const report = {
    outcome: "qualified",
    productionEnabled: false,
    deliveryId: "mac",
    target: { platform: "darwin", arch: "arm64", provider: "applehv" },
    checks: Object.fromEntries(
      names.map((n) => [n, { result: "passed", evidenceMode: "live" }]),
    ),
  };
  const delivery = {
    id: "mac",
    execution: { state: "stopped" },
    onlineAccess: { state: "stopped" },
    sessions: [],
    onlineRuns: [],
  };
  assert.doesNotThrow(() => assertMacosAcceptance(report, delivery));
  assert.throws(() =>
    assertMacosAcceptance(
      {
        ...report,
        target: { platform: "win32", arch: "x64", provider: "hyperv" },
      },
      delivery,
    ),
  );
  assert.throws(() =>
    assertMacosAcceptance(report, {
      ...delivery,
      sessions: [{ state: "dispatched" }],
    }),
  );
  assert.throws(() =>
    assertMacosAcceptance(report, {
      ...delivery,
      onlineRuns: [{ state: "uncertain" }],
    }),
  );
  assert.throws(() =>
    assertMacosAcceptance(
      {
        ...report,
        checks: {
          ...report.checks,
          authentication: { result: "not-run", evidenceMode: "live" },
        },
      },
      delivery,
    ),
  );
});

test("unavailable Mac qualification retains its intended target across controller restart", async (t) => {
  const f = fixture(t);
  const c = new DeliveryController(
    f.state,
    {},
    {
      worker: {
        qualificationPlatform: "darwin",
        probe: async () => {
          throw Error("Podman unavailable");
        },
      },
    },
  );
  await c.qualify(f.delivery.id);
  const reopened = new DeliveryController(f.state, {}, {});
  await reopened.qualify(f.delivery.id);
  const report = reopened.qualificationReport(f.delivery.id);
  assert.equal(report.target.platform, "darwin");
  assert.equal(report.target.provider, "applehv");
  assert.equal(report.outcome, "blocked");
  assert.equal(report.source.evidenceMode, "unavailable");
  assert.ok(report.blockers.length > 0);
  assert.equal(report.productionEnabled, false);
});
