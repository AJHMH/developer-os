# Main Linux contract timeout and I/O pressure

Status: PARTIAL; no cause-specific repair or flake waiver.

Main and origin/main were synchronized at e68fa3d38d008a6f2c0e371689e6b50b10b4f279
following PR #61. Required Factory run 38997954390 attempt 1 terminated npm test
at its unchanged 120-second deadline (120.011 s, SIGKILL, no termination failure).
Install and validate passed; later contract build was not run. Native CI and the
remaining Factory review-evidence job were still running when first inspected.

The owner authorized 30 additional active minutes and carried two repair cycles,
then explicitly reallocated that allowance from Windows diagnosis to this separate
Linux baseline blocker. Windows diagnosis remains paused. Production qualification
and all deadlines, assertions, coverage and approval rules remain intact.

## Comparable actual required executions

PR head b57a2eb and merged main e68fa3d use the same production/tests/commands and
Factory revision. PR run 38997354108 completed npm test in 99.612 s; main hit its
120-second deadline. Both retained numeric samples without sampling failure.

| Metric during test | Passing PR | Failed main |
| --- | ---: | ---: |
| I/O PSI some stall fraction | 2.91% | 38.22% |
| I/O PSI full stall fraction | 2.04% | 33.30% |
| CPU I/O-wait tick fraction | 1.90% | 32.40% |
| CPU PSI some stall fraction | 19.50% | 10.01% |
| CPU throttled periods | 0 | 0 |
| Resource samples | 51 | 61 |

Memory pressure was negligible. Aggregate printed durations for 463 common test
titles were 253.082 s on the passing host and 387.292 s on the failed host; these
are parallel-worker aggregate times, not wall-clock elapsed time. Median failed /
passing duration ratio for common titles above 100 ms on the green host was 1.222.
Output is truncated, and file-order buffering prevents attribution to the last
printed title. These observations support broad I/O-associated slowness, not proof
that a particular Git operation, fixture, disk, or leaked process caused the timeout.
Supervisor process.resourceUsage is not child resource usage; host PSI is not
attribution to a specific child or storage device.

Ranked predictions disclosed before further testing:
1. Storage stalls broadly slowed the Git-heavy suite.
2. A particular workload amplified those stalls.
3. A leaked process caused the deadline independently of pressure.

The exact required npm test command is red-capable and has failed on the actual
host; no fast deterministic minimized reproduction exists. No speculative code
repair follows from these counters. A single diagnostic replay on this unchanged
main revision is permitted by the existing specification. The first request was
refused by GitHub because the workflow was still running: no replay dispatched.
Wait for reconciliation before requesting that one replay; preserve both attempts.
A passing replay cannot erase or explain attempt 1.

The structured comparison retains numeric resource data and bounded stage metadata,
not raw child output, paths, arguments or credentials. Original complete evidence
remains the trusted workflow artifact factory-adoption-e68fa3d...-38997954390.
Conservatively charge ten active diagnosis/documentation minutes; twenty active
minutes and two repair cycles remain. CI waits are excluded. No test or production
file has changed.

## Single diagnostic replay and unrelated native failures

After attempt 1 fully reconciled, one failed-job replay was dispatched. Attempt 2
passed the unchanged contract; its test stage took 76.305 s, with 40 samples,
I/O PSI some 11.93% and full 9.13%. This does not erase attempt 1 or establish a
cause-specific repair. No further unchanged-main rerun is authorized by default.

All main Factory gates are now successful. Main native CI failed Windows shard 2:
58 of 60 tests passed. Authentication storage initialize timed out at 15.124 s
before any script milestone; competing CLI admission returned a generic state
access error. Neither failure was the Git push timeout. Those errors are retained
in run 38997953962, job 117294559863; they have not been repaired or rerun.
Main therefore remains blocked despite the successful Linux replay.

## Controlled diagnostic comparison

Two new hosts will each run the unchanged full public pinned contract twice,
varying only fixture TMPDIR: ordinary runner temporary storage versus a fresh
private 512 MiB tmpfs. The hosts reverse disk/memory ordering. This is not a
replacement for required validation and does not modify any contract or deadline.
The mount is runner-owned, mode 0700, nodev/nosuid, under runner temporary storage;
cleanup is unconditional. A separate mount avoids /dev/shm noexec confounding
executable fixture semantics. Existing mounts and safety checks are untouched.

Interpretation must account for sequential cache effects, limited tmpfs capacity,
and tests storing data outside TMPDIR. A faster memory-backed observation alone
cannot establish historical causality or justify changing required validation.
If process-tree termination is uncertain the harness stops before a second run.
Temporary workflow removal is required after observations are retained.

Both reviews ran. Spec reported zero actionable findings; standards requested
immutable setup-node/upload-artifact pins. Those official action SHAs are now
pinned, with syntax and YAML checks repeated. Charge ten additional active minutes
for this comparison preparation and one review-fix cycle: ten active minutes and
one repair cycle remain. CI waiting is excluded.
