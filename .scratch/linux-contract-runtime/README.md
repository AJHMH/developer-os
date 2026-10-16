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
application or normal tests. The two historical workflow definitions can be
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
One unchanged-code main diagnostic rerun was requested after retaining the failed
attempt and both distinct profiles. Its result must be recorded separately;
a passing retry cannot explain or waive the original failure. The App lacks
Actions-write permission; the rerun used the authorized existing CLI session.
Commits and PR authorship use the verified Software Factory App identity.

Linux repair allowance is separate from the Windows investigation's retained
24 active minutes. No cause-specific repair cycle has been attempted yet.
