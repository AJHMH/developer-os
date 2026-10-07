import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { DatabaseSync } from "node:sqlite";
import { redact } from "./redaction.js";

/** Only fixed, non-input-derived messages may cross the public error boundary. */
export class DeliveryError extends Error {}

function canonicalPath(path: string): string {
  let existing = resolve(path);
  const missing: string[] = [];
  while (!existsSync(existing)) {
    missing.unshift(basename(existing));
    const parent = dirname(existing);
    if (parent === existing)
      throw new DeliveryError("Provide an accessible state directory.");
    existing = parent;
  }
  return join(realpathSync(existing), ...missing);
}

function assertStorageEntry(path: string, directory: boolean): void {
  try {
    const entry = lstatSync(path);
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

function contains(parent: string, child: string): boolean {
  const difference = relative(parent, child);
  return (
    difference === "" ||
    (difference !== ".." &&
      !difference.startsWith(`..${sep}`) &&
      !isAbsolute(difference))
  );
}

export interface FeatureRequest {
  repository: string;
  request: string;
  issue?: string;
}

export interface Delivery {
  id: string;
  phase: "blocked";
  repository: string;
  request: string;
  issue: string | null;
  createdAt: string;
  blocker: {
    code: "DELIVERY_NOT_ENABLED";
    message: string;
    nextAction: string;
  };
  evidence: { kind: "request"; path: string }[];
}

/** Public intake/status boundary. This slice has no worker or remote-effect adapter. */
export class DeliveryController {
  private readonly stateDirectory: string;

  constructor(stateDirectory: string) {
    if (!stateDirectory.trim() || /[\u0000-\u001F\u007F]/.test(stateDirectory))
      throw new DeliveryError("Provide a valid state directory.");
    this.stateDirectory = canonicalPath(stateDirectory);
    if (redact(this.stateDirectory) !== this.stateDirectory)
      throw new DeliveryError("Use a state path without embedded credentials.");
  }

  start(input: FeatureRequest): Delivery {
    if (
      typeof input.repository !== "string" ||
      !isAbsolute(input.repository) ||
      !existsSync(input.repository) ||
      !statSync(input.repository).isDirectory() ||
      typeof input.request !== "string" ||
      !input.request.trim() ||
      input.request.length > 65_536 ||
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(input.request)
    ) {
      throw new DeliveryError(
        "Provide an absolute repository directory and a nonempty feature request.",
      );
    }
    if (
      input.issue !== undefined &&
      (typeof input.issue !== "string" ||
        !input.issue.trim() ||
        input.issue.length > 2048 ||
        /[\u0000-\u001F\u007F]/.test(input.issue))
    ) {
      throw new DeliveryError(
        "Provide a nonempty issue reference without control characters.",
      );
    }
    const repository = realpathSync(input.repository);
    if (
      redact(repository) !== repository ||
      redact(this.stateDirectory) !== this.stateDirectory
    )
      throw new DeliveryError(
        "Use repository and state paths without embedded credentials.",
      );
    if (
      contains(repository, this.stateDirectory) ||
      contains(this.stateDirectory, repository)
    )
      throw new DeliveryError(
        "Keep controller state outside and separate from the target repository.",
      );
    const id = randomUUID();
    const artifact = join(this.stateDirectory, "artifacts", `${id}.json`);
    const delivery: Delivery = {
      id,
      phase: "blocked",
      repository,
      request: redact(input.request.trim()),
      issue: input.issue === undefined ? null : redact(input.issue.trim()),
      createdAt: new Date().toISOString(),
      blocker: {
        code: "DELIVERY_NOT_ENABLED",
        message: "Feature delivery is not enabled in this intake-only slice.",
        nextAction:
          "Complete repository onboarding, host qualification and the remaining delivery implementation before execution.",
      },
      evidence: [{ kind: "request", path: artifact }],
    };
    this.withDatabase((db) => {
      db.exec("BEGIN IMMEDIATE");
      let createdArtifact = false;
      try {
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

  status(id: string): Delivery {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)
    )
      throw new DeliveryError("Provide a valid delivery ID.");
    return this.withDatabase((db) => {
      const row = db
        .prepare("SELECT document FROM deliveries WHERE id = ?")
        .get(id);
      if (!row) throw new DeliveryError("Delivery not found.");
      return JSON.parse(String(row.document)) as Delivery;
    });
  }

  list(): { deliveries: Delivery[] } {
    return this.withDatabase((db) => ({
      deliveries: db
        .prepare("SELECT document FROM deliveries ORDER BY rowid")
        .all()
        .map((row) => JSON.parse(String(row.document)) as Delivery),
    }));
  }

  private withDatabase<T>(work: (db: DatabaseSync) => T): T {
    const artifacts = join(this.stateDirectory, "artifacts");
    assertStorageEntry(artifacts, true);
    const ledger = join(this.stateDirectory, "deliveries.sqlite");
    for (const path of [ledger, `${ledger}-wal`, `${ledger}-shm`])
      assertStorageEntry(path, false);
    mkdirSync(join(this.stateDirectory, "artifacts"), {
      recursive: true,
      mode: 0o700,
    });
    const db = new DatabaseSync(ledger);
    try {
      db.exec("PRAGMA busy_timeout = 5000;");
      db.exec("BEGIN IMMEDIATE");
      const version = Number(
        db.prepare("PRAGMA user_version").get()?.user_version,
      );
      if (version > 1)
        throw new DeliveryError("This ledger requires a newer controller.");
      if (version === 0) {
        db.exec(
          "CREATE TABLE deliveries (id TEXT PRIMARY KEY, document TEXT NOT NULL); PRAGMA user_version = 1;",
        );
      }
      db.exec("COMMIT");
      db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
      return work(db);
    } finally {
      if (db.isTransaction) db.exec("ROLLBACK");
      db.close();
    }
  }
}
