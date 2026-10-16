# 14: Clean eligible merged branches and report delivery completion

**What to build:** The controller evaluates all local and remote non-main tips, deletes only proven eligible merged branches under conditional controls, records retained branches and reports completed delivery or resumable cleanup blockers.

**Blocked by:** 13: [Synchronize clean local main without losing work](13-safe-main-sync.md).

**Status:** ready-for-human — controlled implementation complete and merged; native acceptance open

## Source and governing contract

Read the [approved canonical specification](../../aios-feature-delivery/spec.md) before implementation. User-story coverage: 43, 44, 45, 46, 47, 48, 49, 50. Use the domain glossary and approved public-controller command/observation testing boundary; assert visible behavior and permitted/forbidden effects rather than implementation internals.

This is an implementation slice, separate from resolved wayfinder decisions. Unimplemented or unqualified phases remain blocked. Controlled adapters and temporary repositories demonstrate behavior before real host/repository qualification; they do not establish live readiness. Preserve existing user material, authority boundaries and credentials. Do not enable live pilot delivery before all qualification prerequisites pass.

## Current evidence reconciliation — 15 October 2026

The controlled controller slice implements inventory, eligibility, conditional deletion, independent effect reconciliation and completion after fresh main checks/alignment. See the [contract](../../../docs/branch-cleanup.md) and [implementation receipt](../ticket14-implementation-receipt.md). Manual agent Git operations remain separate from product acceptance.

### Remaining native acceptance

- [ ] Independently qualify native Windows/macOS inventory/PR history, effective protection/replay policy, credential/configuration isolation, conditional tip/worktree/protection races and bounded operation quiescence.
- [ ] Qualify the integrated upstream native delivery path. Parent 04, native 05–14 and tickets 15–17 remain open; production stays disabled.

Checked criteria below describe the controlled implementation with real temporary Git repositories and controlled remote authority. The native cleanup adapter is absent and the CLI refuses unqualified authority.

## Controlled implementation acceptance

- [x] Inventory includes unrelated merged branches and separate local/remote tips; main is excluded and every candidate has eligible/retained/blocked status with reason.
- [x] Ordinary ancestry or reliable squash/rebase PR-head/merge linkage establishes current-tip integration; newer tips/local-only work and ambiguous evidence are preserved.
- [x] Protected, Factory replay/event and active-worktree branches are retained as expected exclusions; no automatic unmerged deletion or replay-evidence migration occurs.
- [x] Eligibility evidence is durable before deletion. Recheck tip/policy/worktree state and condition the operation on the evaluated tip; unsupported race control blocks rather than deleting blindly.
- [x] Local and remote outcomes are independent; partial success and uncertain acceptance reconcile safely on resume without repeating PR creation or merge.
- [x] Completion requires all applicable main gates, recorded safe alignment and finished eligible cleanup; expected retention is not failure, while unknown/failed eligibility remains a blocker.
- [x] Completion/blocker reports include revisions, deletions/retentions, evidence and next action with synthetic secrets redacted.
- [x] Public temporary-Git/controlled-remote tests cover merge styles, new commits, exclusions, tip races, partial deletion and crash windows.


## Comments

### Merged implementation and hosted verification — 15 October 2026

The controlled implementation is complete and merged in [PR #38](https://github.com/AJHMH/developer-os/pull/38) at `37f31f94c1ac049d5f2327f4b35534407e368fb3`. Subsequent [PR #39](https://github.com/AJHMH/developer-os/pull/39)
restored all 15 overwritten publication recovery scenarios, verified preservation
of the original tests, and adopted reviewed Factory diagnostics/evidence reuse.
Current main `c63ee3ad7a8b96521f148175633ddcbd38716f43` passes all 24 hosted
checks across Developer OS CI, CodeQL and Factory adoption. Local main was
fast-forwarded to that exact revision with tracked work clean and all 21
untracked owner snapshots preserved.

- [x] Controlled implementation merged and reviewed.
- [x] Current-main Linux, macOS, eight Windows shards, Factory coverage and both
  independent approval checks passed.
- [x] Regression preservation audited after the test split (zero missing original
  statements or changed original assertion bodies).
- [ ] Native product adapters and complete-controller qualification remain open
  as listed above. Manual agent synchronization and CI are not product acceptance.

This closes the controlled implementation work, not the native acceptance gate.
Ticket 15 may begin prerequisite assessment and harness preparation; it cannot
claim successful complete-controller Windows qualification from these results.
