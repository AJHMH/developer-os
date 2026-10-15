# 12: Verify merged main and block unsafe recovery

**What to build:** A merged PR remains incomplete while configured main checks, including the pilot's hosted E2E, are monitored for the actual merged/main revision. Failure preserves evidence and stops downstream progression.

**Blocked by:** 11: [Merge only the validated and owner-approved head](11-conditional-owner-merge.md).

**Status:** ready-for-human

## Source and governing contract

Read the [approved canonical specification](../../aios-feature-delivery/spec.md) before implementation. User-story coverage: 39, 40. Use the domain glossary and approved public-controller command/observation testing boundary; assert visible behavior and permitted/forbidden effects rather than implementation internals.

This is an implementation slice, separate from resolved wayfinder decisions. Unimplemented or unqualified phases remain blocked. Controlled adapters and temporary repositories demonstrate behavior before real host/repository qualification; they do not establish live readiness. Preserve existing user material, authority boundaries and credentials. Do not enable live pilot delivery before all qualification prerequisites pass.

## Acceptance criteria

- [x] Main evidence ties the actual merge/result and current main observation to required trusted checks; passing PR checks alone is insufficient.
- [x] Main advancement causes revision/check reassessment rather than synchronization based on stale green results.
- [x] Declared/default CI wait limits and durable restart monitoring hold for main checks; missing/untrusted results do not pass.
- [x] Failure prevents synchronization/cleanup and reports revision, failed check, evidence and owner next action.
- [x] No automatic direct-main patch, rewrite or revert is performed; any fix/revert requires a new signed PR and owner approval.
- [x] Public tests verify passed-main progression, E2E failure, timeouts, advancing main and interrupted check observation.

## Implementation evidence

Controlled implementation on `codex/ticket12-merged-main-verification` adds
`monitorMainChecks` and `monitor-main-checks`, with retained merged/main linkage,
trusted revision-specific histories, durable declared/default deadlines and
read-only recovery. Passed main remains incomplete delivery; synchronization and
cleanup are later slices. See [main verification contract](../../../docs/main-verification.md)
and [implementation receipt](../ticket12-implementation-receipt.md).

The checked criteria describe controlled public-controller behavior. Native
Windows/macOS observation, current-main race handling, complete trusted check
history and credential separation still require observed qualification; no
native monitor or live pilot is enabled.
