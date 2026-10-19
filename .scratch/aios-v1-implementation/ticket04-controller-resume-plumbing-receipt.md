# Issue 04: controller explicit-session resume plumbing

Status: implemented at the controller seam on
`codex/issue04-controller-resume-plumbing` and reviewed on both axes, with a
Spec re-review. Hosted checks and native qualification remain open.
Production remains disabled.

## Boundary and behavior

`DeliveryController.codeFeature` now carries native explicit-session resume
end to end.

- **Resume names its predecessor.** A resumed turn names its exact stopped
  predecessor as `resumeFrom`: the operation ID, fence, `state: "stopped"` and
  the predecessor's intent. It has no thread ID and no global session selection.
  This shape is the one the guest compares: prepare stores it as
  `admission.resumeFrom`, and recovery checks it.
- **Persistence and fencing.** The session persists `resumeFrom`.
  `PinnedCodingRuntime` includes it in the launch binding, so a predecessor
  changed during asynchronous pin inspection refuses before dispatch.
- **Thread observed.** The session durably records `threadStarted` when its CLI
  `thread.started` event is accepted.
- **When recovery is needed.** A resume that stops without that observation
  may have moved the predecessor's retained session home. The controller:
  - sets an `UNCERTAIN_SESSION` blocker at stop, whether the stop came from the
    turn, pause, cancel or recovery;
  - treats the delivery as not quiescent, which refuses dispatch, phase resume
    and ownership release;
  - recovers through `runtime.recover`, either straight after the failed turn
    or through the public `recover` action after a pause or controller loss.
- **When recovery succeeds.** The session is marked
  `resumeRecovery: "recovered"` and the blocker clears. The next resume names
  the original predecessor again. A resume whose thread did start keeps that
  successor as the next predecessor.
- **When recovery isn't verified.** A runtime without recovery, a refused
  recovery, changed pins or a receipt for another operation leaves the blocker
  in place.

`PinnedCodingRuntime.recover` delegates to the transport's
`recoverInterruptedResume`. It checks the pins before and after, and requires
an exact operation, fence and `recovered: true` receipt.

The guest's `recover-resume` now also covers a resume that was refused before
its preparation was recorded, such as the refusal of a retained home that
contains Codex configuration. Prepare saves its record, with an admission and a
binding, before it reserves or moves anything. A record with no binding and no
admission can therefore only come from the exact-session stop. Recovery then
moves nothing, requires that the successor has no home and that the
predecessor isn't reserved by it, and consumes the successor. Before this
change, such a resume stayed blocked forever.

## Known limitation

The recovery decision uses observing `thread.started`, while the guest refuses
recovery once launch was attempted. These signals differ in one case: a resume
that launched but stopped before its thread event stays blocked as
`UNCERTAIN_SESSION`, because the guest refuses its recovery. That fails closed,
and it needs owner reconciliation that doesn't exist yet. No case skips a
recovery that was needed, because the thread is observed only after launch.

## Evidence

All tests go through the agreed seams:
- the public `DeliveryController` methods (`codeFeature`, `recover`, `pause`,
  `resume` and `release`) with the controlled runtime fixture;
- `PinnedCodingRuntime` over a controlled transport;
- `NativePodmanCodingTransport` against the external guest fixture, for the
  unrecorded-preparation recovery.

TDD notes:
- The five initial controller tests failed first: no `resumeFrom`, no recovery
  and no block. My first test helper failed in setup, because `structuredClone`
  can't copy the request's callbacks. I fixed the helper before trusting the
  red results.
- The controller-loss test failed first: `recover(id)` stopped the lost
  session but never recovered its home. Fixed.
- **Spec review findings:**
  - Release and phase resume weren't blocked while a home was unverified, and
    a resume refused before preparation could never be recovered. Each new
    test failed first.
  - The re-review found that pause and cancel left an unverified home with no
    blocker. The test failed first; `stopFeature` now sets the blocker.
- **Standards review findings:** a stale doc comment and duplicated test setup
  (restarts, the controlled transport, controller loss). Both fixed.

Mutation checks: each guard was removed in turn, the code was rebuilt, and the
focused tests were rerun.
- **Pinned, with at least one test failing when removed:**
  - adapter pin check;
  - the `threadStarted` and `recovered` parts of `needsResumeRecovery`;
  - recovery after the turn, in `recover`, and after a lost stop;
  - controller receipt operation check;
  - predecessor choice after recovery;
  - the blocker when recovery fails, at stop, and when it clears;
  - `resumeFrom` in the launch binding;
  - the quiescence change;
  - the guest check that an unprepared successor holds no home.
- **Redundant by design:**
  - the adapter's receipt operation check, because the controller checks it;
  - the guest check that an unprepared successor isn't the predecessor's
    reserver, because prepare saves before reserving;
  - a missing recovery method, which the type system enforces.
- I removed a pre-dispatch guard once quiescence made it unreachable.

Final validation, cloud Linux on Node 24:
- typecheck and Prettier pass;
- `feature-candidate.test.mjs` has 70 of 70 passing;
- the focused native recovery tests pass;
- the full `npm test` reports 845 tests: 841 pass, 4 skipped, 0 fail, exit 0,
  2m34s.

No Codex binary, credentials, online inference or real VM was used.

## Still open

- Owner reconciliation for a resume that launched without an observed thread.
- Fresh model-only and usage authority for resumed turns.
- Base-refresh resume.
- Real Windows and macOS resumed CLI, recovery and isolation qualification.
- Production remains disabled, and the parent ticket stays partial.
- Domain vocabulary: "retained session home" and coding-session "resume", as
  distinct from delivery resumption, are not yet in `CONTEXT.md`.
