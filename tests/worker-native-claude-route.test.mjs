import assert from "node:assert/strict";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { claudeGuest } from "../dist/podman-coding.js";
import { claudeCodeArgv, modelRoutePort } from "../dist/coding-agent.js";
import {
  MessagesGateway,
  claudeCodeRelayEnvironment,
} from "../dist/messages-gateway.js";
import { pinnedModelPrices } from "../dist/spend-budget.js";
import {
  claudeCodingBoundaryProbe,
  claudeCodingBoundaryProbeNames,
  boundaryProbeNames,
} from "../dist/worker-probes.js";
import {
  guestFixture,
  launchRequest,
  session,
  realReadFileSync,
  realWriteFileSync,
} from "./helpers/native-coding-fixture.mjs";

// The routed Claude Code guest (ADR 0006, 0008): Claude Code's Messages
// requests cross the session relay to a real MessagesGateway, charged to the
// spend budget, against the external Linux and Podman simulator. The
// provider is a fake; no credential or network is involved.
const sessionId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const modelRoute = Object.freeze({
  deliveryId: "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  capability: "c".repeat(64),
  decisionSha256: "d".repeat(64),
});
// Generated per run: never a literal key in the repository.
const apiKey = `sk-ant-api03-${randomBytes(24).toString("hex")}`;
const sse = [
  `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 1000, output_tokens: 1 } } })}\n\n`,
  `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: 200 } })}\n\n`,
].map((s) => Buffer.from(s));

function messagesGateway() {
  const effects = [],
    calls = [];
  const gateway = new MessagesGateway(
    {
      deliveryId: modelRoute.deliveryId,
      sessionId: "12345678-1234-4234-8234-123456789abc",
      expiresAt: Date.now() + 10 * 60_000,
      maxRequests: 8,
    },
    () => apiKey,
    {
      admit: (op, reserve) => (effects.push(["admit", op, reserve]), true),
      charge: (op, usage) => effects.push(["charge", op, usage]),
      chargeReservation: (op) => effects.push(["reservation", op]),
      release: (op) => effects.push(["release", op]),
    },
    async function* (key, body) {
      calls.push({ key, body });
      yield* sse;
    },
  );
  return { gateway, effects, calls };
}
const messages = (model = pinnedModelPrices.model) =>
  Buffer.from(
    JSON.stringify({
      model,
      messages: [{ role: "user", content: "synthetic turn" }],
      max_tokens: 1024,
      stream: true,
    }),
  );
/** Claude Code's side: one raw request to the relay, retried until it
 * listens. The simulator runs the relay on a free port in `relay-port`. */
async function claude(root, raw, deadline = Date.now() + 20000) {
  for (;;) {
    try {
      const port = Number(realReadFileSync(`${root}/relay-port`, "utf8"));
      return await new Promise((resolve, reject) => {
        const socket = net.connect(port, "127.0.0.1");
        const chunks = [];
        socket.on("data", (bytes) => chunks.push(bytes));
        socket.on("error", reject);
        socket.on("close", () => resolve(Buffer.concat(chunks).toString()));
        socket.end(raw);
      });
    } catch (error) {
      if (
        !["ECONNREFUSED", "ENOENT"].includes(error.code) ||
        Date.now() > deadline
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
const post = (path, payload = messages(), capability = modelRoute.capability) =>
  Buffer.concat([
    Buffer.from(
      `POST ${path} HTTP/1.1\r\nHost: 127.0.0.1:${modelRoutePort}\r\n` +
        `Authorization: Bearer ${capability}\r\n` +
        `X-AIOS-Delivery: ${modelRoute.deliveryId}\r\n` +
        "anthropic-version: 2023-06-01\r\n" +
        "Content-Type: application/json\r\n" +
        `Content-Length: ${payload.length}\r\n\r\n`,
    ),
    payload,
  ]);
const routed = (transport, changes = {}) =>
  launchRequest(transport, {
    argv: [...claudeCodeArgv(undefined), "Change the title"],
    branch: "aios/feature-12345678-1234-4234-8234-123456789abc",
    modelRoute,
    ...changes,
  });

test("a routed Claude Code turn reaches the MessagesGateway through the relay, charged to the budget", async (t) => {
  const { transport, read, root } = guestFixture(
    t,
    { threadId: sessionId, keepRunning: true },
    undefined,
    claudeGuest,
  );
  const m = messagesGateway();
  const running = transport.run(await routed(transport), () => {}, m.gateway);
  const failure = running.then(
    () => undefined,
    (error) => error,
  );
  // Codex's route, another model and another capability are refused, and
  // never reach the gateway.
  for (const raw of [
    post("/v1/responses"),
    post("/v1/messages/count_tokens"),
    post("/v1/messages", messages("claude-other")),
    post("/v1/messages", messages(), "0".repeat(64)),
  ]) {
    const denied = await Promise.race([claude(root, raw), failure]);
    assert.equal(typeof denied, "string", String(denied));
    assert.match(denied, /^HTTP\/1\.1 403 /);
  }
  const responses = [];
  for (const path of ["/v1/messages", "/v1/messages?beta=true"])
    responses.push(await claude(root, post(path)));
  realWriteFileSync(`${root}/codex-exit`, "");
  await running;
  for (const response of responses) {
    assert.match(response, /^HTTP\/1\.1 200 /);
    assert.match(response, /\r\nContent-Type: text\/event-stream\r\n/);
    assert.ok(response.endsWith(Buffer.concat(sse).toString()));
  }
  // Only the two Messages requests reached the provider, under the host's key.
  assert.equal(m.calls.length, 2);
  assert.ok(m.calls.every((c) => c.key === apiKey));
  assert.deepEqual(
    m.effects.map(([kind, , usage]) => [kind, kind === "charge" ? usage : 0]),
    [
      ["admit", 0],
      ["charge", { input_tokens: 1000, output_tokens: 200 }],
      ["admit", 0],
      ["charge", { input_tokens: 1000, output_tokens: 200 }],
    ],
  );
  // The turn is over, so the gateway refuses anything more.
  await assert.rejects(
    m.gateway.respond(
      modelRoute.deliveryId,
      m.gateway.capability,
      messages().toString(),
    ),
  );
  // The worker gets exactly the route's environment, and the same argv.
  const worker = read().container;
  const env = Object.fromEntries(
    worker.Config.Env.map((e) => [
      e.slice(0, e.indexOf("=")),
      e.slice(e.indexOf("=") + 1),
    ]),
  );
  assert.deepEqual(env, {
    PATH: "/usr/bin:/bin",
    HOME: "/session",
    CLAUDE_CONFIG_DIR: "/session",
    ...claudeCodeRelayEnvironment(
      modelRoutePort,
      modelRoute.deliveryId,
      modelRoute.capability,
    ),
    SHELL: "/usr/local/bin/bash",
    HOSTNAME: "aios-coding",
  });
  assert.deepEqual(worker.Config.Cmd.slice(4), [
    ...claudeCodeArgv(undefined),
    "Change the title",
  ]);
});

test("a routed Claude Code session runs Claude's own boundary probe, in routed mode", async (t) => {
  const passed = (names) =>
    names.map((name) => `passed-${name}`).join("\n") + "\n";
  const { transport, read, root } = guestFixture(
    t,
    {
      threadId: sessionId,
      keepRunning: true,
      probeOutput: passed(claudeCodingBoundaryProbeNames),
    },
    undefined,
    claudeGuest,
  );
  const m = messagesGateway();
  const request = await routed(transport);
  const running = transport.run(request, () => {}, m.gateway);
  // Probe only once the launch has run, so the launch's own simulator state
  // never overwrites the probe's.
  for (
    let i = 0;
    i < 400 && !read().commands?.some((a) => a.at(-1) === "/tmp/launch");
    i++
  )
    await new Promise((resolve) => setTimeout(resolve, 5));
  const probed = await transport.probeBoundary(session, "index.html");
  assert.deepEqual(
    probed.probes.map((p) => [p.name, p.outcome]),
    claudeCodingBoundaryProbeNames.map((name) => [name, "passed"]),
  );
  const exec = read().commands.find(
    (args) => args[1] === "exec" && args[3] === "/bin/sh",
  );
  assert.equal(exec[5], claudeCodingBoundaryProbe);
  assert.equal(read().probes[0][2], "routed");
  realWriteFileSync(`${root}/codex-exit`, "");
  await running;
});

test("the shared probe's verdicts, as the removed Codex guest gave them, are never a Claude Code result", async (t) => {
  // The shared probe, then the coding worker's own controls: Codex's order.
  const shared = [
    ...boundaryProbeNames,
    ...claudeCodingBoundaryProbeNames.slice(-5),
  ];
  assert.notDeepEqual(shared, claudeCodingBoundaryProbeNames);
  const { transport, read, root } = guestFixture(
    t,
    {
      threadId: sessionId,
      keepRunning: true,
      probeOutput: shared.map((name) => `passed-${name}`).join("\n") + "\n",
    },
    undefined,
    claudeGuest,
  );
  const m = messagesGateway();
  const request = await routed(transport);
  const running = transport.run(request, () => {}, m.gateway);
  // Probe only once the launch has run, so the launch's own simulator state
  // never overwrites the probe's.
  for (
    let i = 0;
    i < 400 && !read().commands?.some((a) => a.at(-1) === "/tmp/launch");
    i++
  )
    await new Promise((resolve) => setTimeout(resolve, 5));
  await assert.rejects(transport.probeBoundary(session, "index.html"));
  realWriteFileSync(`${root}/codex-exit`, "");
  await running;
});

for (const variable of [
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_CUSTOM_HEADERS",
  "ANTHROPIC_MODEL",
])
  test(`a worker whose ${variable} is not the route's is never launched`, async (t) => {
    const { transport, read } = guestFixture(
      t,
      { threadId: sessionId, routeEnvDrift: variable },
      undefined,
      claudeGuest,
    );
    const m = messagesGateway();
    await assert.rejects(
      transport.run(await routed(transport), () => {}, m.gateway),
    );
    assert.equal(
      read().commands.filter((args) => args[1] === "start").length,
      0,
    );
    assert.equal(m.calls.length, 0);
  });
