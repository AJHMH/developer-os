import assert from "node:assert/strict";
import { test } from "node:test";
import os from "node:os";
import fs from "node:fs";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { resolve } from "node:path";
import {
  podmanPlatform,
  podmanMachine,
  podmanCommand,
} from "../dist/podman-platform.js";
import { NativePodmanDriver } from "../dist/podman-native.js";

// External OS, filesystem and process observations are simulated; no VM is launched.
function hostFixture(
  t,
  platform,
  arch = platform === "darwin" ? "arm64" : "x64",
) {
  let config = {
    Name: "aios-test",
    Version: 1,
    Mounts: [],
    HostUser: { Rootful: false },
    HyperVHypervisor: {},
    AppleHypervisor: { Vfkit: { Rosetta: false, BinaryPath: null } },
    Rosetta: false,
    ImportNativeCA: false,
    Ansible: null,
    Resources: { USBs: [] },
  };
  let stat = {
    isFile: () => true,
    isDirectory: () => true,
    isSymbolicLink: () => false,
    nlink: 1,
    size: 100,
  };
  let actualPath = (path) => resolve(path);
  let result = { status: 0, stdout: "observed" };
  let executable = "trusted-runtime";
  let version = "6.1.1";
  const requests = [];
  t.mock.method(os, "platform", () => platform);
  t.mock.method(os, "arch", () => arch);
  t.mock.method(os, "release", () =>
    platform === "darwin" ? "27.2.0" : "10.0.26100",
  );
  t.mock.method(os, "homedir", () => "/virtual-home");
  t.mock.method(fs, "lstatSync", () => stat);
  t.mock.method(fs, "realpathSync", (path) => actualPath(path));
  t.mock.method(fs, "existsSync", () => true);
  t.mock.method(fs, "readFileSync", (path) => {
    if (String(path).endsWith("aios-test.json")) return JSON.stringify(config);
    if (String(path).endsWith("pins.json"))
      return JSON.stringify({
        schema: 1,
        binding: { provider: platform === "darwin" ? "applehv" : "hyperv" },
      });
    return Buffer.from(executable);
  });
  t.mock.method(childProcess, "spawnSync", (path, args, options) => {
    if (args.includes("version"))
      return {
        status: 0,
        stdout: JSON.stringify({ Client: { Version: version } }),
      };
    if (args.includes("python3")) {
      const encoded = options.input.match(/base64.b64decode\('([^']+)'\)/)[1];
      requests.push(JSON.parse(Buffer.from(encoded, "base64")));
      return result;
    }
    return result;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  return {
    config,
    requests,
    setConfig: (value) => {
      config = value;
    },
    setStat: (value) => {
      stat = { ...stat, ...value };
    },
    setPath: (value) => {
      actualPath = value;
    },
    setResult: (value) => {
      result = value;
    },
    setVersion: (value) => {
      version = value;
    },
    setExecutable: (value) => {
      executable = value;
    },
  };
}

for (const platform of ["darwin", "win32"]) {
  test(`trusted ${platform} observations select the explicit provider and refuse unsafe configuration`, (t) => {
    const f = hostFixture(t, platform);
    const host = podmanMachine("aios-test");
    assert.equal(host.provider, platform === "darwin" ? "applehv" : "hyperv");
    assert.equal(host.guestArch, platform === "darwin" ? "arm64" : "amd64");
    assert.equal(podmanCommand(host, ["info"]), "observed");
    for (const patch of [
      { Name: "wrong" },
      { Version: 2 },
      { Mounts: ["host"] },
      { Mounts: null },
      { HostUser: { Rootful: true } },
      platform === "darwin"
        ? { AppleHypervisor: null }
        : { HyperVHypervisor: null },
      ...(platform === "darwin"
        ? [
            { Rosetta: true },
            { ImportNativeCA: true },
            { Ansible: {} },
            { Resources: { USBs: ["usb"] } },
            { Resources: { USBs: null } },
            { AppleHypervisor: { Vfkit: { Rosetta: true, BinaryPath: null } } },
            {
              AppleHypervisor: {
                Vfkit: { Rosetta: false, BinaryPath: "/custom" },
              },
            },
          ]
        : []),
    ]) {
      f.setConfig({ ...f.config, ...patch });
      assert.throws(
        () => podmanMachine("aios-test"),
        /Unsafe machine configuration/,
      );
    }
    f.setConfig(f.config);
    for (const patch of [
      { isFile: () => false },
      { isSymbolicLink: () => true },
      { nlink: 2 },
      { size: 65537 },
    ]) {
      f.setStat(patch);
      assert.throws(() => podmanMachine("aios-test"));
      f.setStat({
        isFile: () => true,
        isSymbolicLink: () => false,
        nlink: 1,
        size: 100,
      });
    }
    f.setPath((path) => resolve(path) + "/redirected");
    assert.throws(() => podmanMachine("aios-test"), /Unsafe native path/);
    f.setPath((path) => resolve(path));
    for (const result of [
      { status: 1, stdout: "private-error" },
      { status: 0, error: Error("private-error") },
    ]) {
      f.setResult(result);
      assert.throws(
        () => podmanCommand(host, ["info"]),
        /Observation unavailable/,
      );
    }
    assert.throws(() => podmanMachine("../unsafe"), /Invalid machine/);
  });
  test(`native ${platform} observation transports bound host data and refuses uncertain runtime results`, (t) => {
    const f = hostFixture(t, platform);
    f.setResult({
      status: 0,
      stdout: JSON.stringify({
        binding: { provider: platform === "darwin" ? "applehv" : "hyperv" },
        effective: { network: "none" },
      }),
    });
    const driver = new NativePodmanDriver(
      "aios-test",
      "/authority",
      "/pins.json",
    );
    const observed = driver.observe("/candidate");
    assert.equal(observed.effective.network, "none");
    const request = f.requests[0];
    assert.equal(request.action, "observe");
    assert.equal(request.hostBinding.platform, platform);
    assert.equal(
      request.hostBinding.provider,
      platform === "darwin" ? "applehv" : "hyperv",
    );
    assert.equal(request.guestArch, platform === "darwin" ? "arm64" : "amd64");
    assert.equal(request.expected.provider, request.hostBinding.provider);
    f.setVersion("unknown");
    assert.throws(() => driver.observe("/candidate"), /Unknown client version/);
    f.setVersion("6.1.1");
    f.setResult({ status: 1, stdout: "private-error" });
    assert.throws(
      () => driver.observe("/candidate"),
      /Native offline operation unavailable/,
    );
    f.setResult({ status: 0, stdout: "malformed" });
    assert.throws(() => driver.observe("/candidate"), SyntaxError);
    f.setStat({ isDirectory: () => false });
    assert.throws(() => driver.observe("/candidate"), /Unsafe native path/);
  });
}

test("unsupported hosts and Intel Macs cannot select a native provider", (t) => {
  hostFixture(t, "linux");
  assert.throws(() => podmanPlatform(), /Unsupported native host/);
});
test("Intel Macs cannot select AppleHV", (t) => {
  hostFixture(t, "darwin", "x64");
  assert.throws(() => podmanPlatform(), /Unsupported native host/);
});
