# 10: Address review findings and wait for owner approval

**Implementation reconciliation — 15 October 2026:** The controlled controller slice is implemented in current source and covered by the corresponding implementation receipt. Native adapter/qualification acceptance remains open, so this ticket is not marked fully completed. See the [current status](../../../docs/implementation-status.md).


**What to build:** Straightforward review findings pass through the signed repair loop; disputed requests remain open for owner resolution. The controller waits for only the sole owner's valid current-head GitHub review.

**Blocked by:** 09: [Monitor trusted PR checks for the current revision](09-trusted-pr-checks.md).

**Status:** ready-for-human

## Source and governing contract

Read the [approved canonical specification](../../aios-feature-delivery/spec.md) before implementation. User-story coverage: 25, 26, 27, 28, 29, 32. Use the domain glossary and approved public-controller command/observation testing boundary; assert visible behavior and permitted/forbidden effects rather than implementation internals.

This is an implementation slice, separate from resolved wayfinder decisions. Unimplemented or unqualified phases remain blocked. Controlled adapters and temporary repositories demonstrate behavior before real host/repository qualification; they do not establish live readiness. Preserve existing user material, authority boundaries and credentials. Do not enable live pilot delivery before all qualification prerequisites pass.

## Acceptance criteria

- [x] A conversation is resolved only after its straightforward fix has relevant verification evidence; disagreement/conflicting scope remains unresolved and is reported to the owner.
- [x] Review text cannot authorize credential access, scope/policy changes or new budgets; all fixes use existing repair allowance and check/publication evidence.
- [x] Only trusted eligible owner current-head APPROVED review satisfies the gate. Bot/self/stale/dismissed reviews and outstanding required changes do not.
- [x] No agent credentials submit an owner review; chat approval does not replace the GitHub review, and no separate merge instruction is added to valid approved-head authorization.
- [x] New commits invalidate review and checks; explicit session/allowance state survives review-fix restarts.
- [x] Approval wait has no deadline or repeated reminders; status records pending action while pause/cancel remain effective.
- [x] Public tests exercise review repair, disputed findings, identity/permission changes, exact-head invalidation and indefinite approval waiting with controlled time.


## Controlled implementation — 2026-10-14

Checked criteria describe the controlled public-controller slice, with durable
review repair, verified conversation resolution and exact-head owner approval.
See [review contract](../../../docs/review-owner-approval.md) and
[implementation receipt](../ticket10-implementation-receipt.md). Native review
provenance, policy eligibility, scope assessment, conditional resolution and
Windows/macOS credential/isolation qualification remain open. No native GitHub
review adapter, approval submission or merge operation is enabled by this slice.
