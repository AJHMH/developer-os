# Trusted PR check monitoring

Ticket 09 adds `monitorPRChecks`, `rerunPRCheck` and `repairPRChecks` to the public
controller. The corresponding CLI commands are `monitor-pr-checks`,
`rerun-pr-check --check-id <id>` and `repair-pr-checks`, each requiring `--id`.
The CLI installs no native GitHub monitor. Only explicitly supplied trusted,
controlled adapters can exercise this implementation slice.

## Identity and policy

Monitoring requires a published, locally validated candidate, its retained App PR
identity, repository ownership and unchanged onboarding policy. Every PR-scoped
validation check must declare both `publisher` and `workflow`. The workflow is an
exact owner-controlled identity; the adapter must independently verify the source
workflow and publisher, rather than deriving trust from a check name or output.
Legacy policies without workflow identities cannot monitor PR checks.

Each complete observation identifies the repository, PR, head, base branch, App
author and open state. Check attempts include trusted identity, run ID, attempt,
exact head, timestamps and status. The adapter must retrieve all pages and prior
attempts for that head. Missing history, conflicting terminal results, malformed
values, stale heads and wrong identities block advancement. Extra provider fields
and error text are not retained. Attempts and observations are bounded.

Success advances only to `waiting-review`, never merge or delivery completion.
Pending, missing, skipped, neutral and cancelled evidence remains incomplete unless
the pinned owner policy explicitly allows that status. Exceptions do not authorize
spoofed identity or an unobserved PR. Failed attempts remain visible after retries;
a passing rerun is flaky unless an owner-controlled flake policy covers it.

## Waiting and interruption

One monitoring call performs at most one bounded external observation. Repeated
ordinary calls within five seconds reuse retained state. There is no background
polling loop. The phase start and last observed clock persist across restart,
pause and downtime. These waits do not consume active repair time.

An explicit hosted check timeout overrides the 60-minute default; local command
limits remain unchanged. Expiration or clock regression creates a durable timeout
blocker and stops ordinary polling. Read-only reconciliation of an unresolved
rerun remains possible after timeout, without reopening success or write authority.
Longer declared deadlines are not replaced by a fixed poll-count cutoff.

Observation generations prevent a late response from replacing a newer poll.
Pause/cancel preserve accepted observations but do not advance the delivery.
Changed runtime bindings fail closed at admission and dispatch. Restart reads the
same real ledger; it neither resets deadlines nor invents a fresh rerun allowance.

## Diagnostic reruns and repair

One explicit diagnostic rerun intent is allowed per unchanged published head.
The operation ID and failed check/run/attempt are saved before dispatch. Lost or
invalid acknowledgments remain uncertain. A trusted receipt must establish
acceptance or quiescent absence; a late callback cannot dispatch after uncertainty.
Accepted reruns must produce a new attempt before repair can proceed. No repeated
write is inferred from a missing response. Unresolved reruns prevent release.

A fresh complete observation of terminal trusted failures can enter the existing
cumulative repair loop. Missing/stalled/untrusted evidence cannot authorize repair.
The original publication is retained in `publicationHistory` before local repair;
its failure batch survives interruption. Repair still uses the three-cycle/60-active-
minute default, explicit owner extensions and isolated revalidation.

A changed, successfully repaired candidate can be published to the same PR. Its
signed commit has the previous published commit as parent. The Git port must
atomically require that exact old branch tip, and must reject unrelated changes;
no blind overwrite is allowed. Existing PR identity must be observed again and
match the prior PR number. Lost update outcomes use publication reconciliation.
A new managed head receives new check evidence and a new CI phase deadline, while
old evidence and cumulative repair usage remain retained. Unchanged output cannot
manufacture a new head merely to hide an unexplained failing retry.

## Qualification still required

Controlled fixtures and real temporary signed Git objects establish controller
behavior, not live GitHub authority. Native ports must independently qualify
pagination/history completeness, workflow/App publisher provenance, timestamp and
clock behavior, operation-ID rerun reconciliation, conditional branch updates,
credential isolation and interruption on Windows and macOS. The owner Git signer
and App PR transport still require their earlier native qualification.
[Review decisions and final-head approval](review-owner-approval.md), merge, main
verification and completion remain separate gates. Production delivery remains disabled.
