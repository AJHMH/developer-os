# 13: Synchronize clean local main without losing work

**What to build:** With passing applicable main evidence the controller fetches current refs and fast-forwards clean local main, reports recorded alignment, or preserves dirty/divergent work as a blocker.

**Blocked by:** 12: [Verify merged main and block unsafe recovery](12-merged-main-verification.md).

**Status:** ready-for-human — controlled implementation; native acceptance open

## Source and governing contract

Read the [approved canonical specification](../../aios-feature-delivery/spec.md) before implementation. User-story coverage: 41, 42. Use the domain glossary and approved public-controller command/observation testing boundary; assert visible behavior and permitted/forbidden effects rather than implementation internals.

This is an implementation slice, separate from resolved wayfinder decisions. Unimplemented or unqualified phases remain blocked. Controlled adapters and temporary repositories demonstrate behavior before real host/repository qualification; they do not establish live readiness. Preserve existing user material, authority boundaries and credentials. Do not enable live pilot delivery before all qualification prerequisites pass.

## Current evidence reconciliation — 15 October 2026

The controlled controller implementation is present on this branch. It requires fresh ticket 12 evidence, records intent before effects, refuses unsafe checkout/ref changes, and reconciles uncertain results without redispatch. Public tests use real temporary Git repositories and local bare remotes. Manual agent Git operations remain separate from product acceptance. See the [contract](../../../docs/main-synchronization.md) and [implementation receipt](../ticket13-implementation-receipt.md).

### Remaining native acceptance

- [ ] Install and independently qualify trusted Windows/macOS Git transports and checkout/ref authority, including candidate configuration/environment exclusion, conditional effect races, bounded operations and crash recovery.
- [ ] Qualify the integrated upstream native main observer and delivery path. Parent 04 and tickets 14–17 stay open; production delivery remains disabled.

The checked criteria below describe the controlled implementation only. The native adapter is absent and the CLI refuses unqualified synchronization.

## Controlled implementation acceptance

- [x] Canonical repository identity, current remote refs, checkout and main are rechecked before synchronization; main advancement invalidates stale completion assumptions.
- [x] Clean local main can fast-forward to the recorded verified remote revision; final local/remote alignment is observed and reported.
- [x] Uncommitted work, local-only main commits and divergent history preserve all content/history and block unsafe synchronization.
- [x] No automatic stash, reset, rebase, force-push or discard is used; trusted Git operations never execute candidate-controlled scripts.
- [x] Interrupted or uncertain synchronization is reconciled from current refs before progression; evidence identifies safe completed steps.
- [x] Public tests use temporary Git repositories for clean/dirty/divergent histories, identity/ref changes and restart without data loss.

