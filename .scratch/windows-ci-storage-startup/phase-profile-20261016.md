# Native Windows storage phase profile

Baseline: merged PR #50, `22f55c368e4bf7723885a1390dcb034172a31813`.
Local main and origin/main matched; all 24 active main checks passed before
this diagnostic slice. The policy's conditional certification job was skipped.
The original timeout remains unexplained; no cause-specific repair is claimed.
The prior repair allowance retains 14 active minutes; this diagnostic slice
continues that allowance, with CI waits excluded.

## Question and experiment

Do successful cold initializations spend most elapsed time in the measured
stdin/path/identity/ACL stages, or outside those stages? The latter includes
PowerShell startup, instrumentation initialization, I/O and process exit; it
must not be labeled pure startup time.

A Windows-only, explicitly invoked synthetic probe calls the existing public
initializer and strict native storage ACL observation. It records fixed stage
labels with relative milliseconds, total native invocation time, exit/timeout
metadata and source/runtime identity. Four fresh hosted runners each execute
up to four sequential samples; later samples share host caches. Sampling stops
on the first refusal. No storage action is retried, no deadline is increased,
and no owner credential, path, identity, raw error or input is recorded.

The 15-second native deadline, minimal environment, existing ACL/DPAPI code and
all production source remain unchanged. The probe creates and removes only
its own newly created synthetic setup directories. Successful timings cannot
explain the historical failure; a reproduced failure is still needed.

Temporary workflow hardening review: no findings. Pull-request trigger only,
contents-read permission, hosted runners, SHA-pinned actions, credentials not
persisted, no secrets, and no candidate text interpolated into run scripts.
The sampling workflow will be removed after collecting observations.

Status: diagnostic observation pending. Issue 04 and production qualification
remain blocked; this is not a storage timeout fix or a gate waiver.

## Initializer-first measurements

Four native hosts on probe revision `5cb9b15` completed all 16 initializations
and strict ACL observations. First-call totals: 3,003 / 4,107 / 3,082 / 1,974 ms;
timed script totals: 58 / 62 / 44 / 56 ms. Later initialization totals ranged
174–267 ms. Most cold-call time is outside the measured script, not observed
inside stdin parsing or ACL work. These healthy timings do not reproduce the
historical 15-second refusal or identify its cause.

Counterfactual: four new hosts run a fixed read-only Console output script first,
using the exact helper executable, flags, environment, working directory and
15-second timeout. Then they run the same initialization/ACL samples. If the
no-op absorbs the cold cost and initialization becomes warm-fast, shared
PowerShell/runtime startup is supported over initialization-specific work.
If no-op stays fast but initialization remains slow, that prediction fails.
A control refusal stops the probe; no storage action is retried.

## No-op-first counterfactual

Four new hosts on `aab78d0` observed no-op times of 3,566 / 4,622 / 2,035 /
4,116 ms. The subsequent first initializations took 299 / 362 / 265 / 285 ms,
including measured script times of 59 / 97 / 55 / 77 ms. All four strict ACL
checks and later samples passed. The read-only control absorbs the multi-second
cold cost without performing storage initialization. This supports shared
PowerShell/runtime cold-start overhead in successful runs over slow ACL work;
it does not identify the OS/runtime component or prove the historical timeout
occurred at the same phase. No production warm-up, retry or deadline change is
proposed.

Across both cohorts: eight fresh Windows hosts, 32 initializations, 32 strict
native ACL observations and four no-op controls; all observed. Raw bounded
reports `phase-profile-initialize-first-{1..4}.json` and
`phase-profile-noop-first-{1..4}.json` retain exact source/runtime bindings and
stage data. They are synthetic diagnostics, not worker qualification evidence.
The temporary sampling workflow is removed from the final tree.

## Repeatable probe

On a native Windows x64 host, build the trusted tree and run:

```text
node .scratch/windows-ci-storage-startup/profile-native-startup.mjs new-report.json --approve-synthetic-storage-probe
```

For the counterfactual, append `--first-noop`. Reports are create-only. The probe
never opens an owner account, imports credentials, invokes inference or changes
production policy. Its `[DEBUG-storage-profile]` injection is intentionally
retained only inside this explicitly marked diagnostic harness, not in tests
or production code. Stop on any refusal; do not repeat until it disappears.

Status: PARTIAL — healthy cold overhead is localized and a controlled
counterfactual supports shared runtime startup. The 15-second refusal itself
has not been reproduced with stage evidence, so no cause-specific fix is
claimed. Issue 04 remains paused. Next useful evidence is a naturally failing
instrumented initialization, followed by OS/runtime tracing on that affected
host. Repair allowance is conservatively charged 24 active minutes total,
including the previously recorded 14; CI waits excluded, limits not reset.

## Validation and review

Both native cohorts completed on their recorded source revisions. The final
probe source is identical to the no-op-first cohort's `aab78d0` source; later
changes retain results and remove temporary CI only. Syntax and formatting
checks passed. A macOS invocation positively refused before report creation or
storage effects; it is not native Windows acceptance. Standards review: zero
actionable findings. Specification review: zero actionable findings.
All production source, existing tests, net workflows, contract/dependencies and
21 preexisting owner reports are unchanged. Final-head hosted validation and
owner review remain pending.

Merged-main checks:
[CI](https://github.com/AJHMH/developer-os/actions/runs/38946420793),
[Factory](https://github.com/AJHMH/developer-os/actions/runs/38946421234),
[CodeQL](https://github.com/AJHMH/developer-os/actions/runs/38946420720).
These passed at `22f55c3` without rerunning this main revision.
