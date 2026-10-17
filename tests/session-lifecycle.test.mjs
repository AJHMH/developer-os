import assert from "node:assert/strict";
import test from "node:test";
import {
  SessionLifecycle,
  sessionsQuiescent,
} from "../dist/session-lifecycle.js";

function fixture(runtimes = {}) {
  let delivery = {
    id: "delivery",
    phase: "implementing",
    ownership: { held: true, fence: 1, key: "repository" },
    blocker: { code: "DELIVERY_NOT_ENABLED" },
    execution: {
      deliveryId: "delivery",
      intent: "start",
      repositoryKey: "repository",
      operationId: "operation",
      sandboxId: "sandbox",
      workerSessionId: "worker",
      runnerId: "runner",
      fence: 1,
      state: "running",
    },
  };
  const ports = {
    read: () => structuredClone(delivery),
    change: (_id, update) => {
      update(delivery, () => ++delivery.ownership.fence);
      return structuredClone(delivery);
    },
    observe: (promise) => promise,
    runnerId: "recovery-runner",
    clock: () => Date.parse("2026-10-17T12:00:00Z"),
    runtimes,
    disabledBlocker: () => ({ code: "DELIVERY_NOT_ENABLED" }),
    stopValidation: async () => delivery,
    stopFeature: async () => delivery,
    finishRepair: () => delivery,
  };
  return {
    lifecycle: new SessionLifecycle(ports),
    ports,
    read: ports.read,
    update: (mutation) => mutation(delivery),
  };
}

test("worker recovery advances the fence and accepts only an exact stopped receipt", async () => {
  const f = fixture({
    worker: {
      fenceAndStop: async (session) => ({ ...session, status: "stopped" }),
    },
  });
  const stopped = await f.lifecycle.stopWorker("delivery");
  assert.equal(stopped.execution.state, "stopped");
  assert.equal(stopped.execution.fence, 2);
  assert.equal(stopped.execution.runnerId, "recovery-runner");
  assert.equal(stopped.recovery.at(-1).outcome, "stopped");
  assert.equal(sessionsQuiescent(stopped), true);
});

test("changed receipt identity and missing shutdown evidence preserve uncertainty", async () => {
  for (const result of [undefined, "mismatched", "running"]) {
    const f = fixture({
      worker: {
        fenceAndStop: async (session) =>
          result === undefined
            ? undefined
            : {
                ...session,
                workerSessionId:
                  result === "mismatched" ? "other" : session.workerSessionId,
                status: result === "running" ? "running" : "stopped",
              },
      },
    });
    const stopped = await f.lifecycle.stopWorker("delivery");
    assert.equal(stopped.execution.state, "uncertain");
    assert.equal(stopped.blocker.code, "UNCERTAIN_SESSION");
    assert.equal(stopped.phase, "blocked");
    assert.equal(sessionsQuiescent(stopped), false);
  }
});

test("late receipts are recorded without replacing the current session", () => {
  const f = fixture(),
    old = f.read().execution;
  f.update((delivery) => {
    delivery.ownership.fence++;
    delivery.execution.operationId = "new-operation";
  });
  const current = f.lifecycle.recordReceipt(
    "delivery",
    old,
    { ...old, status: "stopped" },
    true,
  );
  assert.equal(current.execution.operationId, "new-operation");
  assert.equal(current.execution.state, "running");
  assert.equal(current.recovery.at(-1).outcome, "late-response");
});

test("offline recovery requires revocation and descendant shutdown before admitting its census", async () => {
  for (const verified of [true, false]) {
    const pins = {
      bindingSha256: "a".repeat(64),
      policySha256: "b".repeat(64),
    };
    const f = fixture({
      offline: {
        mode: "controlled",
        stop: async (session) => ({
          ...session,
          ...pins,
          status: "stopped",
          revoked: true,
          descendantsStopped: verified,
          evidence: {
            observedProcesses: 8,
            remainingProcesses: 0,
            censusSha256: "c".repeat(64),
          },
        }),
      },
    });
    f.update((delivery) => {
      delivery.offlineCanary = {
        ...pins,
        mode: "controlled",
        session: { ...delivery.execution },
      };
    });
    const stopped = await f.lifecycle.stopWorker("delivery");
    assert.equal(stopped.execution.state, verified ? "stopped" : "uncertain");
    assert.equal(Boolean(stopped.offlineCanary.shutdownProof), verified);
  }
});

test("online recovery requires exact irreversible revocation and zero descendants", async () => {
  let remaining = 1;
  const f = fixture({
    online: {
      stop: async (runId) => ({
        runId,
        revoked: true,
        remainingProcesses: remaining,
      }),
    },
  });
  f.update((delivery) => {
    delete delivery.execution;
    delivery.onlineAccess = { runId: "online", state: "dispatched", fence: 1 };
  });
  assert.equal(
    (await f.lifecycle.stopOnline("delivery")).onlineAccess.state,
    "uncertain",
  );
  remaining = 0;
  const stopped = await f.lifecycle.stopOnline("delivery");
  assert.equal(stopped.onlineAccess.state, "stopped");
  assert.equal(stopped.blocker.code, "DELIVERY_NOT_ENABLED");
});

test("quiescence includes retained and current worker, online, coding and validation sessions", () => {
  const f = fixture();
  f.update((delivery) => {
    delivery.execution.state = "stopped";
  });
  assert.equal(sessionsQuiescent(f.read()), true);
  for (const extra of [
    { sessions: [{ state: "uncertain" }] },
    { offlineCanary: { session: { state: "running" } } },
    { onlineAccess: { state: "dispatched" } },
    { onlineRuns: [{ state: "uncertain" }] },
    { feature: { session: { state: "running" } } },
    { validation: { attempts: [{ state: "dispatched" }] } },
  ]) {
    assert.equal(sessionsQuiescent({ ...f.read(), ...extra }), false);
  }
});

test("worker proposals archive stopped sessions and bind each dispatch to a fresh fence", () => {
  const f = fixture();
  f.update((d) => {
    d.execution.state = "stopped";
  });
  f.ports.change("delivery", (delivery, advance) => {
    const previous = structuredClone(delivery.execution);
    const session = f.lifecycle.proposeWorker(delivery, advance, {
      resume: true,
      state: "proposed",
    });
    assert.equal(session.fence, 2);
    assert.equal(session.intent, "resume");
    assert.equal(session.sandboxId, previous.sandboxId);
    assert.equal(session.workerSessionId, previous.workerSessionId);
    assert.notEqual(session.operationId, previous.operationId);
    assert.deepEqual(delivery.sessions, [previous]);
    assert.throws(() =>
      f.lifecycle.proposeWorker(delivery, advance, {
        resume: false,
        state: "dispatched",
      }),
    );
  });
  assert.equal(f.read().ownership.fence, 2);
});

test("online dispatch archives prior proof and refuses retained uncertain sessions", () => {
  const f = fixture();
  f.update((d) => {
    d.execution.state = "stopped";
    d.onlineAccess = { runId: "old", fence: 1, state: "stopped" };
  });
  f.ports.change("delivery", (delivery, advance) => {
    f.lifecycle.dispatchOnline(delivery, advance, {
      runId: "new",
      state: "dispatched",
    });
    assert.equal(delivery.onlineAccess.fence, 2);
    assert.equal(delivery.onlineRuns[0].runId, "old");
    delivery.onlineAccess.state = "stopped";
    delivery.onlineRuns[0].state = "uncertain";
    assert.throws(() =>
      f.lifecycle.dispatchOnline(delivery, advance, {
        runId: "refused",
        state: "dispatched",
      }),
    );
  });
});
