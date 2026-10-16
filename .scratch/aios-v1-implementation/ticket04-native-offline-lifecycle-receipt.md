# Issue 04: offline native lifecycle observation

Production remains disabled and this transport is not qualified. This slice
repairs defects exposed by an explicitly authorized, credential-free macOS
first-launch observation. It does not complete Issue 04 or a coding turn.

## Baseline

PR #48 merged as `013425692dc2c3c69335b781546bed7804ff0fd0`; local main was
fast-forwarded to that revision and all 24 active main checks passed before this
slice. See the [coverage runtime repair receipt](coverage-runtime-repair-receipt.md).
No deadlines, coverage thresholds or approval requirements were relaxed.

## Defects and repairs

- The management subprocess inherited an 8 MiB file-size limit intended to bound
  observations. Podman's private database/WAL writes also inherited it, causing
  `file too large` and transaction errors during creation. Observation stdout
  and stderr now have separate 8 MiB streaming limits; the existing 15-second
  command deadline remains. Failed commands have their owned process group
  killed and their parent reaped. A real 9 MiB private-file regression failed
  before the repair and passed afterward. Oversized-stream and hung-command
  refusal tests retain the original bounds.
- Restarting the 30-second lease timer on every poll hit systemd's five-starts
  per ten-second limit. Renewal now happens at ten-second intervals, with timer
  activity still checked on every poll. The lease duration and independent
  execution deadline are unchanged. A manager-rate regression failed before
  the repair and passed afterward.
- Repeated stop failed when systemd had already garbage-collected a transient
  timer. Stop now independently observes both units and accepts an absent unit
  only with inactive state and no pending job. Unavailable, malformed, pending
  or failed stop observations still block collection. The repeated-stop
  regression failed before the repair and passed afterward.
- A checkpoint refusal after an asynchronous poll was incorrectly reported as
  changed runtime binding. Pin comparison and checkpoint refusal now have
  separate errors; both still trigger exact-session shutdown and fresh pins.
  The regression reproduced the incorrect error before the change.

## Retained native attempts

All reports use a dedicated AppleHV VM, deny-all networking, pinned Codex,
empty worker home and a fixed ordinary `canary.txt`. No owner credential or
inference authority was supplied. Reports retain source and policy hashes;
failed diagnostic versions do not qualify later code.

1. Attempts 1–2 failed during preparation and stopped with zero remaining
   processes.
2. Attempt 3 retained the temporary diagnostic version that identified the
   Podman database error. The diagnostic probe was removed from source.
3. Attempt 4 launched but hit the lease timer start limit; repeated cleanup was
   initially uncertain because the deadline timer was absent. Independent
   process/cgroup observations found zero survivors. Exact-session recovery
   with the repaired cleanup subsequently returned stopped and zero remaining
   processes. No output from this old-policy session was admitted.
4. Attempt 5 stopped safely at the existing 60-second allowance. The first
   harness incorrectly expected offline Codex to exit naturally; it instead
   retried denied networking. This remains a blocked observation.
5. Attempt 6 explicitly requested a checkpoint stop at 20 seconds and stopped
   safely, but exposed the misleading binding-change error. This remains a
   blocked observation; the harness does not accept a binding-change error as
   evidence of a requested stop.

The revised harness tests an explicit checkpoint stop, fresh-instance exact-
session recovery, fresh runtime pins and stable ordinary-file collection.
It never treats this scenario as a completed coding turn or grants qualification.

6. [Attempt 7](macos/ticket04-native-offline-attempt7.json), at verified bot
   source `dca75fae8dd5f6c34286ae5dcbbc1f37fdeb0803`, passed the explicit
   checkpoint-stop lifecycle, fresh-instance stop/pins, unchanged ordinary-file
   collection and final stop. Runtime source was clean. It records
   `executionOutcome: checkpoint-stopped`, `workerCompletedTurn: false`,
   `inferenceAuthorized: false`, `qualified: false` and production disabled.

The [attempt 4 recovery record](macos/ticket04-native-offline-attempt4-recovery.json)
retains the later zero-process reconciliation without admitting its output.

## Validation

All 46 focused native tests pass. The checkpoint regression initially failed
with the expected misclassified error and passed after the repair. Type checking
passed; formatting passed after formatting the new assertion. Standards and
specification reviews found zero actionable findings, including the checkpoint
follow-up. The [preservation audit](ticket04-native-preservation-audit.json)
checks all 82 preexisting test/helper files: every existing native test is
preserved as an unchanged prefix, unrelated test files are byte-identical and
only the external simulator changed. All 21 preexisting owner reports are
unchanged. Workflows, Factory contract and dependencies are unchanged.
The superseded full-suite run was explicitly stopped after the checkpoint source
follow-up; its partial output is not counted as a pass. A subsequent local invocation omitted the documented
`AIOS_TEST_PYTHON=/usr/bin/python3` setting and failed to start the expiry
fixture because `python` is absent on this Mac; that run is not counted as a
pass. The documented invocation
`AIOS_TEST_PYTHON=/usr/bin/python3 npm test` passed: 617 tests, 615 passed,
two platform skips, zero failures, 334.646 seconds. No test assertions or
production deadlines were relaxed.

[PR #49](https://github.com/AJHMH/developer-os/pull/49) is authored by the
Software Factory bot with verified bot commits. Hosted checks and current-head
owner approval remain pending; this receipt does not claim hosted completion.

## Remaining gates

Windows observation, adversarial mounts/network/escape probes, independent timer
expiry and controller-loss recovery, writable-storage bounds, explicit resume,
controlled dependencies, model-only authority, usage/exhaustion and production
controller integration remain open. Existing fixed-worker receipts cannot qualify
this general transport. See [Issue 04](issues/04-isolated-worker-gate.md).
