# Windows main-sync fixture push investigation

Status: PARTIAL. No cause or repair is established for the original failure.
The owner authorized separate investigation and 30 additional active minutes
on 16 October 2026, preserving all deadlines and safety checks.

PR #54 head `c3642df`, run `38970239339`, Windows shard 3 job `117206540933`,
failed `remote advancement invalidates green checks and requires newly verified
main`. The unchanged fixture asserted at its first `git push origin main`:
expected status 0, actual null. Its spawn limit was 5,000 ms. No spawn error or
signal was retained, so timeout, process-creation failure and other termination
remain distinguishable hypotheses, not a diagnosed historical timeout.

The helper now retains bounded operation, elapsed time, unchanged timeout,
status, signal, allowlisted error code and stderr byte count. It emits positive
push observations and failures without arguments, paths, environment or error
messages. The original subprocess options, Git isolation, return values and test
assertions remain unchanged. This is retained diagnostic metadata, not a retry,
warmup, shortened workload or timing allowance.

The diagnostic regression runs the existing public test with an external
child-process failure seam. A real never-completing Node child receives the
original five-second spawn options. Before logging, the regression failed because
error metadata was absent; after logging it verifies ETIMEDOUT and the fixed push
operation/limit. This verifies diagnostics; it does not reproduce the unknown
historical Git cause. No private application test hook is introduced.

The separate branch includes PR #54's reviewed pin adoption as a dependency so
required validation can use the independently selected Factory revision. Its
separate PR targets main; it does not bypass PR #54's failed Windows requirement.
Two temporary fresh Windows hosts run the unchanged original selected scenario
once each. The temporary workflow will be removed after results are reconciled.
Passing observations cannot explain or waive the original failure. The first
failed log and structured Windows shard artifact are retained privately.

## Selected-scenario observations

Run `38976063659`, source `f3dbac5`, passed the original selected scenario on
two fresh Windows hosts. Six push observations completed in 164–253 ms with
status 0, no signal and no spawn error. `selected-observations.json` retains
the bounded metadata. The original null-status failure was not reproduced.

This selected workload does not reproduce the original shard's simultaneous
file workload. The next bounded comparison runs the complete original shard
with its unchanged concurrency two and five-second fixture subprocess limit on
two fresh Windows hosts. No additional synthetic load or warmup is introduced.

## Full-shard results and remaining gate

Run `38976227934`, source `5cbf9fa`, passed the unchanged complete Windows
shard 3/8 on both hosts with concurrency two. Each ran 102 tests: 78 passed,
24 existing platform skips, zero failures/cancellations. The two hosts retained
29 Git observations each, with elapsed times 25–324 ms and 46–296 ms.
`full-shard-observations.json` preserves the bounded records and summaries.
The temporary workflow was removed after artifact reconciliation.

These observations do not establish the original error code or cause; no
cause-specific production or fixture behavior repair is justified. The historical
case remains PARTIAL. The retained diagnostic regression passed after failing
before logging; all six local main-sync tests, type checking and formatting
passed. Both review axes found zero actionable initial findings. No original
assertion, five-second deadline, Git isolation or approval rule changed.

Conservatively charge 15 active investigation minutes from the five remaining
plus the newly approved 30: 20 active minutes remain. CI waits are excluded.
No new behavior-repair cycle was used; the prior two-cycle count remains. The
original failed shard and passing probes are separate evidence, not a retry
waiver or a claim that passing diagnostics resolve PR #54's failed check.
