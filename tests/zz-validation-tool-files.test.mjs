// #275: owner-pinned tool files, such as Prisma's schema engines, which a
// real repository's install downloads from the network. The host fetches and
// verifies each; the guest copies them into each install and check home.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
