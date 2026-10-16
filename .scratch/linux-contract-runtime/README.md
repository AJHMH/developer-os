# Linux contract runtime diagnosis

Status: PARTIAL. The original timeout remains unexplained. This is retained
instrumentation and evidence, not a cause-specific repair or a flake waiver.
The owner authorized this separate baseline investigation on 16 October 2026.
Issue 04 and the separate Windows storage investigation remain paused while
this main-baseline blocker is unresolved.

## Original failure

Local main and origin/main were synchronized at
`04a911ede7773a82f711d874ee33160c669ddf9e` after PR #51 merged.
[Main Factory validation](https://github.com/AJHMH/developer-os/actions/runs/38949657805/job/117137544551)
passed install and validation, then terminated `npm test` at 120.010 seconds:
`timedOut=true`, `SIGKILL`, no termination failure, no final suite summary.
The complete structured result is retained in `main-04a911e-failure.json`.
The first attempt was retained before any rerun. All other executed main checks,
including cold Windows authentication storage, passed.

PR #51 changed no production source, existing tests, workflows, dependencies or
contract. No assertion failure or specific hanging test is established by the
last printed test: Node may buffer test output in file order.

## Predictions and measurements

Ranked predictions before instrumentation:

1. Repeated Git work dominates runtime: fixed external-command timing should
   identify Git as the main measured process cost.
2. A few long files determine completion: per-file completion and elapsed
   measurements should expose a long tail.
3. A leaked process survives completed assertions: test files should finish but
   the parent should remain alive without a suite result.

The temporary workflow used the pinned Factory executor, the unchanged command
`npm test`, unchanged concurrency four and unchanged 120-second deadline. It
installed dependencies in both checkouts before execution. It did not reproduce
Factory's preceding validate phase, so these are diagnostic workload observations,
not replacements for the required complete contract check.

| Observation                       | Source    | Run                                                                           | Result including build |
| --------------------------------- | --------- | ----------------------------------------------------------------------------- | ---------------------- |
| Initial timing                    | `7934411` | [38950583306](https://github.com/AJHMH/developer-os/actions/runs/38950583306) | Passed, 102.217 s      |
| Git operation and resource timing | `c657d3e` | [38951017641](https://github.com/AJHMH/developer-os/actions/runs/38951017641) | Passed, 96.361 s       |

Both ran all 617 tests: 614 passed, three existing platform skips, zero failures.
Both recorded 227 completed Node processes, including test files and short-lived
CLI children. No unfinished process was observed in either successful run.
The first recorded 51,287 Git processes consuming 202.903 aggregate seconds across
parallel workers. The second recorded the same count and 188.132 aggregate Git
seconds: 16,243 rev-parse, 8,313 config, 7,851 status, 7,489 ls-tree and 7,489
cat-file calls, plus fixture/setup and other Git operations. Aggregate timings
are not wall-clock duration and do not sum to an independent deadline.

The second host reported Linux x64, Node v24.21.0, four available CPUs and
AMD EPYC 7763. These measurements describe that host; the failed host did not
retain equivalent resource counters. For the 301 common test titles whose
second-profile duration exceeded 100 ms, the failed main attempt accumulated
427.741 test seconds versus 236.390 in profile two. Slowness spans the printed
suite, rather than identifying a single failed assertion or one hanging file.
This supports a broad runtime-cost hypothesis, not a proven historical scheduler,
filesystem, CPU, or process-startup cause.

A separate public-controller lifecycle observation on macOS completed in 1.799 s:
30 fresh admissions, 30 config/status/tree/blob queries each and 61 revision
queries. Removing those checks or caching mutable authority is not an accepted
optimization. No production change is justified by these observations alone.

## Retained diagnostic boundary

`process-profile.mjs` is an explicit NODE_OPTIONS preload, not installed by the
application or normal tests. The historical workflow definitions can be
inspected at their recorded commits. The temporary workflow is removed from the
final tree. `profile-1.json` and `profile-2.json` retain complete executor results
and numeric per-process observations.

The preload wraps the existing external process boundary without replacing its
results or changing command arguments, timeouts, environment or concurrency. It
records fixed command/operation categories, test-file basenames, numeric timing
and CPU/resource metadata. It records no command arguments, environment values,
stdout, stderr or credentials in process profiles. Periodic snapshots use an
unreferenced timer, so the probe cannot keep a process alive. Executor output is
retained separately in each result exactly as returned by Factory.

The original suite is the red-capable deadline feedback loop. It is necessarily
slow and intermittent; no fast, deterministic minimized reproduction exists yet.
The passing probes do not satisfy that missing diagnosis step. Next useful
evidence is equivalent profiling on an actually failing Linux host, rather than
an assertion or policy change based on a healthy proxy.

## Safety and remaining gate

No production source, existing test, assertion, deadline, coverage threshold,
approval rule, dependency or Factory revision is changed. The 21 preexisting
owner reports are preserved. Production qualification remains disabled.
The single permitted unchanged-code main diagnostic rerun also failed: attempt 2,
job `117143659186`, test stage 120.009 seconds, SIGKILL, no final suite summary.
It reached native-worker tests near the end; attempt 1 stopped earlier in the
printed suite. `main-04a911e-rerun.json` retains this result. No further unchanged
main rerun is authorized by the default retry rule. The App lacks
Actions-write permission; the rerun used the authorized existing CLI session.
Commits and PR authorship use the verified Software Factory App identity.

## Complete-sequence countercheck

The third probe reproduced the full contract command sequence through the exact
pinned `runContract`, including install and preceding validation, while retaining
the preload. Source `f356a0d`, [run 38951902280](https://github.com/AJHMH/developer-os/actions/runs/38951902280):
install 0.588 s; validate 6.790 s; test 96.258 s; build 4.103 s. Every command
passed its unchanged 120-second deadline. All 617 tests ran: 614 passed, three
existing platform skips. `profile-3-full-contract.json` preserves the result and
process observations. The pinned executor was also compared byte-for-byte with
the locally inspected Factory source and matched.

This rules out the omitted preceding phase as a sufficient explanation for the
first two passing profiles; it does not establish what slowed either failed
main host. All observed diagnostic processes completed. No failed-host CPU or
I/O trace exists, so the historical cause remains unknown. No smaller reliable
red reproduction has been obtained. The preload is opt-in and can affect timing;
its passing observations are not uninstrumented causal proof.

The temporary workflow is again removed after the complete-sequence observation.
Both earlier review axes reported zero actionable findings. Type checking and
repository formatting passed; full-suite evidence is the three hosted probes.
No additional local full run was needed for this diagnostics-only change, which
contains no production or existing-test edits.

## External host sampling without a preload

A final comparison removed NODE_OPTIONS entirely. The parent invoked the pinned
full contract and sampled allowlisted numeric Linux CPU, I/O-pressure, memory
and cgroup counters every two seconds. It did not wrap or change child commands.
Source `1e9e502`, [run 38952644530](https://github.com/AJHMH/developer-os/actions/runs/38952644530),
two independent hosts:

| Host | CPU model                 | Test stage | Tests                            |
| ---- | ------------------------- | ---------- | -------------------------------- |
| 1    | AMD EPYC 7763             | 100.281 s  | 614 passed, three existing skips |
| 2    | Intel Xeon Platinum 8370C | 82.281 s   | 614 passed, three existing skips |

Both reported four available CPUs and Node v24.21.0; all contract commands
passed. `host-profile-1.json` and `host-profile-2.json` retain every sample and
result. Neither observed cgroup CPU throttling or nonzero steal ticks. Memory
pressure remained negligible in these healthy observations. This shows the
preload is not necessary to obtain a passing observation. Hardware and timing
vary, but these healthy measurements do not prove what delayed either failed
main host. No stress, warmup, timeout increase or test exemption was introduced.

## Diagnostic supervisor correction

Review found that a periodic report-write exception could terminate the parent
that owns Factory's deadline. The retained sampler now catches sampling failures,
stops sampling and lets the original command finish or reach its original
termination deadline. It records diagnostic failure after command reconciliation.
The optional process preload likewise catches snapshot write failures rather
than terminating a deadline supervisor. Missing reports remain missing evidence.

The public process/filesystem regression uses the exact pinned Factory executor,
a disposable never-completing Node child and a four-second fixture deadline. It
replaces the existing host report with a directory after the child starts,
causing EISDIR on the next sample. It introduces no test-only production hook.
[Run 38953090240](https://github.com/AJHMH/developer-os/actions/runs/38953090240),
source `40ae8a9`, confirmed:

- Original sampler from `1e9e502`: exited after 2.138 s with EISDIR; command still
  alive. The regression then explicitly cleaned up its owned process group.
- Corrected sampler: returned after 4.138 s, original deadline still enforced,
  child stopped, `timedOut=true`, `terminationFailed=false`, and diagnostic
  sampling failure retained. The diagnostic command refused as required.

`sampler-supervision.json` records both verdicts and the exact old-source SHA256,
which matched `git show 1e9e502:.../profile-host.mjs`. This verifies a diagnostic
supervision repair only, not the original main runtime failure. The two healthy
host observations used the earlier sampler; neither encountered a write error.
The temporary workflow is removed after this focused regression. The standalone
verification helper is Linux-only and uses explicit disposable fixture paths;
non-Linux sampler invocation refused before report creation or command effects.

## Remaining blocker and allowance

PR #52 retains the investigation as Software Factory bot with verified commits.
The owner marked it ready for review in GitHub; that UI state does not establish
a cause-specific repair. Final-head checks and GitHub approval remain required.
The failed main hosts have no equivalent resource trace, so the historical cause
and a reliable minimized reproduction remain unavailable. The next useful step
is capturing these counters during a naturally failing complete contract run.
Do not add an unchanged-main retry or claim passing diagnostic hosts resolved it.

Linux allowance is separate from the Windows investigation's retained 24 active
minutes. Conservatively charge 40 active Linux investigation/repair minutes;
CI waits are excluded. One review-repair cycle was used for sampler supervision;
no cause-specific runtime fix was attempted. The remaining allowance is 20 active
minutes and two cycles, whichever is exhausted first. The unresolved baseline
blocks merge and resumed work under the existing specification. This remains
PARTIAL evidence, not VERIFIED main repair.

## Resumed after PR #53

Main `b870b429ad695f1f2fec3d08ce71f6a49e65816b` passed all 24 executed
checks on 16 October 2026; certification was the expected conditional skip.
Local main matched that exact revision. The Linux full contract, macOS and all
eight Windows shards passed. This new revision does not explain the two older
Linux timeouts. PR #52 was refreshed through verified App merge `b4b410b`.

The next bounded observation reuses the reviewed two-host external sampler and
exact pinned Factory executor. No preload, warmup, workload stress, concurrency
change or increased deadline is introduced. The full current contract runs once
on each host, retaining numeric resource counters and every result, including
failures. This is a changed-revision diagnostic comparison, not another rerun of
unchanged failed main. The workflow is temporary and will be removed after its
artifacts are reconciled. Historical-cause and minimized-reproduction gaps remain.

### Resumed observation results

[Run 38964772767](https://github.com/AJHMH/developer-os/actions/runs/38964772767)
completed both observations at source `174610a`. Both hosts reported AMD EPYC
9V45, four available CPUs and Node 24.21.0. The test stages took 78.968 s and
74.566 s respectively; each ran all 630 tests, with 627 passed, three existing
platform skips and zero failures. Install, preceding validation and build passed
as well. The complete results and numeric samples are retained in
`resumed-host-profile-1.json` and `resumed-host-profile-2.json`.

Neither observation timed out. They therefore supply no failed-host trace and
do not explain the historical 120-second failures. No cause-specific production
repair is justified. The temporary workflow was removed after artifact retention;
normal workflows, deadlines, tests, assertions and safety gates are unchanged.
Both review axes found zero actionable issues in the resumed diagnostic scope.

Conservatively charge another 10 active investigation minutes: cumulative Linux
allowance used is 50 minutes, with 10 minutes remaining. No new repair cycle was
used because this comparison made no validation/review fix. The earlier one-cycle
count remains. CI waiting is excluded. This is still PARTIAL; the missing evidence
is a resource/process trace from an actually failing Linux contract execution.
Passing more healthy hosts alone cannot close that gap.
