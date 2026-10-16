import assert from "node:assert/strict";
import { test } from "node:test";
import { DeliveryController } from "../dist/controller.js";
import { PinnedCodingRuntime } from "../dist/feature-candidate.js";
import { codingFixture } from "./helpers/feature-fixture.mjs";
import { planAndValidate } from "./helpers/validation-fixture.mjs";

test("changed shutdown pins fence import and redispatch until exact-session recovery", async (t) => {
  const f = codingFixture(t);
  let drift = false,
    runs = 0,
    collections = 0;
  const stopped = [];
  const adapter = new PinnedCodingRuntime(f.runtime.pins, {
    mode: "controlled",
    inspect: async () => ({
      ...f.runtime.pins,
      ...(drift ? { bindingSha256: "f".repeat(64) } : {}),
    }),
    async run(request, output) {
      runs++;
      const result = await f.runtime.execute(request);
      output(
        Buffer.from(result.events.map((e) => JSON.stringify(e)).join("\n")),
      );
      return { ...result, pins: { ...f.runtime.pins } };
    },
    async stop(request) {
      stopped.push({ ...request });
      if (stopped.length === 1) drift = true;
      return f.runtime.stop(request);
    },
    async collect(request) {
      collections++;
      return f.runtime.collect(request);
    },
  });
  f.controller = new DeliveryController(f.state, f.options, {
    featurePlanner: f.criteria,
    featureRuntime: adapter,
    validationRuntime: f.validation,
    clock: () => f.now,
  });
  await planAndValidate(f);
  const result = await f.controller.codeFeature(f.delivery.id);
  assert.equal(result.feature.session.state, "uncertain");
  assert.equal(result.blocker.code, "UNCERTAIN_SESSION");
  assert.equal(result.feature.candidate, undefined);
  assert.equal(collections, 0);
  assert.throws(() => f.controller.release(f.delivery.id), /shutdown/);
  await assert.rejects(f.controller.codeFeature(f.delivery.id), /stopped/);
  drift = false;
  const recovered = await f.controller.recover(f.delivery.id);
  assert.equal(recovered.feature.session.state, "stopped");
  assert.equal(stopped.length, 2);
  assert.equal(stopped[1].operationId, stopped[0].operationId);
  assert.equal(stopped[1].fence, stopped[0].fence);
  assert.equal(runs, 1);
  assert.equal(collections, 0);
});

function lifecycleFixture(t) {
  const f = codingFixture(t);
  f.transport = {
    mode: "controlled",
    inspect: async () => ({ ...f.runtime.pins }),
    async run(request, output) {
      const result = await f.runtime.execute(request);
      output(
        Buffer.from(result.events.map((e) => JSON.stringify(e)).join("\n")),
      );
      return { ...result, pins: { ...f.runtime.pins } };
    },
    stop: (request) => f.runtime.stop(request),
    collect: (request) => f.runtime.collect(request),
  };
  f.controller = new DeliveryController(f.state, f.options, {
    featurePlanner: f.criteria,
    featureRuntime: new PinnedCodingRuntime(f.runtime.pins, f.transport),
    validationRuntime: f.validation,
    clock: () => f.now,
  });
  return f;
}

test("pin drift after shutdown observation refuses collection dispatch", async (t) => {
  const f = lifecycleFixture(t);
  let stopped = false,
    drift = false,
    collections = 0;
  f.transport.stop = async (request) => {
    stopped = true;
    return f.runtime.stop(request);
  };
  f.transport.inspect = async () => {
    const measured = {
      ...f.runtime.pins,
      ...(drift ? { policySha256: "f".repeat(64) } : {}),
    };
    if (stopped) drift = true;
    return measured;
  };
  f.transport.collect = async (request) => {
    collections++;
    return f.runtime.collect(request);
  };
  await planAndValidate(f);
  const result = await f.controller.codeFeature(f.delivery.id);
  assert.equal(
    collections,
    0,
    "changed management pins must prevent collection",
  );
  assert.equal(result.feature.candidate, undefined);
});

test("pin drift during asynchronous collection cannot admit worker output", async (t) => {
  const f = lifecycleFixture(t);
  let drift = false,
    collected = false;
  f.transport.inspect = async () => ({
    ...f.runtime.pins,
    ...(drift ? { cliSha256: "f".repeat(64) } : {}),
  });
  f.transport.collect = async (request) => {
    const output = await f.runtime.collect(request);
    await Promise.resolve();
    drift = true;
    collected = true;
    return output;
  };
  await planAndValidate(f);
  const result = await f.controller.codeFeature(f.delivery.id);
  assert.equal(collected, true);
  assert.equal(
    result.feature.candidate,
    undefined,
    "changed pins cannot authorize collected output",
  );
  assert.equal(result.feature.outcome, "failed");
});
