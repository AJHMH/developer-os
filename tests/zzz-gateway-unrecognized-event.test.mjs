// The name of a provider event the gateway does not recognise. The name sorts
// after every other test file, so no other file changes shard.
import assert from "node:assert/strict";
import test from "node:test";
import {
  syntheticGatewayAccount,
  syntheticGatewayApproval,
} from "../dist/gateway-canary.js";
import {
  gatewayRequest,
  HostSubscriptionGateway,
  syntheticGatewayResponse,
} from "../dist/subscription-gateway.js";

const deliveryId = "00000000-0000-4000-8000-000000000021";
// The synthetic reply with `extra` events after its text deltas, where the
// owner's live reply carried an event the gateway does not recognise.
function replyWith(extra) {
  const events = syntheticGatewayResponse()
    .toString()
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
  const done = events.findIndex((e) => e.type === "response.output_text.done");
  events.splice(done, 0, ...extra);
  const account = syntheticGatewayAccount();
  return new HostSubscriptionGateway(
    syntheticGatewayApproval(deliveryId, account),
    () => account,
    async () =>
      Buffer.from(
        events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
      ),
  );
}

test("an unrecognised event is still refused, and its plain type name is kept", async () => {
  const gateway = replyWith([
    { type: "response.output_text.annotation.added", annotation: "secret" },
  ]);
  await assert.rejects(
    gateway.respond(deliveryId, gateway.capability, gatewayRequest),
    /Gateway refused/,
  );
  const { stream } = gateway.observation;
  assert.equal(stream.eventTypes.at(-1), "other");
  assert.deepEqual(stream.unrecognizedTypes, [
    "response.output_text.annotation.added",
  ]);
  assert.doesNotMatch(JSON.stringify(gateway.observation), /secret/);
});

test("a type that is not a plain identifier is kept only as unnamed", async () => {
  for (const type of [
    "Response.Text Added",
    "x".repeat(81),
    "response..added",
    42,
    // No type at all.
    undefined,
  ]) {
    const gateway = replyWith([{ type }]);
    await assert.rejects(
      gateway.respond(deliveryId, gateway.capability, gatewayRequest),
      /Gateway refused/,
    );
    assert.deepEqual(gateway.observation.stream.unrecognizedTypes, ["unnamed"]);
  }
});

test("a recognised reply records no unrecognised types", async () => {
  const gateway = replyWith([]);
  await gateway.respond(deliveryId, gateway.capability, gatewayRequest);
  assert.deepEqual(gateway.observation.stream.unrecognizedTypes, []);
});

test("a response.metadata event is ignored and never reaches the worker", async () => {
  const gateway = replyWith([
    { type: "response.metadata", metadata: { note: "secret" } },
  ]);
  const reply = await gateway.respond(
    deliveryId,
    gateway.capability,
    gatewayRequest,
  );
  assert.deepEqual(reply, syntheticGatewayResponse());
  assert.doesNotMatch(reply.toString(), /secret/);
  const { stream } = gateway.observation;
  assert.deepEqual(stream.unrecognizedTypes, []);
  assert.equal(stream.completed, true);
});

test("only the exact response.metadata type is ignored", async () => {
  for (const type of ["response.metadata.delta", "response.metadata_extra"]) {
    const gateway = replyWith([{ type }]);
    await assert.rejects(
      gateway.respond(deliveryId, gateway.capability, gatewayRequest),
      /Gateway refused/,
    );
    assert.deepEqual(gateway.observation.stream.unrecognizedTypes, [type]);
  }
});
