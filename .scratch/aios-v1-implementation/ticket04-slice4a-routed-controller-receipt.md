# Issue 04 slice 4a: the controller routes mediated coding turns

Base: `main` at `7371b2e`. 27 October 2026. No inference, no credentials, no
native run, no guest change.

## Decisions

The owner's slice 4 decisions E–H are in the plan ("Owner decisions for
slice 4"). 4a implements E. The owner also chose:
- **An injected general-session factory.** The controller routes a mediated
  turn only when a factory is configured; without one, coding stays offline
  as before. The real, credential-backed factory belongs to slice 5.
- **Per-request decision check (after review):** each model request re-reads
  the owner's protected decision record against the delivery's stored
  qualification, without re-probing the worker or rewriting the stored
  qualification. Launch still re-qualifies fully.
- **Test seams:** the controller with the existing fake `FeatureRuntime`, and
  `PinnedCodingRuntime` with a stub transport.

## What changed

- **`CoordinationOptions.generalSessions` (`src/controller.ts`).** A
  `GeneralSessionFactory` gets a `GeneralSessionTurn` (delivery, coding
  operation, SHA-256 of the qualified mediation decision, the decision's
  credential account, and an expiry of the remaining allowance plus 60 s,
  capped at the gateway's 30-minute session limit) and an `authority`
  callback, and returns the turn's `SessionGateway`. The factory is called
  inside the guarded turn, after the dispatch usage check, so a factory that
  throws still stops the prepared session.
- **Routed turns.** When a delivery has a qualified mediation decision and a
  factory is configured, the turn's route is `{deliveryId, decisionSha256,
  capability}` with the gateway's capability. The argv is
  `lockedCodingArgv(threadId, route)`, and the request carries `modelRoute`.
- **Authority at each model request (decision E).** The callback observes
  usage now and re-reads the decision record. In order: no observation or
  unmeasured usage is `unknown` (decision H); another usage account is
  `account`; exhaustion is `exhausted`; anything the gate doesn't permit for
  this operation is `approval-required`; a decision that no longer qualifies
  or hashes differently is `withdrawn`; otherwise `permitted`. The 30 s
  monitor stays, and its read may overlap a request's read: both are fresh,
  and whichever finishes last is stored.
- **Decision hash.** `JSON.stringify` of the qualified decision as projected
  from the owner's record. Its key order and fields come from that file, so
  the hash is stable across turns until the record changes.
- **`account` authority (`src/general-session-gateway.ts`).** Added to
  `GeneralSessionAuthority`. It was already a revocation reason, and the
  gateway revokes with any non-`permitted` value.
- **Dispatch freshness (decision E).** Just before handing the turn to the
  runtime, the controller observes usage again and refuses unless the gate
  permits it for this operation and account, and it is measured (decision
  H). A refusal stops the session before any turn, so no interruption is
  recorded and the next launch needs only fresh usage. `mayDispatch` stays
  synchronous, so it still checks the stored report, now that fresh one.
  ADR 0002 says the 60-second reuse "is removed for this mode"; this
  refresh before dispatch is how it is met.
- **`FeatureRuntime.execute(request, gateway?)` (`src/feature-candidate.ts`).**
  `PinnedCodingRuntime` refuses a routed turn without a gateway, an offline
  turn with one, and a gateway whose capability isn't the route's, before the
  transport runs. Otherwise it passes the gateway to `transport.run`.

## Evidence

- Written test-first. In `tests/zz-feature-coding-session.test.mjs`:
  - a mediated turn is routed through the configured general session (route,
    argv, gateway, turn fields);
  - without a factory it stays offline (today's behaviour, now asserted);
  - six authority values from a fresh observation and the decision record;
  - usage that lapses after preparation is seen before dispatch.
- In `tests/model-route.test.mjs`: the gateway reaches the transport
  unchanged; routed without a gateway, offline with one, and a gateway for
  another capability are each refused. Each refusal clause was checked by
  removing it.
- **Changed test:** "a slow usage observation is never polled concurrently"
  counted a read that started before the turn and ended during it, which the
  new dispatch read now causes. It counts only reads started during the turn,
  so it still fails if two polls overlap during the turn.
- **After the two-axis review,** also test-first: the per-request check
  re-reads the record without re-probing (a worker probe that would fail
  mid-turn leaves the turn `permitted` and the stored decision unchanged); a
  turn's general session never outlives the gateway's limit, even with a
  24-hour allowance; a factory that throws stops the prepared session and
  dispatches nothing. Each failed first. Other review changes: the glossary's
  "general session" names, the existing `sha256` helper, one usage check
  shared by dispatch and authority, and the route built with the gateway.
- **Factory coverage gate (PR #126):** the first commit failed it on every
  attempt, deterministically: global line coverage went from 22,458/23,023
  (97.546%) to 22,578/23,147 (97.541%), and the gate allows no decrease;
  changed lines were 221/225. Measured locally, the new uncovered lines were
  the `unknown` branch when the usage read itself throws and a `catch` around
  the decision read. The projection never throws (it catches internally), so
  that `catch` was dead and is removed; a new test covers the first, with the
  delivery paused while a request's usage read is in flight.
- Results are in the PR description.

## Not covered

- **Lapse handling (decisions F, G):** the grant is still revoked as
  `stopped` when the native run ends; slice 4b revokes at once with the
  reason, fails the checkpoint and collects evidence.
- **Restart, the simulator's synthetic usage reader, and the native
  canary:** slices 4c and 4d. 4c also records each session's route mode on
  the host and starts a new lineage when a restart names a new decision
  (the plan's decision A consequence); until then only the guest refuses a
  resume whose mode or decision changed.
- **No real factory:** slice 5.

Production remains disabled.
