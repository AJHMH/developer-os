// #275: the owner contract's fields for a real repository: the install
// image's C library, so the prepared npm cache keeps only that platform's
// optional packages; and the outputs a check may write.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

test("an owner contract may name its install image's libc, and nothing else there (#275)", async (t) => {
  const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { validationContract } = await import("../dist/isolated-validation.js");
  const { ownerValidationContract } = await import(
    "./helpers/validation-fixture.mjs"
  );
  const { ownerPolicyDeclaredLibc } = await import(
    "../dist/native-validation-runtime.js"
  );
  const root = mkdtempSync(join(tmpdir(), "aios-libc-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "policy.json");
  const write = (libc) => {
    const contract = ownerValidationContract();
    if (libc !== undefined) contract.environment.libc = libc;
    const text = JSON.stringify({
      requiredChecks: ["pr-ci"],
      validationContract: contract,
    });
    writeFileSync(path, text);
    return createHash("sha256").update(text).digest("hex");
  };
  assert.equal(
    validationContract(path, write("glibc")).environment.libc,
    "glibc",
  );
  assert.equal(ownerPolicyDeclaredLibc(path), "glibc");
  assert.equal(
    validationContract(path, write("musl")).environment.libc,
    "musl",
  );
  assert.equal(
    Object.hasOwn(
      validationContract(path, write(undefined)).environment,
      "libc",
    ),
    false,
  );
  assert.equal(ownerPolicyDeclaredLibc(path), undefined);
  assert.throws(
    () => validationContract(path, write("bionic")),
    /Invalid validation environment/,
  );
  assert.equal(ownerPolicyDeclaredLibc(path), undefined);
});

test("the owner contract declares outputs, and the runtime hands them to every check", async (t) => {
  const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { validationContract, validationDigest } = await import(
    "../dist/isolated-validation.js"
  );
  const { PinnedValidationRuntime, offlineValidationEnvironment } =
    await import("../dist/native-validation.js");
  const { ownerValidationContract } = await import(
    "./helpers/validation-fixture.mjs"
  );
  const root = mkdtempSync(join(tmpdir(), "aios-outputs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "policy.json");
  const write = (outputPaths) => {
    const contract = ownerValidationContract();
    if (outputPaths !== undefined) contract.outputPaths = outputPaths;
    const text = JSON.stringify({
      requiredChecks: ["pr-ci"],
      validationContract: contract,
    });
    writeFileSync(path, text);
    return createHash("sha256").update(text).digest("hex");
  };
  const declared = validationContract(path, write([".svelte-kit", "coverage"]));
  assert.deepEqual(declared.outputPaths, [".svelte-kit", "coverage"]);
  assert.equal(
    Object.hasOwn(validationContract(path, write([])), "outputPaths"),
    false,
  );
  for (const bad of [["node_modules"], [".env"], ["a/"], "x", [1]])
    assert.throws(
      () => validationContract(path, write(bad)),
      /Invalid owner validation contract/,
      JSON.stringify(bad),
    );

  const pins = {
    imageSha256: "7".repeat(64),
    policySha256: "8".repeat(64),
    bindingSha256: "9".repeat(64),
  };
  const runs = [];
  const runtime = new PinnedValidationRuntime(pins, {
    mode: "controlled",
    async inspect() {
      return { ...pins };
    },
    async run(request) {
      runs.push(request);
      return {
        operationId: request.operationId,
        fence: request.fence,
        checkId: request.check.id,
        exitCode: 0,
        timedOut: false,
        pins: { ...pins },
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
  });
  const environment = offlineValidationEnvironment(pins.imageSha256);
  await runtime.execute({
    operationId: "11111111-1111-4111-8111-111111111111",
    fence: 1,
    stage: "baseline",
    treeSha256: "d".repeat(64),
    environmentSha256: validationDigest(environment),
    bindingSha256: runtime.bindingSha256,
    contract: declared,
    check: {
      id: "type",
      kind: "type",
      scope: "local",
      stages: ["baseline"],
      command: ["true"],
      publisher: "isolated-checker",
      timeoutMs: 1000,
    },
    files: [],
    mayDispatch: () => true,
  });
  assert.deepEqual(runs[0].outputPaths, [".svelte-kit", "coverage"]);
});

test("the owner contract pins tool files, and the runtime fetches them once per attempt for every check", async (t) => {
  const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { gzipSync } = await import("node:zlib");
  const { validationContract, validationDigest } = await import(
    "../dist/isolated-validation.js"
  );
  const { PinnedValidationRuntime, offlineValidationEnvironment } =
    await import("../dist/native-validation.js");
  const { ownerValidationContract } = await import(
    "./helpers/validation-fixture.mjs"
  );
  const { ownerPolicyDeclaresToolFiles } = await import(
    "../dist/native-validation-runtime.js"
  );
  const engine = Buffer.from("engine\n");
  const toolFiles = [
    {
      url: "https://binaries.prisma.sh/x/linux-arm64-openssl-3.0.x/schema-engine.gz",
      sha256: createHash("sha256").update(engine).digest("hex"),
      path: ".cache/prisma/master/x/linux-arm64-openssl-3.0.x/schema-engine",
      gzip: true,
      executable: true,
    },
  ];
  const root = mkdtempSync(join(tmpdir(), "aios-tools-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "policy.json");
  const write = (value) => {
    const contract = ownerValidationContract();
    if (value !== undefined) contract.toolFiles = value;
    const text = JSON.stringify({
      requiredChecks: ["pr-ci"],
      validationContract: contract,
    });
    writeFileSync(path, text);
    return createHash("sha256").update(text).digest("hex");
  };
  const contract = validationContract(path, write(toolFiles));
  assert.deepEqual(contract.toolFiles, toolFiles);
  assert.equal(ownerPolicyDeclaresToolFiles(path), true);
  assert.throws(
    () =>
      validationContract(path, write([{ ...toolFiles[0], url: "http://x/y" }])),
    /Invalid owner validation contract/,
  );
  write(undefined);
  assert.equal(ownerPolicyDeclaresToolFiles(path), false);

  const pins = {
    imageSha256: "7".repeat(64),
    policySha256: "8".repeat(64),
    bindingSha256: "9".repeat(64),
  };
  const transport = (runs) => ({
    mode: "controlled",
    async inspect() {
      return { ...pins };
    },
    async run(request) {
      runs.push(request);
      return {
        operationId: request.operationId,
        fence: request.fence,
        checkId: request.check.id,
        exitCode: 0,
        timedOut: false,
        pins: { ...pins },
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
  });
  const execute = (runtime, id) =>
    runtime.execute({
      operationId: "11111111-1111-4111-8111-111111111111",
      fence: 1,
      stage: "baseline",
      treeSha256: "d".repeat(64),
      environmentSha256: validationDigest(
        offlineValidationEnvironment(pins.imageSha256),
      ),
      bindingSha256: runtime.bindingSha256,
      contract,
      check: {
        id,
        kind: id,
        scope: "local",
        stages: ["baseline"],
        command: ["true"],
        publisher: "isolated-checker",
        timeoutMs: 1000,
      },
      files: [],
      mayDispatch: () => true,
    });
  const runs = [];
  let reads = 0;
  const runtime = new PinnedValidationRuntime(
    pins,
    transport(runs),
    undefined,
    {
      toolReader: async () => {
        reads++;
        return { status: 200, bytes: gzipSync(engine) };
      },
    },
  );
  assert.equal((await execute(runtime, "format")).status, "success");
  assert.equal((await execute(runtime, "lint")).status, "success");
  assert.equal(reads, 1, "fetched once per attempt");
  assert.deepEqual(
    runs.map((r) => r.tools.map((tool) => [tool.path, tool.bytes.toString()])),
    [[[toolFiles[0].path, "engine\n"]], [[toolFiles[0].path, "engine\n"]]],
  );
  // A runtime that can't fetch them fails the check without running it.
  const none = [];
  const unable = new PinnedValidationRuntime(pins, transport(none));
  assert.equal((await execute(unable, "format")).status, "failure");
  assert.equal(none.length, 0);
  // A fetch that fails leaves it unrun, and the next check fetches again.
  const failing = [];
  let attempts = 0;
  const flaky = new PinnedValidationRuntime(
    pins,
    transport(failing),
    undefined,
    {
      toolReader: async () => {
        if (++attempts === 1) throw Error("ECONNRESET");
        return { status: 200, bytes: gzipSync(engine) };
      },
    },
  );
  assert.equal((await execute(flaky, "format")).status, "cancelled");
  assert.equal((await execute(flaky, "lint")).status, "success");
  assert.equal(failing.length, 1);
});
