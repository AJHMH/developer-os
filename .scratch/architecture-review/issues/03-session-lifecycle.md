# 03: Worker session lifecycle

Status: ready-for-agent
Progress: completed
Source: [Claude architecture review](../source-review.md)
Blocked by: 01

## Scope

Extract session authority, identity/receipt matching, stop uncertainty and quiescence across worker, offline and online sessions. Preserve paused/cancelled semantics in the controller.

Affected files: controller.ts, worker.ts, offline-canary.ts, online-access.ts.

## Completion criteria

Public lifecycle tests cover late/mismatched receipts and uncertain shutdown; controller pause/cancel/recover/release and dispatch tests pass.

## Comments

17 October 2026: Owner authorized all recommendations, including speculative CLI and deletion decisions. Live inference, production enablement and Issue #4 qualification work are outside this diversion.

17 October 2026 implementation evidence: Session lifecycle and affected controller/online/validation/coding tests pass (150 tests). Pause/cancel use shared shutdown and receipt rules; controls exercise no longer creates a runtime import cycle.

17 October 2026 final review: Fresh fenced worker/online dispatch and archival now use the lifecycle seam as well; public tests cover resume identity, new operation identity, and retained uncertainty refusal.
