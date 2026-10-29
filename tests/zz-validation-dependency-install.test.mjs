// The controlled dependency phase in the validation guest (Issue 04, D2b):
// the prepared npm cache crosses in chunks, installs offline once per attempt
// in its own container, and each check sees the installed layer read-only.
// The real management program runs in the local guest simulator. The name
// sorts after every other test file, so no other file changes shard.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { dependencyTransfer } from "../dist/podman-validation.js";
import { posixGuest } from "./helpers/native-coding-fixture.mjs";
import {
  attemptFiles,
  runRequest,
  validationGuest,
} from "./helpers/native-validation-fixture.mjs";

const tarball = (text, size) =>
  size ? Buffer.alloc(size, text) : Buffer.from(text);
const cacheFile = (bytes) => ({
  path: createHash("sha512").update(bytes).digest("hex") + ".tgz",
  bytes,
});
const dependencies = (
  files = [cacheFile(tarball("left-pad"))],
  changes = {},
) => ({
  planSha256: "9".repeat(64),
  files,
  installTimeoutMs: 60000,
  ...changes,
});
/** An attempt whose tree carries a lockfile, as a dependency phase needs. */
function lockedRequest(overrides = {}, check = {}) {
  const { files, treeSha256 } = attemptFiles({
    "index.html": "<h1>Contact</h1>\n",
    "package.json": '{"name":"candidate"}\n',
    "package-lock.json": '{"lockfileVersion":3,"packages":{"":{}}}\n',
  });
  return runRequest(
    { files, treeSha256, dependencies: dependencies(), ...overrides },
    check,
  );
}
const actions = (guest) =>
  guest.requests.map((r) => r.action).filter((a) => a !== "inspect");

test(
  "the cache crosses in chunks, installs once, and each check sees it read-only",
  posixGuest,
  async (t) => {
    const guest = validationGuest(t);
    // Larger than one chunk, so it crosses in two.
    const big = cacheFile(tarball("b", dependencyTransfer.chunkBytes + 7));
    const small = cacheFile(tarball("left-pad"));
    const request = lockedRequest({
      dependencies: dependencies([big, small]),
    });
    const first = await guest.transport.run(request);
    assert.equal(first.exitCode, 0);
    assert.equal(first.dependencies.state, "installed");
    // Only the installed layer stays: the install's workspace, the upload
    // and npm's own cache are gone.
    const state = `${guest.root}/.local/state/aios-validation-v1`;
    const [attempt] = readdirSync(state).filter(
      (n) => n.startsWith("aios-validation-") && !n.endsWith(".json"),
    );
    assert.deepEqual(readdirSync(`${state}/${attempt}`).sort(), [
      "deps",
      "input",
    ]);
    assert.match(first.dependencies.layerSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(
      actions(guest).filter((a) => a === "cache-put").length,
      3,
      "two chunks and one",
    );
    const [check] = guest
      .commands("podman", "create")
      .filter((c) => c.includes("--name") && !c.join(" ").includes("npm ci"));
    const volumes = check
      .map((arg, i) => (arg === "--volume" ? check[i + 1] : null))
      .filter(Boolean);
    assert.equal(volumes.length, 2);
    assert.match(
      volumes[1] ?? volumes[0],
      /\/deps:\/workspace\/node_modules:ro,/,
    );
    const install = guest
      .commands("podman", "create")
      .find((c) => c.join(" ").includes("npm ci"));
    assert.ok(install.includes("--network=none"));
    assert.ok(install.includes("--read-only"));
    // A later check in the same attempt reuses the installed layer.
    const before = guest.requests.length;
    const second = await guest.transport.run({
      ...request,
      check: { ...request.check, id: "lint" },
    });
    assert.equal(
      second.dependencies.layerSha256,
      first.dependencies.layerSha256,
    );
    assert.deepEqual(
      guest.requests
        .slice(before)
        .map((r) => r.action)
        .filter((a) => ["cache-put", "install-start"].includes(a)),
      [],
    );
    const stopped = await guest.transport.stop(request);
    assert.equal(
      stopped.treeSha256,
      request.treeSha256,
      "the tree is unchanged",
    );
    assert.equal(
      existsSync(`${guest.root}/.local/state/aios-validation-v1`) &&
        guest.read().containers &&
        Object.keys(guest.read().containers).length,
      0,
    );
  },
);

test(
  "an install script's writes outside node_modules never reach a check",
  posixGuest,
  async (t) => {
    const guest = validationGuest(t, { installWritesInput: true });
    const request = lockedRequest({}, { command: ["present", "index.html"] });
    const result = await guest.transport.run(request);
    assert.equal(result.dependencies.state, "installed");
    assert.equal(result.exitCode, 0);
    assert.equal(
      (await guest.transport.stop(request)).treeSha256,
      request.treeSha256,
    );
  },
);

for (const [name, engine, expected] of [
  ["a failing install", { installExit: 1 }, { exitCode: 1, timedOut: false }],
  [
    "an install that leaves a special file in its layer",
    { installSpecialFile: true },
    { exitCode: 0, timedOut: false },
  ],
  [
    "an install that leaves no node_modules",
    { installNoModules: true },
    { exitCode: 0, timedOut: false },
  ],
  [
    "an install past its deadline",
    // The guest clock passes a 1 s deadline, within the guest's own
    // 15 s command bound.
    { installHang: true, expireAfterStart: 5 },
    { exitCode: 137, timedOut: true },
  ],
])
  test(`${name} fails the check unrun`, posixGuest, async (t) => {
    const guest = validationGuest(t, engine);
    const request = lockedRequest({
      dependencies: dependencies(undefined, { installTimeoutMs: 1000 }),
    });
    const result = await guest.transport.run(request);
    assert.equal(result.dependencies.state, "failed");
    assert.equal(result.dependencies.layerSha256, null);
    assert.equal(result.exitCode, expected.exitCode);
    assert.equal(result.timedOut, expected.timedOut);
    assert.equal(
      guest
        .commands("podman", "create")
        .filter((c) => !c.join(" ").includes("npm ci")).length,
      0,
      "no check container",
    );
    await guest.transport.stop(request);
    assert.deepEqual(Object.keys(guest.read().containers), []);
  });

for (const [name, request, engine] of [
  [
    "an attempt without a lockfile",
    () => runRequest({ dependencies: dependencies() }),
    {},
  ],
  [
    "an attempt that ships node_modules",
    () => {
      const { files, treeSha256 } = attemptFiles({
        "package-lock.json": "{}\n",
        "node_modules/x/index.js": "x\n",
      });
      return runRequest({ files, treeSha256, dependencies: dependencies() });
    },
    {},
  ],
  [
    "a chunk altered in transit",
    () => lockedRequest(),
    { cacheChunkDrift: true },
  ],
  [
    "an attempt carrying a shrinkwrap",
    () => {
      const { files, treeSha256 } = attemptFiles({
        "package-lock.json": "{}\n",
        "npm-shrinkwrap.json": "{}\n",
      });
      return runRequest({ files, treeSha256, dependencies: dependencies() });
    },
    {},
  ],
])
  test(
    `the guest refuses ${name} and installs nothing`,
    posixGuest,
    async (t) => {
      const guest = validationGuest(t, engine);
      const r = request();
      await assert.rejects(guest.transport.run(r));
      assert.deepEqual(
        guest
          .commands("podman", "create")
          .filter((c) => c.join(" ").includes("npm ci")),
        [],
      );
      await guest.transport.stop(r);
    },
  );

test("the host's deadline grace must be a bounded whole number", (t) => {
  for (const deadlineGraceMs of [NaN, -1, 1.5, Infinity, 600001])
    assert.throws(
      () => validationGuest(t, {}, { deadlineGraceMs }),
      /Invalid native validation authority/,
    );
});

test(
  "an upload cut short is never resumed by a later check",
  posixGuest,
  async (t) => {
    const guest = validationGuest(t, { laterChunkDrift: true });
    const big = cacheFile(tarball("b", dependencyTransfer.chunkBytes + 7));
    const request = lockedRequest({ dependencies: dependencies([big]) });
    await assert.rejects(guest.transport.run(request));
    await assert.rejects(
      guest.transport.run({
        ...request,
        check: { ...request.check, id: "lint" },
      }),
      /upload was interrupted/,
    );
    await guest.transport.stop(request);
  },
);

test("malformed dependencies are refused before any guest effect", async (t) => {
  const guest = validationGuest(t);
  const good = cacheFile(tarball("left-pad"));
  for (const deps of [
    dependencies([{ ...good, path: "a".repeat(128) + ".tgz" }]),
    dependencies([good], { installTimeoutMs: 0 }),
    dependencies([good], {
      installTimeoutMs: dependencyTransfer.installTimeoutMs + 1,
    }),
    dependencies([good], { planSha256: "not-a-digest" }),
    dependencies([cacheFile(Buffer.alloc(0))]),
    dependencies([good, good]),
  ])
    await assert.rejects(
      guest.transport.run(lockedRequest({ dependencies: deps })),
      /Unsupported native validation request/,
    );
  assert.deepEqual(guest.requests, []);
});

test("stop ends an install still running", posixGuest, async (t) => {
  const guest = validationGuest(t, { installHang: true });
  const request = lockedRequest();
  const running = guest.transport.run(request).catch((error) => error);
  // Polls see it running until stop kills its container.
  const polls = () =>
    guest.requests.filter((r) => r.action === "install-poll").length;
  for (let i = 0; i < 1000 && polls() < 2; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(polls() >= 2);
  const stopped = await guest.transport.stop(request);
  assert.equal(stopped.stopped, true);
  assert.deepEqual(Object.keys(guest.read().containers), []);
  assert.ok((await running) instanceof Error, "the run ends refused");
});

test(
  "a lost guest deadline cannot keep the host waiting on an install",
  posixGuest,
  async (t) => {
    const guest = validationGuest(
      t,
      { installHang: true, deadlineLost: true },
      { deadlineGraceMs: 20 },
    );
    const request = lockedRequest({
      dependencies: dependencies(undefined, { installTimeoutMs: 1 }),
    });
    await assert.rejects(
      guest.transport.run(request),
      /install outlived its deadline/,
    );
    await guest.transport.stop(request);
    assert.deepEqual(Object.keys(guest.read().containers), []);
  },
);

// The pinned runtime plans the attempt's cache from the candidate lockfile,
// fetches it once on the host and hands it to the transport.
const {
  PinnedValidationRuntime,
  offlineValidationEnvironment,
  preparedNpmValidationEnvironment,
} = await import("../dist/native-validation.js");
const { validationDigest } = await import("../dist/isolated-validation.js");
const runtimePins = Object.freeze({
  imageSha256: "7".repeat(64),
  policySha256: "8".repeat(64),
  bindingSha256: "9".repeat(64),
});
const registry = "https://registry.npmjs.org";
const leftPad = Buffer.from("left-pad tarball\n");
const lockfile = Buffer.from(
  JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": {},
      "node_modules/left-pad": {
        version: "1.0.0",
        resolved: `${registry}/left-pad/-/left-pad-1.0.0.tgz`,
        integrity:
          "sha512-" + createHash("sha512").update(leftPad).digest("base64"),
      },
    },
  }),
);
const layer = "6".repeat(64);
/** A controlled transport answering each run with `answer(request)`. */
function controlled(
  answer = () => ({ state: "installed", layerSha256: layer }),
) {
  const runs = [];
  return {
    runs,
    transport: {
      mode: "controlled",
      async inspect() {
        return { ...runtimePins };
      },
      async run(request) {
        runs.push(request);
        const deps = request.dependencies && answer(request);
        return {
          operationId: request.operationId,
          fence: request.fence,
          checkId: request.check.id,
          exitCode: deps?.state === "failed" ? (deps.exitCode ?? 1) : 0,
          timedOut: deps?.timedOut ?? false,
          pins: { ...runtimePins },
          ...(deps
            ? {
                dependencies: {
                  exitCode: 0,
                  timedOut: false,
                  layerSha256: null,
                  ...deps,
                },
              }
            : {}),
        };
      },
      async stop(attempt) {
        return {
          ...attempt,
          stopped: true,
          remainingProcesses: 0,
          treeSha256: "d".repeat(64),
        };
      },
    },
  };
}
function registryReader(fail = false) {
  const reads = [];
  return {
    reads,
    reader: async (url) => {
      reads.push(url);
      if (fail) throw Error("ECONNRESET");
      return { status: 200, bytes: Buffer.from(leftPad) };
    },
  };
}
function executeRequest(runtime, files, check = {}) {
  return {
    operationId: "11111111-1111-4111-8111-111111111111",
    fence: 1,
    stage: "baseline",
    treeSha256: "d".repeat(64),
    environmentSha256: validationDigest(
      preparedNpmValidationEnvironment(runtimePins.imageSha256),
    ),
    bindingSha256: runtime.bindingSha256,
    check: {
      id: "format",
      kind: "format",
      scope: "local",
      stages: ["baseline"],
      command: ["true"],
      publisher: "isolated-checker",
      timeoutMs: 90000,
      ...check,
    },
    files,
    mayDispatch: () => true,
  };
}
const lockedFiles = [
  { path: "package-lock.json", bytes: lockfile, executable: false },
];

test("a dependency runtime declares the prepared npm environment, not the offline one", async () => {
  const { transport } = controlled();
  const runtime = new PinnedValidationRuntime(
    runtimePins,
    transport,
    undefined,
    {
      reader: registryReader().reader,
    },
  );
  const { environment } = await runtime.inspect();
  assert.deepEqual(
    environment,
    preparedNpmValidationEnvironment(runtimePins.imageSha256),
  );
  assert.deepEqual(environment.registries, [registry]);
  assert.notEqual(
    validationDigest(environment),
    validationDigest(offlineValidationEnvironment(runtimePins.imageSha256)),
  );
});

test("the runtime fetches an attempt's cache once and hands each check the same install", async () => {
  const { transport, runs } = controlled();
  const { reader, reads } = registryReader();
  const runtime = new PinnedValidationRuntime(
    runtimePins,
    transport,
    undefined,
    {
      reader,
    },
  );
  const first = await runtime.execute(executeRequest(runtime, lockedFiles));
  const second = await runtime.execute(
    executeRequest(runtime, lockedFiles, { id: "lint", kind: "lint" }),
  );
  assert.deepEqual(reads, [`${registry}/left-pad/-/left-pad-1.0.0.tgz`]);
  assert.equal(runs.length, 2);
  const deps = runs[0].dependencies;
  assert.match(deps.planSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    deps.files.map((f) => f.path),
    [createHash("sha512").update(leftPad).digest("hex") + ".tgz"],
  );
  assert.equal(deps.installTimeoutMs, 90000, "the check's own bound");
  assert.equal(runs[1].dependencies.planSha256, deps.planSha256);
  for (const result of [first, second]) {
    assert.equal(result.status, "success");
    assert.deepEqual(result.artifacts, [
      { name: "npm-cache-plan", sha256: deps.planSha256 },
      { name: "npm-dependency-layer", sha256: layer },
    ]);
  }
  // After stop, a new run of the attempt fetches again.
  await runtime.stop(executeRequest(runtime, lockedFiles));
  await runtime.execute(executeRequest(runtime, lockedFiles));
  assert.equal(reads.length, 2);
});

for (const [name, answer, status] of [
  ["a failed install", () => ({ state: "failed", exitCode: 1 }), "failure"],
  [
    "an install that exited cleanly but left an unadmittable layer",
    () => ({ state: "failed", exitCode: 0 }),
    "failure",
  ],
  [
    "an install past its deadline",
    () => ({ state: "failed", exitCode: 137, timedOut: true }),
    "timeout",
  ],
])
  test(`${name} becomes the check's ${status}`, async () => {
    const { transport } = controlled(answer);
    const runtime = new PinnedValidationRuntime(
      runtimePins,
      transport,
      undefined,
      {
        reader: registryReader().reader,
      },
    );
    const result = await runtime.execute(executeRequest(runtime, lockedFiles));
    assert.equal(result.status, status);
    assert.deepEqual(result.artifacts, []);
  });

for (const [name, files, fail, status] of [
  ["no lockfile", [], false, "failure"],
  [
    "a lockfile naming another registry",
    [
      {
        path: "package-lock.json",
        bytes: Buffer.from(
          lockfile
            .toString()
            .replaceAll(registry, "https://registry.example.com"),
        ),
        executable: false,
      },
    ],
    false,
    "failure",
  ],
  ["an unreachable registry", lockedFiles, true, "cancelled"],
])
  test(`${name} leaves the check unrun as ${status}`, async () => {
    const { transport, runs } = controlled();
    const runtime = new PinnedValidationRuntime(
      runtimePins,
      transport,
      undefined,
      {
        reader: registryReader(fail).reader,
      },
    );
    const result = await runtime.execute(executeRequest(runtime, files));
    assert.equal(result.status, status);
    assert.equal(runs.length, 0);
  });

test("authority lost while the cache is fetched refuses before the transport runs", async () => {
  const { transport, runs } = controlled();
  const runtime = new PinnedValidationRuntime(
    runtimePins,
    transport,
    undefined,
    {
      reader: registryReader().reader,
    },
  );
  let calls = 0;
  const request = executeRequest(runtime, lockedFiles);
  request.mayDispatch = () => ++calls === 1;
  await assert.rejects(
    runtime.execute(request),
    /Validation execution refused/,
  );
  assert.equal(runs.length, 0);
});

test("a transport result without the attempt's install is untrusted", async () => {
  const { transport } = controlled(() => undefined);
  const runtime = new PinnedValidationRuntime(
    runtimePins,
    transport,
    undefined,
    {
      reader: registryReader().reader,
    },
  );
  await assert.rejects(
    runtime.execute(executeRequest(runtime, lockedFiles)),
    /Untrusted validation result/,
  );
  const { transport: layerless } = controlled(() => ({
    state: "installed",
    layerSha256: null,
  }));
  const strict = new PinnedValidationRuntime(
    runtimePins,
    layerless,
    undefined,
    {
      reader: registryReader().reader,
    },
  );
  await assert.rejects(
    strict.execute(executeRequest(strict, lockedFiles)),
    /Untrusted validation result/,
  );
});
