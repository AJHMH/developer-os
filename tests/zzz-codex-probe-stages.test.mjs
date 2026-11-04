// Every stage the Codex probe can stop at reaches the qualification record. The
// name sorts after every other test file, so no other file changes shard.
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DeliveryController } from "../dist/controller.js";
import { PodmanHostAdapter } from "../dist/podman-host.js";
import { codexProbeStage } from "../dist/vm-management.js";

const binding = {
  platform: "win32",
  arch: "x64",
  osVersion: "10.0.26100",
  provider: "hyperv",
  machine: "aios-test",
  hostId: "a".repeat(64),
  engineVersion: "6.0.2",
  vmImageSha256: "b".repeat(64),
  template: "example.org/worker@sha256:" + "c".repeat(64),
  workerVersion: "0.161.0",
  policyVersion: "offline-v1",
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
};

// The mediation report of a qualification whose Codex probe reported `codex`.
async function mediation(t, codex) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-probe-stage-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "repo");
  mkdirSync(repository);
  const state = join(root, "state");
  const policyPath = join(root, "pins.json");
  writeFileSync(policyPath, JSON.stringify({ schema: 1, binding }), {
    mode: 0o600,
  });
  const native = {
    machine: binding.machine,
    policyPath,
    authorityDirectory: state,
    observe: () => ({ binding, effective }),
    probeIsolation: async () => ({
      passed: true,
      binding,
      challengeId: "00000000-0000-4000-8000-000000000111",
      probeVersion: "d".repeat(64),
      escapeAttempts: [
        "passed-escape-unshare",
        "passed-escape-chroot",
        "passed-escape-cgroup",
        "passed-escape-proc",
      ],
      probes: [
        {
          name: "owner-credentials",
          outcome: "passed",
          evidenceSha256: "e".repeat(64),
        },
      ],
      credentialExclusion: {
        hostFilesDenied: true,
        guestFileDenied: true,
        environmentScrubbed: true,
        mountsAbsent: true,
        networkAbsent: true,
        positiveControlsBeforeAfter: true,
      },
      codex,
    }),
  };
  const controller = new DeliveryController(
    state,
    {},
    {
      worker: new PodmanHostAdapter({
        machine: binding.machine,
        policyPath,
        adversarial: true,
        native,
      }),
    },
  );
  const delivery = controller.start({ repository, request: "Stages" });
  return (await controller.qualify(delivery.id)).qualification
    .subscriptionMediation;
}

test("every stage the guest program can report is a recorded stage", () => {
  const source = readFileSync(
    new URL("../dist/vm-management.js", import.meta.url),
    "utf8",
  );
  const stages = [...source.matchAll(/stage='(codex-[a-z-]*)'/g)].map(
    ([, stage]) => (stage.endsWith("-") ? `${stage}0` : stage),
  );
  assert.ok(stages.length > 40);
  for (const stage of ["initialization", ...stages])
    assert.equal(codexProbeStage(stage), stage);
});

test("a probe stopped at a stage records that stage and its timing", async (t) => {
  for (const stage of [
    "initialization",
    "codex-protocol-deadline",
    "codex-relay-peer-positive",
    "codex-relay-denial-3",
  ]) {
    const m = await mediation(t, {
      blockedStage: stage,
      diagnostic: { elapsedMs: 41000, failureKind: "timeout" },
    });
    assert.equal(m.workerBlocker, stage);
    assert.equal(m.workerDiagnostic.elapsedMs, 41000);
    assert.equal(m.workerDiagnostic.failureKind, "timeout");
    assert.equal(m.workerProtocol, "not-run");
  }
});

test("a stage outside the list is recorded only as unlisted", async (t) => {
  for (const stage of [
    "synthetic-private-detail",
    "codex-relay-denial-x",
    "codex-relay-denial-123",
  ]) {
    const m = await mediation(t, { blockedStage: stage });
    assert.equal(m.workerBlocker, "unlisted");
    assert.doesNotMatch(JSON.stringify(m), /synthetic-private-detail/);
  }
});
