# Define main synchronization and branch-cleanup eligibility

Type: grilling
Label: wayfinder:grilling
Status: resolved
Claimed by: current Codex chat
Parent: ../map.md
Blocked by: 01, 03

## Question

How should AIOS verify main, synchronize a dirty or divergent local checkout, and prove that a non-main branch is safe to delete after merge?

Settle squash/rebase merge provenance, branches with newer commits, unrelated merged branches, Factory event branches retained for replay, remote deletion races and partial cleanup failure. The agreed policy excludes deletion of unmerged work and discarding local work.

## Evidence

- [Factory replay-evidence requirement](../factory-evidence.md).

## Resolution requirements

An explicit eligibility and completion contract, including preservation exceptions and evidence retained before deletion.

## Comments

### Owner decisions — 7 October 2026

- Fast-forward a clean local main only. Uncommitted changes, local-only main commits or divergent main block synchronization; no automatic stash, reset, rebase or discard.
- Cleanup examines all local and remote non-main branches in the onboarded repository, including unrelated branches whose work is merged, with protected/retained exclusions.
- Squash/rebase cleanup requires recorded PR merge evidence tying the branch's unchanged final head to its merged result on main. Preserve newer tips and uncertain evidence.
- Retain Factory replay/event branches, protected branches and branches checked out in another worktree. Report these exclusions as expected retention, not cleanup failure.
- Recheck branch tips before deletion. Changed tips are not deleted blindly. Preserve successful progress and report remaining cleanup blockers; resume without repeating the merge.

## Answer

Owner confirmed the complete synchronization and cleanup contract on 7 October 2026. This resolves the planning decision; synchronization and cleanup controls remain to be implemented and demonstrated.

1. Enter this phase only after the approved PR has merged and configured checks on the actual merged/main revision have passed, as required by the validation and lifecycle contracts. A main-check failure stops progression and uses a new owner-approved PR for any repair/revert.
2. Verify repository/remote identity and fetch current references. Record the merge result and main revision used for synchronization and cleanup; do not infer current remote state from stale cached refs. If main advances, reassess the revision and applicable check evidence before claiming synchronized completion.
3. Inspect the local checkout and main before changing them. Uncommitted changes, local-only main commits or divergent history produce a blocker, preserving all work. Only fast-forward a clean local main. Never automatically stash, reset, rebase, force-push main or discard work. Verify local main matches remote main at the recorded completion observation.
4. Inventory local and remote non-main branches, including unrelated merged branches. Each branch receives a recorded eligibility decision and reason: eligible, retained or blocked. Main is never a candidate. Respect protected branches, owner retention policy, Factory event/replay requirements and branches checked out in any worktree.
5. Establish merge evidence for each eligible branch. Ordinary ancestry may establish integration; squash/rebase cases require recorded PR evidence connecting the branch's unchanged final head to a merge result present on main. A merged PR badge alone is insufficient if the branch has newer commits. Local and remote tips are evaluated separately; a merged remote tip does not justify deleting local-only work. Uncertain integration is preserved pending an explicit owner decision.
6. Preserve evidence before deletion: repository/remote identity, branch name and exact tip, main revision, PR/head/merge linkage or ancestry proof, policy/exclusion decisions and operation outcome. Retained replay branches are not deleted merely because their code is merged; migrating replay evidence would require a separate decision.
7. Recheck main state, branch tip, protection/retention and worktree use immediately before a deletion. Use conditional operations or equivalent controls to avoid deleting a tip different from the evaluated one. If a tip changes or an outcome is uncertain, reconcile or block; never retry blind or force-delete simply to make cleanup appear complete. Exact race-control mechanisms belong to the runtime implementation specification.
8. Record local and remote deletion results independently. If one succeeds and another fails, preserve that progress and the remaining evidence. Report the failed operation and required next action; resumption reconciles current refs before attempting outstanding eligible cleanup. Do not repeat feature implementation, PR creation or merge.
9. Expected retained branches do not prevent completion when their exclusions are documented. Unexpected deletion failure, unsafe synchronization or unresolved eligibility is a blocker, not complete cleanup. Unmerged branches remain retained unless the owner explicitly decides otherwise.
10. Report completion only with passing applicable main checks, verified safe synchronization and all eligible cleanup finished. The report includes the checked/synchronized main revision, deleted branches, retained branches with reasons, and any evidence references. Treat the final observation as a recorded point in time, not a promise that remote main can never change afterward.

### Acceptance scenarios

| Scenario | Expected outcome |
|---|---|
| Dirty checkout or divergent local main | Preserve work, block synchronization, perform no automatic stash/reset/rebase. |
| Clean main behind remote with passing applicable checks | Fast-forward and verify the recorded local/remote main revision. |
| Squash-merged PR and unchanged branch head | Delete only after validated PR/head/merge linkage and all exclusion/race checks. |
| Merged PR followed by a new branch commit | Preserve the branch; earlier merge evidence does not cover its new tip. |
| Remote branch merged but local branch has extra commits | Evaluate tips separately and preserve unmerged local work. |
| Factory event branch or active-worktree branch | Retain with a documented reason; exclusion is expected. |
| Remote deletion succeeds, local deletion fails | Record partial progress, report blocker, reconcile and resume remaining cleanup only. |
| Branch changes during cleanup | Do not delete a different tip; reassess or block. |

Resolution: accepted by the owner. No repository synchronization, branch deletion or pilot writes have been performed during planning.
