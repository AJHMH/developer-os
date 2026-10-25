import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  GeneralSessionGateway,
  GeneralSessionProviderRefusal,
  generalSessionGatewayVersion,
  generalSessionLimits,
  generalSessionResponses,
} from "../dist/general-session-gateway.js";
import { gatewayModel } from "../dist/inference-contract.js";
import {
  requiredSubscriptionScopes,
  subscriptionAccountId,
  subscriptionIssuer,
} from "../dist/subscription-account.js";

const start = Date.UTC(2026, 9, 24, 15, 0, 0);
const hostId = "urn:uuid:11111111-2222-4333-8444-555555555555";
const token = "host-only-synthetic-token";
const account = (changes = {}) => ({
  issuer: subscriptionIssuer,
  clientId: "client",
  subject: "subject",
  hostId,
  accessToken: token,
  scopes: [...requiredSubscriptionScopes],
  expiresAt: start + 3_600_000,
  planUsageAuthorized: true,
  ...changes,
});
const accountId = subscriptionAccountId(account());
const grant = (changes = {}) => ({
  deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  sessionId: "12345678-1234-4234-8234-123456789abc",
  accountId,
  hostId,
  expiresAt: start + 10 * 60_000,
  maxRequests: 8,
  ...changes,
});
const request = (changes = {}) =>
  JSON.stringify({
    model: gatewayModel,
    instructions: "synthetic",
    input: [{ role: "user", content: "synthetic turn" }],
    tools: [
      { type: "function", name: "shell" },
      { type: "custom", name: "apply_patch" },
    ],
    store: false,
    stream: true,
    ...changes,
  });
/** Requests Codex 0.161.0 really sent in code mode (ADR 0002 amendment),
 * captured offline and trimmed: structure, keys and fixed values are kept, and
 * free text, opaque values and identifiers are synthetic. */
const captured = ["launch", "resume"].map((phase) =>
  readFileSync(
    new URL(`./fixtures/codex-0.161.0-${phase}-request.json`, import.meta.url),
    "utf8",
  ),
);
const withoutMetadata = (raw) => {
  const { client_metadata: _, ...body } = JSON.parse(raw);
  return JSON.stringify(body);
};
const additionalTools = (tools) =>
  request({ input: [{ type: "additional_tools", role: "developer", tools }] });
const sse = [
  Buffer.from('data: {"type":"response.created"}\n\n'),
  Buffer.from('data: {"type":"response.completed"}\n\n'),
];

/** A gateway over fakes that record every effect. */
function harness(options = {}) {
  let now = start;
  const effects = { authority: 0, account: 0, provider: [], closed: 0 };
  const gateway = new GeneralSessionGateway(
    grant(options.grant),
    () => {
      effects.account++;
      return account(options.account);
    },
    async () => {
      effects.authority++;
      return (await options.authority?.(control)) ?? "permitted";
    },
    async function* (hostToken, body, signal) {
      effects.provider.push({ hostToken, body, signal });
      try {
        const status =
          typeof options.providerStatus === "function"
            ? options.providerStatus(effects.provider.length)
            : options.providerStatus;
        if (status) throw new GeneralSessionProviderRefusal(status);
        for (const chunk of options.chunks ?? sse) {
          if (options.beforeChunk) await options.beforeChunk(signal);
          yield chunk;
        }
      } finally {
        effects.closed++;
      }
    },
    () => now,
  );
  const control = { gateway, advance: (ms) => (now += ms) };
  return {
    gateway,
    effects,
    advance: (ms) => (now += ms),
    respond: (raw = request(), changes = {}) =>
      gateway.respond(
        changes.deliveryId ?? grant().deliveryId,
        changes.capability ?? gateway.capability,
        raw,
      ),
  };
}
const drain = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};

test("a session request reaches the provider as inspected, with only the host token", async () => {
  const h = harness();
  const raw = request();
  const body = await drain(await h.respond(raw));
  assert.deepEqual(body, Buffer.concat(sse));
  assert.deepEqual(
    h.effects.provider.map(({ hostToken, body }) => ({ hostToken, body })),
    [{ hostToken: token, body: raw }],
  );
  assert.equal(h.effects.authority, 1);
  const seen = h.gateway.observation;
  assert.equal(seen.revoked, false);
  assert.equal(seen.requests, 1);
  assert.equal(seen.providerRequests, 1);
  assert.equal(seen.completed, 1);
  assert.equal(seen.responseBytes, Buffer.concat(sse).length);
  // Labels and counts only: neither the token nor any content appears.
  const text = JSON.stringify(seen);
  for (const secret of [token, "synthetic turn", "response.created"])
    assert.equal(text.includes(secret), false, secret);
  assert.match(generalSessionGatewayVersion, /^[a-f0-9]{64}$/);
});

test("a malformed grant is refused at construction", () => {
  for (const changes of [
    { deliveryId: "not-a-uuid" },
    { sessionId: "x" },
    { accountId: "short" },
    { hostId: "host" },
    { expiresAt: start },
    { expiresAt: start + generalSessionLimits.sessionMs + 1 },
    { maxRequests: 0 },
    { maxRequests: generalSessionLimits.maxRequests + 1 },
    { maxRequests: 1.5 },
  ])
    assert.throws(
      () =>
        new GeneralSessionGateway(
          grant(changes),
          account,
          async () => "permitted",
          async function* () {},
          () => start,
        ),
      /Invalid general session grant/,
      JSON.stringify(changes),
    );
});

for (const [name, raw, changes, refusal] of [
  [
    "a wrong capability",
    request(),
    { capability: "0".repeat(64) },
    "capability",
  ],
  ["a short capability", request(), { capability: "x" }, "capability"],
  [
    "another delivery",
    request(),
    { deliveryId: "ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee" },
    "delivery",
  ],
  ["another model", request({ model: "gpt-other" }), {}, "model"],
  ["a non-streaming request", request({ stream: false }), {}, "request-shape"],
  ["a request that is not JSON", "{not json", {}, "request-shape"],
  ["a JSON array", "[]", {}, "request-shape"],
  ["an unknown field", request({ background: true }), {}, "field"],
  [
    "client metadata that is not an object",
    request({ client_metadata: "x" }),
    {},
    "request-shape",
  ],
  [
    "another reasoning context",
    request({ reasoning: { context: "current_turn" } }),
    {},
    "value",
  ],
  [
    "a hosted tool among additional tools",
    additionalTools([{ type: "web_search" }]),
    {},
    "tool",
  ],
  [
    "a hosted tool inside a tool namespace",
    additionalTools([
      { type: "namespace", name: "functions", tools: [{ type: "mcp" }] },
    ]),
    {},
    "tool",
  ],
  [
    "a hosted tool inside a top-level tool namespace",
    request({
      tools: [
        { type: "namespace", name: "functions", tools: [{ type: "mcp" }] },
      ],
    }),
    {},
    "tool",
  ],
  [
    "a local shell inside a tool namespace",
    additionalTools([
      {
        type: "namespace",
        name: "functions",
        tools: [{ type: "local_shell" }],
      },
    ]),
    {},
    "tool",
  ],
  [
    "a tool namespace with a field beyond its name and tools",
    additionalTools([
      {
        type: "namespace",
        name: "functions",
        server_url: "https://x",
        tools: [],
      },
    ]),
    {},
    "tool",
  ],
  [
    "an additional tools item with a field beyond its tools",
    request({
      input: [{ type: "additional_tools", server_url: "https://x", tools: [] }],
    }),
    {},
    "item",
  ],
  [
    "a namespace inside a namespace",
    additionalTools([
      {
        type: "namespace",
        name: "outer",
        tools: [{ type: "namespace", name: "inner", tools: [] }],
      },
    ]),
    {},
    "tool",
  ],
  [
    "additional tools that are not a list",
    request({ input: [{ type: "additional_tools", tools: {} }] }),
    {},
    "request-shape",
  ],
  [
    "a tool namespace whose tools are not a list",
    additionalTools([{ type: "namespace", name: "functions", tools: {} }]),
    {},
    "request-shape",
  ],
  ["a paid tier field", request({ service_tier: "priority" }), {}, "field"],
  [
    "a hosted web tool",
    request({ tools: [{ type: "web_search" }] }),
    {},
    "tool",
  ],
  [
    "a hosted MCP tool",
    request({ tools: [{ type: "mcp", server_url: "https://x" }] }),
    {},
    "tool",
  ],
  [
    "a hosted file tool",
    request({ tools: [{ type: "file_search" }] }),
    {},
    "tool",
  ],
  ["tools that are not a list", request({ tools: {} }), {}, "request-shape"],
  ["a stored response", request({ store: true }), {}, "value"],
  ["a request without store", request({ store: undefined }), {}, "value"],
  [
    "another include value",
    request({ include: ["file_search_call.results"] }),
    {},
    "value",
  ],
  [
    "unbounded reasoning effort",
    request({ reasoning: { effort: "xhigh" } }),
    {},
    "value",
  ],
  [
    "an unknown reasoning field",
    request({ reasoning: { budget: 1 } }),
    {},
    "value",
  ],
  [
    "a hosted tool choice",
    request({ tool_choice: { type: "web_search_preview" } }),
    {},
    "tool",
  ],
  [
    "a stored-response reference",
    request({ previous_response_id: "resp_x" }),
    {},
    "field",
  ],
  [
    "an item reference",
    request({ input: [{ type: "item_reference", id: "msg_x" }] }),
    {},
    "item",
  ],
  [
    "a hosted-tool call item",
    request({ input: [{ type: "web_search_call", id: "ws" }] }),
    {},
    "item",
  ],
  [
    "a file input",
    request({
      input: [
        { role: "user", content: [{ type: "input_file", file_id: "file_x" }] },
      ],
    }),
    {},
    "item",
  ],
  [
    "a remote file URL",
    request({
      input: [
        {
          role: "user",
          content: [{ type: "input_text", file_url: "https://x" }],
        },
      ],
    }),
    {},
    "item",
  ],
  [
    "a remote image",
    request({
      input: [
        {
          role: "user",
          content: [{ type: "input_image", image_url: "https://x/y.png" }],
        },
      ],
    }),
    {},
    "item",
  ],
  [
    "a remote image in a tool result",
    request({
      input: [
        {
          type: "function_call_output",
          call_id: "c",
          output: [{ type: "input_image", image_url: "http://x" }],
        },
      ],
    }),
    {},
    "item",
  ],
  [
    "a tool that is not an object",
    request({ tools: ["web_search"] }),
    {},
    "tool",
  ],
  [
    "a tool choice naming a worker tool type without a name",
    request({ tool_choice: { type: "function" } }),
    {},
    "tool",
  ],
  ["input that is not a list", request({ input: {} }), {}, "request-shape"],
  ["an input item that is not an object", request({ input: [7] }), {}, "item"],
  [
    "input nested past the depth bound",
    request({
      input: [
        {
          role: "user",
          content: JSON.parse("[".repeat(70) + "]".repeat(70)),
        },
      ],
    }),
    {},
    "request-shape",
  ],
  [
    "an oversized request",
    request({ instructions: "x".repeat(generalSessionLimits.requestBytes) }),
    {},
    "request-shape",
  ],
])
  test(`${name} is refused before authority, account or provider`, async () => {
    const h = harness();
    await assert.rejects(h.respond(raw, changes), /refused/);
    assert.deepEqual(
      [h.effects.authority, h.effects.account, h.effects.provider.length],
      [0, 0, 0],
    );
    assert.equal(h.gateway.observation.refusals[refusal], 1);
  });

test("what a coding turn replays is admitted", async () => {
  const h = harness();
  const raw = request({
    include: ["reasoning.encrypted_content"],
    reasoning: { effort: "medium", summary: "auto" },
    tool_choice: "auto",
    parallel_tool_calls: false,
    prompt_cache_key: "session",
    text: { verbosity: "low" },
    input: [
      { role: "user", content: [{ type: "input_text", text: "turn" }] },
      { type: "reasoning", encrypted_content: "opaque", summary: [] },
      { type: "function_call", call_id: "c1", name: "shell", arguments: "{}" },
      { type: "function_call_output", call_id: "c1", output: "ok" },
      {
        type: "custom_tool_call",
        call_id: "c2",
        name: "apply_patch",
        input: "x",
      },
      { type: "custom_tool_call_output", call_id: "c2", output: "done" },
      {
        role: "user",
        content: [
          { type: "input_image", image_url: "data:image/png;base64,AA==" },
        ],
      },
    ],
  });
  await drain(await h.respond(raw));
  assert.equal(h.effects.provider[0].body, raw);
});

test("Codex 0.161.0's captured requests are admitted, and client metadata never reaches the provider", async () => {
  const h = harness();
  for (const raw of captured) {
    assert.ok(JSON.parse(raw).client_metadata);
    await drain(await h.respond(raw));
    const forwarded = h.effects.provider.at(-1).body;
    assert.equal(forwarded, withoutMetadata(raw));
    assert.equal(forwarded.includes("client_metadata"), false);
  }
  assert.equal(
    h.gateway.observation.requestBytes,
    Buffer.byteLength(captured.map(withoutMetadata).join("")),
  );
});

test("worker tools in a namespace, at the top level or among additional tools, are admitted", async () => {
  const h = harness();
  const namespace = {
    type: "namespace",
    name: "functions",
    tools: [
      { type: "custom", name: "exec" },
      { type: "function", name: "exec_command" },
    ],
  };
  for (const raw of [
    request({ tools: [namespace] }),
    additionalTools([namespace, { type: "function", name: "sleep" }]),
  ]) {
    await drain(await h.respond(raw));
    assert.equal(h.effects.provider.at(-1).body, raw);
  }
});

test("a worker tool may name a parameter like a file field, and the all-turns reasoning context is admitted", async () => {
  const h = harness();
  for (const raw of [
    additionalTools([
      {
        type: "function",
        name: "read",
        parameters: { type: "object", properties: { file_id: {} } },
      },
    ]),
    request({ reasoning: { context: "all_turns" } }),
  ]) {
    await drain(await h.respond(raw));
    assert.equal(h.effects.provider.at(-1).body, raw);
  }
});

test("the provider gets the body that was inspected, not a duplicate key the gateway never saw", async () => {
  const h = harness();
  // An earlier duplicate `model`; JSON.parse keeps the later, pinned one.
  const raw = `{"model":"gpt-other",${request().slice(1)}`;
  await drain(await h.respond(raw));
  const forwarded = h.effects.provider[0].body;
  assert.equal(forwarded, JSON.stringify(JSON.parse(raw)));
  assert.equal(forwarded.includes("gpt-other"), false);
});

test("plain-text input, no input, and a named worker tool choice are admitted", async () => {
  const h = harness();
  for (const raw of [
    request({ input: "synthetic turn" }),
    request({ input: undefined }),
    request({ tool_choice: { type: "function", name: "shell" } }),
    request({ tool_choice: "required" }),
  ]) {
    await drain(await h.respond(raw));
    assert.equal(h.effects.provider.at(-1).body, raw);
  }
});

test("an empty response completes and frees the slot at once", async () => {
  const h = harness({ chunks: [] });
  const stream = await h.respond();
  assert.equal(h.gateway.observation.completed, 1);
  assert.equal(h.effects.closed, 1);
  assert.deepEqual(await drain(stream), Buffer.alloc(0));
  // Closing again, or reading past the end, stays finished.
  await stream.return();
  assert.deepEqual(await stream.next(), { done: true, value: undefined });
  await drain(await h.respond());
  assert.equal(h.gateway.observation.completed, 2);
});

test("a closed stream reads as finished", async () => {
  const h = harness({ chunks: [sse[0], sse[1], sse[1]] });
  const stream = await h.respond();
  await stream.return();
  assert.deepEqual(await stream.next(), { done: true, value: undefined });
  assert.equal(h.effects.closed, 1);
});

test("a provider failure mid-stream is a provider refusal, and a revocation while waiting is a revocation", async () => {
  const failing = harness({
    chunks: [sse[0], sse[1]],
    beforeChunk: (() => {
      let calls = 0;
      return async () => {
        if (++calls === 2) throw Error("connection reset");
      };
    })(),
  });
  await assert.rejects(
    drain(await failing.respond()),
    (error) => error.reason === "provider",
  );
  assert.equal(failing.gateway.observation.refusals.provider, 1);
  assert.equal(failing.gateway.observation.revoked, false);

  let started;
  const waiting = harness({
    chunks: [sse[0], sse[1]],
    beforeChunk: (signal) =>
      started
        ? new Promise((resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
            started();
          })
        : undefined,
  });
  const stream = await waiting.respond();
  const reading = new Promise((resolve) => (started = resolve));
  const iterator = stream[Symbol.asyncIterator]();
  await iterator.next();
  const rest = iterator.next();
  await reading;
  waiting.gateway.revoke("paused");
  await assert.rejects(rest, (error) => error.reason === "revoked");
  assert.equal(waiting.gateway.observation.revokedFor, "paused");
});

test("a chunk that arrives after the time bound is refused as a timeout", async () => {
  let first = true;
  const h = harness({
    grant: { expiresAt: start + 50 },
    chunks: [sse[0], sse[1]],
    // A provider that ignores the abort signal and delivers late anyway.
    beforeChunk: async () => {
      if (first) return void (first = false);
      await new Promise((resolve) => setTimeout(resolve, 100));
    },
  });
  await assert.rejects(
    drain(await h.respond()),
    (error) => error.reason === "timeout",
  );
  assert.equal(h.gateway.observation.refusals.timeout, 1);
  assert.equal(h.effects.closed, 1);
});

test("refused fields and tool types are named, never their values", async () => {
  const h = harness();
  await assert.rejects(h.respond(request({ background: "secret-value" })));
  await assert.rejects(
    h.respond(request({ tools: [{ type: "web_search", query: "secret-q" }] })),
  );
  const seen = h.gateway.observation;
  assert.deepEqual(seen.refusedFields, ["background"]);
  assert.deepEqual(seen.refusedToolTypes, ["web_search"]);
  const text = JSON.stringify(seen);
  assert.equal(
    text.includes("secret-value") || text.includes("secret-q"),
    false,
  );
});

for (const authority of [
  "approval-required",
  "unknown",
  "exhausted",
  "withdrawn",
])
  test(`fresh authority "${authority}" revokes the session before the credential`, async () => {
    const h = harness({ authority: () => authority });
    await assert.rejects(h.respond(), /refused/);
    assert.deepEqual([h.effects.account, h.effects.provider.length], [0, 0]);
    assert.equal(h.gateway.observation.revokedFor, authority);
    // Irreversible: a later request is refused as revoked, without authority.
    await assert.rejects(h.respond(), /refused/);
    assert.equal(h.effects.authority, 1);
    assert.equal(h.gateway.observation.refusals.revoked, 1);
  });

test("authority withdrawn mid-session ends it at the next provider request", async () => {
  let current = "permitted";
  const h = harness({ authority: () => current });
  await drain(await h.respond());
  current = "withdrawn";
  await assert.rejects(h.respond(), /refused/);
  assert.equal(h.effects.provider.length, 1);
  assert.equal(h.gateway.observation.revokedFor, "withdrawn");
});

for (const [name, changes] of [
  ["another account", { subject: "someone-else" }],
  ["another host", { hostId: "urn:uuid:99999999-2222-4333-8444-555555555555" }],
  ["a token expiring within the request", { expiresAt: start + 60_000 }],
  ["missing plan authorization", { planUsageAuthorized: false }],
  ["a missing scope", { scopes: ["resource.invoke"] }],
])
  test(`${name} revokes the session before the provider`, async () => {
    const h = harness({ account: changes });
    await assert.rejects(h.respond(), /refused/);
    assert.equal(h.effects.provider.length, 0);
    assert.equal(h.gateway.observation.revokedFor, "account");
  });

test("the session's request budget and deadline are hard limits", async () => {
  const h = harness({ grant: { maxRequests: 2 } });
  await drain(await h.respond());
  await drain(await h.respond());
  await assert.rejects(h.respond(), /refused/);
  assert.equal(h.gateway.observation.refusals["request-budget"], 1);
  assert.equal(h.effects.provider.length, 2);

  const late = harness();
  late.advance(10 * 60_000);
  await assert.rejects(late.respond(), /refused/);
  assert.equal(late.gateway.observation.revokedFor, "expired");
  assert.equal(late.effects.authority, 0);
});

test("only one request is in flight at a time", async () => {
  const h = harness();
  const first = await h.respond();
  await assert.rejects(h.respond(), /refused/);
  assert.equal(h.gateway.observation.refusals.concurrent, 1);
  await drain(first);
  await drain(await h.respond());
  assert.equal(h.effects.provider.length, 2);
});

test("revocation mid-stream aborts the provider and ends the stream", async () => {
  const h = harness({ chunks: [sse[0], sse[1], sse[1]] });
  const received = [];
  const stream = await h.respond();
  await assert.rejects(
    (async () => {
      for await (const chunk of stream) {
        received.push(chunk);
        h.gateway.revoke("exhausted");
      }
    })(),
    (error) => error.reason === "revoked",
  );
  assert.equal(received.length, 1);
  assert.equal(h.effects.provider[0].signal.aborted, true);
  assert.equal(h.effects.closed, 1);
  assert.equal(h.gateway.observation.revokedFor, "exhausted");
  assert.equal(h.gateway.observation.completed, 0);
  await assert.rejects(h.respond(), (error) => error.reason === "revoked");
});

test("the provider request starts at once, under the authority just taken", async () => {
  const h = harness();
  const stream = await h.respond();
  // Fetched before the caller reads anything.
  assert.equal(h.effects.provider.length, 1);
  await drain(stream);
});

test("closing a stream early frees the slot and closes the provider request", async () => {
  const h = harness({ chunks: [sse[0], sse[1], sse[1]] });
  const stream = await h.respond();
  await stream.return();
  assert.equal(h.effects.closed, 1);
  await drain(await h.respond());
  assert.equal(h.effects.provider.length, 2);
});

test("a revocation while authority is awaited is honoured", async () => {
  const h = harness({
    authority: ({ gateway }) => {
      gateway.revoke("stopped");
      return "permitted";
    },
  });
  await assert.rejects(h.respond(), (error) => error.reason === "revoked");
  assert.deepEqual([h.effects.account, h.effects.provider.length], [0, 0]);
});

test("a grant that expires while authority is awaited ends as expired", async () => {
  const h = harness({
    authority: ({ advance }) => {
      advance(10 * 60_000);
      return "permitted";
    },
  });
  await assert.rejects(h.respond(), (error) => error.reason === "expired");
  assert.equal(h.gateway.observation.revokedFor, "expired");
  assert.equal(h.effects.provider.length, 0);
});

test("a request past its time bound is refused as a timeout", async () => {
  const h = harness({
    grant: { expiresAt: start + 50 },
    chunks: [sse[0], sse[1]],
    beforeChunk: (signal) =>
      new Promise((resolve, reject) => {
        if (signal.aborted) return reject(signal.reason);
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }),
  });
  await assert.rejects(h.respond(), (error) => error.reason === "timeout");
  assert.equal(h.gateway.observation.refusals.timeout, 1);
  assert.equal(h.effects.closed, 1);
});

test("a response past its bound revokes the session", async () => {
  const h = harness({
    chunks: [
      Buffer.alloc(generalSessionLimits.responseBytes),
      Buffer.from("x"),
    ],
  });
  await assert.rejects(drain(await h.respond()), /refused/);
  assert.equal(h.gateway.observation.revokedFor, "response-bound");
});

test("a provider refusal is recorded, never retried, and does not end the session", async () => {
  const h = harness({ providerStatus: (call) => (call === 1 ? 429 : 0) });
  await assert.rejects(h.respond(), (error) => error.reason === "provider");
  assert.equal(h.effects.provider.length, 1);
  assert.deepEqual(h.gateway.observation.providerStatuses, [429]);
  // The same gateway still serves the next request, under fresh authority.
  assert.deepEqual(await drain(await h.respond()), Buffer.concat(sse));
  assert.equal(h.effects.authority, 2);
  assert.equal(h.gateway.observation.revoked, false);
});

test("the provider adapter posts exactly the inspected body to the fixed origin", async () => {
  const calls = [];
  const fetchResponse = async (url, init) => {
    calls.push({ url, init });
    return new Response(new Blob([Buffer.concat(sse)]).stream(), {
      status: 200,
    });
  };
  const signal = new AbortController().signal;
  const chunks = [];
  for await (const chunk of generalSessionResponses(fetchResponse)(
    token,
    request(),
    signal,
  ))
    chunks.push(Buffer.from(chunk));
  assert.deepEqual(Buffer.concat(chunks), Buffer.concat(sse));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.redirect, "error");
  assert.equal(calls[0].init.signal, signal);
  assert.deepEqual(calls[0].init.headers, {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    accept: "text/event-stream",
  });
  assert.equal(calls[0].init.body, request());

  const refused = generalSessionResponses(
    async () => new Response("no", { status: 401 }),
  )(token, request(), signal);
  await assert.rejects(
    (async () => {
      for await (const _ of refused);
    })(),
    (error) =>
      error instanceof GeneralSessionProviderRefusal && error.status === 401,
  );
});
