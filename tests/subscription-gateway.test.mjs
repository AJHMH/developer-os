import assert from "node:assert/strict";
import { test } from "node:test";
import {
  gatewayRequest,
  HostSubscriptionGateway,
  syntheticGatewayAccount,
  syntheticGatewayApproval,
  syntheticGatewayResponse,
} from "../dist/subscription-gateway.js";

const deliveryId = "00000000-0000-4000-8000-000000000021";
const makeGateway = ({
  account = syntheticGatewayAccount(),
  approval = undefined,
  provider = async () => syntheticGatewayResponse(),
} = {}) =>
  new HostSubscriptionGateway(
    approval ?? syntheticGatewayApproval(deliveryId, account),
    () => account,
    provider,
  );

test("host gateway refuses stale, mismatched, revoked and replayed grants", async () => {
  const account = syntheticGatewayAccount();
  const approval = syntheticGatewayApproval(deliveryId, account);
  const invalidApprovals = [
    { ...approval, runId: "invalid" },
    { ...approval, deliveryId: "invalid" },
    { ...approval, accountId: "invalid" },
    { ...approval, hostId: "invalid" },
    { ...approval, requestSha256: "invalid" },
    { ...approval, unknownUsageApproved: false },
    { ...approval, expiresAt: Date.now() - 1 },
    { ...approval, expiresAt: Date.now() + 60000 },
  ];
  for (const invalid of invalidApprovals)
    assert.throws(
      () => makeGateway({ account, approval: invalid }),
      /Invalid host inference approval/,
    );

  let providerCalls = 0;
  const gateway = makeGateway({
    account,
    provider: async () => {
      providerCalls++;
      return syntheticGatewayResponse();
    },
  });
  await assert.rejects(
    gateway.respond(
      "00000000-0000-4000-8000-000000000022",
      gateway.capability,
      gatewayRequest,
    ),
    /Gateway refused/,
  );
  await assert.rejects(
    gateway.respond(deliveryId, "0".repeat(64), gatewayRequest),
    /Gateway refused/,
  );
  await assert.rejects(
    gateway.respond(deliveryId, gateway.capability, "x".repeat(65537)),
    /Gateway refused/,
  );
  gateway.revoke();
  await assert.rejects(
    gateway.respond(deliveryId, gateway.capability, gatewayRequest),
    /Gateway refused/,
  );
  assert.equal(providerCalls, 0);
});

test("host gateway validates fixed request shape and selected account before provider access", async () => {
  const invalidRequests = [
    "not-json",
    JSON.stringify({ ...JSON.parse(gatewayRequest), model: "other" }),
    JSON.stringify({ ...JSON.parse(gatewayRequest), stream: false }),
    JSON.stringify({ ...JSON.parse(gatewayRequest), store: true }),
    JSON.stringify({ ...JSON.parse(gatewayRequest), input: "not-an-array" }),
    JSON.stringify({
      ...JSON.parse(gatewayRequest),
      tools: [{ type: "function", name: "mcp__owner" }],
    }),
  ];
  for (const body of invalidRequests) {
    const gateway = makeGateway();
    await assert.rejects(
      gateway.respond(deliveryId, gateway.capability, body),
      /Gateway refused/,
    );
    assert.equal(gateway.observation.providerAttempts, 0);
  }

  const account = syntheticGatewayAccount();
  const invalidAccounts = [
    { ...account, issuer: "https://other.invalid" },
    { ...account, hostId: "urn:uuid:00000000-0000-4000-8000-000000000022" },
    { ...account, planUsageAuthorized: false },
    { ...account, scopes: ["resource.invoke"] },
    { ...account, scopes: ["chatgpt.tokens.use.direct"] },
    { ...account, expiresAt: Date.now() + 1000 },
    { ...account, expiresAt: Number.NaN },
    { ...account, accessToken: "" },
    { ...account, accessToken: 42 },
  ];
  for (const invalidAccount of invalidAccounts) {
    let calls = 0;
    const gateway = makeGateway({
      account: invalidAccount,
      approval: syntheticGatewayApproval(deliveryId, account),
      provider: async () => {
        calls++;
        return syntheticGatewayResponse();
      },
    });
    await assert.rejects(
      gateway.respond(deliveryId, gateway.capability, gatewayRequest),
      /Gateway refused/,
    );
    assert.equal(calls, 0);
  }
});

test("host gateway consumes a provider attempt on refusal and bounds returned bytes", async () => {
  const denied = makeGateway({
    provider: async () => {
      throw Error("synthetic upstream refusal");
    },
  });
  await assert.rejects(
    denied.respond(deliveryId, denied.capability, gatewayRequest),
    /Gateway refused/,
  );
  assert.equal(denied.observation.providerAttempts, 1);
  assert.equal(denied.observation.phase, "provider-request");
  await assert.rejects(
    denied.respond(deliveryId, denied.capability, gatewayRequest),
    /Gateway refused/,
  );

  const oversized = makeGateway({
    provider: async () => Buffer.alloc(65537, 1),
  });
  await assert.rejects(
    oversized.respond(deliveryId, oversized.capability, gatewayRequest),
    /Gateway refused/,
  );
  assert.equal(oversized.observation.providerAttempts, 1);
  assert.equal(oversized.observation.phase, "provider-request");
});

test("host gateway refuses malformed response event ordering and message metadata", async () => {
  const validEvents = syntheticGatewayResponse()
    .toString()
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
  const variants = [];
  const mutate = (type, change) => {
    const events = structuredClone(validEvents);
    change(
      events.find((event) => event.type === type),
      events,
    );
    variants.push(events);
  };
  mutate("response.created", (event) => (event.response.id = ""));
  mutate("response.created", (event) => (event.response.status = "completed"));
  mutate("response.created", (event, events) => events.splice(1, 0, event));
  variants.push([
    validEvents[0],
    { type: "response.in_progress", response: { id: "wrong" } },
    ...validEvents.slice(1),
  ]);
  mutate("response.output_item.added", (event) => (event.output_index = -1));
  mutate("response.output_item.added", (event) => (event.item.id = ""));
  mutate("response.output_item.added", (event) => (event.item.type = "tool"));
  mutate("response.output_item.added", (event) => (event.item.role = "user"));
  mutate("response.output_item.added", (event) => (event.item.status = "done"));
  mutate("response.output_item.added", (event) => (event.item.content = ["x"]));
  mutate("response.content_part.added", (event) => (event.content_index = 1));
  mutate("response.content_part.added", (event) => (event.part.type = "text"));
  mutate(
    "response.content_part.added",
    (event) => (event.part.text = "unexpected"),
  );
  mutate("response.output_text.delta", (event) => (event.delta = "unexpected"));
  mutate("response.output_text.done", (event) => (event.text = 42));
  mutate("response.output_item.done", (event) => (event.output_index = 2));
  for (const code of ["model_not_found", "private-upstream-detail"])
    variants.push([
      validEvents[0],
      { type: "response.failed", response: { error: { code } } },
      ...validEvents.slice(1),
    ]);

  for (const events of variants) {
    const gateway = makeGateway({
      provider: async () =>
        Buffer.from(
          events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
        ),
    });
    await assert.rejects(
      gateway.respond(deliveryId, gateway.capability, gatewayRequest),
    );
  }
});

test("host gateway accepts bounded reasoning and the supported structured text shape", async () => {
  const events = syntheticGatewayResponse()
    .toString()
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
  const reasoning = Array.from({ length: 33 }, (_, index) => ({
    type: "response.reasoning_summary_text.delta",
    delta: `synthetic reasoning ${index}`,
  }));
  events.splice(1, 0, ...reasoning);
  const value = JSON.parse(gatewayRequest);
  value.input = [
    { role: "developer", content: "discarded context" },
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: "Say exactly: AIOS model-only inference complete",
        },
      ],
    },
  ];
  value.tools = [{ type: "function", name: "shell" }];
  const gateway = makeGateway({
    provider: async () =>
      Buffer.from(
        events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
      ),
  });
  const result = await gateway.respond(
    deliveryId,
    gateway.capability,
    JSON.stringify(value),
  );
  assert.deepEqual(result, syntheticGatewayResponse());
  assert.equal(gateway.observation.stream.eventTypesTruncated, true);
  assert.equal(gateway.observation.stream.completed, true);
  assert.equal(gateway.observation.stream.textDoneMatches, true);
});
