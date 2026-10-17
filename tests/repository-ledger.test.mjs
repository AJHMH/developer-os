import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import {
  RepositoryLedger,
  repositoryIdentity,
} from "../dist/repository-ledger.js";

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-ledger-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const state = join(root, "state"),
    repository = join(root, "repo");
  mkdirSync(repository);
  const ledger = new RepositoryLedger(state);
  const delivery = (key = repositoryIdentity(repository)) => ({
    id: randomUUID(),
    repository,
    request: "Preserve work",
    issue: null,
    phase: "blocked",
    ownership: { held: false, fence: 0, key },
  });
  return { state, repository, ledger, delivery };
}

test("ledger admits one owner, preserves queue order across reopen, and hands off atomically", (t) => {
  const f = fixture(t),
    first = f.ledger.admit(f.delivery()),
    second = f.ledger.admit(f.delivery()),
    third = f.ledger.admit(f.delivery());
  assert.equal(first.ownership.held, true);
  assert.equal(second.phase, "queued");
  assert.equal(third.phase, "queued");
  const reopened = new RepositoryLedger(f.state);
  reopened.update(first.id, (delivery, ownership) => {
    delivery.phase = "cancelled";
    ownership.release();
  });
  assert.equal(reopened.read(second.id).ownership.held, true);
  assert.equal(reopened.read(second.id).ownership.fence, 3);
  assert.equal(reopened.read(third.id).ownership.held, false);
  assert.equal(reopened.read(first.id).ownership.held, false);
  assert.equal(
    JSON.parse(readFileSync(f.ledger.requestArtifact(first.id), "utf8"))
      .deliveryId,
    first.id,
  );
});

test("a failed fence CAS rolls back both ownership and document updates", (t) => {
  const f = fixture(t),
    first = f.ledger.admit(f.delivery());
  assert.throws(
    () =>
      f.ledger.update(first.id, (delivery, ownership) => {
        delivery.request = "uncommitted";
        delivery.ownership.fence++;
        ownership.advanceFence();
      }),
    /ownership changed/,
  );
  assert.deepEqual(f.ledger.read(first.id), first);
  const changed = f.ledger.update(first.id, (_delivery, ownership) =>
    ownership.advanceFence(),
  );
  assert.equal(changed.ownership.fence, 2);
});

test("failed document admission removes its new artifact and preserves the prior owner", (t) => {
  const f = fixture(t),
    first = f.ledger.admit(f.delivery());
  const invalid = f.delivery();
  invalid.request = BigInt(1);
  assert.throws(() => f.ledger.admit(invalid));
  assert.equal(existsSync(f.ledger.requestArtifact(invalid.id)), false);
  assert.deepEqual(f.ledger.list(), [first]);
});

test("legacy SQLite migration conservatively grants one owner and queues duplicate repositories", (t) => {
  const f = fixture(t);
  mkdirSync(f.state);
  const first = f.delivery(),
    second = f.delivery();
  delete first.ownership;
  delete second.ownership;
  const db = new DatabaseSync(join(f.state, "deliveries.sqlite"));
  db.exec(
    "CREATE TABLE deliveries (id TEXT PRIMARY KEY, document TEXT NOT NULL); PRAGMA user_version = 1",
  );
  for (const item of [first, second])
    db.prepare("INSERT INTO deliveries VALUES (?, ?)").run(
      item.id,
      JSON.stringify(item),
    );
  db.close();
  assert.equal(f.ledger.read(first.id).ownership.held, true);
  assert.equal(f.ledger.read(second.id).phase, "queued");
  assert.equal(f.ledger.list().length, 2);
});
