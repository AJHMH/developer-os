# 14: Clean eligible merged branches and report delivery completion

**What to build:** The controller evaluates all local and remote non-main tips, deletes only proven eligible merged branches under conditional controls, records retained branches and reports completed delivery or resumable cleanup blockers.

**Blocked by:** 13: [Synchronize clean local main without losing work](13-safe-main-sync.md).

**Status:** ready-for-agent

## Source and governing contract

Read the [approved canonical specification](../../aios-feature-delivery/spec.md) before implementation. User-story coverage: 43, 44, 45, 46, 47, 48, 49, 50. Use the domain glossary and approved public-controller command/observation testing boundary; assert visible behavior and permitted/forbidden effects rather than implementation internals.

This is an implementation slice, separate from resolved wayfinder decisions. Unimplemented or unqualified phases remain blocked. Controlled adapters and temporary repositories demonstrate behavior before real host/repository qualification; they do not establish live readiness. Preserve existing user material, authority boundaries and credentials. Do not enable live pilot delivery before all qualification prerequisites pass.

## Acceptance criteria

- [ ] Inventory includes unrelated merged branches and separate local/remote tips; main is excluded and every candidate has eligible/retained/blocked status with reason.
- [ ] Ordinary ancestry or reliable squash/rebase PR-head/merge linkage establishes current-tip integration; newer tips/local-only work and ambiguous evidence are preserved.
- [ ] Protected, Factory replay/event and active-worktree branches are retained as expected exclusions; no automatic unmerged deletion or replay-evidence migration occurs.
- [ ] Eligibility evidence is durable before deletion. Recheck tip/policy/worktree state and condition the operation on the evaluated tip; unsupported race control blocks rather than deleting blindly.
- [ ] Local and remote outcomes are independent; partial success and uncertain acceptance reconcile safely on resume without repeating PR creation or merge.
- [ ] Completion requires all applicable main gates, recorded safe alignment and finished eligible cleanup; expected retention is not failure, while unknown/failed eligibility remains a blocker.
- [ ] Completion/blocker reports include revisions, deletions/retentions, evidence and next action with synthetic secrets redacted.
- [ ] Public temporary-Git/controlled-remote tests cover merge styles, new commits, exclusions, tip races, partial deletion and crash windows.

