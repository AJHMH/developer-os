# Ticket 13 controlled implementation receipt

Date: 15 October 2026. Starting main: `e5ee07d1cce3bd722244dc48326c2ea2b7fde3c6`
(PR #36). Branch: `codex/ticket13-safe-main-sync`.

## Implemented scope

The public `syncMain` operation refreshes trusted ticket 12 main checks, verifies
current repository/checkout/ref observations, persists synchronization intent and
uses a conditional controlled Git boundary. It admits only a clean fast-forward;
owner changes, local-only/divergent history, changed identity, other worktree use
and advanced unverified main block effects. The requested controls forbid stash,
reset, rebase, force-push and candidate-selected hooks/filters/includes/environment.

Final independent observations establish exact local/remote/HEAD alignment and
quiescence. `reconcileMainSync` and public recovery never redispatch effects.
Uncertainty blocks retry/release, old dispatch callbacks are fenced when recovery
starts, and per-observation tokens reject late responses. Pause/cancel, policy,
main-check and adapter changes cannot grant fresh effect authority. A synchronized
phase does not complete delivery; eligible cleanup remains ticket 14.

See [contract](../../docs/main-synchronization.md) and
[ticket](issues/13-safe-main-sync.md).

## Evidence boundary

Public tests use real temporary working repositories, real bare remotes, actual
fetches, branch switching and fast-forward merges. The strengthened fixture changes
tracked HTML bytes at the target and verifies those bytes after synchronization.
Trusted GitHub identity/checks, exclusive operation authority and some race
observations remain controlled. Native Windows/macOS Git transports and locking
are not implemented or qualified; CLI commands refuse without trusted adapters.
No live provider, production repository synchronization, publication, merge or
branch deletion was performed by these tests.

## Validation

- `npm run typecheck`, build, formatting and `git diff --check`: passed.
- Full suite with `AIOS_TEST_PYTHON=/usr/bin/python3 npm test`: **519 tests, 517 passed, two platform skips, zero failures** (317.3 seconds). Synthetic localhost services were permitted; no live provider calls.
- Focused synchronization/main-check/control regressions: **49 passed**, zero failures. Additional admission regressions: **five passed**.
- Final synchronization run with the strengthened changing-file fixture: **21 passed**, zero failures (119.7 seconds). Logs are retained locally at `/private/tmp/ticket13-full-suite.log`, `/private/tmp/ticket13-focused.log`, `/private/tmp/ticket13-admission.log` and `/private/tmp/ticket13-final-sync.log`; temporary logs are not permanent repository artifacts.
- No hosted CI, native Windows/macOS qualification or independent agent review has run for this branch.

Initial tests
caught a nested ledger read inside the intent transaction; the guard now evaluates
transaction-local state. Remote-advancement tests respect ticket 12's persisted
polling interval before requesting a new revision observation. Recovery regressions
cover lost results, in-flight timeout, late observations, dispatch races, cancellation
and configuration refusal. These are implementation tests, not native acceptance.

All 21 pre-existing local-only snapshots retain their original SHA-256 values and
remain untracked. Dated refused native attempts and successful reports are preserved;
no historical approval is reused.

## Remaining qualification

Parent 04 and the native acceptance of 05–13 remain open. Qualify trusted native
transports, credential/configuration isolation, checkout/ref/worktree authority,
actual concurrent writers, bounded process/descendant shutdown, interrupted effects
and the complete integrated path independently on Windows and macOS. Tickets 14–17
remain unfinished. Production delivery remains disabled.


## Merged evidence update — 15 October 2026

Controlled implementation is merged (PR #37 for ticket 13, PR #38 for ticket 14).
PR #39 at main `c63ee3ad7a8b96521f148175633ddcbd38716f43` restores all 15
publication recovery cases overwritten during the earlier test split. The prior
retention assertions in historical scheduling notes do not supersede that audit:
see [restoration evidence](publication-recovery-restoration.md). All 24 current-main
checks pass, including eight Windows shards and both independent approval checks.
Manual local main synchronization preserved tracked content and 21 untracked owner
snapshots. These observations close controlled implementation/merge verification;
the remaining native acceptance above is still open. Ticket 15 has started with
scope clarification and a complete-controller prerequisite/acceptance matrix;
no complete-controller Windows qualification is claimed.
