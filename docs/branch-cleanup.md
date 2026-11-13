# Eligible branch cleanup and controlled completion

Issue 14 extends the controlled delivery lifecycle after verified main
synchronization. `cleanupBranches(id)` inventories every local and remote non-main
branch through a trusted adapter, records eligibility before any deletion and
reports independent outcomes. `reconcileCleanup(id)` and `recover(id)` observe
existing operations without dispatching deletions. Production remains disabled.

## Eligibility and retention

Each inventory is bound to the canonical repository/checkout, default branch,
verified main revision, owner policy and adapter binding. Missing, malformed,
duplicate or incomplete inventory is a blocker. Local and remote tips are separate
candidates even when they share a branch name. Both main tips must be present and
consistent with the verified target; main is never a deletion candidate.
Case-folded or Unicode-equivalent namespace collisions refuse the entire plan.

Protected, Factory replay/event and active-worktree branches are retained with
explicit reasons. Unmerged branches are also retained; they require a separate
owner decision outside automatic cleanup. Replay evidence is never migrated by
this operation. Expected retention does not prevent controlled completion.

Ordinary ancestry into the exact verified main establishes integration. Otherwise,
trusted complete PR linkage must establish that the unchanged current head was
merged to the selected base and its merge result is reachable on that main.
Newer tips are retained. Ambiguous linkage or unknown integration blocks cleanup;
unsupported conditional deletion never falls back to blind deletion.

A durable round retains each bounded fact, eligibility decision, original reason
and evidence digest. Each eligible local/remote effect gets its own operation ID
before dispatch. The adapter must recheck current tip, main, policy, protection
and worktree state under exclusive authority, then condition acceptance on the
expected tip and live controller fence. Native qualification must prove these
semantics; a client-side precheck alone is insufficient.

## Recovery and completion

Timeout or lost response never permits a blind retry. The controller separately
observes exact operation quiescence and current branch presence. An absent ref
without proof that delayed senders are stopped is insufficient. Local success can
coexist with a remote refusal; both records survive restart. Read-only recovery
revokes the original runner's dispatch capability and does not continue its
remaining deletions. A later explicit cleanup request can build a fresh plan only
after old effects are reconciled.

Deletion-outcome recovery can record acceptance even if main or policy subsequently
changes. That observation supplies no new deletion or completion authority. Before
completion, the controller refreshes trusted main checks and alignment and obtains
a fresh complete branch inventory. New eligible branches, changed exclusions,
uncertain/failed deletions or unknown eligibility block completion. Observation
identities prevent stale responses from replacing newer decisions. Paused and
cancelled deliveries stay stopped during recovery.

`phase: completed` identifies the **controlled** lifecycle result. Its evidence
retains the verified/synchronized revision, deleted and retained branches, blocked
outcomes and next action. `cleanup.mode` is `controlled` and `productionEnabled`
remains false. A completed stopped delivery permits explicit ownership release;
cleanup does not manufacture approval, repeat a merge or create another PR.

## Native branch cleanup (#273)

`src/native-branch-cleanup.ts` works in the delivery's own checkout, with the
same isolated Git as the native main sync (`src/native-git.ts`): no system or
global configuration, an empty hooks folder, fsmonitor off, one allowed
protocol, and your `gh` login as the only credential helper. A checkout whose
configuration names filters or includes, or whose origin is another
repository, gets no inventory.

**Inventory.** It fetches every remote branch into the origin tracking refs,
then lists the remote branches through GitHub. Each tip must match the fetch;
a branch that moved in between makes the inventory incomplete. For every local
and remote branch it records:
- **protected:** GitHub's classic branch protection, or an active ruleset
  deletion rule for that name. A local branch shares its remote name's;
- **replay-retained:** the Software Factory's event branches,
  `feat/factory-remediation-<32 hex>`, which it keeps for durable replay;
- **active worktree:** a local branch checked out in any worktree;
- **ancestry** into main's exact tip;
- **PR history**, for a branch not in main's history: its merged PRs into
  main by branch name. The PR for exactly this tip counts, or else the latest,
  whose different head makes the branch a newer tip. Its merge commit must be
  in main's history. A full page of history, or any unavailable answer, makes
  the linkage ambiguous, which blocks cleanup.

It is quiescent only when none of its own deletions is running and the
checkout's index, HEAD, packed-refs and branch locks are free.

**Removal.** It takes the whole inventory again, and requires the same main,
the same owner policy digest and the same tip. It re-applies the cleanup
decision, and checks the controller fence once more. Only then does it delete,
conditioned on the evaluated tip:
- locally, with `update-ref -d` and the old value;
- remotely, with a push that deletes the branch under a lease on that tip,
  through your `gh` login and under GitHub's own branch rules. Then it drops
  the stale tracking ref, only while that still names the tip.

Protected, replay, worktree, unmerged and newer branches are never deleted,
and neither is main.

Cleanup deletes **every** branch merged into the verified main, not only the
delivery's own, as the specification requires. A completed cleanup completes
the delivery. `phase: completed`, with the cleanup round, is the completion
report: the verified and synchronized revision, each deleted and retained
branch with its reason, and the next action.

### Native cleanup acceptance

The real delivery run's `--through-cleanup` continues after main sync.
`cleanup-branches` must:
- delete the delivery's merged feature branch on GitHub;
- keep every retained branch;
- complete the delivery.

`reconcile-cleanup` must then find the same single completed cleanup. On the
disposable repository, every other branch already merged into main is deleted
too. Open and unmerged PR branches are kept.

```sh
node scripts/run-native-acceptance.mjs "$HOME/.developer-os/ticket4-macos/state" scripts/run-native-cli-delivery-acceptance.mjs -- aios-macos-noshare "$HOME/.developer-os/admission/claude-coding-admission.json" "$HOME/.developer-os/admission/validation-admission.json" "$HOME/.developer-os-auth" "$HOME/.developer-os/issue14-cleanup-delivery-$(date +%Y%m%d-%H%M%S).json" --approve-metered-native-run --through-cleanup "$HOME/.developer-os/admission/publication-identity.json" "$HOME/.developer-os/admission/production-admission.json"
```

### Native results (13 November 2026)

The Mac passed with outcome `observed-native-delivery-through-cleanup`
([receipt](../.scratch/aios-v1-implementation/ticket14-macos-cleanup-delivery-receipt.md)).
A real delivery merged
[AJHMH/aios-publication-acceptance#16](https://github.com/AJHMH/aios-publication-acceptance/pull/16),
and main was verified and synchronized at `881d6806…`. `cleanup-branches` then:
- deleted 5 branches: this delivery's feature branch, locally and on GitHub,
  and the merged feature branches of three earlier deliveries;
- kept 13 unmerged branches;
- completed the delivery.

Cleanup took 215 seconds, because each removal re-takes the whole inventory.

## CLI and qualification boundary

The CLI recognizes `cleanup-branches --id <id>` and `reconcile-cleanup --id <id>`.
Both take `--owner-policy`. With it, the CLI installs the native branch cleanup,
and the main observer and main sync, because cleanup re-checks main and its
alignment first. Without it, cleanup refuses. Candidate files cannot select
these ports.

Public tests use real temporary Git working trees and bare remotes. Actual local
expected-old reference deletion and remote lease-conditioned deletion are exercised,
including races introduced after inspection. Linked-worktree exclusions are real.
The native adapter's tests use a GitHub stand-in for protection, rulesets and
PR history. Production remains disabled; the observed pilot (#275) remains.
