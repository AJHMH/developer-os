import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { DeliveryController } from "../dist/controller.js";

function fixture(t) {
  const root = fs.realpathSync(
    fs.mkdtempSync(join(tmpdir(), "aios-storage-race-")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "repo"),
    state = join(root, "state");
  fs.mkdirSync(repository);
  const controller = new DeliveryController(state);
  const owner = controller.start({
    repository,
    request: "First synthetic feature",
  });
  return { root, repository, state, controller, owner };
}

test(
  "a removed SQLite WAL observed during admission does not reject a queued request",
  { skip: process.platform === "win32" },
  (t) => {
    const f = fixture(t),
      wal = join(f.state, "deliveries.sqlite-wal");
    fs.writeFileSync(wal, "");
    const original = fs.lstatSync;
    let observed = false;
    t.mock.method(fs, "lstatSync", function (path, ...args) {
      if (path === wal && !observed) {
        observed = true;
        const fd = fs.openSync(wal, "r");
        try {
          fs.unlinkSync(wal);
          const removed = fs.fstatSync(fd);
          assert.equal(removed.nlink, 0);
          return removed;
        } finally {
          fs.closeSync(fd);
        }
      }
      return Reflect.apply(original, this, [path, ...args]);
    });
    syncBuiltinESMExports();
    t.after(() => {
      t.mock.restoreAll();
      syncBuiltinESMExports();
    });
    const queued = f.controller.start({
      repository: f.repository,
      request: "Second synthetic feature",
    });
    assert.equal(observed, true);
    assert.equal(queued.phase, "queued");
    assert.equal(queued.ownership.held, false);
    const deliveries = f.controller.list().deliveries;
    assert.equal(deliveries.length, 2);
    assert.deepEqual(
      deliveries.filter((d) => d.ownership.held).map((d) => d.id),
      [f.owner.id],
    );
  },
);

function removedInode(path) {
  fs.writeFileSync(path, "");
  const fd = fs.openSync(path, "r");
  try {
    fs.unlinkSync(path);
    const entry = fs.fstatSync(fd);
    assert.equal(entry.nlink, 0);
    return entry;
  } finally {
    fs.closeSync(fd);
  }
}
function observeRemoved(t, path, entry, replace, repeat = false) {
  const original = fs.lstatSync;
  let first = true;
  t.mock.method(fs, "lstatSync", function (observed, ...args) {
    if (observed === path && (first || repeat)) {
      first = false;
      replace?.();
      return entry;
    }
    return Reflect.apply(original, this, [observed, ...args]);
  });
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
}
const posixUnlink = {
  skip:
    process.platform === "win32"
      ? "Requires a POSIX unlinked-open-inode observation"
      : false,
};
for (const replacement of ["hard-link", "symbolic-link", "ambiguous-again"]) {
  test(
    `a removed sidecar replaced by ${replacement} still refuses admission`,
    posixUnlink,
    (t) => {
      const f = fixture(t),
        wal = join(f.state, "deliveries.sqlite-wal");
      const entry = removedInode(wal),
        outside = join(f.root, "outside.txt");
      fs.writeFileSync(outside, "owner fixture");
      observeRemoved(
        t,
        wal,
        entry,
        replacement === "hard-link"
          ? () => fs.linkSync(outside, wal)
          : replacement === "symbolic-link"
            ? () => fs.symlinkSync(outside, wal)
            : undefined,
        replacement === "ambiguous-again",
      );
      assert.throws(
        () =>
          f.controller.start({
            repository: f.repository,
            request: "Refused synthetic feature",
          }),
        /ordinary files and directories/i,
      );
      t.mock.restoreAll();
      syncBuiltinESMExports();
      fs.rmSync(wal, { force: true });
      assert.equal(fs.readFileSync(outside, "utf8"), "owner fixture");
      assert.deepEqual(
        f.controller.list().deliveries.map((d) => d.id),
        [f.owner.id],
      );
    },
  );
}
test(
  "a reappearing ordinary SHM sidecar is revalidated before queueing",
  posixUnlink,
  (t) => {
    const f = fixture(t),
      shm = join(f.state, "deliveries.sqlite-shm");
    const entry = removedInode(shm);
    observeRemoved(t, shm, entry, () => fs.writeFileSync(shm, ""));
    const queued = f.controller.start({
      repository: f.repository,
      request: "Second synthetic feature",
    });
    assert.equal(queued.phase, "queued");
    assert.equal(queued.ownership.held, false);
    assert.equal(f.controller.status(f.owner.id).ownership.held, true);
  },
);
test(
  "an unlinked main ledger observation is never treated as a disposable sidecar",
  posixUnlink,
  (t) => {
    const f = fixture(t),
      ledger = join(f.state, "deliveries.sqlite"),
      bytes = fs.readFileSync(ledger);
    const fd = fs.openSync(ledger, "r");
    let entry;
    try {
      fs.unlinkSync(ledger);
      entry = fs.fstatSync(fd);
      assert.equal(entry.nlink, 0);
    } finally {
      fs.closeSync(fd);
    }
    fs.writeFileSync(ledger, bytes);
    observeRemoved(t, ledger, entry);
    assert.throws(
      () =>
        f.controller.start({
          repository: f.repository,
          request: "Refused replacement ledger",
        }),
      /ordinary files and directories/i,
    );
    t.mock.restoreAll();
    syncBuiltinESMExports();
    assert.deepEqual(
      f.controller.list().deliveries.map((d) => d.id),
      [f.owner.id],
    );
  },
);
test("a linked SQLite sidecar is refused on every platform", (t) => {
  const f = fixture(t),
    outside = join(f.root, "outside.txt"),
    wal = join(f.state, "deliveries.sqlite-wal");
  fs.writeFileSync(outside, "owner fixture");
  fs.linkSync(outside, wal);
  assert.throws(
    () =>
      f.controller.start({
        repository: f.repository,
        request: "Refused linked sidecar",
      }),
    /ordinary files and directories/i,
  );
  fs.unlinkSync(wal);
  assert.equal(fs.readFileSync(outside, "utf8"), "owner fixture");
  assert.deepEqual(
    f.controller.list().deliveries.map((d) => d.id),
    [f.owner.id],
  );
});

import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
for (const holdMs of [100, 6000, -100])
  test(
    holdMs === 100
      ? "a brief writer between migration and WAL configuration still queues the next request"
      : holdMs === 6000
        ? "persistent journal contention refuses within the existing five-second lock budget"
        : "a busy storage result returned after its lock budget refuses without a new retry",
    async (t) => {
      const f = fixture(t),
        ledger = join(f.state, "deliveries.sqlite");
      // Published SQLite intake may still use its default rollback journal.
      const previous = new DatabaseSync(ledger);
      previous.exec("PRAGMA journal_mode=DELETE;");
      previous.close();
      const signal = new Int32Array(new SharedArrayBuffer(4));
      const worker = new Worker(
        new URL(
          "data:text/javascript," +
            encodeURIComponent(`
    import {DatabaseSync} from 'node:sqlite';
    import {workerData,parentPort} from 'node:worker_threads';
    const signal=new Int32Array(workerData.signal);
    const db=new DatabaseSync(workerData.ledger,{timeout:5000});
    try {
      parentPort.postMessage('ready');
      Atomics.wait(signal,0,0,5000);
      db.exec('BEGIN IMMEDIATE');
      Atomics.store(signal,0,2);Atomics.notify(signal,0);
      Atomics.wait(signal,0,2,workerData.holdMs);
      db.exec('COMMIT');
    } finally {db.close();}
  `),
        ),
        {
          workerData: {
            ledger,
            signal: signal.buffer,
            holdMs: Math.abs(holdMs),
          },
        },
      );
      const closed = new Promise((resolve, reject) => {
        worker.on("error", reject);
        worker.on("exit", (code) =>
          code === 0 ? resolve() : reject(Error("Writer fixture failed")),
        );
      });
      await new Promise((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
      });
      const original = DatabaseSync.prototype.exec;
      let interposed = false;
      t.mock.method(DatabaseSync.prototype, "exec", function (sql) {
        if (!interposed && /PRAGMA\s+journal_mode\s*=/i.test(sql)) {
          interposed = true;
          Atomics.store(signal, 0, 1);
          Atomics.notify(signal, 0);
          while (Atomics.load(signal, 0) !== 2) {
            if (Atomics.wait(signal, 0, 1, 5000) === "timed-out")
              throw Error("Writer did not acquire fixture lock");
          }
        }
        try {
          return Reflect.apply(original, this, [sql]);
        } catch (error) {
          if (holdMs < 0 && /PRAGMA\s+journal_mode\s*=/i.test(sql))
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5010);
          throw error;
        }
      });
      let queued, failure;
      const started = performance.now();
      let elapsedMs;
      try {
        queued = f.controller.start({
          repository: f.repository,
          request: "Second synthetic feature",
        });
      } catch (error) {
        failure = error;
      } finally {
        elapsedMs = performance.now() - started;
        t.mock.restoreAll();
        await closed;
      }
      assert.equal(interposed, true);
      if (holdMs === 100) {
        assert.ifError(failure);
        assert.equal(queued.phase, "queued");
        assert.equal(queued.ownership.held, false);
      } else {
        assert.equal(failure?.errcode, 5);
        assert.ok(
          elapsedMs >= 4500 && elapsedMs < 6000,
          `Refused after ${elapsedMs} ms`,
        );
        assert.equal(f.controller.list().deliveries.length, 1);
      }
      assert.deepEqual(
        f.controller
          .list()
          .deliveries.filter((d) => d.ownership.held)
          .map((d) => d.id),
        [f.owner.id],
      );
    },
  );

for (const failureKind of ["sqlite-readonly", "unclassified-storage"]) {
  test(`${failureKind} failure refuses admission without retrying journal configuration`, (t) => {
    const f = fixture(t);
    let fault;
    if (failureKind === "sqlite-readonly") {
      const readonly = new DatabaseSync(join(f.state, "deliveries.sqlite"), {
        readOnly: true,
      });
      try {
        readonly.exec("CREATE TABLE refused_write(id INTEGER)");
      } catch (error) {
        fault = error;
      } finally {
        readonly.close();
      }
    } else {
      try {
        fs.readFileSync(join(f.root, "missing-storage-entry"));
      } catch (error) {
        fault = error;
      }
    }
    assert.ok(fault instanceof Error);
    const original = DatabaseSync.prototype.exec;
    let attempts = 0;
    t.mock.method(DatabaseSync.prototype, "exec", function (sql) {
      if (/PRAGMA\s+journal_mode\s*=/i.test(sql)) {
        attempts++;
        throw fault;
      }
      return Reflect.apply(original, this, [sql]);
    });
    assert.throws(
      () =>
        f.controller.start({
          repository: f.repository,
          request: "Refused failed storage",
        }),
      (error) => error === fault,
    );
    assert.equal(attempts, 1);
    t.mock.restoreAll();
    assert.deepEqual(
      f.controller.list().deliveries.map((d) => d.id),
      [f.owner.id],
    );
  });
}
test("a directory cannot replace a SQLite sidecar", (t) => {
  const f = fixture(t),
    wal = join(f.state, "deliveries.sqlite-wal");
  fs.mkdirSync(wal);
  assert.throws(
    () =>
      f.controller.start({
        repository: f.repository,
        request: "Refused directory sidecar",
      }),
    /ordinary files and directories/i,
  );
  fs.rmdirSync(wal);
  assert.deepEqual(
    f.controller.list().deliveries.map((d) => d.id),
    [f.owner.id],
  );
});
