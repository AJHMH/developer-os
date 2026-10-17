# Windows shard 1 baseline runtime investigation

Status: PARTIAL. Local and remote main are synchronized at `9096ab6`, whose
native, Factory and CodeQL workflows passed. The historical main `ab8ceb1`
Windows shard 1 ten-minute deadline failure remains unexplained. The owner
authorized this separate baseline investigation before actual-fixture Git phase
capture. No cause-specific repair is established.

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
The temporary workflow was removed after results were reconciled. Missing or
failed snapshots remain missing evidence; instrumented timings have probe cost.

## Native observations and outcome

[Run 38982598047](https://github.com/AJHMH/developer-os/actions/runs/38982598047)
at diagnostic revision `7f35e91455329d710fbcd8199fd36e5f3b488b14` passed on both
Windows hosts: 63/63 tests each, zero skips, failures or cancellations. Test runner
wall times were 374.187 and 456.290 seconds. All 20 snapshots per host completed;
none reported snapshot failure. Both artifacts were downloaded before cleanup.
The bounded numeric/file-family summaries are in `native-observations.json`.

Each host recorded 9,524 Git calls in test-file processes. Their summed Git times
were 521.856 and 420.359 seconds across concurrent files; these are not wall time.
The slower host spent less summed time inside these synchronous Git calls, so a
Git-only explanation is insufficient. Review resolution took 175.08/220.11 seconds,
conditional merge 158.19/181.88, and main-sync admission 95.21/122.45. These healthy
instrumented observations do not reproduce the historical deadline failure,
identify its cause, or establish that main is green. No production repair is made.

The preload and filesystem-failure control remain explicitly opt-in under scratch;
normal tests and required workflows do not load them. The temporary two-host
workflow is removed. No assertions, command arguments, subprocess deadlines,
ten-minute job limit, coverage thresholds, approval requirements or isolation
rules changed. At that checkpoint, Issue 04 remained paused behind the unresolved main baseline.
Actual required main-sync Git phase capture remains pending.

Allowance ledger: the owner added 30 active minutes and two repair cycles to the
previous five minutes/three used cycles, then explicitly authorized using that
extension for this separate baseline investigation. Charge 15 active minutes for
this profiling slice (CI waits excluded), leaving 20 active minutes and the two
additional repair cycles. The new implementation/control was validated before
publication; no cause-specific repair cycle or unchanged-main retry was used.
Restarting or opening this diagnostic PR does not reset those limits.

## Continued investigation after PR 57

Main `9096ab6bc2b3df07a0f000437a13341b6b37c8f5` is synchronized locally.
Native CI run `38989321715`, Factory run `38989322030` and CodeQL run
`38989321741` all passed. The original historical failure remains unexplained.
PR 57's uninstrumented required shard 1 also passed all 63 cases in 358.913 seconds.

The slower profiling host spent less time inside measured Git calls, but more time
outside them: review resolution elapsed/Git/self CPU was 220.11/109.32/11.7 seconds,
versus 175.08/136.91/13.9 on the other host. The remainder is not automatically
filesystem latency, CPU starvation or a specific blocked operation.

Next prediction: if synchronous filesystem waits explain that unmeasured time,
fixed-operation filesystem totals should account for a substantial portion of it.
A separately opt-in `AIOS_FILESYSTEM_PROFILE=1` extends the preload with operation
counts, totals and maxima only. No paths, contents, arguments or errors are recorded.
Native success/refusal behavior and `realpathSync.native` are preserved. Nested
filesystem calls and diagnostic snapshot writes are excluded from ordinary totals.
SQLite native calls, asynchronous waits and scheduling delays are not measured by
these filesystem wrappers; an unexplained remainder cannot establish their cause.

A real filesystem control fails with the pristine profiler (missing measurements)
and passes with this extension. It verifies returned contents, ENOENT refusal,
native path identity and absence of private path/content values in reports. The
original report-write-failure/deadline control passes with profiling enabled.
Two-axis review found no actionable findings before publication.

A temporary two-host native observation uses unchanged full shard 1/8, file
concurrency two and ten-minute job deadline. It was removed after retaining
all outcomes. This is an instrumented changed-revision observation, not an
unchanged-main rerun or a cause-specific repair.

### Filesystem observation results

[Run 38990169762](https://github.com/AJHMH/developer-os/actions/runs/38990169762)
at `86c307caef833e4647df5126381c9ed29526c095` passed on both native hosts: all
63 tests each, zero skips/failures/cancellations, in 326.977 and 378.657 seconds.
All 20 snapshots per host completed without snapshot failures. Artifacts were
downloaded before removing the temporary workflow. Full bounded test-file
summaries are retained in `filesystem-observations.json`.

Measured filesystem totals across concurrent test files were 8.557 and 6.730
seconds. Review resolution accounted for 1.469/1.676 seconds of filesystem time
within 137.12/165.61 seconds elapsed. These observations do not support measured
JavaScript filesystem calls as the dominant cost on these healthy hosts. They do
not exclude native SQLite I/O, asynchronous waits, scheduling delays or filesystem
costs in child processes, and do not resolve the historical failed-host cause.
No production optimization or deadline change is justified by this evidence.

The temporary workflow is removed; the extension remains explicitly opt-in only.
Native commands, assertions, all limits and safety checks remain unchanged.
Charge a further ten active investigation minutes, excluding CI waits: ten active
minutes and two additional repair cycles remain from the prior owner extension.
No cause-specific repair cycle or unchanged-main rerun was used. The next useful
boundary, if pursued within that allowance, is native SQLite execution timing;
it has not yet been captured. Main-sync Git phase capture also remains pending.
