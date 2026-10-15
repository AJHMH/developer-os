# Conditional owner-approved merge

Implementation reference: [current scope and qualification gates](implementation-status.md). Controlled delivery contracts below are implemented; native production acceptance remains separate from the fixed-worker evidence.

Ticket #11 adds `mergeFeature`, `reconcileMerge` and `refreshMergeBase` to the
public delivery controller. CLI aliases are `merge-feature`, `reconcile-merge`
and `refresh-merge-base`, each with `--id`. No native merge runtime is installed;
the CLI refuses privileged execution without qualified controlled authority.

Merge refreshes trusted check and review observations, then verifies repository,
PR, head, base revision, owner-policy digest, configured merge identity and
effective protections. The trusted adapter must support conditional head **and**
base dispatch and enforce current approval, checks and conversations at the
remote effect boundary without bypass. A cached green observation alone cannot
supply those guarantees. Unsupported controls block; there is no blind merge
fallback and no owner-review submission method.

The ledger persists a checking intent, then a dispatched intent before the write.
Each operation retains a stable ID, publication, exact revisions, policy, adapter
binding and ownership fence. Pause/cancel fence new work while allowing accepted
results to be recorded. Lost or malformed receipts remain uncertain. Restart
reconciles the same operation and verifies PR/head/merge linkage and reachability
on observed main. Only proven quiescent absence permits a new attempt, with fresh
gates. Concurrent recovery of a checking intent fences its original continuation.
A merged candidate is sealed against subsequent publication or review repair.

When remote main advances, merge records the new revision and stops. Base refresh
requires clean locally materialized main at that observed revision and a fresh
remote observation; it never resets, stashes or discards local work. The caller's
qualified reference acquisition remains responsible for materializing main.
Refresh retains the old publication, invalidates review authority, consumes the
existing cumulative repair allowance, validates unchanged advanced main, and gives
the isolated worker the retained candidate plus old/new admitted baseline files.
The repaired output uses normal admission and candidate validation, then normal
signed publication to the existing PR. New commits need fresh checks and owner
approval. Baseline failure, uncertain work and exhausted allowance preserve work
and block progression. An interrupted refresh retains its repair attempt; it does
not reset usage or silently restart the worker.

`merged` is intermediate status. It records the merge commit and observed main,
not successful main checks, synchronization, cleanup or completed delivery.
Ticket 12 now implements controlled main-check verification; synchronization and
cleanup remain tickets 13–14. Native production delivery qualification remains open:
Windows and macOS credentials, protected conditional GitHub effects, race handling,
complete trusted observations, read-only reconciliation and isolation require
observed qualification. Controlled tests are not live readiness evidence.
