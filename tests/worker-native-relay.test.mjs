// Slice 3 step 3b: the session relay channel and the separate release action,
// against the external guest simulator. No VM, provider or credential.
import assert from "node:assert/strict";
import net from "node:net";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { NativePodmanCodingTransport } from "../dist/podman-coding.js";
import { lockedCodingArgv } from "../dist/feature-candidate.js";
import {
  nativeHost,
  observation,
  launchRequest,
  guestFixture,
  posixGuest,
  realWriteFileSync,
  realReadFileSync,
  sessionGateway,
} from "./helpers/native-coding-fixture.mjs";

const modelRoute = Object.freeze({
  deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  capability: "c".repeat(64),
  decisionSha256: "d".repeat(64),
});
const routedArgv = [...lockedCodingArgv(undefined, modelRoute), "Change it"];
/** Codex 0.161.0's captured launch request (tests/fixtures). */
const captured = readFileSync(
  new URL("./fixtures/codex-0.161.0-launch-request.json", import.meta.url),
);
const sse = [
  Buffer.from('data: {"type":"response.created"}\n\n'),
  Buffer.from('data: {"type":"response.completed"}\n\n'),
];

const gateway = () => sessionGateway(sse);

/** Codex's side: one raw request to the relay, retried until it listens. The
 * simulator runs the relay on a free port, reported in `relay-port`. */
async function codex(root, raw, deadline = Date.now() + 20000) {
  for (;;) {
    try {
      const port = Number(realReadFileSync(`${root}/relay-port`, "utf8"));
      return await new Promise((resolve, reject) => {
        const socket = net.connect(port, "127.0.0.1");
        const chunks = [];
        socket.on("data", (bytes) => chunks.push(bytes));
        socket.on("error", reject);
        socket.on("close", () => resolve(Buffer.concat(chunks)));
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
const post = (capability = modelRoute.capability, payload = captured) =>
  Buffer.concat([
    Buffer.from(
      "POST /v1/responses HTTP/1.1\r\nHost: 127.0.0.1:18091\r\n" +
        `Authorization: Bearer ${capability}\r\n` +
        `X-AIOS-Delivery: ${modelRoute.deliveryId}\r\n` +
        "Content-Type: application/json\r\nAccept: text/event-stream\r\n" +
        `Content-Length: ${payload.length}\r\n\r\n`,
    ),
    payload,
  ]);
const routed = async (transport, changes = {}) =>
  launchRequest(transport, {
    allowanceMs: 60000,
    argv: routedArgv,
    modelRoute,
    ...changes,
  });
const relayRecord = (root, requests) => {
  const name = requests.find((r) => r.action === "prepare").name;
  return JSON.parse(
    realReadFileSync(
      `${root}/.local/state/aios-coding-v1/${name}.json`,
      "utf8",
    ),
  );
};
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test(
  "a routed turn releases Codex only after its relay is ready, and streams Codex's request through the gateway",
  posixGuest,
  async (t) => {
    const { transport, read, root, requests } = guestFixture(t, {
      keepRunning: true,
    });
    const g = gateway();
    const running = transport.run(await routed(transport), () => {}, g);
    const failure = running.then(
      () => undefined,
      (error) => error,
    );
    // Another capability is refused, and never reaches the gateway.
    const denied = await Promise.race([
      codex(root, post("0".repeat(64))),
      failure,
    ]);
    assert.ok(Buffer.isBuffer(denied), String(denied));
    assert.match(denied.toString(), /^HTTP\/1\.1 403 /);
    const response = await codex(root, post());
    realWriteFileSync(`${root}/codex-exit`, "");
    const result = await running;
    assert.equal(result.exitCode, 1);

    const text = response.toString();
    const [head, body] = [
      text.slice(0, text.indexOf("\r\n\r\n")),
      text.slice(text.indexOf("\r\n\r\n") + 4),
    ];
    assert.match(head, /^HTTP\/1\.1 200 /);
    assert.match(head, /\r\nContent-Type: text\/event-stream\r\n/);
    assert.equal(body, Buffer.concat(sse).toString());
    // Only the body crosses, byte for byte, under the gateway's own capability.
    assert.deepEqual(g.calls, [
      [modelRoute.deliveryId, g.capability, captured.toString()],
    ]);
    assert.deepEqual(g.revoked, ["stopped"]);

    const actions = requests
      .map((r) => r.action)
      .filter((a) => a !== "inspect");
    assert.deepEqual(actions, [
      "prepare",
      "launch",
      "relay",
      "release",
      ...actions.slice(4, -1).map(() => "poll"),
      "stop",
    ]);
    // The relay's request names only the session and its capability.
    const relay = requests.find((r) => r.action === "relay");
    assert.equal(relay.capability, modelRoute.capability);
    const state = read();
    const nsenter = state.commands.findIndex((args) => args[1] === "unshare");
    const release = state.commands.findIndex(
      (args) => args[1] === "exec" && args.at(-1) === "/tmp/launch",
    );
    assert.ok(nsenter >= 0 && release > nsenter, "the relay starts first");
    assert.deepEqual(state.commands[nsenter].slice(0, 4), [
      "podman",
      "unshare",
      "nsenter",
      `--net=/proc/${state.container.FixturePid}/ns/net`,
    ]);
    // Stop ends the relay: its record is closed and its process is gone.
    const { relay: recorded } = relayRecord(root, requests);
    assert.equal(recorded.stopped, true);
    assert.equal(recorded.listener.pid, state.relayPids[0]);
    assert.ok(state.relayPids.length === 1 && !alive(state.relayPids[0]));
  },
);

test("an offline turn is released without a relay", posixGuest, async (t) => {
  const { transport, read, requests } = guestFixture(t);
  await transport.run(
    await launchRequest(transport, { allowanceMs: 60000 }),
    () => {},
  );
  assert.deepEqual(
    requests.map((r) => r.action).filter((a) => a !== "inspect"),
    ["prepare", "launch", "release", "poll", "stop"],
  );
  assert.equal(
    read().commands.some((args) => args[1] === "unshare"),
    false,
  );
});

for (const [name, at, rejected] of [
  [
    "releasing Codex",
    "release",
    /Native coding release observation unavailable/,
  ],
  ["a poll", "poll", /Native coding poll observation unavailable/],
])
  test(
    `the guest refuses ${name} when the session's relay listener is not the one it recorded`,
    posixGuest,
    async (t) => {
      const { transport, read, root, requests } = guestFixture(t, {
        keepRunning: true,
        relayForged: at,
      });
      const g = gateway();
      await assert.rejects(
        transport.run(await routed(transport), () => {}, g),
        rejected,
      );
      const state = read();
      const released = state.commands.some(
        (args) => args[1] === "exec" && args.at(-1) === "/tmp/launch",
      );
      assert.equal(released, at === "poll");
      assert.equal(state.alive, false);
      assert.deepEqual(g.revoked, ["stopped"]);
      assert.equal(relayRecord(root, requests).phase, "stopped");
    },
  );

for (const lost of ["relay", "channel"])
  test(
    `losing the ${lost === "relay" ? "relay" : "relay's channel"} after release revokes the gateway and stops the exact session`,
    posixGuest,
    async (t) => {
      // The guest still sees the relay as alive, so only the host can notice.
      const { transport, read } = guestFixture(t, {
        keepRunning: true,
        loseRelay: lost,
      });
      const g = gateway();
      await assert.rejects(
        transport.run(await routed(transport), () => {}, g),
        /Native coding relay lost/,
      );
      assert.deepEqual(g.revoked, ["stopped"]);
      const state = read();
      assert.equal(state.alive, false);
      assert.ok(state.commands.some((args) => args[1] === "stop"));
    },
  );

test(
  "a routed worker that fills the shared disk and exits still has its relay ended at shutdown",
  posixGuest,
  async (t) => {
    const { transport, read, write, root, requests } = guestFixture(t, {
      keepRunning: true,
    });
    let checkpoints = 0;
    const g = gateway();
    // Codex exits at the first poll, then the disk fills. Stop then finds no
    // running worker, so only the reserve it releases at the end makes room
    // for the relay's record.
    const request = await routed(transport, {
      checkpoint: () => {
        checkpoints++;
        if (checkpoints === 1) realWriteFileSync(`${root}/codex-exit`, "");
        if (checkpoints === 2) write({ ...read(), diskFull: true });
        return true;
      },
    });
    assert.equal((await transport.run(request, () => {}, g)).exitCode, 1);
    const state = read();
    assert.equal(state.container.State.Running, false);
    const { relay, phase } = relayRecord(root, requests);
    assert.equal(phase, "stopped");
    assert.equal(relay.stopped, true);
    assert.ok(!alive(state.relayPids[0]));
    assert.deepEqual(g.revoked, ["stopped"]);
  },
);

test(
  "the guest refuses a relay whose capability is not the admitted one, and Codex is never released",
  posixGuest,
  async (t) => {
    const { transport, read } = guestFixture(t, {
      keepRunning: true,
      relayCapabilityDrift: true,
    });
    const g = gateway();
    await assert.rejects(
      transport.run(await routed(transport), () => {}, g),
      /Session relay unavailable/,
    );
    const state = read();
    assert.equal(
      state.commands.some((args) => args[1] === "unshare"),
      false,
    );
    assert.equal(
      state.commands.some((args) => args.at(-1) === "/tmp/launch"),
      false,
    );
    assert.equal(state.alive, false);
    assert.deepEqual(g.revoked, ["stopped"]);
  },
);

test("a route needs a gateway, a gateway needs a route, and the two capabilities differ, before any VM effect", async (t) => {
  const fixture = nativeHost(t, (r) => ({
    session: r.session,
    binding: observation,
    cliSha256: r.cliSha256,
  }));
  const transport = new NativePodmanCodingTransport(
    "aios-test",
    "a".repeat(64),
  );
  const offline = await launchRequest(transport);
  for (const [request, g] of [
    [await routed(transport), undefined],
    [offline, gateway()],
    [
      await routed(transport),
      { ...gateway(), capability: modelRoute.capability },
    ],
    [await routed(transport), { ...gateway(), respond: undefined }],
  ])
    await assert.rejects(
      transport.run(request, () => {}, g),
      /Unsupported native coding launch/,
    );
  assert.equal(
    fixture.requests.some((r) => r.action !== "inspect"),
    false,
  );
});
