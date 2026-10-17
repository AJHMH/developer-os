# Merged main verification and Git trace follow-up

Status: PARTIAL. Local main and origin/main both equal
`a9efc28df8e48977da336cc890edd90dfc40062f` after PR 60. Native CI 38994377121,
Factory validation 38994377357 and CodeQL 38994377109 all completed successfully.
The original failed runs remain failed; no retry was requested.

Required Windows shard 3 passed 78 tests with 24 existing platform skips and no
failures. Its downloaded artifact retained 26 successful pushes, all with traces
available, no truncation and no cleanup failure. The longest push elapsed 1562 ms.
Its Git-root exit was at 1.538777 seconds; the receive-pack child completed after
1.312047 seconds and a transport_push region took 1.240381 seconds. The difference
between parent elapsed and Git-root exit was about 23 ms. Packing child time was
32.234 ms. These regions overlap and must not be summed as independent wall time.

PR 60's slowest healthy push was 435 ms, with root exit 0.403680 seconds and
receive-pack child time 0.347257 seconds. This comparison locates the extra time
in this healthy sample primarily inside Git's transport/child lifetime, not
outside Git startup/exit. It does not establish the failed 5014 ms invocation's
phase or underlying host/device cause. Successful trace records alone cannot
close the intermittent defect.

Bounded next experiment: on two fresh native Windows hosts, use the same
synthetic fixture and its unchanged f.run push seam against at most 100 freshly
initialized disposable bare remotes per host. Stop on the first failure per host
and retain its original result and Trace2 phases. Preserve the five-second native
deadline, ten-minute job limit, isolation configuration, assertions and all safety
rules; introduce no warmup, ignored failure or automatic retry. This is a changed
diagnostic workload, not an unchanged required-CI rerun or a replacement gate.
A reproduction would need to match the native timeout symptom before causal
repair; a healthy loop would remain inconclusive.

Allowance: the reallocated ten active minutes had five left after PR 60's native
analysis. Those final five are consumed by main verification, artifact comparison
and this receipt (CI waits excluded). One repair cycle remains; no cause-specific
repair has been attempted. Further experiment execution requires an explicit
active-time extension. No allowance or cycle count resets on restart.

These follow-up files are local uncommitted evidence; main was not rewritten.
