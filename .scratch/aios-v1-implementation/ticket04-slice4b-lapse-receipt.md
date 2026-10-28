# Issue 04 slice 4b: a lapse or withdrawal ends a routed turn at once

Base: `main` at `05eea07`. 28 October 2026. No inference, no credentials, no
native run, no guest change.

## Decisions

4b implements the owner's decisions F and G (the plan's "Owner decisions for
slice 4"). The owner also chose, on 28 October:
- **Test seam:** `DeliveryController.codeFeature` with the injected
  general-session factory fake and the existing fake `FeatureRuntime`.
- **The record:** each `usageInterruptions` entry gains `reason`
  (`exhausted`, `approval-required`, `unknown`, `account` or `withdrawn`). A
  withdrawal needs the same owner restart approval as a usage lapse; 4c
  decides between a resume and a new lineage.
- **Evidence storage:** `artifacts/interrupted-<operationId>.json`, written
  `wx` with mode 600, listed as `{kind: "interrupted-turn", path}` in the
  delivery's evidence. The feature's candidate is never set.

## What changed

- **One fresh-authority check (`src/controller.ts`).** `freshLapse` observes
  usage now and, for a mediated turn, re-reads the owner's decision record;
  it returns the lapse or `null`. The gateway's authority callback, the 30 s
  usage monitor and the post-turn check all use it, so a withdrawn decision
  is seen between model requests and after a completed turn, not only at
  the next request. A usage read that loses delivery authority is `unknown`
  to the gateway and a control change (interrupt, no record) to the monitor,
  as before.
- **A lapse ends the turn at once (decision F).** On a lapse seen by a
  request or the monitor, the controller revokes the general session with
  the reason, records the interruption with the reason before the worker is
  stopped, and interrupts the turn. The checkpoint then fails, so the native
  poll loop exits. An authority answer that arrives after the turn ended
  changes nothing.
- **Every end revokes once.** A turn without a lapse revokes as `stopped`,
  `paused`, or `pin-changed` when the runtime's pins changed. Reading the
  phase for that cannot skip the stop.
- **Evidence only (decision G).** After a lapse and a verified stop under
  unchanged pins, the controller collects the workspace once and stores it as
  `interrupted-turn` evidence. A refused collection leaves the interruption
  and no evidence. The guest's `collect` is read-only, so the stopped thread
  stays resumable.
- **Types.** `GeneralSessionLapse` (`src/general-session-gateway.ts`) names
  fresh authority that no longer permits a session; the interruption reason
  uses it. Records written before 4b have no reason.
- **Docs.** `CONTEXT.md` (usage interruption), ADR 0002 (revocation) and
  `docs/feature-candidate.md` (interrupted-turn evidence).

## Evidence

- Written test-first in `tests/zz-feature-coding-session.test.mjs`; all ten
  first tests failed on their assertions before the change:
  - a request refused as each of `exhausted`, `approval-required`,
    `unknown`, `account` and `withdrawn` revokes with that reason before the
    turn continues, fails the checkpoint, stops the session with the thread
    kept, and records that reason, revoking exactly once;
  - a turn without a lapse revokes as `stopped`; a paused one as `paused`;
  - a lapse seen by the usage monitor revokes with its reason;
  - the workspace is kept as evidence, mode 600, never as a candidate;
  - a refused collection leaves the interruption and no evidence.
- **After the two-axis review,** also tested: a pin change revokes as
  `pin-changed`; a withdrawal seen by the monitor ends the turn between
  requests; a turn that completes after its decision was withdrawn is
  evidence, not a candidate (before the fix it could be admitted); a
  withdrawal needs the same restart approval; after a lapse and its
  evidence, the restart resumes the same thread. A monitor poll that loses
  delivery authority interrupts without recording a lapse (it keeps the
  monitor's control-change line covered for the Factory coverage gate). The
  existing "completes after exhaustion" test now checks the reason and the
  evidence.
- Results are in the PR description.

## Not covered

- **A lapse found only after the turn completed** is recorded with its
  reason, but the general session was already revoked as `stopped` when the
  turn ended; the grant was over either way.
- **Restart, the route mode on the host, a new lineage after a changed
  decision, and the simulator's synthetic usage reader:** slice 4c.
- **The native canary:** slice 4d. **No real factory:** slice 5.

Production remains disabled.
