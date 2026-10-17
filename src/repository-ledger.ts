import { lstatSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Delivery } from "./controller.js";
import { DeliveryError } from "./errors.js";
import { inspectOnboarding, type OnboardingReport } from "./onboarding.js";

function assertStorageEntry(
  path: string,
  directory: boolean,
  removedSidecarMayBeAbsent = false,
): void {
  try {
    let entry = lstatSync(path);
    // SQLite removes WAL/SHM files when its last connection closes. A stat
    // racing that unlink can describe an ordinary inode with no remaining link.
    // Observe the path once more; a replacement must pass every original check.
    if (removedSidecarMayBeAbsent && entry.isFile() && entry.nlink === 0)
      entry = lstatSync(path);
    if (
      entry.isSymbolicLink() ||
      (directory ? !entry.isDirectory() : !entry.isFile() || entry.nlink !== 1)
    ) {
      throw new DeliveryError(
        "Controller storage must use ordinary files and directories, not links.",
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

const ledgerBusyTimeoutMs = 5000;
function configureLedgerJournal(db: DatabaseSync): void {
  const deadline = performance.now() + ledgerBusyTimeoutMs;
  const waiter = new Int32Array(new SharedArrayBuffer(4));
  // Journal-mode promotion can return SQLITE_BUSY without invoking SQLite's
  // busy handler. Own that wait here, within the same existing lock budget.
  db.exec("PRAGMA busy_timeout = 0;");
  try {
    for (;;) {
      try {
        db.exec("PRAGMA journal_mode = WAL;");
        break;
      } catch (error) {
        const sqlite = error as { code?: string; errcode?: number };
        const remaining = deadline - performance.now();
        if (
          sqlite.code !== "ERR_SQLITE_ERROR" ||
          sqlite.errcode !== 5 ||
          remaining <= 0
        )
          throw error;
        Atomics.wait(waiter, 0, 0, Math.min(10, remaining));
        if (performance.now() >= deadline) throw error;
      }
    }
  } finally {
    db.exec(`PRAGMA busy_timeout = ${ledgerBusyTimeoutMs};`);
  }
  db.exec("PRAGMA synchronous = FULL;");
}

export function repositoryIdentity(
  repository: string,
  onboarding?: OnboardingReport,
): string {
  return onboarding?.canonicalRepository
    ? `github:${onboarding.canonicalRepository.name.toLowerCase()}`
    : `path:${process.platform === "win32" ? repository.toLowerCase() : repository}`;
}

export interface OwnershipTransaction {
  advanceFence(): number;
  reclaimQueued(): void;
  release(): void;
}
function validId(id: string): void {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
  )
    throw new DeliveryError("Provide a valid delivery ID.");
}
/** Owns SQLite, transactional documents, canonical ownership, fencing and FIFO handoff. */
export class RepositoryLedger {
  constructor(readonly stateDirectory: string) {}
  requestArtifact(id: string): string {
    validId(id);
    return join(this.stateDirectory, "artifacts", id + ".json");
  }
  assertArtifacts(): void {
    assertStorageEntry(join(this.stateDirectory, "artifacts"), true);
  }
  read(id: string): Delivery {
    validId(id);
    return this.withDatabase((db) => {
      const row = db
        .prepare("SELECT document FROM deliveries WHERE id = ?")
        .get(id);
      if (!row) throw new DeliveryError("Delivery not found.");
      return JSON.parse(String(row.document)) as Delivery;
    });
  }
  list(): Delivery[] {
    return this.withDatabase((db) =>
      db
        .prepare("SELECT document FROM deliveries ORDER BY rowid")
        .all()
        .map((row) => JSON.parse(String(row.document)) as Delivery),
    );
  }
  admit(delivery: Delivery): Delivery {
    validId(delivery.id);
    const id = delivery.id,
      key = delivery.ownership.key,
      artifact = this.requestArtifact(id);
    this.withDatabase((db) => {
      db.exec("BEGIN IMMEDIATE");
      let createdArtifact = false;
      try {
        const owner = db
          .prepare(
            "SELECT delivery_id, fence FROM repository_owners WHERE repository = ?",
          )
          .get(key);
        if (owner?.delivery_id) {
          delivery.phase = "queued";
        } else {
          delivery.ownership = {
            held: true,
            fence: Number(owner?.fence ?? 0) + 1,
            key,
          };
          db.prepare(
            "INSERT INTO repository_owners (repository, delivery_id, fence) VALUES (?, ?, ?) ON CONFLICT(repository) DO UPDATE SET delivery_id = excluded.delivery_id, fence = excluded.fence",
          ).run(key, id, delivery.ownership.fence);
        }
        writeFileSync(
          artifact,
          JSON.stringify(
            {
              deliveryId: id,
              request: delivery.request,
              issue: delivery.issue,
            },
            null,
            2,
          ),
          { flag: "wx", mode: 0o600, flush: true },
        );
        createdArtifact = true;
        db.prepare("INSERT INTO deliveries (id, document) VALUES (?, ?)").run(
          id,
          JSON.stringify(delivery),
        );
        db.exec("COMMIT");
      } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        if (createdArtifact) unlinkSync(artifact);
        throw error;
      }
    });
    return delivery;
  }
  update(
    id: string,
    work: (delivery: Delivery, ownership: OwnershipTransaction) => void,
  ): Delivery {
    validId(id);
    return this.withDatabase((db) => {
      db.exec("BEGIN IMMEDIATE");
      const row = db
        .prepare("SELECT document FROM deliveries WHERE id = ?")
        .get(id);
      if (!row) throw new DeliveryError("Delivery not found.");
      const delivery = JSON.parse(String(row.document)) as Delivery;
      work(delivery, {
        advanceFence: () => this.advanceFence(db, delivery),
        reclaimQueued: () => {
          const owner = db
            .prepare(
              "SELECT delivery_id, fence FROM repository_owners WHERE repository = ?",
            )
            .get(delivery.ownership.key);
          if (owner && owner.delivery_id === null)
            this.handoff(
              db,
              delivery.ownership.key,
              Number(owner.fence),
              delivery,
            );
        },
        release: () => {
          const old = delivery.ownership;
          const fence = old.fence + 1;
          const result = db
            .prepare(
              "UPDATE repository_owners SET delivery_id = NULL, fence = ? WHERE repository = ? AND delivery_id = ? AND fence = ?",
            )
            .run(fence, old.key, delivery.id, old.fence);
          if (result.changes !== 1)
            throw new DeliveryError(
              "Repository ownership changed; reconcile before continuing.",
            );
          delivery.ownership = { held: false, fence, key: old.key };
          this.handoff(db, old.key, fence, delivery);
        },
      });
      db.prepare("UPDATE deliveries SET document = ? WHERE id = ?").run(
        JSON.stringify(delivery),
        id,
      );
      db.exec("COMMIT");
      return delivery;
    });
  }
  private advanceFence(db: DatabaseSync, delivery: Delivery): number {
    const fence = delivery.ownership.fence + 1;
    const result = db
      .prepare(
        "UPDATE repository_owners SET fence = ? WHERE repository = ? AND delivery_id = ? AND fence = ?",
      )
      .run(
        fence,
        delivery.ownership.key,
        delivery.id,
        delivery.ownership.fence,
      );
    if (result.changes !== 1)
      throw new DeliveryError(
        "Repository ownership changed; reconcile before continuing.",
      );
    delivery.ownership.fence = fence;
    return fence;
  }
  private handoff(
    db: DatabaseSync,
    key: string,
    fence: number,
    current: Delivery,
  ): void {
    const next = db
      .prepare("SELECT document FROM deliveries ORDER BY rowid")
      .all()
      .map((row) => JSON.parse(String(row.document)) as Delivery)
      .map((item) => (item.id === current.id ? current : item))
      .find((item) => item.ownership.key === key && item.phase === "queued");
    if (!next) return;
    const result = db
      .prepare(
        "UPDATE repository_owners SET delivery_id = ?, fence = ? WHERE repository = ? AND delivery_id IS NULL AND fence = ?",
      )
      .run(next.id, fence + 1, key, fence);
    if (result.changes !== 1)
      throw new DeliveryError(
        "Repository ownership changed; reconcile before continuing.",
      );
    next.phase = "blocked";
    next.ownership = { held: true, fence: fence + 1, key };
    if (next.id !== current.id)
      db.prepare("UPDATE deliveries SET document = ? WHERE id = ?").run(
        JSON.stringify(next),
        next.id,
      );
  }
  private withDatabase<T>(work: (db: DatabaseSync) => T): T {
    const artifacts = join(this.stateDirectory, "artifacts");
    assertStorageEntry(artifacts, true);
    const ledger = join(this.stateDirectory, "deliveries.sqlite");
    assertStorageEntry(ledger, false);
    for (const path of [`${ledger}-wal`, `${ledger}-shm`])
      assertStorageEntry(path, false, true);
    mkdirSync(join(this.stateDirectory, "artifacts"), {
      recursive: true,
      mode: 0o700,
    });
    const db = new DatabaseSync(ledger);
    try {
      db.exec(`PRAGMA busy_timeout = ${ledgerBusyTimeoutMs};`);
      db.exec("BEGIN IMMEDIATE");
      const version = Number(
        db.prepare("PRAGMA user_version").get()?.user_version,
      );
      if (version > 2)
        throw new DeliveryError("This ledger requires a newer controller.");
      if (version === 0) {
        db.exec(
          "CREATE TABLE deliveries (id TEXT PRIMARY KEY, document TEXT NOT NULL); PRAGMA user_version = 1;",
        );
      }
      if (version < 2) {
        db.exec(
          "CREATE TABLE repository_owners (repository TEXT PRIMARY KEY, delivery_id TEXT, fence INTEGER NOT NULL); PRAGMA user_version = 2;",
        );
        for (const row of db
          .prepare("SELECT id, document FROM deliveries ORDER BY rowid")
          .all()) {
          const delivery = JSON.parse(String(row.document)) as Delivery;
          delivery.onboarding ??= inspectOnboarding(delivery.repository, {});
          delivery.authorityPolicySha256 =
            delivery.onboarding?.policy?.sha256 ?? null;
          const key = repositoryIdentity(
            delivery.repository,
            delivery.onboarding,
          );
          const owner = db
            .prepare(
              "SELECT delivery_id FROM repository_owners WHERE repository = ?",
            )
            .get(key);
          delivery.ownership = { held: !owner, fence: owner ? 0 : 1, key };
          if (owner) delivery.phase = "queued";
          else
            db.prepare("INSERT INTO repository_owners VALUES (?, ?, 1)").run(
              key,
              delivery.id,
            );
          db.prepare("UPDATE deliveries SET document = ? WHERE id = ?").run(
            JSON.stringify(delivery),
            delivery.id,
          );
        }
      }
      db.exec("COMMIT");
      configureLedgerJournal(db);
      return work(db);
    } finally {
      if (db.isTransaction) db.exec("ROLLBACK");
      db.close();
    }
  }
}
