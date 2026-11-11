// Disposable databases in the validation guest (#265): a fresh PostgreSQL
// from the owner-admitted image per E2E check, ready before the check starts,
// reachable only on the loopback of the network namespace the check shares
// with it, and removed when the check ends. The real management program runs
// in the local guest simulator, whose host mocks stay in this file. The name
// sorts after every other test file, so no other file changes shard.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  runRequest,
  validationGuest,
} from "./helpers/native-validation-fixture.mjs";

const database = "5".repeat(64);
const dbGuest = (t, engine = {}) =>
  validationGuest(t, engine, {
    databaseImageSha256: database,
    deadlineGraceMs: 0,
  });
const created = (guest) =>
  guest
    .commands("podman", "create")
    .map((c) => ({ name: c[c.indexOf("--name") + 1], args: c }));
const value = (args, flag) =>
  args.find((a) => a.startsWith(flag + "="))?.slice(flag.length + 1);
const envs = (args) =>
  args.map((a, i) => (a === "--env" ? args[i + 1] : null)).filter(Boolean);

test("an E2E check gets its own ready database on a shared loopback, removed with it", async (t) => {
  const guest = dbGuest(t);
  const request = runRequest(
    { database: true },
    { id: "e2e", command: ["database"] },
  );
  const result = await guest.transport.run(request);
  assert.equal(result.database, "ready");
  assert.equal(result.exitCode, 0, "the database ran during the check");
  assert.equal(result.pins.databaseImageSha256, database);
  const [db, check] = created(guest);
  assert.match(db.name, /-d0$/);
  assert.match(check.name, /-c0$/);
  // The database: the admitted image, offline, its data on the tmpfs.
  assert.ok(db.args.includes(database));
  assert.equal(value(db.args, "--network"), "none");
  assert.ok(db.args.includes("--read-only"));
  // The image's own data volume is never mounted.
  assert.ok(db.args.includes("--image-volume=ignore"));
  assert.match(value(db.args, "--tmpfs"), /size=536870912$/);
  assert.match(
    db.args.at(-1),
    /^set -e; initdb .* exec postgres .*-h 127\.0\.0\.1/,
  );
  // The check joins only that database's network namespace, by its ID.
  assert.equal(
    value(check.args, "--network"),
    "container:" + createHash("sha256").update(db.name).digest("hex"),
  );
  assert.equal(value(check.args, "--hostname"), undefined);
  assert.deepEqual(
    envs(check.args).filter((e) => /^(PG|DATABASE_URL)/.test(e)),
    [
      "PGHOST=127.0.0.1",
      "PGPORT=5432",
      "PGUSER=aios",
      "PGDATABASE=postgres",
      "DATABASE_URL=postgresql://aios@127.0.0.1:5432/postgres",
    ],
  );
  // The guest waited for it, inside the database container.
  assert.ok(
    guest
      .commands("podman", "exec")
      .every((c) => c[2] === db.name && c[3] === "pg_isready"),
  );
  assert.ok(guest.commands("podman", "exec").length >= 1);
  // Both are gone once the check ends.
  assert.deepEqual(Object.keys(guest.read().containers), []);
  assert.equal(
    (await guest.transport.stop(request)).treeSha256,
    request.treeSha256,
  );
});

test("each E2E check gets a fresh database, and other checks get none", async (t) => {
  const guest = dbGuest(t);
  const request = runRequest({ database: true }, { id: "e2e-1" });
  await guest.transport.run(request);
  await guest.transport.run({
    ...request,
    check: { ...request.check, id: "e2e-2" },
  });
  const plain = await guest.transport.run({
    ...request,
    database: undefined,
    check: { ...request.check, id: "lint" },
  });
  assert.equal(plain.database, undefined);
  const names = created(guest).map((c) => c.name.replace(/^.*-/, ""));
  assert.deepEqual(names, ["d0", "c0", "d1", "c1", "c2"]);
  assert.equal(value(created(guest).at(-1).args, "--network"), "none");
  await guest.transport.stop(request);
});

for (const [name, engine] of [
  ["never answers", { databaseUnready: true }],
  ["exits at start", { databaseExits: true }],
])
  test(`a database that ${name} leaves its check unrun`, async (t) => {
    const guest = dbGuest(t, engine);
    const request = runRequest({ database: true }, { id: "e2e" });
    const result = await guest.transport.run(request);
    assert.equal(result.database, "unready");
    assert.equal(result.exitCode, 125);
    assert.equal(result.timedOut, false);
    // No check container was ever created, and the database is gone.
    assert.deepEqual(
      created(guest).map((c) => c.name.replace(/^.*-/, "")),
      ["d0"],
    );
    assert.deepEqual(Object.keys(guest.read().containers), []);
    // The attempt goes on: a later check still runs.
    const next = await guest.transport.run({
      ...request,
      database: undefined,
      check: { ...request.check, id: "lint" },
    });
    assert.equal(next.exitCode, 0);
    assert.equal(
      (await guest.transport.stop(request)).treeSha256,
      request.treeSha256,
    );
  });

test("a check joined to another network namespace is refused, and stop removes its database", async (t) => {
  const guest = dbGuest(t, { databaseIdDrift: true });
  const request = runRequest({ database: true }, { id: "e2e" });
  await assert.rejects(
    guest.transport.run(request),
    /Native validation start observation unavailable/,
  );
  assert.equal(Object.keys(guest.read().containers).length, 2);
  const stopped = await guest.transport.stop(request);
  assert.equal(stopped.stopped, true);
  assert.deepEqual(Object.keys(guest.read().containers), []);
});

test("stop ends a running E2E check and its database", async (t) => {
  const guest = dbGuest(t, { expireAfterStart: 0 });
  const request = runRequest(
    { database: true },
    { id: "e2e", command: ["hang"], timeoutMs: 1 },
  );
  // The check outlives its guest deadline only when the timer is lost.
  guest.write({ deadlineLost: true });
  await assert.rejects(guest.transport.run(request), /outlived its deadline/);
  assert.equal(Object.keys(guest.read().containers).length, 2);
  await guest.transport.stop(request);
  assert.deepEqual(Object.keys(guest.read().containers), []);
});

test("a transport admits a database image only when it is loaded, for the guest's architecture", async (t) => {
  const plain = validationGuest(t);
  const withDb = dbGuest(t);
  const [a, b] = [
    await plain.transport.inspect(),
    await withDb.transport.inspect(),
  ];
  assert.equal(a.databaseImageSha256, undefined);
  assert.equal(b.databaseImageSha256, database);
  assert.notEqual(a.bindingSha256, b.bindingSha256);
  assert.equal(a.policySha256, b.policySha256);
  for (const engine of [
    { databaseImageMissing: true },
    { databaseArch: "amd64" },
  ])
    await assert.rejects(
      dbGuest(t, engine).transport.inspect(),
      /observation unavailable/,
    );
  // A transport without one never asks for a database.
  await assert.rejects(
    plain.transport.run(runRequest({ database: true })),
    /Unsupported native validation request/,
  );
  assert.throws(
    () => validationGuest(t, {}, { databaseImageSha256: "short" }).transport,
    /Invalid native validation authority/,
  );
});
