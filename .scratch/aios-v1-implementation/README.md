# AIOS v1 implementation tickets

Status: published
Approved: 7 October 2026

Canonical source: [Developer AIOS v1 specification](../aios-feature-delivery/spec.md). These are implementation slices; the resolved wayfinder issues remain unchanged.

## Current status — 15 October 2026

Tickets **01–03, 18–20, 23–25** are complete within their recorded scope. Ticket **21** is complete for fixed-request mediation; **22** has fixed-fixture evidence but its broad usage-monitoring/restart criterion remains open. Generalized production use remains gated. Tickets **05–13** have implemented controlled controller slices; ticket 13 is under local review on `codex/ticket13-safe-main-sync`, and native acceptance remains open throughout. Parent **04** stays open for production admission. Tickets **14–17** remain unfinished: cleanup, complete-platform qualification and observed pilot.

Use the [implementation reference](../../docs/implementation-status.md) for evidence and limits. Qualification is source/host/policy bound, not automatically inherited by later revisions. Ticket review or completion never supplies inference authority or owner GitHub approval. Historical progress entries below retain the observations at their recorded dates and are superseded by the current summary where they conflict.

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
| [18: Admit a pinned dedicated Windows VM through the controller](issues/18-pinned-windows-vm.md) | 2, 3 (completed) | 12, 51, 52, 56 |
| [19: Run and safely collect an offline delivery canary](issues/19-offline-workspace-roundtrip.md) | 18 | 12, 15, 50, 51, 52 |
| [20: Prove forbidden access with positive controls](issues/20-positive-control-isolation.md) | 19 | 12, 50, 51, 53, 56 |
| [21: Qualify model-only subscription authentication mediation](issues/21-subscription-auth-mediation.md) | 18 | 14, 50, 54, 55 |
| [22: Dispatch online inference under independently enforced access policy](issues/22-online-access-usage-gate.md) | 20, 21 (positive qualification) | 14, 15, 31, 54, 55 |
| [23: Fence and reconcile VM descendants across controller interruption](issues/23-vm-fencing-recovery.md) | 19 | 9, 34, 35, 36, 37, 51 |
| [24: Qualify the Windows production worker path](issues/24-windows-worker-qualification.md) | 22, 23 | 12, 13, 14, 15, 52, 56 |
| [25: Independently qualify the macOS worker path](issues/25-macos-worker-qualification.md) | 24 | 12, 13, 14, 15, 52, 56 |

10 October ticket 04 progress: [20 isolation evidence](ticket20-native-isolation.json) and [23 fencing/recovery evidence](ticket23-native-fencing.json) passed for the fixed native Windows synthetic worker. Ticket 21 remains open after [credential-free protocol/relay canaries](ticket21-protocol-observation.json) and separate registration preparation. The owner confirmed no Mac is available; independent macOS qualification is blocked. Parent 04 remains open and production disabled.

10 October independent Mac progress: the owner supplied an Apple-silicon Mac.
Parent 04 now has a native AppleHV ARM64 synthetic offline path, independently
observed transfer/result collection, positive-control denial/escape canaries and
eight-process pause/fencing/crash recovery. Credential-free pinned Codex host
protocol and relay also passed. See [macOS worker qualification](../../docs/macos-worker-qualification.md).
Authentication/online/production blockers are unchanged; parent 04 and tickets
25/16 remain incomplete. The prior no-Mac statement above is historical.


14 October ticket 06 progress: the controlled baseline/candidate validation slice is
ready for human review. [Implementation receipt](ticket06-implementation-receipt.md)
records passing public-controller/full-suite validation and outstanding native and
hosted qualification. The owner explicitly selected this controlled implementation
while parent native qualification remains open; production delivery stays disabled.


14 October ticket 07 progress: controlled candidate repair is ready for human
review, with durable cycle/time allowances, explicit extensions and fenced
revalidation. See [receipt](ticket07-implementation-receipt.md). Native repair
and complete delivery qualification remain open.


14 October ticket 08 progress: controlled signed-publication and App PR orchestration
is ready for review. See [receipt](ticket08-implementation-receipt.md). Native
credential-bearing ports and live Windows/macOS/GitHub qualification remain open;
the CLI still refuses publication without trusted controlled integrations.


14 October ticket 09 progress: controlled trusted PR-check monitoring is ready for
human review, with exact-head identity checks, retained rerun history, durable CI
deadlines and cumulative repair followed by conditional publication. See
[receipt](ticket09-implementation-receipt.md). Native GitHub and cross-platform
qualification remain open; production delivery stays disabled.


14 October ticket 10 progress: controlled review findings and owner approval are
ready for human review. Scoped fixes use persisted repair allowances; conversation
resolution requires verified changed output and current checks. Exact-head human
approval reaches the separate merge gate. See [receipt](ticket10-implementation-receipt.md).
Native review and complete delivery qualification remain open.


15 October issue reconciliation and ticket 13: current summaries separate controlled implementation, native acceptance and historical fixed-worker evidence. Ticket 21 is complete only for fixed-request mediation; ticket 22 retains its unchecked broad usage criterion. Ticket 13 implements controlled synchronization/reconciliation; see its [receipt](ticket13-implementation-receipt.md). No native production gate is waived.
