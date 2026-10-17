# Actual required main-sync Git phase capture candidate

Status: PARTIAL, NATIVE VALIDATION PENDING. No production fix or native observation of this
new capture is established. PR 59's approved head remains unchanged.

PR 59 native CI run 38991544011 reproduced the original Git push symptom in
`tests/main-sync.test.mjs:58`: its fixture setup push returned no status after
5014 ms, SIGTERM, ETIMEDOUT, zero stderr bytes. This is actual required-run failure
evidence, not a forced control. Windows authentication setup passed on that host;
its first initialization took 6810 ms. A subsequent expected ACL refusal returned
status 1 without timeout. Sanitized records are in `pr59-observations.json`.
PR 59 finished with only shard 3 and the Windows aggregate failed; approval and
all other checks passed. PR 58 was closed by the owner without merging.

The candidate applies the previously reviewed Trace2 event allowlist directly
at the actual Windows fixture's push seam, retaining the five-second native
limit and all assertions. Other platforms keep the original direct call. Native
arguments are unchanged. Only this disposable fixture's Git call receives a
private GIT_TRACE2_EVENT destination. No owner repository or credentials are
traced. Source-control isolation settings remain intact.

Each trace is read at most 64 KiB, with at most 128 allowlisted phase/exit events,
numeric timings and numeric process relationships. Raw arguments, paths, process
identifiers and messages are not published. Raw traces are deleted after each
call; cleanup failure is explicit. An unavailable directory, read failure or
metadata-write failure cannot replace the native result or exception. Trace
absence/truncation is incomplete evidence. The probe has measurement overhead.

A real-Git control passes success, missing-ref refusal and unavailable diagnostic
directory cases, preserving native results and the declared 5000 ms option. It
excludes private fixture paths and ref names from published records. The initial
privacy check accidentally searched the diagnostic prefix for the ordinary word
`main`; it was corrected to search the parsed record, without changing observer
behavior. These controls validate capture, not the historical timeout's cause.

The earlier authorization for actual-fixture phase capture was deferred to the
Windows shard 1 baseline. The newest 30 active minutes were allocated specifically
to auth setup and Linux attribution. Charge twenty active minutes for that slice,
its native-result analysis and preparation of this candidate; ten minutes and one
repair cycle remain. The owner subsequently confirmed reallocation of those ten active minutes
to native validation/publication of this Git candidate. No additional retry is requested and
no deadline, assertion, coverage or approval rule is relaxed.
