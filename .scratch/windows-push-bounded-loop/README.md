# Bounded native Windows push reproduction loop

Status: PARTIAL. Serial and paired native observations passed; the timeout
remains unreproduced and no cause-specific repair is established. Main a9efc28 is synchronized and
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
temporary workflow was removed after both outcomes were reconciled.

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

## Serial native outcome and paired refinement

Run 38995223050 at cd7efde2d15e10f039e6c3b75ee910d99f2fc397 passed on both
native hosts: 100 fresh remotes each plus two original setup pushes, 204 successful
pushes total. Maximum elapsed was 1147/978 ms, with no missing/truncated traces or
cleanup failures. Body/test times were 45.959/56.749 seconds. Both artifacts were
downloaded. This did not reproduce the required-run timeout; a successful serial
loop cannot explain the original concurrent test-file execution.

The next changed diagnostic workload uses two JS workers per host, 50 fresh
remotes each, keeping the total bounded at 100 fresh remotes. Each worker has its
own fixture (four setup pushes per host), isolated files and native supervision.
It exercises overlapping calls, but worker threads are not the original separate
Node test-file processes, and this difference limits causal conclusions. No
required CI settings or normal tests change.

A shared atomic stop flag is checked before every native subprocess dispatch.
Unexpected worker refusal sets it immediately; peer workers stop new native calls.
Already-dispatched calls finish under their original deadlines. No worker or
in-flight native supervisor is force-terminated. The coordinator waits for worker
exit and diagnostic-stream drainage, then requires both complete successful body
reports and zero worker exit codes. Missing reports or diagnostic failures fail
the observation. Reports/logs live in a unique private output directory.

Two-worker local success and real-Git refusal controls pass. The refusal control
proves host failure and zero completed iterations, with the peer stopped or
independently refused; no second iteration runs. These are harness controls, not
reproduction of the historical timeout. Native job timeouts remain ten minutes
and each original Git call remains five seconds. The workflow remains temporary.

## Paired review corrections and controls

Two-axis review found two harness gaps before native paired publication: report
write failure did not stop further work, and the prior refusal control independently
failed both workers rather than proving peer stopping. Both are corrected in one
repair cycle; the carried cycle is now consumed and zero repair cycles remain.

A failed required progress write now marks evidence failure, sets the atomic stop
flag and fails a checkpoint before further native dispatch. The final persistence
path cannot replace an original failure; process exit/report validation still
refuses success when evidence is lost. A real directory at the report file path
causes EISDIR and proves both workers stop before any original native call.

The new peer control injects a real missing-ref refusal only in worker one. Worker
two waits at a control-only barrier until the shared stop flag is set, then attempts
fixture startup. The shared guard refuses it before any original subprocess. Both
workers fail with zero completed loop iterations; no second remote is created.
The barrier and injected refusal are never used in the native experiment.

Both controls were run against private broken copies: removing the shared guard
makes the peer control fail, and restoring soft report failure makes the filesystem
control fail. The real corrected sources pass both controls and a positive paired
local run. This validates the controls' sensitivity, not the historical bug.

Charge twenty further active minutes for paired harness preparation, controls and
review correction, leaving thirty active minutes and zero repair cycles. CI waits
remain excluded. The serial and paired native observations remain separately
revision-bound; results are not pooled as equivalent workloads.

## Paired native results and conclusion

Run 38995970292 at cc93fb94f380879d4f3f17126e68c9114645f319 passed on both native
hosts. Each worker completed 50 fresh remotes with zero exit status; each host
therefore completed 100 fresh remotes plus four setup pushes. The parent logs
retained 104 push traces per host, reconciled against 52 push result records in
each worker's log. All 208 traces were available, untruncated and parseable, with
no cleanup failure. Maximum elapsed was 1279/798 ms. Both artifacts were downloaded
before deleting the temporary workflow.

Git's direct fd-2 trace writes appear in the parent log, not the worker stream
logs. The worker logs contain original test results and main-sync result metadata;
the unique worker JSON files contain progress. The pooled native traces cannot
be attributed to individual workers. This limitation is preserved rather than
inventing a mapping. Numeric summaries and artifact hashes are retained in
serial-observations.json and paired-observations.json; complete event arrays
remain in the named CI artifacts.

Across the separate serial and paired workloads there were 400 successful fresh
remote pushes plus 12 setup pushes. No original five-second timeout was reproduced.
The controls prove diagnostic fail-stop behavior, not a causal regression repair.
Neither healthy workload reproduces the original complete concurrent test-file
context. A future failed required-run trace remains the decisive missing evidence;
merged PR 60 now captures those phases on every Windows fixture push. No production
optimization, flake exception or safety/deadline change is justified here.

The reproduction scripts remain explicitly opt-in under scratch. No normal test,
production code, required workflow, assertion, coverage threshold or qualification
gate changed. The temporary workflow is removed. Issue 04's production gates
remain open. PR 59 was closed independently; it was not reopened or changed.

Charge ten further active minutes for native reconciliation, cleanup and final
review, leaving twenty active minutes and zero repair cycles. CI waits remain
excluded, and these values must carry forward. Further cause-specific repair
requires an explicit repair-cycle extension; a successful rerun cannot close the
historical defect. No unchanged-source required-CI rerun was requested.
