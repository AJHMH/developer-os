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
