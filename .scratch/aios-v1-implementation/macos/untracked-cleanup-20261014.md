# Untracked artifact cleanup — 14 October 2026

> Historical/design artifact: statements below apply to the recorded investigation, proposal or revision. For implemented capabilities, later completion evidence and remaining production gates, see [implementation status](../../../docs/implementation-status.md).


Reviewed 183 untracked files (1,278,749 bytes), all from Ticket 25 macOS validation. No exact duplicates of tracked files were found.

Preserved 169 unique logs, JSON observations, historical refusals, before-fix snapshots, successful acceptance evidence, and the local continuation history in their original locations. No evidence was promoted to current-source qualification, and no uncertain work was discarded.

Archived 14 historical one-off diagnostic scripts from `macos/debug/`, including old source/policy timing instrumentation and serial validation harnesses. These scripts describe completed validation sessions and historical policies; their source remains recoverable. The archive was read back and every member compared byte-for-byte and by SHA-256 before removing loose copies.

- [Archive](retained-debug-harnesses-20261014.tar.gz)
- [Inventory, decisions, original paths and hashes](untracked-cleanup-20261014.json)
- Preserved local continuation history: `ticket25-local-validation-history.md` (untracked; outside this PR).

To recover a script, read its original path from the inventory and extract that archive member from the repository root. Restoring source does not authorize rerunning historical native, online or inference actions. The cleanup report, inventory and diagnostic archive are committed together. The 169 preserved evidence/history files remain local and untracked.

Tracked files and runtime state were unchanged. No diagnostic, VM operation, credential access or inference was executed during cleanup.
