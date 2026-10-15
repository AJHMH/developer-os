# Ticket #12 controlled implementation receipt

Implemented on `codex/ticket12-merged-main-verification` from merged main
`bd2423cb289df73b216b0edbd139e1e1cc285e2b` (PR #33).

## Behavior

The public controller and `monitor-main-checks` CLI command verify configured
trusted main checks against the actual PR/head/merge linkage and current-main
revision. PR evidence is insufficient. Read-only observations retain complete
attempt histories per revision, reject untrusted provenance, and reassess main
advancement. Passed main remains incomplete delivery; synchronization and cleanup
are subsequent implementation slices.

Durable check deadlines survive restart, main advancement and polling backoff.
The one-hour hosted default applies when no timeout is declared. Shorter unresolved
checks bound observation; a short check completing on time leaves a longer check
its declared allowance. Terminal timeouts survive binding errors, clock rollback,
pause and resume. Interrupted reads recover with a new observation token; stale
responses cannot overwrite newer evidence. Failure reports revision/check evidence
and an owner next action without rerunning, patching or reverting main.

See [main verification contract](../../docs/main-verification.md) and
[ticket](issues/12-merged-main-verification.md).

## Validation

- Typechecking, formatting and `git diff --check`: passed.
- Focused main-verification suite: 14 passed.
- Shared main/PR-check regression run before the final deadline refinements:
  24 passed; the final full suite includes those regressions and all refinements.
- Full instrumented macOS suite: **497 tests, 495 passed, two platform skips,
  zero failures**, 210.0 seconds. Run with `AIOS_TEST_PYTHON=/usr/bin/python3`
  and permission for synthetic localhost services; no live provider calls.
- Global c8 coverage: 16,952/17,743 lines (95.54%), 4,709/5,202 branches (90.52%).
- Factory-style changed-source metrics against the starting revision:
  384/384 lines (100%), 144/152 branches (94.74%). These are local measurements,
  not hosted CI certification or native qualification.
- All 21 retained local snapshots match their recorded SHA-256 values and remain
  untracked. No snapshot cleanup, live inference or remote publication occurred.

Red/green evidence includes the missing controller command, unavailable-observer
restart deadline, per-revision history retention and changed-binding revocation.
Review regressions reproduced mixed check deadlines, binding-error/clock-rollback
timeout reopening, timely short-check completion during a longer pending check,
and pause erasing a clock-rollback timeout. Each failed before correction and
passed afterward through the public controller seam.

## Review

Standards review: no findings. Spec review: four deadline/timeout edge cases
corrected with public regressions, then re-reviewed with no remaining findings.
The fixed comparison point is the merged starting revision above.

## Remaining native qualification

Windows and macOS still require observed qualification of complete API history
and pagination, trusted publisher/workflow identity, PR/head/merge linkage,
reachability, current-main races, bounded reads and credential separation. The
native observer remains absent and the CLI fails closed. Controlled tests do not
enable production or the profile-page pilot. No direct-main repair/revert,
synchronization or cleanup capability is introduced by this slice.
