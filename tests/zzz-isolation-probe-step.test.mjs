// Where inside probeIsolation a refused adversarial probe failed, and how: fixed
// names, an exit status and timings, never any error or guest text.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { test } from "node:test";
import { DeliveryController } from "../dist/controller.js";
import {
  IsolationProbeError,
  NativeOperationError,
  spawnFailure,
} from "../dist/native-diagnostics.js";
import { PodmanHostAdapter } from "../dist/podman-host.js";
import { NativePodmanDriver } from "../dist/podman-native.js";
import { subscriptionGatewayVersion } from "../dist/subscription-gateway.js";

const binding = {
  platform: "darwin",
  arch: "arm64",
  osVersion: "27.3.0",
  provider: "applehv",
  machine: "aios-test",
  hostId: "a".repeat(64),
  engineVersion: "6.0.2",
  vmImageSha256: "b".repeat(64),
  template: "example.org/worker@sha256:" + "c".repeat(64),
  workerVersion: "0.161.0",
  policyVersion: "offline-v1",
};
const admitted = {
  ...binding,
  platform: "darwin",
  arch: "arm64",
  osVersion: "27.2.0",
  provider: "applehv",
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

function workspace(t, pins = binding) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-probe-step-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "repo");
  mkdirSync(repository);
  const authority = join(root, "authority");
  mkdirSync(authority);
  const policyPath = join(root, "pins.json");
  writeFileSync(policyPath, JSON.stringify({ schema: 1, binding: pins }), {
    mode: 0o600,
  });
  return { root, repository, authority, policyPath };
}

// A Codex stream that closes as `close` says, after `frames` on stdout.
function stream({ frames = [], status = 0, deadlineMs = 60000, hang = false }) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new Writable({ write: (_chunk, _encoding, done) => done() });
  child.exitCode = null;
  child.kill = () => {
    if (child.exitCode !== null) return;
    child.exitCode = -1;
    queueMicrotask(() => child.emit("close", null));
  };
  return {
    child,
    deadlineMs,
    unchanged: () => true,
    start: () => {
      if (hang) return;
      queueMicrotask(() => {
        for (const frame of frames)
          child.stdout.emit("data", Buffer.from(JSON.stringify(frame) + "\n"));
        child.exitCode = status;
        child.emit("close", status);
      });
    },
  };
}

// A driver over a fake management channel; `invoke` sees each VM action.
function driver(t, { invoke, openCodex }) {
  const { repository, authority, policyPath } = workspace(t);
  const native = new NativePodmanDriver("aios-test", authority, policyPath);
  Object.defineProperty(native, "management", {
    value: { invoke, openCodex },
  });
  return { native, repository };
}
const isolate = (_action, request) => ({
  challengeId: request.challenge.id,
  passed: true,
});
const passedCodex = (request) => ({
  protocol: "passed",
  explicitResume: "passed",
  resumeInferenceRequests: 0,
  credentialIsolation: "passed",
  gatewayIntegration: "passed",
  gatewayVersion: subscriptionGatewayVersion,
  shutdown: { remainingProcesses: 0 },
  observedCodexProcesses: 1,
  binding: request.expected,
});

async function refused(t, fake) {
  const { native, repository } = driver(t, fake);
  const error = await native.probeIsolation(repository).then(
    () => assert.fail("The probe should have refused"),
    (value) => value,
  );
  assert.ok(error instanceof IsolationProbeError);
  assert.doesNotMatch(
    JSON.stringify(error.diagnostic),
    /synthetic-private-detail/,
  );
  const { stepElapsedMs, elapsedMs, ...named } = error.diagnostic;
  assert.ok(Number.isSafeInteger(stepElapsedMs) && stepElapsedMs >= 0);
  assert.ok(Number.isSafeInteger(elapsedMs) && elapsedMs >= stepElapsedMs);
  return named;
}

test("spawnFailure names how a VM command failed and keeps only its exit status", () => {
  for (const [result, expected] of [
    [
      { error: Object.assign(Error("x"), { code: "ETIMEDOUT" }), status: null },
      { failure: "timeout" },
    ],
    [
      { error: Object.assign(Error("x"), { code: "ENOBUFS" }), status: null },
      { failure: "output-limit" },
    ],
    [
      { error: Object.assign(Error("x"), { code: "ENOENT" }), status: null },
      { failure: "spawn" },
    ],
    [{ status: 255 }, { failure: "exit", exitStatus: 255 }],
    [{ status: null, signal: "SIGKILL" }, { failure: "signal" }],
  ])
    assert.deepEqual(spawnFailure(result), expected);
});

test("a VM command that failed in isolate names the step and how", async (t) => {
  for (const [thrown, expected] of [
    [
      new NativeOperationError("synthetic-private-detail", {
        failure: "timeout",
      }),
      { step: "isolate", failure: "timeout" },
    ],
    [
      new NativeOperationError("synthetic-private-detail", {
        failure: "exit",
        exitStatus: 255,
      }),
      { step: "isolate", failure: "exit", exitStatus: 255 },
    ],
    [
      new SyntaxError("synthetic-private-detail"),
      { step: "isolate", failure: "output" },
    ],
    [Error("synthetic-private-detail"), { step: "isolate", failure: "check" }],
  ])
    assert.deepEqual(
      await refused(t, {
        invoke: () => {
          throw thrown;
        },
      }),
      expected,
    );
});

test("isolation evidence for another challenge is a failed check in isolate", async (t) => {
  assert.deepEqual(
    await refused(t, {
      invoke: () => ({ challengeId: "another", passed: true }),
    }),
    { step: "isolate", failure: "check" },
  );
});

test("a Codex stream that failed names how it ended", async (t) => {
  for (const [options, expected] of [
    [{ status: 255 }, { failure: "exit", exitStatus: 255 }],
    [{ status: null }, { failure: "signal" }],
    [{ status: 0 }, { failure: "output" }],
    [{ hang: true, deadlineMs: 5 }, { failure: "timeout" }],
  ])
    assert.deepEqual(
      await refused(t, {
        invoke: isolate,
        openCodex: () => stream(options),
      }),
      { step: "codex-stream", ...expected },
    );
});

test("a Codex stream that can't start is named as a spawn failure", async (t) => {
  assert.deepEqual(
    await refused(t, {
      invoke: isolate,
      openCodex: () => {
        const opened = stream({ hang: true });
        opened.start = () =>
          queueMicrotask(() =>
            opened.child.emit("error", Error("synthetic-private-detail")),
          );
        return opened;
      },
    }),
    { step: "codex-stream", failure: "spawn" },
  );
});

test("a Codex stage the guest reports isn't a refused probe, and carries its diagnostic", async (t) => {
  const { native, repository } = driver(t, {
    invoke: (action, request) =>
      action === "isolate"
        ? isolate(action, request)
        : {
            binding: request.expected,
            frame: request.frame,
            shutdown: { remainingProcesses: 0 },
          },
    openCodex: () =>
      stream({
        frames: [
          {
            blockedStage: "codex-protocol-deadline",
            diagnostic: {
              elapsedMs: 41000,
              failureKind: "timeout",
              private: "synthetic-private-detail",
            },
          },
        ],
      }),
  });
  const proof = await native.probeIsolation(repository);
  assert.deepEqual(proof.codex, {
    blockedStage: "codex-protocol-deadline",
    diagnostic: { elapsedMs: 41000, failureKind: "timeout" },
  });
  assert.equal(proof.modelFrameTransport, "passed");
});

test("unverified gateway integration is a failed check in the Codex stream", async (t) => {
  // The fake never asks the gateway, so its integration can't be verified.
  assert.deepEqual(
    await refused(t, {
      invoke: isolate,
      openCodex: (request) => stream({ frames: [passedCodex(request)] }),
    }),
    { step: "codex-stream", failure: "check" },
  );
});

test("rejected Codex evidence and a failed model frame name their own steps", async (t) => {
  const answered = (fake, codex) => {
    const { native, repository } = driver(t, fake);
    Object.defineProperty(native, "gatewayInvocation", {
      value: async (payload) => codex(payload),
    });
    return native.probeIsolation(repository).then(
      () => assert.fail("The probe should have refused"),
      ({ diagnostic: { step, failure } }) => ({ step, failure }),
    );
  };
  assert.deepEqual(
    await answered({ invoke: isolate }, () => ({ protocol: "failed" })),
    { step: "codex-evidence", failure: "check" },
  );
  assert.deepEqual(
    await answered(
      {
        invoke: (action, request) => {
          if (action === "isolate") return isolate(action, request);
          throw new NativeOperationError("synthetic-private-detail", {
            failure: "exit",
            exitStatus: 1,
          });
        },
      },
      passedCodex,
    ),
    { step: "model-frame", failure: "exit" },
  );
});

test("a refused probe's diagnostic reaches the qualification, and no other stage gets one", async (t) => {
  const qualification = async (probeIsolation) => {
    const { repository, root, policyPath } = workspace(t, admitted);
    const controller = new DeliveryController(
      join(root, "state"),
      {},
      {
        worker: new PodmanHostAdapter({
          policyPath,
          machine: admitted.machine,
          adversarial: true,
          native: {
            machine: admitted.machine,
            policyPath,
            authorityDirectory: join(root, "state"),
            observe: () => ({ binding: admitted, effective }),
            probeIsolation,
          },
        }),
      },
    );
    const delivery = controller.start({ repository, request: "Probe step" });
    return (await controller.qualify(delivery.id)).qualification;
  };
  const diagnostic = {
    step: "isolate",
    failure: "timeout",
    stepElapsedMs: 90004,
    elapsedMs: 90011,
  };
  const named = await qualification(async () => {
    throw new IsolationProbeError(diagnostic);
  });
  assert.equal(named.adversarialBlocker, "isolation-probe");
  assert.deepEqual(named.adversarialDiagnostic, diagnostic);

  const plain = await qualification(async () => {
    throw Error("synthetic-private-detail");
  });
  assert.equal(plain.adversarialBlocker, "isolation-probe");
  assert.equal(plain.adversarialDiagnostic, undefined);
  assert.doesNotMatch(JSON.stringify(plain), /synthetic-private-detail/);

  const changed = await qualification(async () => ({
    binding: { ...admitted, hostId: "d".repeat(64) },
  }));
  assert.equal(changed.adversarialBlocker, "isolation-binding");
  assert.equal(changed.adversarialDiagnostic, undefined);
});
