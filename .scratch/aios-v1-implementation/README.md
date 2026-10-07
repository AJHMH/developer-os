# AIOS v1 implementation tickets

Status: published
Approved: 7 October 2026

Canonical source: [Developer AIOS v1 specification](../aios-feature-delivery/spec.md). These are implementation slices; the resolved wayfinder issues remain unchanged.

Work any ready ticket whose blockers are complete. Tickets **01–03** are completed; **Launch an isolated worker with a fail-closed qualification gate** is now the frontier. Windows/macOS qualification is independent; both gate the observed pilot. Ticket readiness describes implementable work, not verified host/repository readiness or authorization to bypass owner approval.

| Ticket | Blocked by | User stories |
|---|---|---|
| [01: Submit a feature request and inspect durable delivery status](issues/01-durable-request-status.md) | None | 1, 2, 33, 49, 50 |
| [02: Report repository onboarding readiness without changing setup](issues/02-onboarding-readiness.md) | 1 | 5, 6, 7, 8 |
| [03: Queue, pause, cancel and recover repository-owned deliveries](issues/03-ownership-pause-recovery.md) | 1 | 9, 10, 34, 35, 36, 37 |
| [04: Launch an isolated worker with a fail-closed qualification gate](issues/04-isolated-worker-gate.md) | 2, 3 | 12, 13, 14, 15 |
| [05: Implement a bounded feature and safely admit the worker result](issues/05-bounded-feature-candidate.md) | 4 | 3, 4, 11, 30, 31, 37 |
| [06: Validate baseline and candidate behavior inside isolation](issues/06-isolated-validation.md) | 5 | 16, 17, 18, 19, 20, 21, 22, 23 |
| [07: Repair validation findings within persisted allowances](issues/07-bounded-validation-repair.md) | 6 | 30, 31 |
| [08: Publish signed code and create an App-authored PR](issues/08-signed-app-publication.md) | 7 | 8, 24, 29 |
| [09: Monitor trusted PR checks for the current revision](issues/09-trusted-pr-checks.md) | 8 | 20, 21, 22, 32 |
| [10: Address review findings and wait for owner approval](issues/10-review-owner-approval.md) | 9 | 25, 26, 27, 28, 29, 32 |
| [11: Merge only the validated and owner-approved head](issues/11-conditional-owner-merge.md) | 10 | 27, 28, 38 |
| [12: Verify merged main and block unsafe recovery](issues/12-merged-main-verification.md) | 11 | 39, 40 |
| [13: Synchronize clean local main without losing work](issues/13-safe-main-sync.md) | 12 | 41, 42 |
| [14: Clean eligible merged branches and report delivery completion](issues/14-eligible-cleanup-completion.md) | 13 | 43, 44, 45, 46, 47, 48, 49, 50 |
| [15: Qualify the complete controller boundary on Windows](issues/15-windows-qualification.md) | 14 | 13 |
| [16: Qualify the complete controller boundary on macOS](issues/16-macos-qualification.md) | 14 | 13 |
| [17: Demonstrate an observed profile-page pilot delivery](issues/17-observed-profile-pilot.md) | 15, 16 | 1, 24, 27, 39, 49 |
