// Disposable databases for E2E checks (#265): the owner's validation record
// may admit a PostgreSQL image, the runtime gives one to E2E checks where the
// contract declares a database, and production admission names it with the
// other validation pins. Guest behavior is in zz-validation-database-guest.
// The name sorts after every other test file, so no other file changes shard.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { validationDigest } from "../dist/isolated-validation.js";
import {
  PinnedValidationRuntime,
  offlineValidationEnvironment,
  ownerValidationAdmission,
  sameValidationPins,
  validationBindingSha256,
  validationPinKeys,
} from "../dist/native-validation.js";
import {
  nativeValidationRuntime,
  ownerPolicyDeclaresDatabase,
} from "../dist/native-validation-runtime.js";
import { ownerProductionAdmission } from "../dist/production-admission.js";
const image = "7".repeat(64);

const database = "5".repeat(64);
// The runtime: E2E checks get a database where the contract declares one.
const pins = Object.freeze({
  imageSha256: image,
  policySha256: "8".repeat(64),
  bindingSha256: "9".repeat(64),
  databaseImageSha256: database,
});
const { databaseImageSha256: _db, ...plainPins } = pins;
function controlled(answer = (request) => request.database && "ready") {
  const runs = [];
  return {
    runs,
    transport: {
      mode: "controlled",
      async inspect() {
        return { ...pins };
      },
      async run(request) {
        runs.push(request);
        const db = answer(request);
        return {
          operationId: request.operationId,
          fence: request.fence,
          checkId: request.check.id,
          exitCode: db === "unready" ? 125 : 0,
          timedOut: false,
          pins: { ...pins },
          ...(db ? { database: db } : {}),
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
const environment = { ...offlineValidationEnvironment(image), database: true };
function execute(runtime, check = {}) {
  return runtime.execute({
    operationId: "11111111-1111-4111-8111-111111111111",
    fence: 1,
    stage: "baseline",
    treeSha256: "d".repeat(64),
    environmentSha256: validationDigest(runtime.environment),
    bindingSha256: runtime.bindingSha256,
    check: {
      id: "e2e",
      kind: "e2e",
      scope: "local",
      stages: ["baseline"],
      command: ["true"],
      publisher: "isolated-checker",
      timeoutMs: 60000,
      ...check,
    },
    files: [],
    mayDispatch: () => true,
  });
}

test("a database runtime declares a database and needs the admitted image", async () => {
  const { transport } = controlled();
  const runtime = new PinnedValidationRuntime(pins, transport, undefined, {
    database: true,
  });
  assert.deepEqual((await runtime.inspect()).environment, environment);
  assert.throws(
    () =>
      new PinnedValidationRuntime(plainPins, transport, undefined, {
        database: true,
      }),
    /Unqualified validation transport/,
  );
  // With the image admitted but no database declared, there is none.
  const offline = new PinnedValidationRuntime(pins, transport);
  assert.equal(offline.environment.database, false);
});

test("only E2E checks get a database, and each names the admitted image", async () => {
  const { transport, runs } = controlled();
  const runtime = new PinnedValidationRuntime(pins, transport, undefined, {
    database: true,
  });
  const e2e = await execute(runtime);
  const lint = await execute(runtime, { id: "lint", kind: "lint" });
  assert.deepEqual(
    runs.map((r) => r.database),
    [true, undefined],
  );
  assert.equal(e2e.status, "success");
  assert.deepEqual(e2e.artifacts, [
    { name: "postgres-image", sha256: database },
  ]);
  assert.deepEqual(lint.artifacts, []);
});

test("an unready database fails its check", async () => {
  const { transport } = controlled(() => "unready");
  const runtime = new PinnedValidationRuntime(pins, transport, undefined, {
    database: true,
  });
  const result = await execute(runtime);
  assert.equal(result.status, "failure");
  assert.deepEqual(result.artifacts, []);
});

for (const [name, answer, check] of [
  ["an E2E result without its database", () => undefined, {}],
  ["an E2E result with another database state", () => "maybe", {}],
  [
    "a database for a check that asked for none",
    () => "ready",
    { kind: "lint" },
  ],
])
  test(`${name} is untrusted`, async () => {
    const { transport } = controlled(answer);
    const runtime = new PinnedValidationRuntime(pins, transport, undefined, {
      database: true,
    });
    await assert.rejects(
      execute(runtime, check),
      /Untrusted validation result/,
    );
  });

test("the database image changes the validation binding only when admitted", () => {
  assert.notEqual(
    validationBindingSha256(pins),
    validationBindingSha256(plainPins),
  );
  // Without one, the binding is the one records made before databases.
  assert.equal(
    validationBindingSha256(plainPins),
    validationDigest({
      scope: "aios-native-validation-runtime-v1",
      pins: plainPins,
    }),
  );
  assert.deepEqual(validationPinKeys(pins), [
    "imageSha256",
    "policySha256",
    "bindingSha256",
    "databaseImageSha256",
  ]);
  assert.equal(sameValidationPins(pins, plainPins), false);
  assert.equal(sameValidationPins(plainPins, { ...plainPins }), true);
});

// Owner records: the database image is optional, and checked when present.
function ownerFile(t, name, value) {
  const directory = mkdtempSync(join(tmpdir(), "aios-database-admission-"));
  t.after(() => rmSync(directory, { recursive: true }));
  chmodSync(directory, 0o700);
  const path = join(directory, name);
  writeFileSync(
    path,
    typeof value === "string" ? value : JSON.stringify(value),
    {
      mode: 0o600,
    },
  );
  return path;
}
const validationRecord = (t, recordPins) =>
  ownerFile(t, "validation-admission.json", {
    scope: "aios-native-validation-admission-v1",
    approvedAt: "2026-11-11T00:00:00.000Z",
    pins: recordPins,
  });

test("a validation record may admit a database image", (t) => {
  assert.deepEqual(
    ownerValidationAdmission(validationRecord(t, pins)).pins(),
    pins,
  );
  assert.deepEqual(
    ownerValidationAdmission(validationRecord(t, plainPins)).pins(),
    plainPins,
  );
  for (const bad of [
    { ...pins, databaseImageSha256: "short" },
    { ...pins, browserImageSha256: database },
    { ...plainPins, bindingSha256: undefined },
  ])
    assert.throws(
      () => ownerValidationAdmission(validationRecord(t, bad)).pins(),
      /Owner validation admission is missing or invalid/,
    );
});

test("the CLI's runtime gets the record's database image only when the contract declares a database", (t) => {
  const record = validationRecord(t, pins);
  const runtime = nativeValidationRuntime("aios-test", record, {
    database: true,
  });
  assert.equal(runtime.environment.database, true);
  assert.equal(runtime.pins.databaseImageSha256, database);
  assert.equal(
    nativeValidationRuntime("aios-test", record).environment.database,
    false,
  );
  assert.throws(
    () =>
      nativeValidationRuntime("aios-test", validationRecord(t, plainPins), {
        database: true,
      }),
    /Unqualified validation transport/,
  );
  const policy = (environment) =>
    ownerFile(t, "owner-policy.json", { validationContract: { environment } });
  assert.equal(ownerPolicyDeclaresDatabase(policy({ database: true })), true);
  assert.equal(ownerPolicyDeclaresDatabase(policy({ database: false })), false);
  assert.equal(ownerPolicyDeclaresDatabase(policy({ database: "yes" })), false);
  assert.equal(ownerPolicyDeclaresDatabase(undefined), false);
  assert.equal(
    ownerPolicyDeclaresDatabase(ownerFile(t, "broken.json", "{")),
    false,
  );
});

test("a production admission names the database image with the other validation pins", (t) => {
  const coding = {
    cliVersion: "2.1.311",
    cliSha256: "c".repeat(64),
    policySha256: "d".repeat(64),
    bindingSha256: "e".repeat(64),
  };
  const report = (validation) =>
    JSON.stringify({
      scope: "native-worker-offline-qualification",
      outcome: "observed-offline-worker-qualification",
      buildFresh: true,
      sourceDirty: false,
      pins: { coding, validation },
    });
  const record = (reportText, validation) => {
    const reportPath = ownerFile(t, "qualification.json", reportText);
    const sha = createHash("sha256").update(reportText).digest("hex");
    return ownerFile(t, "production-admission.json", {
      scope: "aios-production-admission-v1",
      approvedAt: "2026-11-11T00:00:00.000Z",
      qualificationReport: reportPath,
      qualificationSha256: sha,
      pins: { coding, validation },
    });
  };
  const admitted = ownerProductionAdmission(
    record(report(pins), pins),
  ).admitted();
  assert.equal(admitted.validationBindingSha256, validationBindingSha256(pins));
  // A record and report must agree on the database image too.
  for (const [reported, named] of [
    [plainPins, pins],
    [pins, plainPins],
    [{ ...pins, databaseImageSha256: "4".repeat(64) }, pins],
  ])
    assert.throws(
      () =>
        ownerProductionAdmission(record(report(reported), named)).admitted(),
      /Owner production admission is missing or invalid/,
    );
});

// The acceptance: its query client against a minimal PostgreSQL stand-in.
function fakePostgres(t, respond) {
  const queries = [];
  const server = createServer((socket) => {
    let started = false;
    const message = (type, body = Buffer.alloc(0)) => {
      const head = Buffer.alloc(5);
      head.write(type);
      head.writeInt32BE(body.length + 4, 1);
      socket.write(Buffer.concat([head, body]));
    };
    // A client that exits at once resets its connection.
    socket.on("error", () => {});
    socket.on("data", (data) => {
      if (!started) {
        started = true;
        // Like a fresh `initdb -U aios`: that one user, and only the
        // databases initdb creates.
        const pairs = data.subarray(8).toString().split("\0");
        const params = Object.fromEntries(
          pairs.flatMap((v, i) => (i % 2 ? [] : [[v, pairs[i + 1]]])),
        );
        if (
          params.user !== "aios" ||
          !["postgres", "template1"].includes(params.database)
        ) {
          message("E", Buffer.from("SFATAL\0C3D000\0\0"));
          socket.end();
          return;
        }
        const auth = Buffer.alloc(4);
        message("R", auth);
        message("Z", Buffer.from("I"));
        return;
      }
      const sql = data.subarray(5, data.length - 1).toString();
      queries.push(sql);
      const answer = respond(sql);
      if (answer === "error") message("E", Buffer.from("SERROR\0\0"));
      else if (answer !== undefined) {
        const field = Buffer.from(answer);
        const row = Buffer.alloc(6);
        row.writeInt16BE(1, 0);
        row.writeInt32BE(field.length, 2);
        message("D", Buffer.concat([row, field]));
      }
      message("C", Buffer.from("SELECT 1\0"));
      message("Z", Buffer.from("I"));
    });
  });
  t.after(() => server.close());
  return new Promise((accept) =>
    server.listen(0, "127.0.0.1", () =>
      accept({ port: server.address().port, queries }),
    ),
  );
}
/** Run `command` as a check would, against the stand-in on `port`, with the
 * guest's database variables (or `database` instead of its own). */
const runQuery = (command, port, database = "postgres") =>
  new Promise((accept) => {
    const child = spawn(command[0], command.slice(1), {
      env: {
        PATH: process.env.PATH,
        PGHOST: "127.0.0.1",
        PGPORT: String(port),
        PGUSER: "aios",
        PGDATABASE: database,
      },
      stdio: "ignore",
    });
    child.on("exit", (code) => accept(code));
  });

test("the acceptance's query client speaks the PostgreSQL protocol from node alone", async (t) => {
  const { postgresQuery, databaseChecks } = await import(
    "../scripts/run-native-validation-admission-acceptance.mjs"
  );
  const server = await fakePostgres(t, (sql) =>
    sql.startsWith("SELECT")
      ? "t"
      : sql.startsWith("BAD")
        ? "error"
        : undefined,
  );
  assert.equal(await runQuery(databaseChecks.database, server.port), 0);
  assert.equal(
    await runQuery(databaseChecks["database-fresh"], server.port),
    0,
  );
  // A different first value, or an error, fails the check.
  assert.equal(await runQuery(postgresQuery("SELECT 1", "f"), server.port), 1);
  assert.equal(await runQuery(postgresQuery("BAD"), server.port), 1);
  assert.deepEqual(server.queries, [
    "CREATE TABLE aios_marker (id int)",
    "SELECT to_regclass('aios_marker') IS NULL",
    "SELECT 1",
    "BAD",
  ]);
  // A database initdb never created refuses the connection.
  assert.equal(await runQuery(databaseChecks.database, server.port, "aios"), 1);
  // No server at all fails it too.
  const gone = createServer();
  await new Promise((done) => gone.listen(0, "127.0.0.1", done));
  const { port } = gone.address();
  await new Promise((done) => gone.close(done));
  assert.equal(await runQuery(databaseChecks.database, port), 1);
  // Every command fits the contract's argument bounds.
  for (const command of Object.values(databaseChecks))
    assert.ok(
      command.every(
        (arg) => arg.length <= 2000 && !/[\u0000-\u001f]/.test(arg),
      ),
    );
});
