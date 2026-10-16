# Coverage baseline runtime repair

Status: implementation validated locally in focused tests; full/hosted validation pending.

The owner authorized this separate baseline repair on 16 October 2026 before resuming Issue 04. Production qualification and dispatch remain disabled.

## Failure and diagnosis

Main `32d29a5de11d5a40d0da5fd724650e2825c510e6`, Factory run `38930397889`, passed install, build, unit tests, integration tests and head instrumentation (95.208 seconds). Base instrumentation of `1fe02cc983f9f05f215ad5a32068655fb6071ddd` reached its existing 120-second deadline at 120.009 seconds and was killed. No coverage-threshold verdict was produced. The dependent human-approval jobs therefore failed too.

The same base passed PR #47 instrumentation in 94.971 seconds. Both attempts are retained; this repair does not claim an identified host scheduler event caused their difference.

A reproduction using the exact base snapshot, collector executor and 120-second limit timed out locally both with and without coverage. Thus coverage alone does not explain the execution cost. The complete inventory is necessary for the deadline feedback loop; deleting tests would measure a different gate.

Temporary, non-authoritative Linux probes in run `38933098728` used four independent four-CPU runners and the exact base snapshot. Concurrency 1 and 2 timed out; concurrency 4 passed in 82.599 seconds; concurrency 8 passed in 78.749 seconds. The small 4/8 difference does not justify changing the existing four-file bound. Probe failures remain retained. The temporary workflow and script are removed from the final change.

Profiling a full public controller coding/validation/publication lifecycle found 60 configuration queries and 91 revision queries: source admission ran 30 times, duplicating configuration reads and separately querying the root and HEAD every time. Git processes consumed about 2.1 of the lifecycle's 2.3 seconds. This identifies avoidable work in a frequently repeated safety check, rather than an assertion or coverage-policy failure.

## Change

Keep every source-admission invocation fresh. Query the complete Git configuration once, with system/global configuration and ambient Git overrides excluded by the existing sanitized runner, and includes disabled. The list retains local and worktree declarations, including overridden values; helper/include declarations still refuse admission before working-tree observation.

Read the canonical root and HEAD in one `rev-parse` invocation. Split at the final newline to preserve embedded root line breaks. Retain native root comparison, expected-revision comparison, clean-tree status, immutable tree/blob reads and ordinary-file verification. No source state is cached.

## Evidence and limits

- Same synthetic public lifecycle: 2.307 seconds before, 1.768 seconds after; 60 fewer Git processes. A private diagnostic two-second target went red before and green after. It is not a new policy deadline or a timing assertion added to the test suite.
- All 52 existing focused source-admission tests passed after the change, including local/worktree helper refusal, input drift, dispatch authority and recovery.
- Added preservation scenarios pass for a canonical root containing a line break and local/worktree include declarations. Windows explicitly skips the line-break path scenario because its filenames cannot contain that character.
- Build and type checking pass. Full suite, final reviews and hosted coverage remain required before readiness.
- All pre-existing tests and the 21 owner snapshot files must remain preserved. No test is removed or skipped beyond existing platform restrictions and the new POSIX-only path scenario.

The 120-second contract limit, collector concurrency, coverage thresholds, scanners, approval rules and all production qualification gates are unchanged. Hosted head/base instrumentation must still pass; local timing improvement alone does not establish a repaired baseline. Issue 04 implementation remains paused until a reviewed repair merges and main validation passes.
