import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import net from "node:net";
import { PassThrough, Writable } from "node:stream";
import { test } from "node:test";
import {
  sessionRelayLimits,
  sessionRelaySource,
  openSessionRelay,
} from "../dist/session-relay.js";
import { gatewayModel } from "../dist/inference-contract.js";

const deliveryId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const capability = "c".repeat(64);
const body = Buffer.from(
  JSON.stringify({ model: gatewayModel, stream: true, store: false }),
);

/** Newline-delimited JSON frames from a stream, one at a time. */
function frames(stream) {
  let pending = "";
  const queue = [],
    waiting = [];
  stream.on("data", (bytes) => {
    pending += bytes.toString();
    for (let i; (i = pending.indexOf("\n")) >= 0; ) {
      const frame = JSON.parse(pending.slice(0, i));
      pending = pending.slice(i + 1);
      waiting.length ? waiting.shift()(frame) : queue.push(frame);
    }
  });
  return () =>
    queue.length
      ? Promise.resolve(queue.shift())
      : new Promise((resolve) => waiting.push(resolve));
}

/** The relay process alone, outside any namespace, on an ephemeral port. */
async function relay(t, config = {}) {
  const child = spawn(
    process.env.AIOS_TEST_PYTHON || "python3",
    ["-I", "-u", "-c", sessionRelaySource],
    { stdio: ["pipe", "pipe", "ignore"] },
  );
  t.after(() => child.kill("SIGKILL"));
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const next = frames(child.stdout);
  child.stdin.write(
    JSON.stringify({
      port: 0,
      deliveryId,
      capability,
      model: gatewayModel,
      requestBytes: 4096,
      responseGapMs: 5000,
      ...config,
    }) + "\n",
  );
  const ready = await next();
  assert.deepEqual(Object.keys(ready).sort(), ["pid", "port", "ready"]);
  assert.equal(ready.ready, true);
  assert.equal(ready.pid, child.pid);
  return {
    port: ready.port,
    next,
    exited,
    send: (frame) => child.stdin.write(JSON.stringify(frame) + "\n"),
    end: () => child.stdin.end(),
  };
}

/** One raw HTTP exchange: everything the relay writes until it closes. */
function exchange(port, raw) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    const chunks = [];
    socket.on("data", (bytes) => chunks.push(bytes));
    socket.on("error", reject);
    socket.on("close", () => resolve(Buffer.concat(chunks)));
    socket.end(raw);
  });
}
/** An exchange the relay cuts by exiting: Windows reports a reset where
 * POSIX reports a close, and either ends the connection. */
const severed = (pending) =>
  pending.catch((error) => {
    if (error.code !== "ECONNRESET") throw error;
    return Buffer.alloc(0);
  });
/** A request with the session's headers; `null` drops one, an array repeats it. */
function request({
  method = "POST",
  path = "/v1/responses",
  headers = {},
  payload = body,
} = {}) {
  const all = {
    Host: "127.0.0.1",
    Authorization: `Bearer ${capability}`,
    "X-AIOS-Delivery": deliveryId,
    "Content-Type": "application/json",
    "Content-Length": String(payload.length),
    ...headers,
  };
  const lines = Object.entries(all).flatMap(([name, value]) =>
    value === null
      ? []
      : (Array.isArray(value) ? value : [value]).map((v) => `${name}: ${v}`),
  );
  return Buffer.concat([
    Buffer.from(`${method} ${path} HTTP/1.1\r\n${lines.join("\r\n")}\r\n\r\n`),
    payload,
  ]);
}
const split = (response) => {
  const index = response.indexOf("\r\n\r\n");
  return {
    head: response.subarray(0, index).toString(),
    body: response.subarray(index + 4),
  };
};
const deniedEmpty = (response, name) => {
  const { head, body: rest } = split(response);
  assert.match(head, /^HTTP\/1\.1 403 /, name);
  assert.equal(rest.length, 0, name);
};

test("the relay refuses anything but the session's exact Responses request with an empty 403", async (t) => {
  const r = await relay(t);
  const json = (value) => Buffer.from(JSON.stringify(value));
  for (const [name, changes] of [
    ["another method", { method: "GET" }],
    ["another path", { path: "/v1/models" }],
    ["a query string", { path: "/v1/responses?stream=1" }],
    [
      "another capability",
      { headers: { Authorization: `Bearer ${"0".repeat(64)}` } },
    ],
    ["no capability", { headers: { Authorization: null } }],
    [
      "a repeated capability",
      {
        headers: {
          Authorization: [`Bearer ${capability}`, `Bearer ${capability}`],
        },
      },
    ],
    [
      "another delivery",
      {
        headers: { "X-AIOS-Delivery": "ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee" },
      },
    ],
    ["no delivery", { headers: { "X-AIOS-Delivery": null } }],
    [
      "a repeated length",
      {
        headers: {
          "Content-Length": [String(body.length), String(body.length)],
        },
      },
    ],
    ["an unknown method", { method: "BREW" }],
    [
      "an upgrade",
      { headers: { Upgrade: "websocket", Connection: "Upgrade" } },
    ],
    ["a chunked body", { headers: { "Transfer-Encoding": "chunked" } }],
    ["an encoded body", { headers: { "Content-Encoding": "gzip" } }],
    ["another content type", { headers: { "Content-Type": "text/plain" } }],
    ["an expectation", { headers: { Expect: "100-continue" } }],
    [
      "a body over the bound",
      { payload: json({ model: gatewayModel, pad: "x".repeat(5000) }) },
    ],
    ["another model", { payload: json({ model: "gpt-other", stream: true }) }],
    ["a body that is not JSON", { payload: Buffer.from("{not json") }],
    [
      "a body that is not UTF-8",
      {
        payload: Buffer.from(
          JSON.stringify({ model: gatewayModel }),
          "utf16le",
        ),
      },
    ],
  ])
    deniedEmpty(await exchange(r.port, request(changes)), name);
  // No refused request reached the host: the first frame is the next request.
  const response = exchange(r.port, request());
  assert.deepEqual(await r.next(), {
    request: 1,
    body: body.toString("base64"),
  });
  const sse = [
    'data: {"type":"response.created"}\n\n',
    'data: {"type":"response.completed"}\n\n',
  ];
  for (const chunk of sse)
    r.send({ request: 1, chunk: Buffer.from(chunk).toString("base64") });
  r.send({ request: 1, end: true });
  const { head, body: streamed } = split(await response);
  assert.match(head, /^HTTP\/1\.1 200 /);
  assert.match(head, /\r\nContent-Type: text\/event-stream\r\n/);
  assert.doesNotMatch(head, /Content-Length/i);
  assert.equal(streamed.toString(), sse.join(""));
});

test("a host refusal is an empty 403, a failure mid-stream ends the response, and a frame out of order ends the relay", async (t) => {
  // A long gap, so only the frame's order can end the relay here.
  const r = await relay(t, { responseGapMs: 600000 });
  const refused = exchange(r.port, request());
  assert.equal((await r.next()).request, 1);
  r.send({ request: 1, refused: true });
  deniedEmpty(await refused, "refused before any bytes");
  const partial = exchange(r.port, request());
  assert.equal((await r.next()).request, 2);
  r.send({
    request: 2,
    chunk: Buffer.from("data: one\n\n").toString("base64"),
  });
  r.send({ request: 2, refused: true });
  const { head, body: cut } = split(await partial);
  assert.match(head, /^HTTP\/1\.1 200 /);
  assert.equal(cut.toString(), "data: one\n\n");
  const stray = severed(exchange(r.port, request()));
  assert.equal((await r.next()).request, 3);
  r.send({ request: 4, end: true });
  assert.equal(await r.exited, 1);
  await stray;
});

test("a malformed request line gets no answer but a 403, and a worker that hangs up mid-stream leaves the relay in step", async (t) => {
  const r = await relay(t);
  // A request line Python reads as HTTP/0.9 gets no status line at all.
  const malformed = await exchange(
    r.port,
    Buffer.from("NOT A REQUEST\r\n\r\n"),
  );
  if (malformed.length) deniedEmpty(malformed, "malformed");
  const socket = net.connect(r.port, "127.0.0.1");
  socket.on("error", () => {});
  socket.write(request());
  assert.equal((await r.next()).request, 1);
  socket.destroy();
  for (let i = 0; i < 8; i++)
    r.send({ request: 1, chunk: Buffer.alloc(65536, 0x61).toString("base64") });
  r.send({ request: 1, end: true });
  const next = exchange(r.port, request());
  assert.equal((await r.next()).request, 2);
  r.send({ request: 2, end: true });
  assert.match(split(await next).head, /^HTTP\/1\.1 200 /);
});

test("a host silent past the response gap ends the relay", async (t) => {
  const r = await relay(t, { responseGapMs: 200 });
  const waiting = severed(exchange(r.port, request()));
  assert.equal((await r.next()).request, 1);
  assert.equal(await r.exited, 1);
  await waiting;
});

test("closing the channel ends the relay at once", async (t) => {
  const r = await relay(t);
  r.end();
  assert.equal(await r.exited, 0);
  await assert.rejects(exchange(r.port, request()), { code: "ECONNREFUSED" });
});

/** A channel process whose streams the test drives. */
function channel() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kills = 0;
  child.kill = () => {
    child.kills++;
    queueMicrotask(() => child.emit("close", null));
    return true;
  };
  child.emit_ = (frame) =>
    child.stdout.write(
      (typeof frame === "string" ? frame : JSON.stringify(frame)) + "\n",
    );
  child.written = frames(child.stdin);
  return child;
}
/** A gateway that records every call and streams `chunks`, or throws. */
function gateway(respond = async () => [Buffer.from("data: done\n\n")]) {
  const g = {
    capability: "e".repeat(64),
    calls: [],
    revoked: [],
    async respond(...args) {
      g.calls.push(args);
      return respond(...args);
    },
    revoke(reason) {
      g.revoked.push(reason);
    },
  };
  return g;
}
const ready = { ready: true, session: { operationId: "x" } };
const requestFrame = (id, bytes = body) => ({
  request: id,
  body: bytes.toString("base64"),
});

test("the bridge streams each request through the gateway in bounded frames", async () => {
  const large = Buffer.alloc(sessionRelayLimits.chunkBytes + 1000, 0x61);
  const g = gateway(async () => [Buffer.from("data: a\n\n"), large]);
  const child = channel();
  const opening = openSessionRelay(child, deliveryId, g, 5000);
  child.emit_(ready);
  const opened = await opening;
  assert.deepEqual(opened.ready, ready);
  assert.equal(opened.relay.lost, false);
  child.emit_(requestFrame(1));
  const written = [];
  for (let frame; !(frame = await child.written()).end; ) written.push(frame);
  assert.deepEqual(g.calls, [[deliveryId, g.capability, body.toString()]]);
  assert.ok(
    written.every((f) => f.request === 1 && Object.keys(f).length === 2),
  );
  const chunks = written.map((f) => Buffer.from(f.chunk, "base64"));
  assert.ok(chunks.every((c) => c.length <= sessionRelayLimits.chunkBytes));
  assert.equal(chunks.length, 3);
  assert.deepEqual(
    Buffer.concat(chunks),
    Buffer.concat([Buffer.from("data: a\n\n"), large]),
  );
  // A gateway refusal answers that request and keeps the session's relay.
  g.calls.length = 0;
  const refusing = gateway(async () => {
    throw Error("refused");
  });
  const second = channel();
  const pending = openSessionRelay(second, deliveryId, refusing, 5000);
  second.emit_(ready);
  const { relay } = await pending;
  second.emit_(requestFrame(1));
  assert.deepEqual(await second.written(), { request: 1, refused: true });
  assert.equal(relay.lost, false);
  assert.deepEqual(refusing.revoked, []);
  second.emit_(requestFrame(2));
  assert.deepEqual(await second.written(), { request: 2, refused: true });
});

test("a failure mid-stream answers that request with a refusal after its bytes", async () => {
  const g = gateway(async () =>
    (async function* () {
      yield Buffer.from("data: a\n\n");
      throw Error("provider failed");
    })(),
  );
  const child = channel();
  const opening = openSessionRelay(child, deliveryId, g, 5000);
  child.emit_(ready);
  const { relay } = await opening;
  child.emit_(requestFrame(1));
  assert.equal((await child.written()).request, 1);
  assert.deepEqual(await child.written(), { request: 1, refused: true });
  assert.equal(relay.lost, false);
});

for (const [name, misbehave] of [
  ["a line that is not JSON", (c) => c.emit_("{not json")],
  ["a frame with other keys", (c) => c.emit_({ ...requestFrame(1), extra: 1 })],
  ["a request out of order", (c) => c.emit_(requestFrame(2))],
  [
    "a second request while one is in flight",
    (c) => {
      c.emit_(requestFrame(1));
      c.emit_(requestFrame(2));
    },
  ],
  [
    "a body that is not canonical base64",
    (c) => c.emit_({ request: 1, body: body.toString("base64") + "\n" }),
  ],
  ["an empty body", (c) => c.emit_({ request: 1, body: "" })],
  [
    "a body over the bound",
    (c) =>
      c.emit_(
        requestFrame(
          1,
          Buffer.alloc(sessionRelayLimits.requestBytes + 1, 0x7b),
        ),
      ),
  ],
  [
    "a body that is not UTF-8",
    (c) => c.emit_(requestFrame(1, Buffer.from([0x7b, 0xff, 0x7d]))),
  ],
  [
    "an endless line",
    (c) => c.stdout.write("x".repeat(sessionRelayLimits.frameChars + 1)),
  ],
  [
    "an oversized line",
    (c) => c.stdout.write("x".repeat(sessionRelayLimits.frameChars + 1) + "\n"),
  ],
  ["unbounded diagnostics", (c) => c.stderr.write(Buffer.alloc(1048577))],
  ["the channel closing", (c) => c.emit("close", 0)],
  ["a channel error", (c) => c.emit("error", Error("lost"))],
])
  test(`${name} loses the relay, revokes the gateway and kills the channel`, async () => {
    const hold = gateway(async () =>
      (async function* () {
        yield Buffer.from("data: a\n\n");
        await new Promise(() => {});
      })(),
    );
    const child = channel();
    const opening = openSessionRelay(child, deliveryId, hold, 5000);
    child.emit_(ready);
    const { relay } = await opening;
    misbehave(child);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(relay.lost, true);
    // A frame arriving once the relay is lost is ignored.
    const calls = hold.calls.length;
    child.emit_(requestFrame(1));
    child.emit_(requestFrame(2));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(hold.calls.length, calls);
    assert.deepEqual(hold.revoked, ["stopped"]);
    assert.ok(child.kills >= 1);
    assert.ok(
      hold.calls.length <= 1,
      "nothing after the violation reaches the gateway",
    );
  });

test("losing the relay closes the gateway stream it was forwarding", async () => {
  let returned = false;
  const g = gateway(async () => ({
    [Symbol.asyncIterator]() {
      return {
        next: () =>
          new Promise((resolve) =>
            setTimeout(
              () => resolve({ done: false, value: Buffer.from("x") }),
              5,
            ),
          ),
        return: async () => {
          returned = true;
          return { done: true, value: undefined };
        },
      };
    },
  }));
  const child = channel();
  const opening = openSessionRelay(child, deliveryId, g, 5000);
  child.emit_(ready);
  const { relay } = await opening;
  child.emit_(requestFrame(1));
  await child.written();
  relay.close();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(returned, true);
  assert.equal(relay.lost, true);
  assert.deepEqual(g.revoked, ["stopped"]);
});

test("a relay that never reports ready is refused and killed at its deadline", async () => {
  const g = gateway();
  const child = channel();
  await assert.rejects(openSessionRelay(child, deliveryId, g, 30));
  assert.ok(child.kills >= 1);
  assert.deepEqual(g.revoked, ["stopped"]);
  const closed = channel();
  const opening = openSessionRelay(closed, deliveryId, g, 5000);
  closed.emit("close", 1);
  await assert.rejects(opening);
  const listed = channel();
  const malformed = openSessionRelay(listed, deliveryId, g, 5000);
  listed.emit_([ready]);
  await assert.rejects(malformed);
  assert.ok(listed.kills >= 1);
});

test("a full channel waits for drain, and keeps no listeners afterwards", async () => {
  const large = Buffer.alloc(4 * sessionRelayLimits.chunkBytes, 0x61);
  const g = gateway(async () => [large]);
  const child = channel();
  // A pipe that takes one frame at a time, as a slow ssh channel would.
  const written = [];
  child.stdin = new Writable({
    highWaterMark: 1,
    write(bytes, _encoding, done) {
      written.push(bytes.toString());
      setTimeout(done, 2);
    },
  });
  const opening = openSessionRelay(child, deliveryId, g, 5000);
  child.emit_(ready);
  await opening;
  child.emit_(requestFrame(1));
  while (!written.join("").includes('"end":true'))
    await new Promise((resolve) => setTimeout(resolve, 5));
  const frames = written
    .join("")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  assert.equal(frames.length, 5);
  assert.deepEqual(
    Buffer.concat(
      frames.slice(0, 4).map((f) => Buffer.from(f.chunk, "base64")),
    ),
    large,
  );
  assert.equal(child.stdin.listenerCount("drain"), 0);
  assert.equal(child.listenerCount("close"), 1);
});
