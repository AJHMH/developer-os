// #275: a real web application's checks write build and test output, and
// write into node_modules (Prisma's client, Vite's temporary config). The
// owner contract declares the outputs, which the tree measurement skips;
// each check gets its own copy of the installed layer, which stays unchanged.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  attemptFiles,
  runRequest,
  validationGuest,
} from "./helpers/native-validation-fixture.mjs";

const lock = '{"lockfileVersion":3,"packages":{"":{}}}\n';
const tgz = Buffer.from("left-pad tarball\n");
const sha512 = createHash("sha512").update(tgz).digest("hex");
const dependencies = () => ({
  planSha256: "5".repeat(64),
  files: [{ path: `${sha512}.tgz`, bytes: tgz }],
  installTimeoutMs: 60000,
});
const tree = () =>
  attemptFiles({
    "index.html": "<h1>Contact</h1>\n",
    "package.json": '{"name":"candidate"}\n',
    "package-lock.json": lock,
  });

test("writes into declared outputs leave the tested tree unchanged; any other write changes it", async (t) => {
  const g = validationGuest(t);
  const { files, treeSha256 } = tree();
  const outputPaths = [".svelte-kit", "coverage"];
  const request = runRequest({ files, treeSha256, outputPaths });
  const run = (id, command) =>
    g.transport.run({
      ...request,
      check: { id, command, timeoutMs: 60000 },
    });
  assert.equal(
    (await run("type", ["write", ".svelte-kit/types/x.d.ts", "x"])).exitCode,
    0,
  );
  assert.equal(
    (await run("coverage", ["write", "coverage/lcov.info", "x"])).exitCode,
    0,
  );
  assert.equal((await g.transport.stop(request)).treeSha256, treeSha256);

  const h = validationGuest(t);
  const other = runRequest(
    { ...tree(), outputPaths },
    { id: "build", command: ["write", "build/out.js", "x"] },
  );
  await h.transport.run(other);
  assert.notEqual((await h.transport.stop(other)).treeSha256, other.treeSha256);
});

test("an output may not hold or lie under an input file, on the host or in the guest", async (t) => {
  const g = validationGuest(t);
  for (const outputPaths of [
    ["index.html"],
    ["package.json/x"],
    ["node_modules"],
    ["../out"],
    [".git"],
    ["a", "a"],
    Array.from({ length: 33 }, (_, i) => `o${i}`),
  ])
    await assert.rejects(
      g.transport.run(runRequest({ ...tree(), outputPaths })),
      /Unsupported native validation request/,
      JSON.stringify(outputPaths),
    );
  assert.equal(g.requests.length, 0);
});

test("each check writes into its own node_modules copy; the layer and the tree stay unchanged", async (t) => {
  const g = validationGuest(t);
  const { files, treeSha256 } = tree();
  const attempt = runRequest({
    files,
    treeSha256,
    dependencies: dependencies(),
  });
  const request = (id, command) => ({
    ...attempt,
    check: { id, command, timeoutMs: 60000 },
  });
  const first = await g.transport.run(
    request("check", [
      "write",
      "node_modules/.prisma/client/index.js",
      "generated",
    ]),
  );
  assert.equal(first.exitCode, 0);
  // The next check gets a fresh copy of the unchanged layer.
  const second = await g.transport.run(
    request("lint", ["absent", "node_modules/.prisma/client/index.js"]),
  );
  assert.equal(second.exitCode, 0);
  assert.equal(second.dependencies.layerSha256, first.dependencies.layerSha256);
  const installed = await g.transport.run(
    request("build", ["present", "node_modules/.bin/tool"]),
  );
  assert.equal(
    installed.exitCode,
    1,
    "a link, not a file: the copy keeps links",
  );
  const stopped = await g.transport.stop(request("x", ["true"]));
  assert.equal(stopped.treeSha256, treeSha256);
});
