# 09: Repository ownership ledger

Status: ready-for-agent
Progress: completed
Source: [Claude architecture review](../source-review.md)
Blocked by: 03

## Scope

Move SQLite schema/migrations, transactional document updates, repository ownership, fence CAS and oldest-queued handoff behind a ledger module. Controller no longer owns SQL.

Affected files: controller.ts, new ledger module.

## Completion criteria

Real temporary SQLite tests verify migration, canonical repository uniqueness, CAS, queue ordering and transactional failure; controller ownership tests pass.

## Comments

17 October 2026: Owner authorized all recommendations, including speculative CLI and deletion decisions. Live inference, production enablement and Issue #4 qualification work are outside this diversion.

17 October 2026: RepositoryLedger owns migrations, documents and ownership/fence CAS. Real SQLite FIFO/reopen, migration and rollback tests plus controller integration: 30 passed. Integrated validation is recorded in the parent spec.
