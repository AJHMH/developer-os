# 11: Merge only the validated and owner-approved head

**Implementation reconciliation — 15 October 2026:** The controlled controller slice is implemented in current source and covered by the corresponding implementation receipt. Native adapter/qualification acceptance remains open, so this ticket is not marked fully completed. See the [current status](../../../docs/implementation-status.md).


**What to build:** At the merge boundary the controller rechecks revisions, protection, reviews, conversations and trusted checks, then conditionally merges only the authorized candidate or reports a preserved blocker.

**Blocked by:** 10: [Address review findings and wait for owner approval](10-review-owner-approval.md).

**Status:** ready-for-human

## Source and governing contract

Read the [approved canonical specification](../../aios-feature-delivery/spec.md) before implementation. User-story coverage: 27, 28, 38. Use the domain glossary and approved public-controller command/observation testing boundary; assert visible behavior and permitted/forbidden effects rather than implementation internals.

This is an implementation slice, separate from resolved wayfinder decisions. Unimplemented or unqualified phases remain blocked. Controlled adapters and temporary repositories demonstrate behavior before real host/repository qualification; they do not establish live readiness. Preserve existing user material, authority boundaries and credentials. Do not enable live pilot delivery before all qualification prerequisites pass.

## Acceptance criteria

- [x] All required current-head approval/check/conversation gates and effective protections are verified immediately before dispatch; no bypass or manufactured evidence path exists.
- [x] Merge is conditioned on the expected validated/approved PR head; head races cannot cause a different candidate to land.
- [x] If main advances, refresh branch/applicable checks within remaining repair allowance; new PR commits require renewed owner approval.
- [x] Policy/permission revocation, unsupported conditional behavior or budget exhaustion blocks merge with evidence.
- [x] Persist intent and outcome; crash after remote merge acceptance reconciles the existing PR/main result rather than blindly merging again.
- [x] Public tests cover head/base races, approval withdrawal, check changes, exact-head effect conditions and before/after-acceptance crashes.


## Controlled implementation — 2026-10-14

Checked criteria describe the controlled controller boundary, not native readiness.
See [conditional merge contract](../../../docs/conditional-merge.md) and
[implementation receipt](../ticket11-implementation-receipt.md). The adapter
must enforce exact head/base and current gates at the effect boundary. No native
merge is enabled. Main checks, synchronization and cleanup remain later slices.
