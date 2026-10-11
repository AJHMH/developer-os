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
