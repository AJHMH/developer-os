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

## Native main sync (#272)

`src/native-main-sync.ts` works in the delivery's own checkout. It fetches
the default branch through your `gh` login, from the repository's own GitHub
URL, into the origin tracking ref. Then it fast-forwards local main to exactly
the verified revision. Every Git step runs with:
- no system or global configuration;
- an empty hooks folder;
- fsmonitor off;
- one allowed protocol.

A checkout whose own configuration names filters or includes is refused, as
is one whose origin is another repository.

It never switches branch, stashes, resets, rebases or forces. The checkout
must:
- already be on main;
- be clean, with no tracked, staged or untracked work;
- have main checked out in no other worktree;
- have local main as an ancestor of the target;
- have no Git lock held.

**Ignored files are allowed** (owner's choice). The fast-forward runs with
`--no-overwrite-ignore`, so if the new main would overwrite an ignored file,
it aborts and nothing is lost. Git's default would overwrite it. Right before
the write, it observes everything again and refuses any difference.

`sync-main` re-checks main first, so it installs the main observer too.
`reconcile-main-sync` only observes. Both take `--owner-policy`.

### Native sync acceptance

The real delivery run's `--through-sync` continues after main verification,
once the clone has been shown unchanged:
- `sync-main` must fast-forward the clone's local main to exactly the verified
  revision, on main and clean;
- `reconcile-main-sync` must then find it aligned.

```sh
node scripts/run-native-acceptance.mjs "$HOME/.developer-os/ticket4-macos/state" scripts/run-native-cli-delivery-acceptance.mjs -- aios-macos-noshare "$HOME/.developer-os/admission/claude-coding-admission.json" "$HOME/.developer-os/admission/validation-admission.json" "$HOME/.developer-os-auth" "$HOME/.developer-os/issue13-sync-delivery-$(date +%Y%m%d-%H%M%S).json" --approve-metered-native-run --through-sync "$HOME/.developer-os/admission/publication-identity.json" "$HOME/.developer-os/admission/production-admission.json"
```

### Native results (13 November 2026)

The Mac passed with outcome `observed-native-delivery-through-sync`, from
`main` at `eee53f0`
([receipt](../.scratch/aios-v1-implementation/ticket13-macos-sync-delivery-receipt.md)).
A real delivery merged
[AJHMH/aios-publication-acceptance#15](https://github.com/AJHMH/aios-publication-acceptance/pull/15),
and main was verified at `26f4541d…`. `sync-main` then fast-forwarded the
delivery's clean checkout from `0eb21835…` to exactly `26f4541d…`, and
`reconcile-main-sync` found it aligned.

An earlier run blocked before publication because ssh-agent held no signing
key. Load it with `ssh-add --apple-use-keychain ~/.ssh/id_ed25519` before a
run.

## CLI and qualification boundary

The CLI recognizes `sync-main --id <id>` and `reconcile-main-sync --id <id>`.
With the owner policy, it installs the native main sync (#272, below).
Controller callers must supply a trusted `MainSyncRuntime` together with the
qualified read-only main-check boundary. Repository files cannot configure ports.

Tests exercise real temporary Git repositories and local bare remotes through a
controlled trusted adapter. GitHub identity, checks and exclusive-authority
observations remain fixtures. These tests establish the controller contract;
they do not qualify credential-bearing transports or prove native cross-process
locking on macOS. Native evidence comes from the native sync results above and
the [complete controller qualification](macos-controller-qualification.md),
whose delivery ran through sync and cleanup.

Tickets 13, 14 and 16 are closed; the pilot (17) remains open. Manual agent Git
operations do not supply this native acceptance or authorize new inference.
