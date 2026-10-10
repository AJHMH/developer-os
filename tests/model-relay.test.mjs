import assert from "node:assert/strict";
import { test } from "node:test";
import { syntheticRelayCanary } from "../dist/model-relay.js";
import http from "node:http";
import { syncBuiltinESMExports } from "node:module";

test("synthetic model relay verifies bounded transport and denial paths without live credentials", async () => {
  // The canary proves the fixed response, refuses alternate routes, credentials
  // and methods, strips the owner header, and rechecks transport after refusal.
  // Every peer is a fresh local loopback server; no account or inference is used.
  assert.equal(await syntheticRelayCanary(), "passed");
});

test("synthetic relay closes its peers and can repeat with fresh capabilities", async () => {
  assert.equal(await syntheticRelayCanary(), "passed");
  assert.equal(await syntheticRelayCanary(), "passed");
});

test("synthetic relay refuses invalid content, body, authorization, tunnels and upgrades", async (t) => {
  const request = http.request;
  let intercepted = false;
  let denied;
  t.mock.method(http, "request", (options, callback) => {
    if (intercepted || !options.headers?.["x-owner-canary"])
      return request(options, callback);
    intercepted = true;
    const probe = (changes, body = "wrong synthetic body") =>
      new Promise((resolve, reject) => {
        const headers = {
          ...options.headers,
          "content-length": Buffer.byteLength(body),
          ...changes.headers,
        };
        const req = request({ ...options, ...changes, headers }, (res) => {
          res.resume();
          res.on("end", () => resolve(res.statusCode));
        });
        req.on("connect", (res, socket) => {
          socket.destroy();
          resolve(res.statusCode);
        });
        req.on("upgrade", (res, socket) => {
          socket.destroy();
          resolve(res.statusCode);
        });
        req.on("error", (error) =>
          error.code === "ECONNRESET" && body.length > 4096
            ? resolve(413)
            : reject(error),
        );
        req.end(body);
      });
    // Keep the canary's first positive response paused until the hostile probes
    // finish. They use only its fresh synthetic capability and local listener.
    denied = Promise.all([
      probe({ headers: { "content-type": "text/plain" } }),
      probe({}),
      probe({ headers: { authorization: "Bearer wrong-length" } }),
      probe({ method: "CONNECT" }),
      probe({ headers: { connection: "Upgrade", upgrade: "synthetic" } }),
      probe({}, "x".repeat(4097)),
    ]);
    return request(options, (incoming) => {
      incoming.pause();
      denied.then(
        () => {
          callback(incoming);
          incoming.resume();
        },
        () => {
          incoming.destroy();
          callback(incoming);
        },
      );
    });
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  assert.equal(await syntheticRelayCanary(), "passed");
  assert.deepEqual(await denied, [403, 403, 403, 403, 403, 413]);
});
