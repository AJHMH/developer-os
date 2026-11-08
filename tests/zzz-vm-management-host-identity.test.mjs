import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hostTargets } from "../dist/host-target.js";
import { VMManagementChannel } from "../dist/vm-management.js";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const simulator = fileURLToPath(
  new URL("./helpers/vm-management-guest.py", import.meta.url),
);

/** The real offline guest program's `enroll`, which `pin-offline` runs, against
 * a simulated VM and a fake Podman whose bytes and version a test can change. */
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(os.tmpdir(), "aios-identity-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  mkdirSync(bin, { mode: 0o700 });
  const executable = join(bin, "podman");
  const vmPath = join(root, "vm.json");
  const vm = {
    machineId: "0123456789abcdef0123456789abcdef",
    productUuid: "0542570a-0000-4000-8000-000000000001",
  };
  const podman = (version) => `#!/bin/sh
if [ "$1" = machine ]; then exec /usr/bin/python3 "${simulator}"; fi
echo '{"Client":{"Version":"${version}"}}'
`;
  const installPodman = (version) =>
    writeFileSync(executable, podman(version), { mode: 0o700 });
  installPodman("6.1.1");
  const host = {
    ...hostTargets.darwin,
    executable,
    cwd: root,
    osVersion: "27.3.0",
    env: {
      HOME: root,
      PATH: `${bin}:/usr/bin:/bin`,
      FAKE_VM: vmPath,
    },
    config: {},
  };
  const channel = new VMManagementChannel(
    "aios-test",
    join(root, "authority"),
    () => host,
  );
  return {
    vm,
    installPodman,
    podman,
    observe() {
      writeFileSync(vmPath, JSON.stringify(vm));
      return channel.invoke("enroll").binding;
    },
  };
}

test("a restart keeps the offline binding, which names the VM by its machine ID", (t) => {
  const f = fixture(t);
  const first = f.observe();
  // Apple's hypervisor gives the VM a new hardware UUID on every boot.
  f.vm.productUuid = "b9c8020a-0000-4000-8000-000000000002";
  assert.deepEqual(f.observe(), first);
});

test("a recreated VM moves only the offline host identity", (t) => {
  const f = fixture(t);
  const first = f.observe();
  f.vm.machineId = "f".repeat(32);
  const recreated = f.observe();
  assert.notEqual(recreated.hostId, first.hostId);
  assert.deepEqual({ ...recreated, hostId: first.hostId }, first);
});

test("a Podman upgrade or a changed hostname moves the host identity", (t) => {
  const f = fixture(t);
  const first = f.observe();
  // Podman 6.1.1 to 6.1.4 on 4 November 2026 moved every pin on the owner's Mac.
  f.installPodman("6.1.4");
  const upgraded = f.observe();
  assert.notEqual(upgraded.hostId, first.hostId);
  f.installPodman("6.1.1");
  assert.equal(f.observe().hostId, first.hostId);
  t.mock.method(os, "hostname", () => "another-host");
  syncBuiltinESMExports();
  assert.notEqual(f.observe().hostId, first.hostId);
  os.hostname.mock.restore();
  syncBuiltinESMExports();
});

test("the offline host identity binds the host facts and machine ID", (t) => {
  const f = fixture(t);
  const { hostId } = f.observe();
  const executable = hash(f.podman("6.1.1"));
  assert.equal(
    hostId,
    hash(`${os.hostname()}${executable}6.1.1${f.vm.machineId}`),
  );
});

test("a missing or malformed machine ID refuses the observation", (t) => {
  const f = fixture(t);
  for (const machineId of [
    "",
    "uninitialized",
    "F".repeat(32),
    "0".repeat(31),
    "0".repeat(33),
  ]) {
    f.vm.machineId = machineId;
    assert.throws(() => f.observe());
  }
});
