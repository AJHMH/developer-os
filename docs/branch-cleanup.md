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

## CLI and qualification boundary

The CLI recognizes `cleanup-branches --id <id>` and `reconcile-cleanup --id <id>`.
It installs no native cleanup adapter and refuses unqualified authority. A trusted
controller caller supplies `BranchCleanupRuntime` alongside the existing main
observer and synchronization adapters; candidate files cannot select these ports.

Public tests use real temporary Git working trees and bare remotes. Actual local
expected-old reference deletion and remote lease-conditioned deletion are exercised,
including races introduced after inspection. Linked-worktree exclusions are real;
GitHub PR linkage, effective protections and operation quiescence remain controlled
observations. These tests do not qualify native credential-bearing transports,
remote protection/worktree races, exclusive authority or process shutdown.

Parent 04, native integration acceptance in 05–14, independent complete-controller
Windows/macOS qualification (15–16), and the observed pilot (17) remain open.
