import "./helpers/owner-host-stand-in.mjs";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import {
  MessagesGateway,
  MessagesProviderRefusal,
  MessagesRefusal,
  MessagesUsageMeter,
  anthropicMessages,
  claudeCodeRelayEnvironment,
  deliveryMessagesBudget,
  messagesGatewayVersion,
  messagesLimits,
  messagesRelayPaths,
} from "../dist/messages-gateway.js";
import { pinnedModelPrices, requestReserve } from "../dist/spend-budget.js";
import { codingFixture } from "./helpers/feature-fixture.mjs";

const start = Date.UTC(2026, 10, 8, 15, 0, 0);
const dollar = 1e12;
// Generated per run: never a literal key in the repository.
const apiKey = `sk-ant-api03-${randomBytes(24).toString("hex")}`;
const grant = (changes = {}) => ({
  deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  sessionId: "12345678-1234-4234-8234-123456789abc",
  expiresAt: start + 10 * 60_000,
  maxRequests: 8,
  ...changes,
});
const body = (changes = {}) => ({
  model: pinnedModelPrices.model,
  system: [
    {
      type: "text",
      text: "synthetic",
      cache_control: { type: "ephemeral" },
    },
  ],
  messages: [
    { role: "user", content: "synthetic turn" },
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "t", signature: "s" },
        { type: "redacted_thinking", data: "d" },
        { type: "text", text: "ok" },
        { type: "tool_use", id: "toolu_1", name: "Bash", input: {} },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_1",
          content: [
            { type: "text", text: "out" },
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: "AA==" },
            },
          ],
        },
        { type: "tool_result", tool_use_id: "toolu_1", content: "plain" },
        { type: "tool_result", tool_use_id: "toolu_1" },
      ],
    },
  ],
  tools: [
    { name: "Bash", description: "run", input_schema: { type: "object" } },
    {
      type: "custom",
      name: "Edit",
      input_schema: { type: "object" },
      cache_control: { type: "ephemeral", ttl: "5m" },
    },
  ],
  tool_choice: { type: "auto" },
  thinking: { type: "adaptive" },
  max_tokens: 32_000,
  stream: true,
  metadata: { user_id: "synthetic" },
  ...changes,
});
const request = (changes) => JSON.stringify(body(changes));
const sse = (usage = { input_tokens: 1000, output_tokens: 1 }, final = 500) =>
  [
    `event: message_start\r\ndata: ${JSON.stringify({ type: "message_start", message: { usage } })}\r\n\r\n`,
    'event: content_block_delta\ndata: {"type":"content_block_delta"}\n\n',
    "data: not json\n\n",
    "data: 7\n\n",
    `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: final, input_tokens: null } })}\n\n`,
  ].map((s) => Buffer.from(s));

/** A budget that records every effect. */
function fakeBudget(admit = true) {
  const effects = [];
  return {
    effects,
    admit: (op, reserve) => (effects.push(["admit", op, reserve]), admit),
    charge: (op, usage) => {
      effects.push(["charge", op, usage]);
      if (usage.output_tokens < 0) throw Error("Unverified model usage");
    },
    chargeReservation: (op) => effects.push(["reservation", op]),
    release: (op) => effects.push(["release", op]),
  };
}

function harness(options = {}) {
  let now = start;
  const budget = options.budget ?? fakeBudget(options.admit);
  const calls = [];
  const provider =
    options.provider ??
    async function* (key, forwarded, signal) {
      calls.push({ key, forwarded, signal });
      for (const chunk of options.chunks ?? sse()) yield chunk;
    };
  const gateway = new MessagesGateway(
    grant(options.grant),
    options.apiKey ?? (() => apiKey),
    budget,
    provider,
    () => now,
  );
  return {
    gateway,
    budget,
    calls,
    advance: (ms) => (now += ms),
    respond: (raw = request(), capability = gateway.capability) =>
      gateway.respond(grant().deliveryId, capability, raw),
  };
}
const drain = async (stream) => {
  const parts = [];
  for await (const chunk of stream) parts.push(Buffer.from(chunk));
  return Buffer.concat(parts).toString();
};
const refused = (reason) => (error) =>
  error instanceof MessagesRefusal && error.reason === reason;

test("a Messages request is reserved, forwarded without metadata and charged from its streamed usage", async () => {
  const h = harness();
  const text = await drain(await h.respond());
  assert.match(text, /message_delta/);
  const forwarded = JSON.parse(h.calls[0].forwarded);
  assert.equal(h.calls[0].key, apiKey);
  assert.equal(forwarded.metadata, undefined);
  const { metadata: _, ...expected } = body();
  assert.deepEqual(forwarded, expected);
  const [admit, charge] = h.budget.effects;
  assert.equal(admit[0], "admit");
  assert.equal(admit[1], `${grant().sessionId}-1`);
  assert.equal(
    admit[2],
    requestReserve({
      inputTokens: Buffer.byteLength(h.calls[0].forwarded),
      maxOutputTokens: 32_000,
      longCacheWrites: false,
    }),
  );
  assert.deepEqual(charge, [
    "charge",
    `${grant().sessionId}-1`,
    { input_tokens: 1000, output_tokens: 500 },
  ]);
  const o = h.gateway.observation;
  assert.equal(o.completed, 1);
  assert.equal(o.charged, 1);
  assert.equal(o.revoked, false);
  assert.equal(o.requestBytes, Buffer.byteLength(h.calls[0].forwarded));
});

test("a request with one-hour cache writes reserves at the dearer write rate", async () => {
  const h = harness();
  const raw = request({
    system: [
      {
        type: "text",
        text: "s",
        cache_control: { type: "ephemeral", ttl: "1h" },
      },
    ],
  });
  await drain(await h.respond(raw));
  const forwarded = h.calls[0].forwarded;
  assert.equal(
    h.budget.effects[0][2],
    requestReserve({
      inputTokens: Buffer.byteLength(forwarded),
      maxOutputTokens: 32_000,
      longCacheWrites: true,
    }),
  );
});

test("the input bound never exceeds the model's context window", async () => {
  const h = harness();
  const long = "x".repeat(messagesLimits.contextTokens + 10);
  await drain(await h.respond(request({ system: long })));
  assert.equal(
    h.budget.effects[0][2],
    requestReserve({
      inputTokens: messagesLimits.contextTokens,
      maxOutputTokens: 32_000,
      longCacheWrites: false,
    }),
  );
});

test("a refused budget is a budget interruption: no key is read and the gateway is revoked", async () => {
  let keys = 0;
  const h = harness({ admit: false, apiKey: () => (keys++, apiKey) });
  await assert.rejects(h.respond(), refused("budget"));
  assert.equal(keys, 0);
  assert.equal(h.calls.length, 0);
  assert.deepEqual(
    h.budget.effects.map((e) => e[0]),
    ["admit"],
  );
  assert.equal(h.gateway.observation.revokedFor, "budget");
  await assert.rejects(h.respond(), refused("revoked"));
});

test("an unavailable key releases the reservation and revokes the gateway", async () => {
  const h = harness({
    apiKey: () => {
      throw Error("vault");
    },
  });
  await assert.rejects(h.respond(), refused("credential"));
  assert.deepEqual(
    h.budget.effects.map((e) => e[0]),
    ["admit", "release"],
  );
  assert.equal(h.gateway.observation.revokedFor, "credential");
});

test("a provider error status is released, since nothing was billed", async () => {
  const h = harness({
    provider: async function* () {
      throw new MessagesProviderRefusal(529);
    },
  });
  await assert.rejects(h.respond(), refused("provider"));
  assert.deepEqual(
    h.budget.effects.map((e) => e[0]),
    ["admit", "release"],
  );
  assert.deepEqual(h.gateway.observation.providerStatuses, [529]);
  // The next request may proceed.
  const ok = harness();
  await drain(await ok.respond());
});

test("a provider failure without a status charges the whole reservation", async () => {
  const h = harness({
    provider: async function* () {
      throw Error("socket");
    },
  });
  await assert.rejects(h.respond(), refused("provider"));
  assert.deepEqual(
    h.budget.effects.map((e) => e[0]),
    ["admit", "reservation"],
  );
  assert.equal(h.gateway.observation.reservationsCharged, 1);
});

test("a stream cut after the first bytes charges the reservation", async () => {
  const h = harness({
    provider: async function* () {
      yield sse()[0];
      throw Error("reset");
    },
  });
  const stream = await h.respond();
  await assert.rejects(drain(stream), refused("provider"));
  assert.deepEqual(
    h.budget.effects.map((e) => e[0]),
    ["admit", "reservation"],
  );
});

test("an error status after the first bytes still charges the reservation", async () => {
  const h = harness({
    provider: async function* () {
      yield sse()[0];
      throw new MessagesProviderRefusal(500);
    },
  });
  const stream = await h.respond();
  await assert.rejects(drain(stream), refused("provider"));
  assert.deepEqual(
    h.budget.effects.map((e) => e[0]),
    ["admit", "reservation"],
  );
});

test("a stream closed early by the worker charges the reservation and frees the slot", async () => {
  const h = harness();
  const stream = await h.respond();
  const iterator = stream[Symbol.asyncIterator]();
  await iterator.next();
  await assert.rejects(h.respond(), refused("concurrent"));
  await iterator.return();
  await iterator.return();
  assert.deepEqual(await iterator.next(), { done: true, value: undefined });
  assert.deepEqual(
    h.budget.effects.map((e) => e[0]),
    ["admit", "reservation"],
  );
  await drain(await h.respond());
});

test("a stream that ends without a final usage charges the reservation", async () => {
  const h = harness({ chunks: [sse()[0]] });
  await drain(await h.respond());
  assert.deepEqual(
    h.budget.effects.map((e) => e[0]),
    ["admit", "reservation"],
  );
});

test("an empty stream charges the reservation", async () => {
  const h = harness({ chunks: [] });
  await drain(await h.respond());
  assert.deepEqual(
    h.budget.effects.map((e) => e[0]),
    ["admit", "reservation"],
  );
  assert.equal(h.gateway.observation.completed, 1);
});

test("usage the budget cannot verify is charged as the reservation", async () => {
  const h = harness({
    chunks: sse({ input_tokens: 10, output_tokens: 1 }, -5),
  });
  await drain(await h.respond());
  assert.deepEqual(
    h.budget.effects.map((e) => e[0]),
    ["admit", "charge", "reservation"],
  );
});

test("the meter ignores deltas before a start and keeps cumulative counts", () => {
  const m = new MessagesUsageMeter();
  m.write(
    Buffer.from('data: {"type":"message_delta","usage":{"output_tokens":3}}\n'),
  );
  assert.equal(m.result, undefined);
  const start = Buffer.from(
    'data: {"type":"message_start","message":{"usage":{"input_tokens":5,"output_tokens":1,"cache_read_input_tokens":2}}}\n',
  );
  m.write(start.subarray(0, 20));
  m.write(start.subarray(20));
  m.write(Buffer.from('data: {"type":"message_start","message":{}}\n'));
  assert.equal(m.result, undefined);
  m.write(
    Buffer.from(
      'data: {"type":"message_delta","usage":{"output_tokens":9,"cache_read_input_tokens":4}}\n',
    ),
  );
  m.write(Buffer.from('data: {"type":"message_delta"}\n'));
  assert.deepEqual(m.result, {
    input_tokens: 5,
    output_tokens: 9,
    cache_read_input_tokens: 4,
  });
});

test("requests are checked before any budget or key access", async () => {
  const h = harness({ grant: { maxRequests: 1 } });
  await assert.rejects(
    h.respond(request(), "f".repeat(64)),
    refused("capability"),
  );
  await assert.rejects(h.respond(request(), "short"), refused("capability"));
  await assert.rejects(
    h.gateway.respond(
      "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      h.gateway.capability,
      request(),
    ),
    refused("delivery"),
  );
  await assert.rejects(h.respond("{"), refused("request-shape"));
  assert.equal(h.budget.effects.length, 0);
  // The malformed request used the session's only request.
  await assert.rejects(h.respond(), refused("request-budget"));
});

test("a grant expires, and only valid grants are accepted", async () => {
  const h = harness();
  h.advance(10 * 60_000);
  await assert.rejects(h.respond(), refused("expired"));
  assert.equal(h.gateway.observation.revokedFor, "expired");
  for (const bad of [
    { deliveryId: "nope" },
    { sessionId: "nope" },
    { expiresAt: start },
    { expiresAt: start + messagesLimits.sessionMs + 1 },
    { expiresAt: 1.5 },
    { maxRequests: 0 },
    { maxRequests: messagesLimits.maxRequests + 1 },
    { maxRequests: 1.5 },
  ])
    assert.throws(
      () =>
        new MessagesGateway(
          grant(bad),
          () => apiKey,
          fakeBudget(),
          undefined,
          () => start,
        ),
      /Invalid Messages grant/,
    );
});

test("a revocation while the reservation is held releases it", async () => {
  let gateway;
  const budget = fakeBudget();
  const h = harness({
    budget,
    apiKey: () => {
      gateway.revoke("stopped");
      return apiKey;
    },
  });
  gateway = h.gateway;
  await assert.rejects(h.respond(), refused("revoked"));
  assert.deepEqual(
    budget.effects.map((e) => e[0]),
    ["admit", "release"],
  );
});

test("expiry while the key is read releases the reservation", async () => {
  let h;
  h = harness({
    apiKey: () => {
      h.advance(10 * 60_000);
      return apiKey;
    },
  });
  await assert.rejects(h.respond(), refused("expired"));
  assert.deepEqual(
    h.budget.effects.map((e) => e[0]),
    ["admit", "release"],
  );
});

test("a revocation mid-stream cuts it and charges the reservation", async () => {
  const h = harness({
    provider: async function* (key, forwarded, signal) {
      yield sse()[0];
      await new Promise((resolve) => signal.addEventListener("abort", resolve));
      yield sse()[1];
    },
  });
  const stream = await h.respond();
  const iterator = stream[Symbol.asyncIterator]();
  await iterator.next();
  const pending = iterator.next();
  h.gateway.revoke("stopped");
  await assert.rejects(pending, refused("revoked"));
  assert.deepEqual(
    h.budget.effects.map((e) => e[0]),
    ["admit", "reservation"],
  );
});

test("a provider that fails after an abort is attributed to the revocation", async () => {
  const h = harness({
    provider: async function* (key, forwarded, signal) {
      yield sse()[0];
      await new Promise((resolve) => signal.addEventListener("abort", resolve));
      throw Error("aborted");
    },
  });
  const stream = await h.respond();
  const iterator = stream[Symbol.asyncIterator]();
  await iterator.next();
  const pending = iterator.next();
  h.gateway.revoke("stopped");
  await assert.rejects(pending, refused("revoked"));
});

test("a response past its bound is cut and revokes the gateway", async () => {
  const big = Buffer.alloc(messagesLimits.responseBytes);
  const h = harness({ chunks: [Buffer.from("data: x\n"), big] });
  const stream = await h.respond();
  await assert.rejects(drain(stream), refused("response-bound"));
  assert.equal(h.gateway.observation.revokedFor, "response-bound");
  assert.deepEqual(
    h.budget.effects.map((e) => e[0]),
    ["admit", "reservation"],
  );
});

test("a first chunk past the bound is refused before the stream opens", async () => {
  const h = harness({
    chunks: [Buffer.alloc(messagesLimits.responseBytes + 1)],
  });
  await assert.rejects(h.respond(), refused("response-bound"));
  assert.deepEqual(
    h.budget.effects.map((e) => e[0]),
    ["admit", "reservation"],
  );
});

const shape = async (changes, reason, names) => {
  const h = harness();
  const raw = typeof changes === "string" ? changes : request(changes);
  await assert.rejects(h.respond(raw), refused(reason));
  assert.equal(h.budget.effects.length, 0);
  if (names)
    for (const [key, value] of Object.entries(names))
      assert.deepEqual(h.gateway.observation[key], value);
};

test("the request shape admits only the pinned model's Messages fields", async () => {
  await shape({ temperature: 1, container: "c" }, "field", {
    refusedFields: ["temperature", "container"],
  });
  await shape({ model: "claude-sonnet-5-5" }, "model");
  await shape({ stream: false }, "request-shape");
  await shape({ metadata: "x" }, "request-shape");
  await shape("[]", "request-shape");
  await shape("x".repeat(messagesLimits.requestBytes + 1), "request-shape");
  for (const max_tokens of [0, 128_001, 1.5, "10"])
    await shape({ max_tokens }, "value");
  for (const thinking of [
    { type: "enabled", budget_tokens: 1000 },
    { type: "adaptive", display: "full" },
    { type: "adaptive", extra: 1 },
    { type: "disabled", display: "omitted" },
    "adaptive",
  ])
    await shape({ thinking }, "value");
  // Only the effort level, which is generally available: no output format.
  for (const output_config of [
    "high",
    { effort: "extreme" },
    { effort: "high", format: { type: "json_schema" } },
    { format: { type: "json_schema" } },
  ])
    await shape({ output_config }, "value");
  for (const effort of ["low", "medium", "high", "xhigh", "max"]) {
    const e = harness();
    await drain(await e.respond(request({ output_config: { effort } })));
  }
  // Beta-only fields stay refused: Claude Code is run with its experimental
  // betas off, and the gateway sends no beta header.
  await shape(
    { context_management: { edits: [{ type: "clear_thinking_20251015" }] } },
    "field",
    { refusedFields: ["context_management"] },
  );
  await shape({ thinking: { type: "adaptive", display: "updates" } }, "value");
  await shape(
    {
      tools: [
        {
          name: "Bash",
          input_schema: { type: "object" },
          defer_loading: true,
        },
      ],
    },
    "tool",
  );
  const h = harness();
  await drain(
    await h.respond(
      request({ thinking: { type: "adaptive", display: "omitted" } }),
    ),
  );
  const d = harness();
  await drain(await d.respond(request({ thinking: { type: "disabled" } })));
  const plain = harness();
  await drain(
    await plain.respond(
      request({
        system: "plain",
        thinking: undefined,
        tools: undefined,
        tool_choice: undefined,
        metadata: undefined,
      }),
    ),
  );
});

test("cache controls are ephemeral with a known lifetime", async () => {
  for (const cache_control of [
    { type: "persistent" },
    { type: "ephemeral", ttl: "1d" },
    { type: "ephemeral", scope: "global" },
    "ephemeral",
  ])
    await shape(
      { system: [{ type: "text", text: "s", cache_control }] },
      "value",
    );
});

test("system prompts are text only", async () => {
  await shape({ system: 5 }, "request-shape");
  await shape({ system: [{ type: "document", text: "s" }] }, "block", {
    refusedBlockTypes: ["document"],
  });
  await shape({ system: [{ type: "text", text: 1 }] }, "block");
  await shape(
    { system: [{ type: "text", text: "s", citations: [] }] },
    "block",
  );
  await shape({ system: ["s"] }, "block");
});

test("only client tools pass: a server tool is refused by its type", async () => {
  await shape(
    {
      tools: [
        { type: "web_search_20260209", name: "web_search" },
        { type: "code_execution_20250825", name: "code" },
        "bad",
        { name: "x" },
        { name: 1, input_schema: {} },
        { name: "x", input_schema: {}, mcp_server: "m" },
      ],
    },
    "tool",
    {
      refusedToolTypes: [
        "web_search_20260209",
        "code_execution_20250825",
        "bad",
        "custom",
      ],
    },
  );
  await shape({ tools: {} }, "request-shape");
  for (const tool_choice of [
    "auto",
    { type: "tool" },
    { type: "auto", name: "Bash" },
    { type: "required" },
    { type: "auto", extra: 1 },
  ])
    await shape({ tool_choice }, "tool");
  const h = harness();
  await drain(
    await h.respond(
      request({
        tool_choice: {
          type: "tool",
          name: "Bash",
          disable_parallel_tool_use: true,
        },
      }),
    ),
  );
  await shape(
    {
      tools: [
        {
          name: "x",
          input_schema: {},
          cache_control: { type: "ephemeral", ttl: "2h" },
        },
      ],
    },
    "value",
  );
});

test("messages carry known blocks, and images only inline", async () => {
  const user = (content) => ({ messages: [{ role: "user", content }] });
  await shape({ messages: [] }, "request-shape");
  await shape({ messages: {} }, "request-shape");
  await shape(
    { messages: [{ role: "developer", content: "x" }] },
    "request-shape",
  );
  // Claude Code sends its environment as a system message (seen on the real
  // CLI): text, and nothing else.
  const system = harness();
  await drain(
    await system.respond(
      request({
        messages: [
          { role: "user", content: "x" },
          { role: "system", content: "# Environment" },
          { role: "system", content: [{ type: "text", text: "more" }] },
        ],
      }),
    ),
  );
  for (const block of [
    { type: "tool_use", id: "t", name: "Bash", input: {} },
    { type: "tool_result", tool_use_id: "t", content: "x" },
    {
      type: "image",
      source: { type: "base64", media_type: "image/png", data: "x" },
    },
  ])
    await shape({ messages: [{ role: "system", content: [block] }] }, "block");
  await shape(
    { messages: [{ role: "user", content: "x", id: 1 }] },
    "request-shape",
  );
  await shape({ messages: ["x"] }, "request-shape");
  await shape(user(5), "request-shape");
  await shape(
    user([{ type: "document", source: { type: "file", file_id: "f" } }]),
    "block",
    { refusedBlockTypes: ["document"] },
  );
  for (const type of [
    "server_tool_use",
    "web_search_tool_result",
    "container_upload",
    "mcp_tool_use",
  ])
    await shape(user([{ type }]), "block");
  await shape(user(["x"]), "block");
  await shape(
    user([
      {
        type: "image",
        source: { type: "url", url: "https://example.com/a.png" },
      },
    ]),
    "block",
    { refusedBlockTypes: ["image:url"] },
  );
  await shape(
    user([{ type: "image", source: { type: "file", file_id: "f" } }]),
    "block",
  );
  await shape(user([{ type: "image" }]), "block", {
    refusedBlockTypes: ["image:false"],
  });
  await shape(
    user([
      {
        type: "image",
        source: { type: "base64", media_type: "text/plain", data: "x" },
      },
    ]),
    "block",
  );
  await shape(
    user([
      { type: "image", source: { type: "base64", media_type: 1, data: "x" } },
    ]),
    "block",
  );
  await shape(
    user([
      { type: "image", source: { type: "base64", media_type: "image/png" } },
    ]),
    "block",
  );
  await shape(
    user([
      {
        type: "tool_result",
        tool_use_id: "t",
        content: [{ type: "document", source: { type: "url" } }],
      },
    ]),
    "block",
  );
  await shape(
    user([{ type: "tool_result", tool_use_id: "t", content: 5 }]),
    "request-shape",
  );
  await shape(
    user([
      {
        type: "text",
        text: "t",
        cache_control: { type: "ephemeral", ttl: "9m" },
      },
    ]),
    "value",
  );
});

test("the provider is the fixed Anthropic origin, without redirects", async () => {
  const seen = [];
  const fakeFetch = async (url, init) => {
    seen.push({ url, init });
    return new Response(
      sse()
        .map((b) => b.toString())
        .join(""),
      {
        status: 200,
      },
    );
  };
  const signal = new AbortController().signal;
  const chunks = [];
  for await (const chunk of anthropicMessages(fakeFetch)(apiKey, "{}", signal))
    chunks.push(chunk);
  assert.ok(chunks.length > 0);
  assert.equal(seen[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(seen[0].init.redirect, "error");
  assert.equal(seen[0].init.method, "POST");
  assert.equal(seen[0].init.body, "{}");
  assert.deepEqual(seen[0].init.headers, {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "content-type": "application/json",
    accept: "text/event-stream",
  });
  const refusing = anthropicMessages(
    async () => new Response("no", { status: 401 }),
  );
  await assert.rejects(
    async () => {
      for await (const _ of refusing(apiKey, "{}", signal));
    },
    (error) => error instanceof MessagesProviderRefusal && error.status === 401,
  );
  const empty = anthropicMessages(
    async () => new Response(null, { status: 200 }),
  );
  await assert.rejects(
    async () => {
      for await (const _ of empty(apiKey, "{}", signal));
    },
    (error) => error instanceof MessagesProviderRefusal && error.status === 200,
  );
});

test("Claude Code reaches the relay with only the capability", () => {
  const capability = "a".repeat(64);
  const env = claudeCodeRelayEnvironment(4711, grant().deliveryId, capability);
  assert.deepEqual(env, {
    ANTHROPIC_BASE_URL: "http://127.0.0.1:4711",
    ANTHROPIC_AUTH_TOKEN: capability,
    ANTHROPIC_CUSTOM_HEADERS: `X-AIOS-Delivery: ${grant().deliveryId}`,
    ANTHROPIC_MODEL: "claude-opus-5-5",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: "32000",
  });
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  for (const [port, id, cap] of [
    [0, grant().deliveryId, capability],
    [65536, grant().deliveryId, capability],
    [1.5, grant().deliveryId, capability],
    [4711, "nope", capability],
    [4711, grant().deliveryId, "secret"],
  ])
    assert.throws(() => claudeCodeRelayEnvironment(port, id, cap), /Invalid/);
  assert.deepEqual(
    [...messagesRelayPaths],
    ["/v1/messages", "/v1/messages?beta=true"],
  );
  assert.match(messagesGatewayVersion, /^[a-f0-9]{64}$/);
});

test("the gateway spends a delivery's budget through the controller", async (t) => {
  const f = codingFixture(t);
  const id = f.delivery.id;
  const budget = deliveryMessagesBudget(f.controller, id);
  const h = harness({
    budget,
    grant: { deliveryId: id },
    chunks: sse({ input_tokens: 250_000, output_tokens: 1 }, 100_000),
  });
  await drain(await h.gateway.respond(id, h.gateway.capability, request()));
  // $1 input and $2 output.
  assert.equal(f.controller.status(id).spend.spent, 3 * dollar);
  assert.equal(f.controller.status(id).spend.reserved, undefined);
  const cut = harness({ budget, grant: { deliveryId: id }, chunks: [] });
  await drain(await cut.gateway.respond(id, cut.gateway.capability, request()));
  const spend = f.controller.status(id).spend;
  assert.ok(spend.spent > 3 * dollar);
  assert.equal(spend.charges, 2);
  const failed = harness({
    budget,
    grant: { deliveryId: id },
    provider: async function* () {
      throw new MessagesProviderRefusal(400);
    },
  });
  await assert.rejects(
    failed.gateway.respond(id, failed.gateway.capability, request()),
    refused("provider"),
  );
  assert.equal(f.controller.status(id).spend.charges, 2);
  assert.equal(f.controller.status(id).spend.reserved, undefined);
  // A worst case past what remains interrupts the delivery.
  const huge = harness({ budget, grant: { deliveryId: id } });
  await assert.rejects(
    huge.gateway.respond(
      id,
      huge.gateway.capability,
      request({
        system: "x".repeat(messagesLimits.requestBytes - 4096),
        max_tokens: 128_000,
      }),
    ),
    refused("budget"),
  );
  assert.match(f.controller.status(id).blocker.message, /Budget interruption/);
});
