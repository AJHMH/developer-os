# 03: Queue, pause, cancel and recover repository-owned deliveries

**What to build:** Public controls coordinate one active delivery per repository, queue later requests and preserve progress when paused, cancelled, blocked or interrupted. Independent repositories may proceed without sharing execution authority.

**Blocked by:** 01: [Submit a feature request and inspect durable delivery status](01-durable-request-status.md).

**Status:** ready-for-agent

## Source and governing contract

Read the [approved canonical specification](../../aios-feature-delivery/spec.md) before implementation. User-story coverage: 9, 10, 34, 35, 36, 37. Use the domain glossary and approved public-controller command/observation testing boundary; assert visible behavior and permitted/forbidden effects rather than implementation internals.

This is an implementation slice, separate from resolved wayfinder decisions. Unimplemented or unqualified phases remain blocked. Controlled adapters and temporary repositories demonstrate behavior before real host/repository qualification; they do not establish live readiness. Preserve existing user material, authority boundaries and credentials. Do not enable live pilot delivery before all qualification prerequisites pass.

## Acceptance criteria

- [ ] Concurrent starts for one repository cannot both dispatch work; durable ownership and stale-runner fencing prevent a recovered process from overlapping an old runner.
- [ ] Different repositories progress independently; waits/pauses/blockers retain ownership until completion or explicit safe release.
- [ ] Pause preserves state for explicit resume; cancel prevents new dispatch and does not automatically close PRs, delete branches or undo dispatched effects.
- [ ] Restart reconciles state and orphan/uncertain worker observations before resuming eligible running work; paused/cancelled/blocked work does not auto-resume.
- [ ] Explicit delivery, sandbox and worker session identities are persisted; a global last-session lookup is never used.
- [ ] Public tests inject crashes and late external responses to verify controls, preservation, no duplicate dispatch and evidence-backed uncertainty blockers.

