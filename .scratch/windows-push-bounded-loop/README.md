# Bounded native Windows push reproduction loop

Status: PARTIAL, native observations pending. Main a9efc28 is synchronized and
passed all native, Factory and CodeQL checks. Its 26 fixture pushes passed; the
slowest healthy trace spent most extra time inside transport/child completion.
The earlier actual required failure remains ETIMEDOUT at 5014 ms with no phase
trace. No cause-specific repair is established.

The owner approved 60 additional active investigation minutes for this bounded
reproduction experiment. Carry forward one unused repair cycle; neither this
extension nor a new branch resets prior cycle usage. CI waits are excluded.

## Workload and stop rule

Two fresh native Windows x64 jobs each initialize the existing public syncFixture,
including its original two setup pushes. Without a preparatory warmup, each then
performs up to 100 additional pushes, one per newly initialized private bare
remote, through the unchanged f.run/f.g seam. Each call retains the existing Git
isolation arguments/environment and 5000 ms subprocess deadline. This varies the
number of disposable remotes; it is not the original full shard or a required-CI
replacement. No stress threads, parallel fixture workers or automatic retry are
added. The original ten-minute job limit remains unchanged.

The first refused setup, initialization, selection or push stops that host and
fails its test. Fail-fast false in the matrix lets the other independent host
complete its own observation; it does not retry the failed host. Initial fixture
failure is not reported as a successful loop. JSON body outcome describes the
loop body only; TAP/job results additionally govern fixture cleanup and full-host
success. The report retains numeric progress and fixed stage labels, not paths,
arguments or error messages. Existing bounded Trace2 records retain native phases.
All artifacts upload on success, failure or cancellation when available; missing
artifacts remain missing evidence.

Normal tests, production code, assertions, qualification and all safety checks
are unchanged. Only newly created synthetic fixture files are removed by existing
fixture cleanup. Raw traces use the already reviewed per-call cleanup. The
workflow is temporary and will be removed after both outcomes are reconciled.

## Local controls

The explicit --local-control mode runs only two remotes and is labeled non-native.
It passed on macOS. A separate real-Git missing-ref control refuses the first loop
push, after the two original setup pushes; the harness returns failure with zero
completed iterations and never creates the second remote. This tests fail-fast
behavior, not the historical timeout cause. No synthetic refusal is applied in
the native workflow, and no local control is run before its cold observation.

Prepublication controls and two-axis review passed with no actionable findings.
Charge ten active minutes for harness preparation, controls and review, leaving
fifty active minutes and the one carried repair cycle; CI waits are excluded.
