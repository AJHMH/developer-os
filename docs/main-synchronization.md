# Safe main synchronization

Issue 13 implements a controlled controller boundary for synchronizing clean local
main to the exact remote revision whose trusted main checks passed. It does not
complete delivery, delete branches or enable native production execution.

## Controller operations

`syncMain(id)` refreshes ticket 12 main evidence before inspecting current remote
refs and the canonical checkout. The trusted synchronization adapter must verify
repository/default-branch identity, checkout/head/local-main/remote-main refs,
cleanliness, ancestry and other worktree use. Dirty tracked, staged, untracked or
ignored work, local-only commits, divergence, missing identity and unsupported
race protection block synchronization without discarding work.

A durable attempt records its operation ID, ownership fence, merge linkage,
policy/adapter binding, previous local main and verified target before dispatch.
The adapter receives the exact expected observation and a live `mayDispatch`
gate. It must acquire exclusive authority over the checkout and refs, recheck
those expectations and refuse races before switching to main and fast-forwarding.
Hooks, filters, includes and candidate environment cannot select executable
helpers. No stash, reset, rebase, force-push or history discard is permitted.

A successful return from Git is insufficient. A new independent observation must
confirm clean local main, current HEAD and remote main all match the recorded
verified target, with no outstanding operation that could later alter them.
Remote advancement invalidates main-check authority and requires fresh checks.

`reconcileMainSync(id)` and `recover(id)` observe existing attempts without
redispatch. Recovery performs no checkout/local-main or remote-branch writes;
its observer may fetch objects and refresh observation refs. Timeout, lost response or incomplete shutdown evidence remains
uncertain; no new attempt or ownership release is permitted until the exact old
operation is proven quiescent. Starting reconciliation revokes its old dispatch
callback. Observation tokens prevent late recovery responses from replacing a
newer result. Read-only recovery can run while paused/cancelled, but never resumes
work or removes those controls. Binding or policy drift blocks advancement.

The durable `main-synchronized` phase identifies recorded alignment, not delivery
completion. Ticket 14 still owns eligible cleanup and the completion decision.
Any later observation of changed refs or failed checks revokes alignment.

## CLI and qualification boundary

The CLI recognizes `sync-main --id <id>` and `reconcile-main-sync --id <id>`.
It installs no native synchronization adapter and refuses unqualified authority.
Controller callers must supply a trusted `MainSyncRuntime` together with the
qualified read-only main-check boundary. Repository files cannot configure ports.

Tests exercise real temporary Git repositories and local bare remotes through a
controlled trusted adapter. GitHub identity, checks and exclusive-authority
observations remain fixtures. These tests establish the controller contract;
they do not qualify credential-bearing transports or prove native cross-process
locking on Windows/macOS. Both platforms still need independent evidence for
transport/configuration isolation, fetch/ref/worktree races, bounded descendant
shutdown, interrupted effects and the full integrated delivery path.

Parent 04 and tickets 14–17 remain open. Prior fixed worker qualification and
manual agent Git operations do not supply this native acceptance or authorize
new inference.
