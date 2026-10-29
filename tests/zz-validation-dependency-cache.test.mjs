// The prepared npm dependency cache (Issue 04, controlled dependency phase):
// a bounded fetch plan read from the candidate's lockfile as data, and a host
// fetch that admits only the exact tarballs the plan names. The name sorts
// after every other test file, so no other file changes shard.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { Agent as HttpsAgent, globalAgent } from "node:https";
import { test } from "node:test";
import {
  dependencyCacheLimits,
  fetchNpmCache,
  httpsRegistryReader,
  npmCachePlan,
} from "../dist/dependency-cache.js";

const registry = "https://registry.npmjs.org";
const tarball = (name) => Buffer.from(`tarball of ${name}\n`);
const integrity = (bytes) =>
  "sha512-" + createHash("sha512").update(bytes).digest("base64");
const entry = (name, version = "1.0.0", changes = {}) => {
  const file = name.split("/").at(-1);
  return {
    version,
    resolved: `${registry}/${name}/-/${file}-${version}.tgz`,
    integrity: integrity(tarball(name)),
    ...changes,
  };
};
const lockfile = (packages, changes = {}) =>
  Buffer.from(
    JSON.stringify({
      name: "candidate",
      lockfileVersion: 3,
      requires: true,
      packages: {
        "": { name: "candidate", version: "0.0.0" },
        ...packages,
      },
      ...changes,
    }),
  );
const ordinary = () =>
  lockfile({
    "node_modules/left-pad": entry("left-pad"),
    "node_modules/@scope/util": entry("@scope/util", "2.1.0", { dev: true }),
    "node_modules/@scope/util/node_modules/left-pad": entry("left-pad"),
    "node_modules/bundled-thing": { version: "1.0.0", inBundle: true },
  });

test("a candidate lockfile becomes a bounded plan of exact registry tarballs", () => {
  const plan = npmCachePlan(ordinary());
  assert.equal(plan.registry, registry);
  assert.match(plan.lockfileSha256, /^[a-f0-9]{64}$/);
  assert.match(plan.planSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    plan.artifacts.map((a) => a.path),
    ["/@scope/util/-/util-2.1.0.tgz", "/left-pad/-/left-pad-1.0.0.tgz"],
    "sorted, deduplicated, bundled entries skipped",
  );
  for (const artifact of plan.artifacts)
    assert.match(artifact.sha512, /^[a-f0-9]{128}$/);
  assert.equal(npmCachePlan(ordinary()).planSha256, plan.planSha256);
  assert.notEqual(
    npmCachePlan(
      lockfile({ "node_modules/left-pad": entry("left-pad", "1.0.1") }),
    ).planSha256,
    plan.planSha256,
  );
});

test("registry package names keep their case", () => {
  const plan = npmCachePlan(
    lockfile({ "node_modules/JSONStream": entry("JSONStream", "1.3.5") }),
  );
  assert.deepEqual(
    plan.artifacts.map((a) => a.path),
    ["/JSONStream/-/JSONStream-1.3.5.tgz"],
  );
});

test("a lockfile without dependencies plans an empty cache", () => {
  assert.deepEqual(npmCachePlan(lockfile({})).artifacts, []);
});

for (const [name, bytes] of [
  ["malformed JSON", Buffer.from("{")],
  ["an old lockfile version", lockfile({}, { lockfileVersion: 1 })],
  ["no packages", lockfile({}, { packages: undefined })],
  [
    "another registry",
    lockfile({
      "node_modules/x": entry("x", "1.0.0", {
        resolved: "https://registry.example.com/x/-/x-1.0.0.tgz",
      }),
    }),
  ],
  [
    "plain http",
    lockfile({
      "node_modules/x": entry("x", "1.0.0", {
        resolved: "http://registry.npmjs.org/x/-/x-1.0.0.tgz",
      }),
    }),
  ],
  [
    "a git dependency",
    lockfile({
      "node_modules/x": entry("x", "1.0.0", {
        resolved: "git+ssh://git@github.com/a/x.git#abc",
      }),
    }),
  ],
  [
    "a file dependency",
    lockfile({
      "node_modules/x": entry("x", "1.0.0", { resolved: "file:../x" }),
    }),
  ],
  [
    "a workspace link",
    lockfile({ "node_modules/x": { resolved: "packages/x", link: true } }),
  ],
  [
    "a query or fragment in the URL",
    lockfile({
      "node_modules/x": entry("x", "1.0.0", {
        resolved: `${registry}/x/-/x-1.0.0.tgz?redirect=1`,
      }),
    }),
  ],
  [
    "a traversing path",
    lockfile({
      "node_modules/x": entry("x", "1.0.0", {
        resolved: `${registry}/x/-/../../evil.tgz`,
      }),
    }),
  ],
  [
    "an explicit port",
    lockfile({
      "node_modules/x": entry("x", "1.0.0", {
        resolved: "https://registry.npmjs.org:443/x/-/x-1.0.0.tgz",
      }),
    }),
  ],
  [
    "an encoded dot segment",
    lockfile({
      "node_modules/x": entry("x", "1.0.0", {
        resolved: `${registry}/x/-/%2e%2e/x-1.0.0.tgz`,
      }),
    }),
  ],
  [
    "credentials in the URL",
    lockfile({
      "node_modules/x": entry("x", "1.0.0", {
        resolved: "https://user:secret@registry.npmjs.org/x/-/x-1.0.0.tgz",
      }),
    }),
  ],
  [
    "no integrity",
    lockfile({
      "node_modules/x": entry("x", "1.0.0", { integrity: undefined }),
    }),
  ],
  [
    "only a sha1 integrity",
    lockfile({
      "node_modules/x": entry("x", "1.0.0", {
        integrity: "sha1-" + Buffer.alloc(20).toString("base64"),
      }),
    }),
  ],
  [
    "an oversized integrity",
    lockfile({
      "node_modules/x": entry("x", "1.0.0", {
        integrity: integrity(tarball("x")) + " a".repeat(600),
      }),
    }),
  ],
  [
    "a malformed sha512",
    lockfile({
      "node_modules/x": entry("x", "1.0.0", { integrity: "sha512-abc" }),
    }),
  ],
  [
    "one tarball under two integrities",
    lockfile({
      "node_modules/x": entry("x"),
      "node_modules/y/node_modules/x": entry("x", "1.0.0", {
        integrity: integrity(Buffer.from("other")),
      }),
    }),
  ],
  ["a package outside node_modules", lockfile({ "lib/x": entry("x") })],
])
  test(`a lockfile with ${name} is refused`, () => {
    assert.throws(() => npmCachePlan(bytes), /lockfile/i);
  });

test("the plan's bounds refuse oversized lockfiles and too many artifacts", () => {
  assert.throws(
    () => npmCachePlan(Buffer.alloc(dependencyCacheLimits.lockfileBytes + 1)),
    /lockfile/i,
  );
  const many = {};
  for (let i = 0; i <= dependencyCacheLimits.artifacts; i++)
    many[`node_modules/p${i}`] = entry(`p${i}`);
  assert.throws(() => npmCachePlan(lockfile(many)), /lockfile/i);
});

/** A registry reader serving `served` (path -> bytes), recording requests. */
function registryReader(served, changes = {}) {
  const requested = [];
  const reader = async (url, signal, maxBytes) => {
    requested.push(url);
    assert.ok(signal instanceof AbortSignal);
    assert.ok(maxBytes > 0 && maxBytes <= dependencyCacheLimits.artifactBytes);
    const path = new URL(url).pathname;
    const bytes = served.get(path);
    if (!bytes) return { status: 404, bytes: Buffer.alloc(0) };
    return { status: 200, bytes: Buffer.from(bytes), ...changes };
  };
  return { reader, requested };
}
const servedFor = (plan, override = {}) =>
  new Map(
    plan.artifacts.map((a) => {
      const name = a.path.split("/-/")[0].slice(1);
      return [a.path, override[a.path] ?? tarball(name)];
    }),
  );

test("the host fetches exactly the planned tarballs and verifies each sha512", async () => {
  const plan = npmCachePlan(ordinary());
  const { reader, requested } = registryReader(servedFor(plan));
  const cache = await fetchNpmCache(plan, { reader });
  assert.deepEqual(
    requested.sort(),
    plan.artifacts.map((a) => registry + a.path).sort(),
  );
  assert.equal(cache.planSha256, plan.planSha256);
  assert.deepEqual(
    cache.files.map((f) => f.path),
    plan.artifacts.map((a) => `${a.sha512}.tgz`),
    "content-addressed by sha512",
  );
  for (const [i, file] of cache.files.entries())
    assert.equal(
      createHash("sha512").update(file.bytes).digest("hex"),
      plan.artifacts[i].sha512,
    );
  assert.equal(
    cache.bytes,
    cache.files.reduce((n, f) => n + f.bytes.length, 0),
  );
});

for (const [name, arrange] of [
  [
    "a tarball whose bytes differ from its integrity",
    (plan) =>
      registryReader(
        servedFor(plan, { [plan.artifacts[0].path]: Buffer.from("tampered") }),
      ),
  ],
  ["a missing tarball", () => registryReader(new Map())],
  [
    "a registry that cannot be reached",
    () => ({
      reader: async () => {
        throw Error("ECONNRESET");
      },
    }),
  ],
  [
    "a compressed response",
    (plan) => registryReader(servedFor(plan), { encoding: "gzip" }),
  ],
])
  test(`the cache is refused for ${name}`, async () => {
    const plan = npmCachePlan(ordinary());
    const { reader } = arrange(plan);
    await assert.rejects(fetchNpmCache(plan, { reader }), /dependency/i);
  });

test("a tarball over the size bound or a run over the total bound is refused", async () => {
  const plan = npmCachePlan(ordinary());
  const big = Buffer.alloc(dependencyCacheLimits.artifactBytes + 1);
  const path = plan.artifacts[0].path;
  const tooBig = { ...plan, artifacts: [{ ...plan.artifacts[0] }] };
  await assert.rejects(
    fetchNpmCache(tooBig, {
      reader: registryReader(new Map([[path, big]])).reader,
    }),
    /dependency/i,
  );
  await assert.rejects(
    fetchNpmCache(plan, {
      reader: registryReader(servedFor(plan)).reader,
      totalBytes: 1,
    }),
    /dependency/i,
  );
});

test("a changed plan is refused before any request", async () => {
  const plan = npmCachePlan(ordinary());
  const { reader, requested } = registryReader(servedFor(plan));
  for (const changed of [
    { ...plan, registry: "https://registry.example.com" },
    {
      ...plan,
      artifacts: [
        ...plan.artifacts,
        { path: "/x/-/x-1.0.0.tgz", sha512: "a".repeat(128) },
      ],
    },
    { ...plan, planSha256: "f".repeat(64) },
  ])
    await assert.rejects(fetchNpmCache(changed, { reader }), /dependency/i);
  assert.deepEqual(requested, []);
});

test("one tarball reached through two paths is one cache file", async () => {
  const bytes = tarball("same");
  const same = { integrity: integrity(bytes) };
  const plan = npmCachePlan(
    lockfile({
      "node_modules/a": entry("a", "1.0.0", same),
      "node_modules/b": entry("b", "1.0.0", same),
    }),
  );
  const served = new Map(plan.artifacts.map((a) => [a.path, bytes]));
  const cache = await fetchNpmCache(plan, {
    reader: registryReader(served).reader,
  });
  assert.equal(cache.files.length, 1);
  assert.equal(cache.bytes, bytes.length);
});

test("a plan path with dot segments is refused before any request", async () => {
  const plan = npmCachePlan(ordinary());
  const { reader, requested } = registryReader(servedFor(plan));
  const artifacts = [{ path: "/../-/x.tgz", sha512: "a".repeat(128) }];
  const { createHash: hash } = await import("node:crypto");
  // Recomputing the digest does not make an unsafe path acceptable.
  const planSha256 = hash("sha256")
    .update(
      JSON.stringify({
        registry: plan.registry,
        lockfileSha256: plan.lockfileSha256,
        artifacts,
      }),
    )
    .digest("hex");
  await assert.rejects(
    fetchNpmCache({ ...plan, artifacts, planSha256 }, { reader }),
    /dependency/i,
  );
  assert.deepEqual(requested, []);
});

test(
  "a reader that ignores cancellation cannot hold the fetch open",
  { timeout: 5000 },
  async () => {
    const plan = npmCachePlan(ordinary());
    const cancellation = new AbortController();
    const reader = () => {
      setTimeout(() => cancellation.abort(), 5);
      return new Promise(() => {});
    };
    await assert.rejects(
      fetchNpmCache(plan, { reader, signal: cancellation.signal }),
      /cancelled/,
    );
  },
);

test("a fetch cancelled before it starts makes no request", async () => {
  const plan = npmCachePlan(ordinary());
  const { reader, requested } = registryReader(servedFor(plan));
  const cancellation = new AbortController();
  cancellation.abort();
  await assert.rejects(
    fetchNpmCache(plan, { reader, signal: cancellation.signal }),
    /cancelled/,
  );
  assert.deepEqual(requested, []);
});

test("a cancelled fetch stops and admits nothing", async () => {
  const plan = npmCachePlan(ordinary());
  const cancellation = new AbortController();
  let calls = 0;
  const reader = async (_url, signal) => {
    calls++;
    cancellation.abort();
    assert.ok(signal.aborted);
    return { status: 200, bytes: Buffer.alloc(0) };
  };
  await assert.rejects(
    fetchNpmCache(plan, { reader, signal: cancellation.signal }),
    /dependency/i,
  );
  assert.equal(calls, 1);
});

test("v1 bounds a cache at 2048 tarballs and 128 MiB", () => {
  assert.equal(dependencyCacheLimits.artifacts, 2048);
  assert.equal(dependencyCacheLimits.totalBytes, 128 * 1024 * 1024);
});

/** A local stand-in for the registry, reached through the reader's injected
 * request function; `respond` answers each request. */
async function localRegistry(t, respond) {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ path: req.url, headers: req.headers });
    respond(req, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address();
  // The reader's own https agent and certificate checking are asserted,
  // then left out: the stand-in speaks plain http.
  const request = (
    url,
    { agent, rejectUnauthorized, ...options },
    callback,
  ) => {
    assert.ok(agent instanceof HttpsAgent && agent !== globalAgent);
    assert.equal(rejectUnauthorized, true);
    return httpRequest(
      `http://127.0.0.1:${port}${new URL(url).pathname}`,
      options,
      callback,
    );
  };
  return { reader: httpsRegistryReader(request), seen };
}
const tarballUrl = `${registry}/x/-/x-1.0.0.tgz`;
const never = () => new AbortController().signal;

test("the registry reader returns the body uncompressed and asks for identity", async (t) => {
  const { reader, seen } = await localRegistry(t, (_req, res) =>
    res.end("tarball bytes"),
  );
  const read = await reader(tarballUrl, never(), 1024);
  assert.equal(read.status, 200);
  assert.equal(read.bytes.toString(), "tarball bytes");
  assert.equal(read.encoding, undefined);
  assert.equal(seen[0].path, "/x/-/x-1.0.0.tgz");
  assert.equal(seen[0].headers["accept-encoding"], "identity");
});

test("the registry reader reports a redirect or compression instead of following it", async (t) => {
  const redirect = await localRegistry(t, (_req, res) => {
    res.writeHead(302, { location: "https://elsewhere.example/x.tgz" });
    res.end();
  });
  const moved = await redirect.reader(tarballUrl, never(), 1024);
  assert.equal(moved.status, 302);
  assert.equal(redirect.seen.length, 1, "never followed");
  const gzip = await localRegistry(t, (_req, res) => {
    res.writeHead(200, { "content-encoding": "gzip" });
    res.end("x");
  });
  assert.equal((await gzip.reader(tarballUrl, never(), 1024)).encoding, "gzip");
});

test("an explicit identity encoding is read like none", async (t) => {
  const { reader } = await localRegistry(t, (_req, res) => {
    res.writeHead(200, { "content-encoding": "identity" });
    res.end("plain");
  });
  const read = await reader(tarballUrl, never(), 1024);
  assert.equal(read.bytes.toString(), "plain");
});

test("the registry reader stops reading past its byte bound", async (t) => {
  // Chunked, with no declared length, so only the running count stops it.
  const { reader } = await localRegistry(t, (_req, res) => {
    res.writeHead(200);
    res.write(Buffer.alloc(4096));
    res.end();
  });
  await assert.rejects(reader(tarballUrl, never(), 1024), /registry/i);
});

test("the registry reader refuses a declared length over its bound before reading", async (t) => {
  const { reader } = await localRegistry(t, (_req, res) => {
    res.writeHead(200, { "content-length": "4096" });
    res.write("x");
  });
  await assert.rejects(reader(tarballUrl, never(), 1024), /registry/i);
});

test("the registry reader stops when aborted before any response", async (t) => {
  const { reader } = await localRegistry(t, () => {});
  const cancellation = new AbortController();
  const reading = reader(tarballUrl, cancellation.signal, 1024);
  setTimeout(() => cancellation.abort(), 20);
  await assert.rejects(reading);
});

test("each read is bounded by what is left of the total", async () => {
  const plan = npmCachePlan(ordinary());
  const bounds = [];
  const { reader } = registryReader(servedFor(plan));
  await fetchNpmCache(plan, {
    reader: (url, signal, maxBytes) => {
      bounds.push(maxBytes);
      return reader(url, signal, maxBytes);
    },
    totalBytes: 1000,
  });
  assert.equal(bounds[0], 1000);
  assert.ok(bounds[1] < 1000, "the second read gets only the remainder");
});

test("the registry reader stops when its signal aborts", async (t) => {
  const { reader } = await localRegistry(t, (_req, res) => {
    res.writeHead(200);
    res.write("partial");
  });
  const cancellation = new AbortController();
  const reading = reader(tarballUrl, cancellation.signal, 1024);
  setTimeout(() => cancellation.abort(), 20);
  await assert.rejects(reading);
});

test("the registry reader refuses any URL but a registry tarball before connecting", async (t) => {
  const { reader, seen } = await localRegistry(t, (_req, res) => res.end());
  for (const url of [
    "https://registry.example.com/x/-/x-1.0.0.tgz",
    // The same length as the registry origin, so only the prefix check
    // tells it apart.
    "https://registry.npmjs.orx/x/-/x-1.0.0.tgz",
    `${registry}/x`,
    `${registry}/x/-/x-1.0.0.tgz?y=1`,
  ])
    await assert.rejects(reader(url, never(), 1024), /registry/i);
  assert.deepEqual(seen, []);
});
