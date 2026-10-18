# Issue 04: bounded offline controller-loss procedure

Status: local implementation validation passed. Native observations are not-run.
Production execution remains disabled; Issue 04 and both host qualification gates
remain open.

## Baseline and preservation

PR #68 merged as `a44e5bfbd95e1f7afb1e82224e6012f6b7c42d1f`. Its tree matches
approved head `911ae1c48ad6bb211563f7c414bec594c0d0c2fa` exactly; all applicable
PR checks passed. Those results were reused. No validation suite was rerun merely
because the merge completed. Local main was conditionally fast-forwarded, and
new work was isolated at `/private/tmp/developer-os-issue04-next` on
`codex/issue04-native-lifecycle-qualification`. The original dirty checkout and
unrelated reports/branches were preserved. The PR #68 branch remains retained
because it is in use by another worktree.

## Procedure and evidence boundary

`observeNativeControllerLoss` is an explicit offline acceptance seam, not
production admission. The CLI at `native-coding-controller-loss-acceptance.mjs`
uses a fresh empty-home, deny-all session containing only an ordinary canary.
It requires `--approve-offline-native-run`, a supported host, clean source and
a new exclusive report file. It does not provision a VM, credentials, inference
authority or dependency access. Use the already configured dedicated machine.

1. Measure fresh runtime pins and persist intent before starting the owned
   controller child. Its environment is allowlisted and Node preload arguments
   are not inherited.
2. Observe positive running process and timer controls independently. Neither
   timer may already have fired.
3. Terminate only the owned controller process/tree without executing its cleanup.
   For the fixed-deadline probe, allow 70 seconds of normal controller renewals
   first. A delay alone is never accepted as proof of which timer fired.
4. Require a second positive running observation after controller loss. Poll for
   independent disappearance within 45 seconds. The journal must still say
   running; explicit reconciliation or prior cleanup invalidates the observation.
5. Read the timer trigger and service execution record. Only a successful exact-
   session `/usr/bin/podman kill --signal KILL` execution, with ordered monotonic
   timestamps and no execution of the other timer, supplies the requested proof.
   Missing, malformed, failed or ambiguous records block the observation.
6. Confirm collection refuses before recovery. Explicitly terminate/reconcile the
   owned controller, verify exact-session shutdown and fresh pins, then collect
   only the unchanged ordinary canary. Failed starts and evidence-write failures
   still enter cleanup. Uncertain cleanup is not a successful observation.

The existing 30-second lease, ten-second renewal cadence, management subprocess
deadlines and production allowance rules are unchanged. Each explicit synthetic
run declares a 90-second worker allowance; controller startup and termination
observations are bounded at 60 and five seconds. Transport calls retain their
existing command deadlines. The separate timer services retain their exited
execution records until verified cleanup; cleanup stops both timer and service
units, without restarting a timer or relaxing a failure rule. Continuity now
requires `LoadState=loaded`, `ActiveState=active`, `SubState=waiting` and no
pending manager job. Retained `active/elapsed` timers cannot pass or be renewed.

`observeTimerExecution` reads systemd's structured `ExecStart` and monotonic
trigger properties, verifying the exact command and session target. It never
renews timers, stops a worker or updates lifecycle phase. Those fields follow the
[systemd service/timer observation contract](https://www.freedesktop.org/software/systemd/man/latest/org.freedesktop.systemd1.html).
Unsupported/missing manager properties refuse rather than invent success.

## Invocation after review and build

Run each mode separately through the existing acceptance lock/awake wrapper.
Use a new report path for every attempt; do not overwrite a failed receipt.

```sh
node scripts/run-native-acceptance.mjs "$QUALIFIED_STATE_DIR" .scratch/aios-v1-implementation/native-coding-controller-loss-acceptance.mjs -- "$DEDICATED_MACHINE" "$NEW_REPORT_PATH" lease --approve-offline-native-run
node scripts/run-native-acceptance.mjs "$QUALIFIED_STATE_DIR" .scratch/aios-v1-implementation/native-coding-controller-loss-acceptance.mjs -- "$DEDICATED_MACHINE" "$OTHER_NEW_REPORT_PATH" deadline --approve-offline-native-run
```

An observed result remains `qualified: false` and `productionEnabled: false`.
No native run was performed in this implementation slice. Neither simulator
results nor this procedure check off native expiry/controller-loss qualification.

## Implementation validation

The first correct regression failed with `observeTimerExecution is not a
function`. A first malformed test invocation had a syntax error and is not
counted as that regression. A later contradictory timestamp case reproduced a
missing refusal and passes after the validator was corrected. The acceptance
seam initially failed with a missing module and now exercises both timer modes.

Focused native transport/lifecycle and acceptance tests: 97 passed before final
review follow-ups. They include natural exit, cleanup, pin drift, missing/foreign
manager command, ignored failure, malformed data, ambiguous dual execution,
failed kill, observation timeout, unavailable/backward clock, early collection,
uncertain controller/recovery, incomplete collection and evidence failure.
The standards review exposed retained elapsed timers passing the broad active
check. Its regression reached a fallback gate before the fix; strict armed-state
validation now refuses the poll before renewal. A first post-fix assertion used
the wrong error text and was corrected to the public poll-refusal contract.
Fresh execution records are also required after the fixed-deadline wait.
Both review axes have zero remaining actionable findings. The final macOS
validation sequence (`typecheck`, `format:check`, full `npm test`, `build`) passed
in 312.8 seconds under the unchanged ten-minute profile. The supervising
executor reported exit zero, no timeout and no termination failure. Its bounded
stdout was truncated, so no exact full-suite test count is claimed. The separate
acceptance runner passed syntax/format checks. No existing assertions, required workflows, policy, dependencies or
coverage thresholds were changed.

## Investigation accounting and remaining work

Scope `issue04-native-controller-loss` was added to the existing private ledger
`/private/tmp/issue04-native-timer-continuity-ledger` under the owner's continuation
request, preserving prior charges and cycles. No old exhausted budget was reset.
CI/review waits are excluded; implementation and local revalidation are charged.
The elapsed-timer candidate regression is retained as a failure observation. One
review repair cycle was consumed; the ledger retains 63 active minutes and two
repair cycles after the latest checkpoint.

Fresh independent Windows and macOS runs must retain exact source/runtime/policy
bindings and all failed attempts. General resume, model-only authority,
usage/exhaustion, storage bounds, controlled dependency execution, adversarial
isolation and production controller integration remain open.


The preservation audit compared all 96 existing test/helper files against the
merged baseline: none are missing. Only the native guest helper and native
transport test file changed; every original test-file line remains in order.
The original checkout's saved tracked diff still matches byte-for-byte.
