# Issue 04: owned launch input and dispatch authority

Date: 15 October 2026. Branch: `codex/ticket04-dispatch-authority`.
Starting main: `caaac9e639720c54a586f73c525d49c997c1f98f` (merged PR #42).

## Main synchronization and baseline verification

Local main was fast-forwarded to that exact GitHub revision without discarding
tracked work or the 21 untracked owner snapshots. All 24 active hosted checks
passed; conditional certification was skipped.

The first coverage attempt in run `38844732243` hit unchanged 120-second budgets:
unit tests 120046 ms and head instrumentation 120069 ms, both SIGKILL/timeouts,
with no preceding assertion failure. Approval gates correctly failed because
coverage evidence was unavailable. One unchanged diagnostic retry passed all
stages: unit tests 83345 ms, head instrumentation 90978 ms and baseline
instrumentation 90072 ms. No limit, threshold, test or safety rule was changed.
This is retained intermittent runner-performance evidence, not a claimed repair.
Artifacts: first `12022834028`, retry `12022997917`; both retained by GitHub.
Local diagnostic archives are in `/private/tmp/issue04-main-caaac9e*coverage.zip`.

## Implemented boundary

- Capture controller callbacks before independent pin inspection and reject
  callback replacement before dispatch.
- Give transport preparation a separate copy of arguments, pins, admitted file
  bytes and baseline-refresh manifests. Retained inspection references cannot
  change the prepared input. Freeze the request shell to protect session fields
  and callback identities; mutable nested data remains checked by the binding.
- Guard dispatch and checkpoint callbacks with the prepared launch binding before
  and after fresh controller authorization. Stream and result admission also
  reject prepared-data drift, using the owned session identity.

The transport must call `mayDispatch()` at its actual effect acceptance after any
async preparation and independently remeasure native pins there. These safeguards
cannot make a transport that ignores its contract safe or qualify native effects.
No generic native transport, credential grant or production-enabled path is added.

## Evidence

Three public-controller regressions failed before their respective safeguards:
callback replacement dispatched paused work; retained inspection references
changed prepared bytes/arguments; and prepared argument mutation passed effect
acceptance after an async wait. Each now passes. Existing normal pinned launch,
executable mismatch, inspection mutation and stream refusals remain passing.
Targeted pin/stream/admission suite: 15 passed. The complete feature-candidate
suite passed all 52 tests. A separate public baseline-refresh regression also
passed, proving both from/to manifests retain admitted bytes despite mutation of
the inspection reference. Build, typecheck, formatting and whitespace checks passed. Full suite:
563 tests, 561 passed, two platform skips, zero failures (366.5 seconds). Log:
`/private/tmp/ticket04-dispatch-full-suite.log`. No existing tests were removed.

## Still open

Issue 04 remains open. General native Codex/Podman transport, model-only session
access and usage controls, dependency/execution/collection integration, lifecycle
recovery and independent fresh Windows/macOS native qualification remain required.
Production dispatch remains disabled. Old fixed-worker receipts do not qualify it.
