import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SessionLifecycle,
  sessionsQuiescent,
} from "../dist/session-lifecycle.js";

const stopped = {
  operationId: "o",
  fence: 1,
  state: "stopped",
  intent: "start",
};

test("quiescence needs the coding session and every validation attempt stopped", () => {
  assert.equal(sessionsQuiescent({}), true);
  assert.equal(
    sessionsQuiescent({
      feature: { session: stopped },
      validation: { attempts: [{ state: "stopped" }, { state: "stopped" }] },
    }),
    true,
  );
  for (const delivery of [
    { feature: { session: { ...stopped, state: "running" } } },
    { feature: { session: { ...stopped, state: "uncertain" } } },
    { validation: { attempts: [{ state: "stopped" }, { state: "running" }] } },
    // A stopped resume that may have moved its predecessor's home.
    {
      feature: {
        session: {
          ...stopped,
          intent: "resume",
          resumeFrom: { ...stopped, operationId: "p" },
        },
      },
    },
  ])
    assert.equal(sessionsQuiescent(delivery), false);
});

test("stopping all stops validation, then coding, then settles the repair", async () => {
  let delivery = {
    validation: { attempts: [{ state: "running" }] },
    feature: { session: { ...stopped, state: "running" } },
    repair: { attempts: [{ id: "r1", state: "running" }] },
  };
  const order = [];
  const lifecycle = new SessionLifecycle({
    read: () => structuredClone(delivery),
    stopValidation: async () => {
      order.push("validation");
      delivery.validation.attempts[0].state = "stopped";
      return delivery;
    },
    stopFeature: async () => {
      order.push("coding");
      delivery.feature.session.state = "stopped";
      return delivery;
    },
    finishRepair: (_id, repairId) => {
      order.push(`repair ${repairId}`);
      delivery.repair.attempts[0].state = "stopped";
      return delivery;
    },
  });
  const result = await lifecycle.stopAll("d");
  assert.deepEqual(order, ["validation", "coding", "repair r1"]);
  assert.equal(sessionsQuiescent(result), true);
  // Nothing is left to stop the second time.
  order.length = 0;
  await lifecycle.stopAll("d");
  assert.deepEqual(order, []);
});
