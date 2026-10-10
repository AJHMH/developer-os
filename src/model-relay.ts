import {
  createServer,
  request,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";

/** Synthetic transport capability only. Both peers stay on host loopback,
 * credentials are fresh canaries and never represent an OpenAI account.
 * No public listener, VM networking, owner credentials or live upstream. */
export async function syntheticRelayCanary(): Promise<"passed" | "not-run"> {
  const capability = randomBytes(32).toString("hex");
  const upstreamCredential = randomBytes(32).toString("hex");
  const checks: boolean[] = [];
  let forwarded = 0;
  const body = JSON.stringify({
    model: "synthetic",
    input: "Synthetic model-only relay challenge",
  });
  const output = JSON.stringify({
    output: "Synthetic model-only relay response",
  });
  const reply = (res: ServerResponse, status: number, value = "") => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(value);
  };
  const upstream = createServer((req, res) => {
    forwarded++;
    checks.push(
      req.method === "POST" &&
        req.url === "/v1/responses" &&
        req.headers.authorization === `Bearer ${upstreamCredential}` &&
        req.headers["x-owner-canary"] === undefined,
    );
    req.resume();
    req.on("end", () => reply(res, 200, output));
  });
  let upstreamPort = 0;
  const relay = createServer((req: IncomingMessage, res: ServerResponse) => {
    const expected = Buffer.from(`Bearer ${capability}`);
    const observed = Buffer.from(req.headers.authorization ?? "");
    if (
      observed.length !== expected.length ||
      !timingSafeEqual(observed, expected)
    ) {
      req.resume();
      reply(res, 403);
      return;
    }
    if (
      req.method !== "POST" ||
      req.url !== "/v1/responses" ||
      req.headers["content-type"] !== "application/json"
    ) {
      req.resume();
      reply(res, 403);
      return;
    }
    let data = "",
      size = 0,
      refused = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 4096) {
        refused = true;
        reply(res, 413);
        req.destroy();
      } else data += chunk.toString("utf8");
    });
    req.on("end", () => {
      if (refused) return;
      // This canary admits one fixed synthetic body, never repository input.
      if (data !== body) {
        reply(res, 403);
        return;
      }
      const outgoing = request(
        {
          hostname: "127.0.0.1",
          port: upstreamPort,
          method: "POST",
          path: "/v1/responses",
          headers: {
            authorization: `Bearer ${upstreamCredential}`,
            "content-type": "application/json",
          },
          timeout: 1000,
        },
        (incoming) => {
          let response = "",
            bytes = 0;
          incoming.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 4096) incoming.destroy();
            else response += chunk.toString("utf8");
          });
          incoming.on("end", () =>
            reply(
              res,
              incoming.statusCode === 200 && response === output ? 200 : 502,
              response === output ? output : "",
            ),
          );
          incoming.on("error", () => reply(res, 502));
        },
      );
      outgoing.on("timeout", () => outgoing.destroy());
      outgoing.on("error", () => reply(res, 502));
      outgoing.end(data);
    });
    req.on("error", () => {
      if (!res.headersSent) reply(res, 400);
    });
  });
  relay.on("connect", (_req, socket) =>
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"),
  );
  relay.on("upgrade", (_req, socket) =>
    socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"),
  );
  const listen = (server: ReturnType<typeof createServer>) =>
    new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") reject(Error());
        else resolve(address.port);
      });
    });
  try {
    upstreamPort = await listen(upstream);
    const port = await listen(relay);
    const send = (path: string, token = capability, method = "POST") =>
      new Promise<{ status: number; content: string }>((resolve, reject) => {
        const req = request(
          {
            hostname: "127.0.0.1",
            port,
            path,
            method,
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": "application/json",
              "content-length": Buffer.byteLength(body),
              "x-owner-canary": "synthetic-owner-header",
            },
            timeout: 1000,
          },
          (res) => {
            let content = "";
            res.on("data", (chunk) => {
              content += chunk.toString();
            });
            res.on("end", () =>
              resolve({ status: res.statusCode ?? 0, content }),
            );
            res.on("error", reject);
          },
        );
        req.on("timeout", () => req.destroy());
        req.on("error", reject);
        req.end(body);
      });
    const positive = await send("/v1/responses");
    checks.push(
      positive.status === 200 && positive.content === output && forwarded === 1,
    );
    for (const path of [
      "/v1/models",
      "/v1/responses?redirect=other",
      "http://other.invalid/v1/responses",
      "/mcp",
      "/github",
    ]) {
      checks.push((await send(path)).status === 403 && forwarded === 1);
    }
    checks.push(
      (await send("/v1/responses", randomBytes(32).toString("hex"))).status ===
        403 && forwarded === 1,
    );
    checks.push(
      (await send("/v1/responses", capability, "GET")).status === 403 &&
        forwarded === 1,
    );
    const after = await send("/v1/responses");
    checks.push(
      after.status === 200 && after.content === output && forwarded === 2,
    );
    return checks.every(Boolean) ? "passed" : "not-run";
  } catch {
    return "not-run";
  } finally {
    relay.closeAllConnections();
    upstream.closeAllConnections();
    await Promise.all(
      [relay, upstream].map(
        (server) =>
          new Promise<void>((resolve) => {
            if (!server.listening) resolve();
            else server.close(() => resolve());
          }),
      ),
    );
  }
}
