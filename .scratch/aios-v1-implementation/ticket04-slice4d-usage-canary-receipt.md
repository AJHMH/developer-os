# Issue 04 slice 4d: the owner-run offline usage canary

Base: `main` at `22ad90f`. 28 October 2026. No inference, no credentials, no
guest change. Built and simulated; the native runs on both hosts are still to
do.

## Decisions

4d is the plan's owner-run offline canary for owner decision C. The owner
chose on 28 October:
- **Driver:** the delivery controller over the real native transport, with a
  real `GeneralSessionGateway` factory and the routed runner's fake provider.
  Planning, validation, onboarding, the worker probe, the mediation decision
  and usage are synthetic stand-ins.
- **Scenarios:** the full lineage, three native turns: unknown usage refused
  even approved; low usage needing approval; exhaustion mid-launch; restart
  refused without approval; an approved resume with the decision withdrawn
  mid-turn; a new decision starting a new lineage that completes.
- **Code reuse:** the fake provider and its scripts move to a shared module.

## What changed

- **`scripts/run-native-usage-canary.mjs`:** `usageCanary({ transport,
  admission })` and its owner-run `main`, with the stages in `stageNames`. Each
  turn is checked for an exact stop. A lapsed turn must be ended at once: the
  gateway refused the next model request (counted as `revoked`, since the
  controller revokes inside the authority callback), and the provider
  answered only the two requests before it. It must be revoked and recorded
  with its reason, keep its thread, and keep its workspace as evidence only;
  the report lists the kept paths. Unknown usage must be refused as
  unmeasured once approved (decision H), not as needing approval. The final
  stage reads from the controller that the decision authorizes no inference
  and delivery stays disabled. The resume must continue the launch's thread under the same
  route. The new lineage must start a new thread under the new decision,
  supersede the old lineage (its latest session, the resume), run the work
  script through the route and complete. Every session is stopped again at
  the end.
- **Shared modules, behaviour unchanged:**
  - `scripts/routed-provider.mjs`: the fake provider, its scripts and SSE
    framing, from the routed runner; its test imports them directly.
  - `scripts/synthetic-mediation.mjs`: the synthetic worker probe and
    decision record, from `tests/helpers/mediation-fixture.mjs`, which now
    calls it. `write()` records a new decision (a new run).
  - `scripts/synthetic-usage.mjs`: the synthetic usage reader, from 4c's test
    helper, which now wraps it.
  - `scripts/windows-owner.mjs`: the Windows synthetic owner setup, from
    `tests/helpers/windows-fixture-owner.mjs`, which re-exports it.
  - `scripts/synthetic-delivery.mjs`: the synthetic delivery, from the
    coding admission runner, which now imports it.
- **The synthetic reader's reset time is fixed** from its first observation.
  The usage scope an owner approval names hashes the window's reset time; a
  reset time that followed the clock changed the scope across a second
  boundary, so the canary's approval was intermittently lost. A real window
  keeps its reset time.
- **Docs:** `docs/worker-qualification.md` gains "Usage canary" with the run
  commands for both hosts.

## Testing

- `tests/zz-usage-simulated-canary.test.mjs` runs the canary against a
  simulated VM whose Codex sends the captured 0.161.0 request shape to the
  real gateway and retries refused requests until its gate stops it. It
  sorts last, so it joins Windows shard 1 and no other file changes shard.
  - The full lineage passes with three routed turns and nothing dispatched
    while usage refused.
  - A record naming other pins blocks before any turn.
  - A session that survives its stop leaves the canary `uncertain`.
  - An interrupted canary stops at its stage and stops every session.
- Every consumer of the moved fixtures passes unchanged.
- `tests/fresh-build.test.mjs` now copies the whole `scripts/` folder into
  its stale checkout, so a runner's shared modules resolve, and covers the
  canary runner: it refuses a stale build before any effect.
- **Two-axis review.** Standards: no violations; applied the shared
  `synthetic-delivery.mjs`, the routed test importing the provider directly,
  and explicit request hooks. Left as is: the canary test's simulator repeats
  parts of the routed test's, and the runners repeat their stage and report
  scaffolding, as before. Spec: added the gateway-refusal and request bound,
  the unmeasured-usage refusal, the kept evidence paths, and the controller's
  own disabled flags.
- Results are in the PR description.

## Native runs (to do after merge)

On each host, from a clean, built `main`, with the current coding admission
record (no guest change, so no re-approval). Expected outcome:
`observed-offline-usage-canary`.

**Risk on the owner's Windows PC:** the shard-split receipt recorded that on
that PC the mediated tests fail at the synthetic decision's qualification,
while they pass in hosted CI. The canary uses the same synthetic decision,
so it may block at `synthetic-decision-qualified` there; the report names
that stage.

## Not covered

- A real provider and a real usage reading: slice 5.
- Guest cleanup of a superseded lineage: a later guest slice.

Production remains disabled.
