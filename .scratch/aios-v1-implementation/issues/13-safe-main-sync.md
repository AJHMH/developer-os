# 13: Synchronize clean local main without losing work

**What to build:** With passing applicable main evidence the controller fetches current refs and fast-forwards clean local main, reports recorded alignment, or preserves dirty/divergent work as a blocker.

**Blocked by:** 12: [Verify merged main and block unsafe recovery](12-merged-main-verification.md).

**Status:** ready-for-agent

## Source and governing contract

Read the [approved canonical specification](../../aios-feature-delivery/spec.md) before implementation. User-story coverage: 41, 42. Use the domain glossary and approved public-controller command/observation testing boundary; assert visible behavior and permitted/forbidden effects rather than implementation internals.

This is an implementation slice, separate from resolved wayfinder decisions. Unimplemented or unqualified phases remain blocked. Controlled adapters and temporary repositories demonstrate behavior before real host/repository qualification; they do not establish live readiness. Preserve existing user material, authority boundaries and credentials. Do not enable live pilot delivery before all qualification prerequisites pass.

## Acceptance criteria

- [ ] Canonical repository identity, current remote refs, checkout and main are rechecked before synchronization; main advancement invalidates stale completion assumptions.
- [ ] Clean local main can fast-forward to the recorded verified remote revision; final local/remote alignment is observed and reported.
- [ ] Uncommitted work, local-only main commits and divergent history preserve all content/history and block unsafe synchronization.
- [ ] No automatic stash, reset, rebase, force-push or discard is used; trusted Git operations never execute candidate-controlled scripts.
- [ ] Interrupted or uncertain synchronization is reconciled from current refs before progression; evidence identifies safe completed steps.
- [ ] Public tests use temporary Git repositories for clean/dirty/divergent histories, identity/ref changes and restart without data loss.

