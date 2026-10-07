# 03: Queue, pause, cancel and recover repository-owned deliveries

**What to build:** Public controls coordinate one active delivery per repository, queue later requests and preserve progress when paused, cancelled, blocked or interrupted. Independent repositories may proceed without sharing execution authority.

**Blocked by:** 01: [Submit a feature request and inspect durable delivery status](01-durable-request-status.md).

**Status:** completed

## Source and governing contract

Read the [approved canonical specification](../../aios-feature-delivery/spec.md) before implementation. User-story coverage: 9, 10, 34, 35, 36, 37. Use the domain glossary and approved public-controller command/observation testing boundary; assert visible behavior and permitted/forbidden effects rather than implementation internals.

This is an implementation slice, separate from resolved wayfinder decisions. Unimplemented or unqualified phases remain blocked. Controlled adapters and temporary repositories demonstrate behavior before real host/repository qualification; they do not establish live readiness. Preserve existing user material, authority boundaries and credentials. Do not enable live pilot delivery before all qualification prerequisites pass.

## Acceptance criteria

- [x] Concurrent starts for one repository cannot both dispatch work; durable ownership and stale-runner fencing prevent a recovered process from overlapping an old runner.
- [x] Different repositories progress independently; waits/pauses/blockers retain ownership until completion or explicit safe release.
- [x] Pause preserves state for explicit resume; cancel prevents new dispatch and does not automatically close PRs, delete branches or undo dispatched effects.
- [x] Restart reconciles state and orphan/uncertain worker observations before resuming eligible running work; paused/cancelled/blocked work does not auto-resume.
- [x] Explicit delivery, sandbox and worker session identities are persisted; a global last-session lookup is never used.
- [x] Public tests inject crashes and late external responses to verify controls, preservation, no duplicate dispatch and evidence-backed uncertainty blockers.


## Implementation evidence — 7 October 2026

Implemented public pause/resume/cancel/recover/release controls and transactional repository ownership. Later requests queue; verified clones share the canonical GitHub identity, and unknown onboarding uses the resolved local path. Paused/blocked/cancelled owners retain authority until explicit safe release. Release requires verified worker quiescence and promotes the oldest eligible queue entry; released paused work rejoins the queue on resume.

Trusted worker integration now has durable intent-before-dispatch, repository/runner/operation/sandbox/worker identities, monotonic fencing and exact receipt validation. Pause/cancel/recovery invalidate old authority before descendant shutdown. Unknown, mismatched, failed or timed-out observations persist uncertainty and prohibit dispatch/release. Late responses are recorded without reviving stopped work. Explicit resume retains sandbox/session identities with a new operation and preserves session history. Admission rechecks onboarding against the immutable original policy pin; changed authority cannot be adopted by repeated retries.

Restart uses explicit stored identities and conservative fence-and-stop reconciliation. Paused/cancelled/blocked deliveries never auto-dispatch. A successfully stopped formerly running delivery becomes eligible for fresh qualified admission. Old intake ledgers migrate transactionally, preserving requests/artifacts and supplying unknown onboarding where no prior evidence exists.

Validation: typechecking, formatting and the full 32-test Node suite pass. Seventeen control-boundary tests cover independent repositories, canonical clones, concurrent CLI processes, pause/resume/cancel/release, a late accepted response, thrown and abrupt-process-exit crashes, exact identity recovery, timed-out observations, missing qualification, spoofed receipts, stale policy admission, session-preserving resume and legacy ledger migration. CodeRabbit's first source review completed with one minor finding concerning resume after release; it was confirmed with a failing public regression and fixed. Final external review completed for cli.ts/controller.ts/onboarding.ts with zero findings.

No production worker adapter or CLI run command is enabled. Ticket 4 must qualify the adapter's real descendant shutdown, retained sandbox/session resume and repository-scoped fence enforcement, and pin one authority directory per host. Separately configured ledgers do not share authority and must not be qualified for concurrent production use. These controller tests do not establish actual worker isolation, Windows/macOS qualification or live GitHub delivery.
