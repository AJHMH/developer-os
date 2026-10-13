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

test("native inference starts its one-shot gateway lease only after bound isolation and always revokes it", async () => {
  const native = new NativePodmanDriver(
    "aios-test",
    "/authority",
    "/pins.json",
  );
  const binding = { platform: "win32", arch: "x64" };
  let created = 0,
    revoked = 0,
    refused = false;
  const gateway = {
    revoke() {
      revoked++;
    },
  };
  native.policy = () => binding;
  native.invoke = (action, payload) => {
    assert.equal(action, "isolate");
    assert.equal(
      created,
      0,
      "request deadline does not include isolation preparation",
    );
    return { passed: !refused, challengeId: payload.challenge.id };
  };
  native.gatewayInvocation = async (payload, deliveryId, supplied) => {
    assert.equal(created, 1);
    assert.equal(supplied, gateway);
    return {
      protocol: "passed",
      explicitResume: "passed",
      resumeInferenceRequests: 0,
      credentialIsolation: "passed",
      gatewayIntegration: "passed",
      relayDeliveryId: deliveryId,
      shutdown: { remainingProcesses: 0 },
      relayShutdownRemaining: 0,
      binding: payload.expected,
    };
  };
  await native.inferThroughGateway("/candidate", "delivery", () => {
    created++;
    return gateway;
  });
  assert.equal(created, 1);
  assert.equal(revoked, 1);
  created = 0;
  refused = true;
  await assert.rejects(
    native.inferThroughGateway("/candidate", "delivery", () => {
      created++;
      return gateway;
    }),
    /Unverified isolation/,
  );
  assert.equal(
    created,
    0,
    "failed isolation cannot create a gateway or open credentials",
  );
  assert.equal(revoked, 1);
});
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
  const programs = [];
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
      programs.push(options.input);
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
    programs,
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

for (const hostPlatform of ["darwin", "win32"])
  test(`native ${hostPlatform} isolation uses a synthetic host process and model-only gateway capability`, async (t) => {
    const f = hostFixture(t, hostPlatform);
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
            assert.ok(
              encodedRequest,
              "expected bounded native request envelope",
            );
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
                explicitResume: "passed",
                resumeInferenceRequests: 0,
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
    assert.equal(proof.codex.explicitResume, "passed");
    assert.equal(proof.modelFrameTransport, "passed");
    assert.equal(
      f.requests.filter((request) => request.action === "model-frame").length,
      2,
    );
    assert.equal(fakeChildren.length, 1);
  });

test("generated native management freezes direct wait failures before successful or failed cleanup", (t) => {
  const runPython = childProcess.spawnSync;
  const python = process.env.AIOS_TEST_PYTHON ?? "python";
  const available = runPython(python, ["--version"], {
    encoding: "utf8",
    timeout: 5000,
  });
  if (available.status !== 0) {
    t.skip("Python required to exercise generated management code");
    return;
  }
  const f = hostFixture(t, "win32");
  f.setResult({ status: 0, stdout: "{}" });
  new NativePodmanDriver("aios-test", "/authority", "/pins.json").observe(
    "/candidate",
  );
  const result = runPython(
    python,
    [
      "-c",
      String.raw`
import ast,json,sys,subprocess,time
program=ast.parse(sys.stdin.read())
functions=[n for n in program.body if isinstance(n,ast.FunctionDef) and n.name in ['fail','command','freeze_failure']]
# Exercise the actual emitted exception handler, replacing VM work and cleanup
# with fixed synthetic subprocess outcomes; no management authority is opened.
branch=next(n for n in ast.walk(program) if isinstance(n,ast.If) and ast.unparse(n.test)=="R['action'] == 'codex-protocol'")
protected=next(n for n in branch.body if isinstance(n,ast.Try) and n.handlers and n.finalbody)
handler=protected.handlers
for cleanupExit in [0,7]:
 diagnostic={'failureKind':'check','commandElapsedMs':3}
 subprocess.run=lambda *a,**k: subprocess.CompletedProcess(a,cleanupExit,b'',b'')
 synthetic=ast.Try(body=ast.parse("raise subprocess.TimeoutExpired('synthetic-child',10)").body,handlers=handler,orelse=[],finalbody=ast.parse("command(['synthetic-cleanup'])").body)
 module=ast.fix_missing_locations(ast.Module(body=functions+[synthetic],type_ignores=[]))
 try: exec(compile(module,'synthetic-management','exec'))
 except Exception: pass
 assert diagnostic['failed'] is True
 assert diagnostic['failureKind']=='timeout',diagnostic
 assert diagnostic['commandElapsedMs']==10000,diagnostic
 assert 'exitCode' not in diagnostic,diagnostic
print('preserved')
`,
    ],
    { input: f.programs[0], encoding: "utf8", timeout: 5000 },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "preserved");
});

test("Windows native Codex launch constrains thread pools and audits the exact environment", (t) => {
  const runPython = childProcess.spawnSync;
  const python = process.env.AIOS_TEST_PYTHON ?? "python";
  const available = runPython(python, ["--version"], {
    encoding: "utf8",
    timeout: 5000,
  });
  if (available.status !== 0) {
    t.skip("Python required to exercise generated management code");
    return;
  }
  const f = hostFixture(t, "win32");
  f.setResult({ status: 0, stdout: "{}" });
  new NativePodmanDriver("aios-test", "/authority", "/pins.json").observe(
    "/candidate",
  );
  const result = runPython(
    python,
    [
      "-c",
      String.raw`
import ast,sys
program=ast.parse(sys.stdin.read())
nodes=list(ast.walk(program))
assignment=next(n for n in nodes if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='runtimeEnv' for t in n.targets))
insertion=next(n for n in nodes if isinstance(n,ast.For) and ast.unparse(n.iter)=='runtimeEnv.items()')
audit=next(n for n in nodes if isinstance(n,ast.If) and ast.unparse(n.test).startswith('env !=') and 'runtimeEnv' in ast.unparse(n.test))
def fail(): raise RuntimeError('environment refused')
base={b'PATH':b'/usr/bin:/bin',b'HOME':b'/',b'HOSTNAME':b'aios-offline',b'DELIVERY_CAPABILITY':b'synthetic',b'CODEX_HOME':b'/tmp/empty-codex'}
for platform in ['win32','darwin']:
 binding={'platform':platform};cap='synthetic';args=['podman','exec','-i','worker','/codex']
 exec(compile(ast.fix_missing_locations(ast.Module(body=[assignment,insertion],type_ignores=[])),'launch','exec'))
 expected={b'TOKIO_WORKER_THREADS':b'1',b'RAYON_NUM_THREADS':b'1'} if platform=='win32' else {}
 assert runtimeEnv==expected
 assert args[-2:]==['worker','/codex']
 assert len(args)==5+2*len(expected)
 env={**base,**expected}
 code=compile(ast.fix_missing_locations(ast.Module(body=[audit],type_ignores=[])),'audit','exec')
 exec(code)
 for altered in [{**env,b'OWNER_TOKEN':b'private'}, {**env,b'TOKIO_WORKER_THREADS':b'2'}, {k:v for k,v in env.items() if k!=b'DELIVERY_CAPABILITY'}]:
  env=altered
  try: exec(code)
  except RuntimeError: pass
  else: raise AssertionError('unsafe environment accepted')
create=next(n for n in nodes if isinstance(n,ast.FunctionDef) and n.name=='create')
assert '--pids-limit=32' in ast.unparse(create)
print('bounded')
`,
    ],
    { input: f.programs[0], encoding: "utf8", timeout: 5000 },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "bounded");
});

test("Windows Codex task-headroom gate waits for idle workers and refuses exhausted budgets", (t) => {
  const runPython = childProcess.spawnSync;
  const python = process.env.AIOS_TEST_PYTHON ?? "python";
  const f = hostFixture(t, "win32");
  f.setResult({ status: 0, stdout: "{}" });
  new NativePodmanDriver("aios-test", "/authority", "/pins.json").observe(
    "/candidate",
  );
  const result = runPython(
    python,
    [
      "-c",
      String.raw`
import ast,sys
program=ast.parse(sys.stdin.read())
gate=next(n for n in ast.walk(program) if isinstance(n,ast.FunctionDef) and n.name=='awaitTaskBudget')
class Clock:
 def __init__(self): self.now=0
 def monotonic(self): return self.now
 def sleep(self,seconds): self.now+=seconds
def fail(): raise RuntimeError('refused')
for samples,allowed in [([(32,12),(28,6),(26,4)],True), ([(32,12)],False), ([(26,12)],False), ([(30,4)],False), ([(26,4)],True)]:
 time=Clock();binding={'platform':'win32'};diagnostic={};observations=0
 def observeTaskLimits():
  global observations
  tasks,runtime=samples[min(observations,len(samples)-1)];observations+=1
  diagnostic.update(workerTaskCount=tasks,workerTaskLimit=32,codexRuntimeTasks=runtime)
 exec(compile(ast.fix_missing_locations(ast.Module(body=[gate],type_ignores=[])),'gate','exec'))
 try: awaitTaskBudget()
 except RuntimeError: assert not allowed
 else: assert allowed
 assert time.now<=12.1
binding={'platform':'darwin'};observations=0;awaitTaskBudget();assert observations==0
calls=[n for n in ast.walk(program) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id=='awaitTaskBudget']
assert len(calls)==3
requestNode=next(n for n in ast.walk(program) if isinstance(n,ast.FunctionDef) and n.name=='request')
cap='synthetic';delivery='synthetic';body=b'{}';name='worker';diagnostic={}
class Process:
 PIPE=1;DEVNULL=2
 def run(self,*args,**kwargs):
  events.append('request')
  return type('Result',(),{'stdout':b'HTTP/1.1 403 Forbidden\r\n\r\n','returncode':0})()
subprocess=Process()
exec(compile(ast.fix_missing_locations(ast.Module(body=[requestNode],type_ignores=[])),'request','exec'))
for platform,worker,running,expected in [('win32','worker',True,['gate','request']),('win32','worker',False,['request']),('win32','peer',True,['request']),('darwin','worker',True,['request'])]:
 binding={'platform':platform};child=object() if running else None;stage='revoked';events=[]
 def awaitTaskBudget(): events.append('gate')
 assert request(worker,18081).startswith(b'HTTP/1.1 403 ')
 assert events==expected and stage=='revoked'
binding={'platform':'win32'};child=object();events=[];stage='revoked'
def awaitTaskBudget(): raise RuntimeError('headroom refused')
try: request(name,18081)
except RuntimeError: pass
else: raise AssertionError('exhausted request executed')
assert events==[] and stage=='codex-relay-task-budget'
print('headroom enforced')
`,
    ],
    { input: f.programs[0], encoding: "utf8", timeout: 5000 },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "headroom enforced");
});

test("native fixed task enforces staging, dispatch authority and exact stopped collection bindings", async (t) => {
  const {
    NativeSyntheticTask,
    syntheticSiteInput,
    syntheticSiteOutput,
    syntheticSiteValidator,
  } = await import("../dist/synthetic-task.js");
  const f = hostFixture(t, "win32");
  const pins = { bindingSha256: "a".repeat(64), policySha256: "b".repeat(64) };
  const session = {
    sandboxId: "00000000-0000-4000-8000-000000000001",
    operationId: "00000000-0000-4000-8000-000000000002",
  };
  let allowed = true,
    dispatches = 0,
    stops = 0,
    collections = 0;
  const native = {
    machine: "aios-test",
    async execute() {
      dispatches++;
      return { status: "running" };
    },
    async stop() {
      stops++;
      return { status: "stopped" };
    },
    async collect() {
      collections++;
      return { files: [] };
    },
  };
  const task = new NativeSyntheticTask(native);
  const request = { ...pins, session, mayDispatch: () => allowed };
  await assert.rejects(task.execute(request), /input or ownership/);
  assert.throws(() => task.stage([]), /fixed synthetic/);
  const files = [
    { path: "index.html", bytes: Buffer.from(syntheticSiteInput) },
    { path: "validate.sh", bytes: Buffer.from(syntheticSiteValidator) },
  ];
  task.stage(files);
  files[0].bytes.fill(0);
  let failure = false,
    malformed = false;
  t.mock.method(childProcess, "spawnSync", (_exe, args, options) => {
    const data = JSON.parse(options.input.split("\n")[1]);
    assert.equal(options.shell, false);
    assert.equal(options.windowsHide, true);
    assert.deepEqual(data.pins, pins);
    assert.equal(
      Buffer.from(data.files[0].bytes, "base64").toString(),
      syntheticSiteInput,
    );
    assert.equal(
      Buffer.from(data.expected, "base64").toString(),
      syntheticSiteOutput,
    );
    if (failure) return { status: 1, stderr: "private fixture error" };
    if (malformed) return { status: 0, stdout: "invalid" };
    return {
      status: 0,
      stdout: JSON.stringify({ action: data.action, files: [] }),
    };
  });
  syncBuiltinESMExports();
  assert.equal((await task.execute(request)).status, "running");
  assert.equal(dispatches, 1);
  allowed = false;
  await assert.rejects(task.execute(request), /ownership/);
  assert.equal(dispatches, 1);
  allowed = true;
  native.execute = async () => {
    allowed = false;
    return {};
  };
  await assert.rejects(task.execute(request), /authority changed/);
  await assert.rejects(
    task.collectTask(session, pins),
    /verified native collection/,
  );
  await task.stop(session, pins);
  assert.equal(stops, 1);
  await task.collect(session, pins);
  assert.equal(collections, 1);
  assert.equal((await task.collectTask(session, pins)).action, "collect");
  await assert.rejects(
    task.collectTask(session, { ...pins, policySha256: "c".repeat(64) }),
    /matching verified/,
  );
  await task.collect({ ...session, sandboxId: "invalid" }, pins);
  await assert.rejects(
    task.collectTask({ ...session, sandboxId: "invalid" }, pins),
    /Invalid synthetic session/,
  );
  await task.collect(session, pins);
  failure = true;
  await assert.rejects(
    task.collectTask(session, pins),
    (error) => !error.message.includes("private fixture"),
  );
  failure = false;
  malformed = true;
  await assert.rejects(task.collectTask(session, pins), SyntaxError);
  task.stage([
    { path: "index.html", bytes: Buffer.from(syntheticSiteInput) },
    { path: "validate.sh", bytes: Buffer.from(syntheticSiteValidator) },
  ]);
  await assert.rejects(
    task.collectTask(session, pins),
    /verified native collection/,
  );
});
