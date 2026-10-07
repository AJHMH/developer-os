# Define delivery lifecycle, recovery and waiting behavior

Type: grilling
Label: wayfinder:grilling
Status: resolved
Claimed by: current Codex chat
Parent: ../map.md
Blocked by: none

## Question

What happens to one delivery when the agent restarts, a command hangs, CI never finishes, approval changes, a PR update races with merge, or a remote effect succeeds without a recorded local result?

Settle pause/resume/cancel semantics, per-repository concurrency, active-work and repair-cycle accounting, wait limits, uncertain-effect reconciliation and blocker reporting. User decisions distinguish desired behavior from implementation mechanisms.

## Resolution requirements

A state/transition and failure-behavior contract with representative interruption scenarios; no code implementation.

## Comments

### Owner decisions — 7 October 2026

- One active delivery per repository; queue further requests. Different repositories may run independently.
- Pause preserves progress for resumption. Cancel stops new actions and preserves branches, PRs and evidence; it does not automatically close, delete or undo work. Already-dispatched remote actions may finish.
- On restart, recover state and reconcile GitHub before resuming previously running work. Explicitly paused/cancelled deliveries remain stopped. Do not blindly replay uncertain push, PR creation or merge operations.
- Respect configured check timeouts; default CI-phase wait limit is 60 minutes. Timeout preserves work and produces a blocker. Human approval has no deadline and no repeated notifications.
- Main-check failure stops cleanup and produces a blocker report. Repair or revert uses a new signed PR with owner approval; no automatic direct-main repair/revert.

### Owner decisions — repair accounting and merge races

- One repair cycle is an attempt to fix a batch of validation/review findings followed by relevant revalidation. Initial implementation is not a cycle. New comments and restarts do not reset the allowance.
- The 60-minute active repair limit counts diagnosis, editing and local revalidation during repair. It excludes initial implementation, CI/approval waits, pauses and downtime. Either exhausted limit blocks further repair until the owner extends the budget.
- Never merge a PR head different from the validated and approved one. If main advances, refresh the branch and applicable checks; any new PR commit needs renewed owner approval. If this cannot finish within the repair budget, preserve work and report a blocker.

## Answer

Owner confirmed the complete lifecycle contract on 7 October 2026. This resolves the planning decision; recovery and operation controls remain to be implemented and demonstrated.

### States and progression

Normal progression is queued → preparing → implementing → validating → waiting-checks/review → waiting-approval → merging → verifying-main → synchronizing/cleanup → completed. Repairing returns to validation. Pause, cancel and blockers interrupt progression; the recorded phase and evidence are retained.

| State or condition | Required behavior |
|---|---|
| Queued | Wait for the repository's active delivery to finish or explicitly release ownership. |
| Active work | At most one delivery may perform work in a repository; repositories may run independently. |
| Waiting for checks | Observe declared checks for the recorded revision. Respect configured timeouts; default phase limit is 60 minutes. Timeout produces a preserved, evidence-backed blocker. |
| Waiting for owner approval | Wait without a deadline or repeated notifications. Only the current-head GitHub review satisfies approval. |
| Paused | Stop new work at a safe boundary, retain state/work/evidence, and require explicit resumption. Do not assume an in-flight action was stopped. |
| Cancelled | Stop new actions and retain branch/PR/evidence. Do not close, delete or undo them automatically, and never automatically resume the cancelled delivery. |
| Blocked | Preserve work, record the reason and required next action, and stop new delivery effects. Restart alone does not clear a blocker or reset the budget. Resume only after the blocker is addressed under the existing contract or explicit owner decision. |
| Completed | Declare success only after the agreed main verification, safe synchronization and eligible cleanup contract is satisfied. |

### Repair accounting

The original allowance is three repair cycles or 60 active repair minutes, whichever is exhausted first. A cycle starts when attempting a batch of validation/review fixes and includes relevant revalidation. Diagnosis, editing and local repair verification count as active repair time; initial implementation, CI/approval waits, pauses and downtime do not. Persist usage across restarts and new review comments. Further repair requires an explicit owner budget extension, not automatic reset.

Check/command timeout behavior must respect the repository's declared validation requirements. A hung command must be stopped or reconciled before another attempt can overlap it. Exact process-control mechanisms and initial-implementation resource limits belong to runtime planning; the repair allowance is not an implicit initial-work deadline.

### Recovery and effect reconciliation

Persist enough progress, revision identity, budget usage and operation evidence to recover an interrupted delivery. On restart, reconcile local Git and GitHub state before scheduling writes. Resume previously running work only when its authority, ownership, checks and recorded phase remain valid. Explicitly paused/cancelled deliveries remain stopped; blocked deliveries retain their blocker.

An uncertain remote outcome is not a failure permission to retry. Determine whether a push, PR creation, merge or cleanup already happened. If evidence cannot establish a safe next action, report a blocker for reconciliation. An already-dispatched operation may finish after pause/cancel; record its observed result without initiating new delivery actions.

### Merge boundary and post-merge failures

Immediately before merge, revalidate the PR head/base, current-head owner approval, conversations and trusted required checks. Merge must be conditioned on the validated/approved head. If main advances, refresh the branch and applicable validation; new head commits invalidate approval. Use the existing repair budget and report exhaustion rather than bypass the gate.

After merge, verify the actual merged/main revision. If main checks fail, stop synchronization/cleanup progression and report a blocker with the merge revision, failed checks and evidence. Any repair or revert is a new signed PR requiring owner approval; no automatic direct-main rewrite. The original delivery is not reported complete merely because the merge happened.

### Representative interruption scenarios

| Scenario | Expected result |
|---|---|
| Process exits after PR creation but before recording the response | Find/reconcile the existing PR before considering another creation. |
| Process exits after merge acceptance but before local commit of status | Inspect the existing PR and main history; do not issue a second merge blindly. |
| Pause/cancel arrives while push or merge is in flight | Stop further dispatch, preserve work, and observe the dispatched operation's outcome. |
| CI does not complete within the configured/default phase limit | Preserve revision and logs; report a timeout blocker. |
| Approval is withdrawn or a new commit arrives while waiting | Keep merge blocked until the current head has valid owner approval and checks. |
| Agent restarts after two repair cycles | Continue with the recorded remaining allowance; do not reset it. |
| Main fails E2E after successful merge | Stop cleanup, report the failure, and require a separately approved repair/revert PR. |

Blocker reports identify the delivery, repository, phase, revisions, attempted operations, check evidence, repair usage and required next action without exposing credentials.

Resolution: accepted by the owner. Runtime implementation, process controls and pilot execution have not been performed in this session.
