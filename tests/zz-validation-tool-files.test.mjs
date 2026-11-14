// #275: owner-pinned tool files, such as Prisma's schema engines, which a
// real repository's install downloads from the network. The host fetches and
// verifies each; the guest copies them into each install and check home.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import {
  fetchToolFiles,
  httpsFileReader,
  toolFileLimits,
  toolPath,
  toolUrl,
  validToolFiles,
} from "../dist/tool-files.js";
import {
  attemptFiles,
  runRequest,
  validationGuest,
} from "./helpers/native-validation-fixture.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const engine = Buffer.from("schema engine binary\n");
const engineUrl =
  "https://binaries.prisma.sh/all_commits/e922089b7d7502aff4249d5da3420f6fa55fc6ad/linux-arm64-openssl-1.1.x/schema-engine.gz";
const enginePath =
  ".cache/prisma/master/e922089b7d7502aff4249d5da3420f6fa55fc6ad/linux-arm64-openssl-1.1.x/schema-engine";
const declared = () => [
  {
    url: engineUrl,
    sha256: sha256(engine),
    path: enginePath,
    gzip: true,
    executable: true,
  },
];
const reader =
  (answers = {}) =>
  async (url) =>
    answers[url] ?? { status: 200, bytes: gzipSync(engine) };

test("tool files are plain https URLs, pinned digests and plain home paths", () => {
  assert.equal(validToolFiles(declared()), true);
  assert.equal(validToolFiles([]), true);
  for (const url of [
    "http://binaries.prisma.sh/x",
    "https://user:pw@binaries.prisma.sh/x",
    "https://binaries.prisma.sh:8443/x",
    "https://binaries.prisma.sh/x?y=1",
    "https://binaries.prisma.sh/x#y",
    "https://binaries.prisma.sh/a/../x",
    "not a url",
    `https://binaries.prisma.sh/${"x".repeat(2000)}`,
    7,
  ])
    assert.equal(toolUrl(url), false, url);
  for (const path of [
    "",
    "/etc/x",
    "a/../b",
    "./a",
    "a b",
    "a;b",
    "$HOME/x",
    "a/",
  ])
    assert.equal(toolPath(path), false, path);
  for (const bad of [
    [{ ...declared()[0], sha256: "x" }],
    [{ ...declared()[0], gzip: false }],
    [{ ...declared()[0], extra: 1 }],
    [declared()[0], declared()[0]],
    Array.from({ length: 33 }, (_, i) => ({ ...declared()[0], path: `t${i}` })),
    [declared()[0], "x"],
    "x",
  ])
    assert.equal(validToolFiles(bad), false, JSON.stringify(bad).slice(0, 80));
});

test("the host admits tool files only when every one matches its digest", async () => {
  const fetched = await fetchToolFiles(declared(), { reader: reader() });
  assert.deepEqual(fetched, [
    {
      sha256: sha256(engine),
      path: enginePath,
      executable: true,
      bytes: engine,
    },
  ]);
  for (const [answer, reason] of [
    [{ status: 302, bytes: Buffer.alloc(0) }, /response/],
    [{ status: 200, bytes: gzipSync(Buffer.from("other")) }, /integrity/],
    [{ status: 200, bytes: Buffer.from("not gzip") }, /size/],
    [{ status: 200, bytes: gzipSync(engine), encoding: "br" }, /response/],
  ])
    await assert.rejects(
      fetchToolFiles(declared(), { reader: reader({ [engineUrl]: answer }) }),
      reason,
    );
  await assert.rejects(
    fetchToolFiles(declared(), {
      reader: async () => {
        throw Error("ECONNRESET");
      },
    }),
    /unavailable/,
  );
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    fetchToolFiles(declared(), { reader: reader(), signal: cancelled.signal }),
    /cancelled/,
  );
  await assert.rejects(
    fetchToolFiles([{ url: "http://x/y" }], { reader: reader() }),
    /declaration/,
  );
  // An uncompressed file is taken as it is.
  const plain = [
    { url: engineUrl.replace(/\.gz$/, ""), sha256: sha256(engine), path: "x" },
  ];
  assert.equal(
    (
      await fetchToolFiles(plain, {
        reader: async () => ({ status: 200, bytes: engine }),
      })
    )[0].executable,
    false,
  );
  assert.equal(toolFileLimits.totalBytes, 128 * 1024 * 1024);
});

test("the host stops a read that is cancelled while it runs", async () => {
  for (const early of [false, true]) {
    const cancel = new AbortController();
    const pending = fetchToolFiles(declared(), {
      // A read that never answers; cancelling it is the only way out.
      reader: () => {
        if (early) cancel.abort();
        return new Promise(() => {});
      },
      signal: cancel.signal,
    });
    if (!early) setImmediate(() => cancel.abort());
    await assert.rejects(pending, /cancelled/);
  }
});

test("the host refuses tool files over the total bound", async () => {
  // Three files each within 64 MiB, together over 128 MiB.
  const bytes = Buffer.alloc(45 * 1024 * 1024, 1);
  const files = ["a", "b", "c"].map((path) => ({
    url: `https://binaries.prisma.sh/${path}`,
    sha256: sha256(bytes),
    path,
  }));
  await assert.rejects(
    fetchToolFiles(files, {
      reader: async () => ({ status: 200, bytes }),
      signal: new AbortController().signal,
    }),
    /size/,
  );
});

test("the https reader refuses anything but a plain https URL before connecting", async () => {
  let requested = false;
  const read = httpsFileReader(() => {
    requested = true;
    throw Error("never");
  });
  await assert.rejects(
    read("http://binaries.prisma.sh/x", AbortSignal.timeout(1000), 10),
    /refused/,
  );
  assert.equal(requested, false);
});

// A stand-in for `https.request`: answers with the given status, headers and
// chunks, or fails the request, without any network.
function fakeRequest({ status = 200, headers = {}, chunks = [], fail } = {}) {
  const seen = { destroyed: false };
  const request = (url, options, onResponse) => {
    seen.url = url;
    seen.options = options;
    const req = new EventEmitter();
    req.end = () =>
      queueMicrotask(() => {
        if (fail) {
          req.emit("error", fail);
          return;
        }
        const res = new EventEmitter();
        res.statusCode = status;
        res.headers = headers;
        res.destroy = (error) => {
          seen.destroyed = true;
          if (error) res.emit("error", error);
        };
        onResponse(res);
        for (const chunk of chunks) {
          if (seen.destroyed) return;
          res.emit("data", Buffer.from(chunk));
        }
        if (!seen.destroyed) res.emit("end");
      });
    return req;
  };
  return { request, seen };
}

test("the https reader returns the body of a plain 200 and the status of anything else", async () => {
  const signal = AbortSignal.timeout(1000);
  const ok = fakeRequest({ chunks: ["schema ", "engine"] });
  assert.deepEqual(await httpsFileReader(ok.request)(engineUrl, signal, 100), {
    status: 200,
    bytes: Buffer.from("schema engine"),
  });
  assert.equal(ok.seen.url, engineUrl);
  assert.equal(ok.seen.options.method, "GET");
  assert.equal(ok.seen.options.headers["accept-encoding"], "identity");
  assert.equal(ok.seen.options.rejectUnauthorized, true);
  assert.equal(ok.seen.options.signal, signal);
  // `identity` is the same as no encoding.
  assert.equal(
    (
      await httpsFileReader(
        fakeRequest({
          headers: { "content-encoding": "identity" },
          chunks: ["x"],
        }).request,
      )(engineUrl, signal, 100)
    ).bytes.toString(),
    "x",
  );
  // A redirect is returned as its status, not followed.
  const moved = fakeRequest({ status: 302, headers: { location: "x" } });
  assert.deepEqual(
    await httpsFileReader(moved.request)(engineUrl, signal, 100),
    { status: 302, bytes: Buffer.alloc(0) },
  );
  assert.equal(moved.seen.destroyed, true);
  // An encoded body is returned with its encoding, for the fetch to refuse.
  assert.deepEqual(
    await httpsFileReader(
      fakeRequest({ headers: { "content-encoding": "gzip" }, chunks: ["x"] })
        .request,
    )(engineUrl, signal, 100),
    { status: 200, bytes: Buffer.alloc(0), encoding: "gzip" },
  );
});

test("the https reader gives up past its size bound and on a failed request", async () => {
  const signal = AbortSignal.timeout(1000);
  const declaredLarge = fakeRequest({ headers: { "content-length": "101" } });
  await assert.rejects(
    httpsFileReader(declaredLarge.request)(engineUrl, signal, 100),
    /refused/,
  );
  assert.equal(declaredLarge.seen.destroyed, true);
  const streamedLarge = fakeRequest({
    chunks: ["x".repeat(60), "x".repeat(60)],
  });
  await assert.rejects(
    httpsFileReader(streamedLarge.request)(engineUrl, signal, 100),
    /refused/,
  );
  assert.equal(streamedLarge.seen.destroyed, true);
  await assert.rejects(
    httpsFileReader(fakeRequest({ fail: Error("ECONNRESET") }).request)(
      engineUrl,
      signal,
      100,
    ),
    /ECONNRESET/,
  );
});

test("the guest copies each verified tool file into the install's and every check's home", async (t) => {
  const g = validationGuest(t);
  const tools = [
    {
      sha256: sha256(engine),
      path: enginePath,
      executable: true,
      bytes: engine,
    },
  ];
  const { files, treeSha256 } = attemptFiles({ "index.html": "<h1>x</h1>\n" });
  const request = runRequest({ files, treeSha256, tools });
  assert.equal((await g.transport.run(request)).exitCode, 0);
  // A second check reuses the upload.
  assert.equal(
    (
      await g.transport.run({
        ...request,
        check: { id: "lint", command: ["true"], timeoutMs: 60000 },
      })
    ).exitCode,
    0,
  );
  assert.equal(
    g.requests.filter((r) => r.action === "tool-put").length,
    1,
    "uploaded once",
  );
  for (const check of g.commands("podman", "create")) {
    const script = check[check.indexOf("-c") + 1];
    assert.ok(
      script.startsWith(
        `( mkdir -p "$HOME/${enginePath.replace(/\/schema-engine$/, "")}" && cp /tools/${sha256(engine)} "$HOME/${enginePath}" && chmod 755 "$HOME/${enginePath}" ) || exit 97; `,
      ),
      script,
    );
    assert.ok(check.some((a) => /\/tools:\/tools:ro,/.test(a)));
  }
  await g.transport.stop(request);
});

test("tool files that don't match their digest, or change within an attempt, are refused", async (t) => {
  const g = validationGuest(t);
  const { files, treeSha256 } = attemptFiles({ "index.html": "<h1>x</h1>\n" });
  await assert.rejects(
    g.transport.run(
      runRequest({
        files,
        treeSha256,
        tools: [
          {
            sha256: "0".repeat(64),
            path: "x",
            executable: false,
            bytes: engine,
          },
        ],
      }),
    ),
    /Unsupported native validation request/,
  );
  for (const tools of [
    [
      {
        sha256: sha256(engine),
        path: "../x",
        executable: false,
        bytes: engine,
      },
    ],
    [
      { sha256: sha256(engine), path: "x", executable: false, bytes: engine },
      { sha256: sha256(engine), path: "x", executable: false, bytes: engine },
    ],
  ])
    await assert.rejects(
      g.transport.run(runRequest({ files, treeSha256, tools })),
      /Unsupported native validation request/,
    );
  assert.equal(g.requests.length, 0);
  // Within one attempt, the manifest is fixed.
  const request = runRequest({
    files,
    treeSha256,
    tools: [
      { sha256: sha256(engine), path: "a", executable: false, bytes: engine },
    ],
  });
  await g.transport.run(request);
  await assert.rejects(
    g.transport.run({
      ...request,
      tools: [
        { sha256: sha256(engine), path: "b", executable: false, bytes: engine },
      ],
      check: { id: "lint", command: ["true"], timeoutMs: 60000 },
    }),
  );
});
