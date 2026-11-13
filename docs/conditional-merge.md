# Conditional merge

Implementation reference: [current scope and qualification gates](implementation-status.md). Controlled delivery contracts below are implemented; native production acceptance remains separate from the fixed-worker evidence.

Ticket #11 adds `mergeFeature`, `reconcileMerge` and `refreshMergeBase` to the
public delivery controller. CLI aliases are `merge-feature`, `reconcile-merge`
and `refresh-merge-base`, each with `--id`. With the owner policy, the CLI
installs the native merge (#270, below).

Merge refreshes trusted check and review observations, then verifies repository,
PR, head, base revision, owner-policy digest, configured merge identity and
effective protections. The trusted adapter must support conditional head **and**
base dispatch and enforce current approval, checks and conversations at the
remote effect boundary without bypass. "Current approval" is the review run's
authorization for the exact head: the owner's approval for a gated change, or
the change gate's ungated classification (ADR 0005, see
[review](review-owner-approval.md#change-gate-adr-0005)). A repository that
relies on the change gate must not also require an approving review in its
branch protection (onboarding, #230). A cached green observation alone cannot
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

## Native merge (#270)

`src/native-merge.ts` merges by **fast-forward**, as the owner chose (#270).
Your `gh` login, the same one that pushes the feature branch, pushes the PR's
exact validated head to the default branch with a lease on main's expected
revision. That one atomic push is conditional on both the head and the base,
and main becomes exactly the owner-signed, checked commit. GitHub then marks
the PR merged. The merge API is never used, so no commit is written for the
merge.

- **Observation:** the PR, main's tip, your login and permission, the branch
  rules, and the current owner policy digest. `protectionsEnforced` needs
  signed commits, blocked force pushes and blocked deletion. `gatesEnforced`
  needs every one of the policy's required checks as a required status check,
  so GitHub itself refuses a push of an unchecked head. The head and base
  conditions are the push's own.
- **Merge:**
  1. It records the intent before dispatch.
  2. It fetches the PR's head and main into its own isolated Git, with no
     system or global configuration and no hooks.
  3. It refuses unless both are exactly as expected and the head descends from
     main's expected revision.
  4. It pushes.
  5. It waits up to 30 seconds for GitHub to link the PR.
- **Receipt:** merged only when main contains the head and GitHub reports the
  PR merged. The merge commit is the head itself. A push that lost the race
  to main is absent, and settled only after two minutes.

`merge-feature` re-checks the PR checks, the review and the production
admission right before it pushes, so it also takes `--podman-machine`,
`--validation-admission` and `--production-admission`. `reconcile-merge` only
observes and takes the owner policy alone. `refresh-merge-base` also takes
`code-feature`'s options, `--production-admission` and
`--publication-identity`, to repair and republish onto advanced main.

The real delivery run accepts it natively with `--through-merge`; see
[the first real delivery](feature-candidate.md#the-first-real-delivery---through-review).

`merged` is intermediate status. It records the merge commit and observed main,
not successful main checks, synchronization, cleanup or completed delivery.
Ticket 12 now implements controlled main-check verification; synchronization and
cleanup remain tickets 13–14. Native production delivery qualification remains open:
macOS credentials, protected conditional GitHub effects, race handling,
complete trusted observations, read-only reconciliation and isolation require
observed qualification. Controlled tests are not live readiness evidence.
