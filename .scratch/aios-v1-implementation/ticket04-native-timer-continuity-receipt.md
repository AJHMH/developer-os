# Issue 04: continuous native timer admission

Production remains disabled. This slice implements continuous verification of the
existing independent worker timers; it does not complete Issue 04 or qualify a
native host.

## Baseline and scope

Local and remote main matched `7aba7fb64101a9461363fbaa66729158fde161af` before
this continuation. Developer OS CI, Factory validation and CodeQL passed. The
owner explicitly requested resuming Issue 04 after that verification. Historical
Windows storage and Linux contract timeout causes remain unresolved; their prior
evidence is preserved, including closed, unmerged PR #62.

## Implementation and regression evidence

The native transport previously verified the fixed deadline timer only at launch.
The first external-guest regression removed that timer after release of the
launch marker. The run returned and accepted output instead of refusing; the red
test failed with `Missing expected rejection`.

The manager now verifies that both the renewable lease and fixed deadline timers
are active on every running-worker poll, before renewing any lease. It rechecks
both timers after initial creation and after renewal. An already observed missing,
inactive or failed timer cannot be revived by the renewal path. The existing
30-second lease, ten-second renewal cadence, fixed execution allowance and
15-second management-command deadline are unchanged. Failed observation triggers
the existing durable revocation, independent shutdown and exact-session recovery
path before output acceptance.

Six external simulator cases cover each timer disappearing or becoming inactive
or failed after launch. The guest clock advances eleven seconds so renewal is due;
each asserts no timer restart, rejection, no accepted output, no surviving
worker, successful exact-session stop and stopped collection. Existing timer
start-rate, cleanup uncertainty, orphan and recovery tests remain intact. These
tests execute the transported Python management program against a simulated
engine; they are not real Windows/macOS timer qualification.

## Validation and accounting

- Focused native transport suite: 52 passed, zero failures/skips on macOS arm64,
  Node 24.21.0 with `AIOS_TEST_PYTHON=/usr/bin/python3`.
- Type checking and formatting passed.
- Restricted full suite: failed at the unchanged 120-second contract limit, with
  `SIGKILL` and successful process-tree termination. Local-listener fixtures also
  failed with `Operation not permitted`. The unchanged-main restricted comparison
  was stopped as superseded/incomplete after identifying that environmental
  refusal. Neither result establishes a source regression or a baseline pass.
  This first attempt also began before the final simulator-clock assertions.
  A host-permitted 120-second candidate probe also timed out, without reported
  assertion failures. Its matching main probe was stopped as incomplete after
  identifying the profile mismatch: `.github/workflows/ci.yml` declares a separate
  ten-minute macOS validation job. Local validation of that declared macOS
  sequence passed. The independent Factory contract's 120-second test gate
  remains unchanged and cannot be claimed passed from these local probes.
- Final macOS profile: type checking, formatting, the full test suite and build
  all passed under the existing ten-minute job limit with existing dependencies.
  The executor bounded/truncated retained stdout, so no full-suite test count is
  inferred from it. Its exit status is zero; focused test counts above are retained
  separately. This does not substitute for hosted Factory or Windows checks.
- Standards and specification reviews: zero remaining findings. The first spec
  review requested testing the renewal boundary; the final six cases address it.
- [Preservation audit](ticket04-timer-preservation-audit.json): all 85 preexisting
  test/helper files retain their contents; 83 are byte-identical and the other two
  have additive changes only. No existing test lines were removed.
  All 21 preexisting owner reports retain their exact SHA-256 hashes.
- [Validation summary](ticket04-timer-validation.json) retains the failed attempt.
- Investigation ledger: private external state at
  `/private/tmp/issue04-native-timer-continuity-ledger`; this continuation uses
  the specification's default 120 active implementation minutes and three repair
  cycles. Earlier unrelated investigations are not reset or extended. Charges
  are operator-reported and CI/review waits are excluded.

## Remaining gates

Independent native timer expiry/controller-loss observations, general-session
resume, model-only authority, usage/exhaustion, storage bounds, controlled
dependency execution and production controller integration remain open. No live
inference, credential import, VM launch or production activation was performed.
Windows and macOS must independently qualify fresh source/runtime/policy bindings.
