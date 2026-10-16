# Windows shard 1 baseline runtime investigation

Status: PARTIAL. Main `ab8ceb1` and local main are synchronized. Required Windows
shard 1 exceeded its unchanged ten-minute job limit; the Windows aggregate failed.
Main is not green. The owner authorized this separate baseline investigation on
16 October 2026 using the recently extended time/cycle allowance, before resuming
actual-fixture Git phase capture. No cause-specific repair is established.

## Original failure

Run `38981203862`, job `117242220975`, started 23:23:47 UTC and completed
23:33:54 UTC. GitHub annotated: “The job has exceeded the maximum execution time
of 10m0s”. It cancelled the test step; the always-run shard artifact uploaded
successfully. Its original log and `windows-tests-1` artifact were retained before
any retry. The remaining main Factory and CodeQL workflows passed. A separate
stale approval-refresh event correctly refused the already merged PR; no mutation
or approval was granted.

Compared with the last passing main shard (`38978241360` at `92447c2`), 30 common
emitted cases over 100 ms have a median duration ratio of 1.705. Their aggregate
test durations are 926.383 versus 461.668 seconds; parallel case totals are not
wall-clock duration. Several conditional-merge and main-sync cases take 61–79
seconds. Node buffers output, so the last printed case does not identify a hung
file. No original failed-host resource trace exists.

## Predictions and bounded capture

Predictions: many slow Git processes inflate otherwise completing files; one
active file fails to finish; or the runner stalls independently of application
CPU. The explicit opt-in profiler captures fixed command-family counts, totals
and maxima, test-file basenames, numeric resource data and an in-flight family.
It records no command arguments, environment values, stdout/stderr or credentials.
An in-flight family describes only the last checkpoint; that command may have
finished after the snapshot, so it does not prove a native command was hung.
The original workload and subprocess results are returned unchanged.

Initial progress is retained before synchronous work. Checkpoints are at most
once per two seconds, including before a native command that could block timer
callbacks. Timer handles are unreferenced. A real filesystem write-failure control
failed before initial progress existed and passes after capture was added: a bad
report destination does not interrupt the child's original one-second control
deadline. That synthetic control does not reproduce the historical shard cause.

Two temporary native hosts run the exact full shard 1/8 with unchanged concurrency
two and the original ten-minute job limit. Always-run artifact retention matches
the mechanism demonstrated on the cancelled original job. No warmup, stress,
threshold change, command exemption or unchanged-main rerun is introduced. These
are instrumented changed-revision observations, not replacements for required CI.
The temporary workflow will be removed after results are reconciled. Missing or
failed snapshots remain missing evidence; instrumented timings have probe cost.
