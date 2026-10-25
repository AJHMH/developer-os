import assert from "node:assert/strict";
import test from "node:test";
import {
  hostTargets,
  hostTarget,
  supportsHostOS,
  validHostBinding,
  validEffectiveControls,
} from "../dist/host-target.js";

test("each target pins the code-mode host from the same official package as its worker CLI", () => {
  // @openai/codex@0.161.0-linux-x64 and -linux-arm64: bin/codex-code-mode-host.
  assert.equal(
    hostTargets.win32.codeModeHostSha256,
    "e87096087c02aa6ab90a5a85031659665aa0bf3ee20c07ca0b8ab701c83fcd5b",
  );
  assert.equal(
    hostTargets.darwin.codeModeHostSha256,
    "64efe2950af9d8ac9e9b94b0aac5e41f56307422e34e66a4217aaea0a221fed0",
  );
});

for (const [platform, minimum, previous] of [
  ["win32", "10.0.22000", "10.0.21999"],
  ["darwin", "23.0.0", "22.9.9"],
]) {
  test(`${platform} target owns its OS floor, architecture and provider admission`, () => {
    const target = hostTargets[platform];
    assert.equal(supportsHostOS(target, minimum), true);
    assert.equal(supportsHostOS(target, previous), false);
    for (const version of [undefined, "latest", "23", "10.0.22000.extra"])
      assert.equal(supportsHostOS(target, version), false);
    assert.equal(hostTarget(platform, target.arch), target);
    assert.equal(
      hostTarget(platform, target.arch === "x64" ? "arm64" : "x64"),
      undefined,
    );
    const binding = {
      platform,
      arch: target.arch,
      provider: target.provider,
      osVersion: minimum,
      machine: "aios-test",
      hostId: "a".repeat(64),
      vmImageSha256: "b".repeat(64),
      template: "example.org/worker@sha256:" + "c".repeat(64),
      engineVersion: "6.0.0",
      workerVersion: "0.161.0",
    };
    assert.equal(validHostBinding(binding, platform), true);
    assert.equal(validHostBinding({ ...binding, provider: "other" }), false);
    assert.equal(validHostBinding({ ...binding, machine: "shared" }), false);
    assert.equal(
      validHostBinding({ ...binding, template: "example.org/worker:latest" }),
      false,
    );
    assert.equal(
      validHostBinding(binding, platform === "darwin" ? "win32" : "darwin"),
      false,
    );
  });
}

test("macOS product and Darwin kernel version domains remain explicit", () => {
  assert.equal(supportsHostOS(hostTargets.darwin, "14.0", "product"), true);
  assert.equal(supportsHostOS(hostTargets.darwin, "13.9.9", "product"), false);
  assert.equal(supportsHostOS(hostTargets.darwin, "14.0", "kernel"), false);
  assert.equal(supportsHostOS(hostTargets.darwin, "23.0.0", "kernel"), true);
  assert.equal(hostTarget("linux", "x64"), undefined);
});

test("effective controls require every measured isolation property", () => {
  const controls = {
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
  };
  assert.equal(validEffectiveControls(controls), true);
  for (const key of Object.keys(controls)) {
    const missing = structuredClone(controls);
    delete missing[key];
    assert.equal(validEffectiveControls(missing), false, key);
  }
  assert.equal(
    validEffectiveControls({ ...controls, mounts: ["/host"] }),
    false,
  );
  assert.equal(
    validEffectiveControls({ ...controls, capabilities: ["SYS_ADMIN"] }),
    false,
  );
});
