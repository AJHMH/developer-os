# Trusted PR check monitoring

Implementation reference: [current scope and qualification gates](implementation-status.md). Controlled delivery contracts below are implemented; native production acceptance remains separate from the fixed-worker evidence.

Ticket 09 adds `monitorPRChecks`, `rerunPRCheck` and `repairPRChecks` to the public
controller. The corresponding CLI commands are `monitor-pr-checks`,
`rerun-pr-check --check-id <id>` and `repair-pr-checks`, each requiring `--id`.
With the owner policy, the CLI installs the native monitor (#268, below).

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

## Native monitor (#268)

`src/native-pr-checks.ts` is the monitor for GitHub Actions. The owner chose
(#268):

- **Identity: the owner's `gh` login**, the same one that pushes. Observing
  only reads. The one write is an explicit `rerun-pr-check`, which reruns that
  run's failed jobs once.
- **Trust: path and unchanged file.** A check counts only from a GitHub
  Actions run of a declared workflow file, for the PR's exact head, while
  that file at the head is byte-identical to the base branch's. A run whose
  workflow the PR changed is reported under the publisher
  `untrusted-workflow-change`, so it never matches the policy.

An owner contract declares such a check with `publisher: github-actions` and
`workflow: <path>@<default branch>`, for example:

```json
{
  "id": "pr-ci",
  "kind": "build",
  "scope": "pr",
  "stages": ["candidate"],
  "command": ["workflow", "ci"],
  "publisher": "github-actions",
  "workflow": ".github/workflows/ci.yml@main",
  "timeoutMs": 1800000
}
```

The check's `id` is the workflow job's name. Each observation reads:
- the PR;
- every Actions run for the head;
- every job of every attempt of the declared workflow's runs, across all
  pages.

So a failure stays in the history after a rerun. A missing page or attempt
makes the observation incomplete. Job statuses map as follows:
- queued and in-progress jobs are `pending`;
- `timed_out` is `timeout`;
- `stale`, `action_required` and unknown conclusions are `missing`.

A rerun is recorded before dispatch. Its receipt is the run's next attempt,
and an unanswered rerun is reported absent only after two minutes.

`monitor-pr-checks`, `rerun-pr-check` and `repair-pr-checks` install the
monitor from `--owner-policy`. It uses the policy's repository and the
workflows of its PR checks declared as above. Its rerun markers live in a
private folder under the state directory. `repair-pr-checks` also takes
`code-feature`'s options, `--production-admission` and
`--publication-identity`, to repair and republish.

### Native PR check acceptance

`scripts/run-native-pr-checks-acceptance.mjs` needs the disposable
repository's `main` to carry `.github/workflows/ci.yml` with one job, `pr-ci`,
that passes unless the PR adds `acceptance/fail`. Through the native
publisher it opens two PRs:

1. **A passing PR:** `pr-ci` must pass, by the controller's own rules.
2. **A failing PR:** it adds the switch, so `pr-ci` must fail.
3. **One rerun of the failure:** its new attempt must be recorded as the
   receipt, with the first failure still in the history.

With the signing key in ssh-agent:

```sh
node scripts/run-native-acceptance.mjs "$HOME/.developer-os/ticket4-macos/state" scripts/run-native-pr-checks-acceptance.mjs -- "$HOME/.developer-os/admission/publication-identity.json" "$HOME/.developer-os/issue09-pr-checks-acceptance-$(date +%Y%m%d-%H%M%S).json" --approve-native-pr-checks
```

## Qualification still required

Controlled fixtures and real temporary signed Git objects establish controller
behavior, not live GitHub authority. Native ports must independently qualify
pagination/history completeness, workflow/App publisher provenance, timestamp and
clock behavior, operation-ID rerun reconciliation, conditional branch updates,
credential isolation and interruption on macOS. The owner Git signer
and App PR transport still require their earlier native qualification.
[Review decisions and final-head approval](review-owner-approval.md), merge, main
verification and completion remain separate gates. Production delivery remains disabled.
