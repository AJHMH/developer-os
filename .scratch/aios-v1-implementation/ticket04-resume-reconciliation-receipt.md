# Issue 04: reconciling a launched resume with no observed thread

Status: implemented on `codex/issue04-resume-reconciliation` and reviewed on
both axes. Hosted checks and native qualification remain open. Production
remains disabled.

## The gap this closes

The [controller resume receipt](ticket04-controller-resume-plumbing-receipt.md)
left one case permanently blocked. Recovery correctly refuses once launch was
attempted, so a resume that launched but never reported its CLI thread to the
controller stayed blocked as `UNCERTAIN_SESSION` with no exit.

## Behavior

The guest's new `reconcile-resume` action settles that case from the guest's
own record. It requires all of the following:
- a stopped successor that attempted launch and has no live processes or
  running container;
- an admission naming exactly this predecessor;
- a predecessor reserved by this successor, with the moved home held by the
  successor.

Inconsistent placement or reservation state refuses, and the action never
moves anything. It has three outcomes:

- **Adopted.** The guest recorded the expected thread while polling, and the
  guest records a thread only from a complete, matching `thread.started`
  event. The successor becomes the next predecessor, exactly as if the
  controller had observed it. The next prepare still re-runs every
  predecessor check, including the retained-home check, the `threadId` check
  and the reservation check.
- **Unresolved.** No thread was recorded, so Codex may have touched the home
  without a usable conversation. Coding stays blocked.
- **Retired.** Only an explicit owner decision through
  `DeliveryController.retireResume` gets here. It requires the owning
  delivery and the session's current fence, and the guest marks the successor
  retired. The controller then:
  - records the decision in `feature.retirements` (operation ID and time);
  - clears the blocker;
  - restarts coding fresh (intent `start`, no thread, no `resumeFrom`).

  The moved home stays in the successor's directory, and the predecessor stays
  reserved by the successor. Neither is ever resumed again: prepare refuses a
  retired predecessor and a reserved one. This retained state is accepted
  permanent residue. Nothing deletes it.

The controller reconciles automatically, without retiring, whenever recovery
is refused. That happens straight after the turn, or through `recover` after
a pause or controller loss. `PinnedCodingRuntime.reconcile` checks the pins
before and after, and requires an exact receipt with a known outcome.

## Evidence

All tests go through the agreed seams:
- the public `DeliveryController` methods (`codeFeature`, `recover` and
  `retireResume`) with the controlled runtime fixture;
- `PinnedCodingRuntime` over a controlled transport;
- `NativePodmanCodingTransport` against the external guest fixture.

The guest fixture produces both launched cases realistically:
- for a recorded thread, the controller-side stream callback rejects after the
  guest has recorded the thread;
- for no thread, the engine refuses to start the worker.

Inconsistent state is created by labeled fault injection into external guest
state.

TDD notes:
- Every transport and controller behavior test failed first.
- The Spec review found that `retireResume` had no ownership or fence gate and
  no audit record. The audit assertion failed first. Both are added.
- The Standards review found duplicated code and reused names. Fixed:
  - one controller trust helper and one receipt-match helper;
  - one named outcome type;
  - one guest predecessor-lookup helper;
  - a correct error for the shared pair validation;
  - a distinct test helper name.

Mutation checks: each guard was removed in turn, the code was rebuilt, and the
focused tests were rerun.
- **Pinned, with at least one test failing when removed:**
  - guest checks: launch was attempted; home placement; reservation by this
    successor; the adoption rule; the retire flag;
  - adapter pin check;
  - controller checks: reconciliation after refused recovery; fresh start after
    retirement; adoption marking the thread started; the retire guard; the
    receipt operation check; unresolved never settling; the audit record.
- **Redundant by design:**
  - prepare's check against a retired predecessor, because a retired session
    never has a recorded thread;
  - the ownership and fence gate on `retireResume`, which no public path can
    reach while the resume is unquiescent;
  - outcome validation, which the type system enforces.

Final validation, cloud Linux on Node 24:
- typecheck and Prettier pass;
- `feature-candidate.test.mjs` and `worker-native-resume.test.mjs` have 125 of
  125 passing;
- the full `npm test` reports 856 tests: 852 pass, 4 skipped, 0 fail, exit 0.

No Codex binary, credentials, online inference or real VM was used.

## Still open

- Cleanup of the residue a retired lineage leaves behind.
- Fresh model-only and usage authority for resumed turns.
- Base-refresh resume.
- Real Windows and macOS resumed CLI, recovery, reconciliation and isolation
  qualification.
- Production remains disabled, and the parent ticket stays partial.
- Domain vocabulary: "retired resume lineage", "adopted" and "unresolved" are
  not yet in `CONTEXT.md`.
