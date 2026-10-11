import assert from "node:assert/strict";
import { test } from "node:test";
import os from "node:os";
import fs from "node:fs";
import childProcess from "node:child_process";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { syncBuiltinESMExports } from "node:module";
import { resolve } from "node:path";
import {
  podmanPlatform,
  podmanMachine,
  podmanCommand,
} from "../dist/podman-platform.js";
import { NativePodmanDriver } from "../dist/podman-native.js";
import {
  gatewayRequest,
  subscriptionGatewayVersion,
  syntheticGatewayResponse,
} from "../dist/subscription-gateway.js";

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
  const nativeReadFile = fs.readFileSync;
  t.mock.method(os, "platform", () => platform);
  t.mock.method(os, "arch", () => arch);
  t.mock.method(os, "release", () =>
    platform === "darwin" ? "27.2.0" : "10.0.26100",
  );
  t.mock.method(os, "homedir", () => "/virtual-home");
  t.mock.method(fs, "lstatSync", () => stat);
  t.mock.method(fs, "realpathSync", (path) => actualPath(path));
  t.mock.method(fs, "existsSync", () => true);
  t.mock.method(fs, "readFileSync", (path, options) => {
    if (
      String(path).includes("aios-host-positive-") ||
      ["host.txt", "synthetic-authority.txt", "synthetic-peer.txt"].some(
        (name) => String(path).endsWith(name),
      )
    )
      return nativeReadFile(path, options);
    if (String(path).endsWith("aios-test.json")) return JSON.stringify(config);
    if (String(path).endsWith("pins.json"))
      return JSON.stringify({
        schema: 1,
        binding: {
          platform,
          arch,
          osVersion: platform === "darwin" ? "27.2.0" : "10.0.26100",
          provider: platform === "darwin" ? "applehv" : "hyperv",
          machine: "aios-test",
        },
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
      const request = JSON.parse(Buffer.from(encoded, "base64"));
      requests.push(request);
      return typeof result === "function" ? result(request) : result;
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

test("native worker refuses dispatch when the controller authorization callback denies it", async () => {
  const driver = new NativePodmanDriver(
    "aios-test",
    "/external/authority",
    "/external/pins.json",
  );
  let authorizationChecks = 0;
  await assert.rejects(
    () =>
      driver.execute({
        session: {
          deliveryId: "00000000-0000-4000-8000-000000000001",
          operationId: "00000000-0000-4000-8000-000000000002",
          sandboxId: "00000000-0000-4000-8000-000000000003",
          workerSessionId: "00000000-0000-4000-8000-000000000004",
          runnerId: "00000000-0000-4000-8000-000000000005",
          fence: 1,
        },
        mayDispatch: () => {
          authorizationChecks++;
          return false;
        },
        files: [],
      }),
    /Native dispatch refused/,
  );
  assert.equal(authorizationChecks, 1);
});

test("native model-frame transport returns only binding-matched bounded frames", (t) => {
  const f = hostFixture(t, "darwin");
  const driver = new NativePodmanDriver(
    "aios-test",
    "/authority",
    "/pins.json",
  );
  const frame = "synthetic model-only request";
  const encoded = Buffer.from(frame).toString("base64");
  f.setResult({
    status: 0,
    stdout: JSON.stringify({
      binding: {
        platform: "darwin",
        arch: "arm64",
        osVersion: "27.2.0",
        provider: "applehv",
        machine: "aios-test",
      },
      frame: encoded,
      shutdown: { remainingProcesses: 0 },
    }),
  });
  const result = driver.modelFrame("/candidate", "request", frame);
  assert.equal(result.frame, encoded);
  assert.equal(result.shutdown.remainingProcesses, 0);
  assert.throws(
    () => driver.modelFrame("/candidate", "request", "x".repeat(4097)),
    /Model frame too large/,
  );

  f.setResult({
    status: 0,
    stdout: JSON.stringify({
      binding: { provider: "other" },
      frame: encoded,
      shutdown: { remainingProcesses: 0 },
    }),
  });
  assert.throws(
    () => driver.modelFrame("/candidate", "request", frame),
    /Unverified model frame/,
  );
});

test("native isolation uses a synthetic host process and model-only gateway capability", async (t) => {
  const f = hostFixture(t, "darwin");
  f.setResult((request) => {
    if (request.action === "isolate")
      return {
        status: 0,
        stdout: JSON.stringify({
          challengeId: request.challenge.id,
          passed: true,
        }),
      };
    if (request.action === "model-frame")
      return {
        status: 0,
        stdout: JSON.stringify({
          binding: request.expected,
          frame: request.frame,
          shutdown: { remainingProcesses: 0 },
        }),
      };
    assert.fail(`Unexpected native action: ${request.action}`);
  });

  const nativeSpawn = childProcess.spawn;
  const fakeChildren = [];
  t.mock.method(childProcess, "spawn", (executable, args, options) => {
    if (executable === process.execPath)
      return nativeSpawn(executable, args, options);

    const child = new EventEmitter();
    child.exitCode = null;
    child.stderr = new EventEmitter();
    child.stdout = new EventEmitter();
    let closed = false;
    const close = (code) => {
      if (closed) return;
      closed = true;
      child.exitCode = code;
      queueMicrotask(() => child.emit("close", code));
    };
    child.kill = () => {
      close(1);
      return true;
    };
    child.stdin = new Writable({
      write(chunk, _encoding, callback) {
        try {
          const python = Buffer.from(
            chunk.toString().trim(),
            "base64",
          ).toString();
          const encodedRequest = python.match(
            /base64\.b64decode\('([^']+)'\)/,
          )?.[1];
          assert.ok(encodedRequest, "expected bounded native request envelope");
          const request = JSON.parse(Buffer.from(encodedRequest, "base64"));
          const frame = {
            capability: request.gatewayCapability,
            deliveryId: request.deliveryId,
            gatewayRequest: Buffer.from(gatewayRequest).toString("base64"),
          };
          queueMicrotask(() =>
            child.stdout.emit(
              "data",
              Buffer.from(JSON.stringify(frame) + "\n"),
            ),
          );
          child.stdin.writeResponse = () => {
            const proof = {
              protocol: "passed",
              credentialIsolation: "passed",
              gatewayIntegration: "passed",
              gatewayVersion: subscriptionGatewayVersion,
              shutdown: { remainingProcesses: 0 },
              observedCodexProcesses: 1,
              binding: request.expected,
            };
            queueMicrotask(() => {
              child.stdout.emit(
                "data",
                Buffer.from(JSON.stringify(proof) + "\n"),
              );
              close(0);
            });
          };
        } catch (error) {
          callback(error);
          return;
        }
        callback();
      },
    });
    const write = child.stdin.write.bind(child.stdin);
    child.stdin.write = (chunk, ...rest) => {
      if (String(chunk).includes("gatewayResponse")) {
        const value = JSON.parse(String(chunk));
        assert.equal(
          value.gatewayResponse,
          syntheticGatewayResponse().toString("base64"),
        );
        child.stdin.writeResponse();
      }
      return write(chunk, ...rest);
    };
    fakeChildren.push(child);
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });

  const driver = new NativePodmanDriver(
    "aios-test",
    "/authority",
    "/pins.json",
  );
  const deliveryId = "00000000-0000-4000-8000-000000000001";
  const proof = await driver.probeIsolation("/candidate", deliveryId);
  assert.equal(proof.passed, true);
  assert.equal(proof.codex.credentialIsolation, "passed");
  assert.equal(proof.modelFrameTransport, "passed");
  assert.equal(
    f.requests.filter((request) => request.action === "model-frame").length,
    2,
  );
  assert.equal(fakeChildren.length, 1);
});
