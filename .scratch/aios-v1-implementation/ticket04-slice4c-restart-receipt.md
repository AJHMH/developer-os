# Issue 04 slice 4c: restart under the same route, or a new lineage

Base: `main` at `5469024`. 28 October 2026. No inference, no credentials, no
native run, no guest change.

## Decisions

4c carries out the consequence of owner decision A in the plan: a restart
under the same decision resumes, and one under a new decision starts a new
lineage. It also adds the synthetic usage reader for owner decision C. The
owner chose on 28 October:
- **Lineage rule:** each session records its route on the host, and a turn
  resumes only when its predecessor's route equals the route it will use.
  Otherwise it starts a new lineage. Sessions from before 4c have no route
  and count as offline.
- **The old lineage:** recorded as superseded on the feature, never resumed
  again, with its thread and workspace kept as evidence.
- **Cleanup scope:** host-only. The guest's `cleanup-retired` accepts only a
  lineage the guest itself retired, so cleaning up a superseded lineage needs
  a guest change and a new policy pin. That is left to a later guest slice.
- **The usage reader:** controller-level, in `tests/helpers/synthetic-usage.mjs`.

## What changed

- **The route on the host (`src/feature-candidate.ts`, `src/controller.ts`).**
  `CodingSession.route` (`SessionRoute`: `deliveryId` and `decisionSha256`,
  never the capability) is set when the turn will be routed: a qualified
  decision and a general-session factory. An offline turn records none. The
  general session and the model route are now built from that same record.
- **Resume or new lineage.** A turn that could resume (no repair, a prior
  thread, not retired) resumes only when the prior session's route equals
  this turn's. Otherwise it starts fresh, with no thread and no
  `resumeFrom`, and pushes the old lineage to `supersededLineages`
  (`operationId`, `threadId`, `route`, `at`, `by`, and the session binding
  for a later cleanup). A recovered resume is compared by its own route,
  which is its predecessor's.
- **Restart approval** is unchanged: a new lineage after a withdrawal still
  needs the owner's restart approval, and dispatching it spends the approval.
- **Tests.** `tests/zz-usage-restart.test.mjs`, a new file that sorts last,
  so it joins Windows shard 8 and no other file changes shard. The routed
  coding helpers move unchanged to `tests/helpers/routed-coding.mjs`, shared
  with `zz-usage-coding-session.test.mjs`.

## Testing

- **Test-first.** Three tests failed on their assertions before the change:
  - each session records its route, and an offline turn records none;
  - a restart under a re-qualified new decision starts a new lineage,
    supersedes the old one and is the lineage that resumes next;
  - an offline session is superseded when coding becomes routed.

  After review, a routed session superseded when coding becomes offline.
- **The plan's usage scenarios through the synthetic reader**, routed:
  low usage needs approval; unknown usage never authorizes, even approved;
  exhaustion mid-turn ends the turn, and a restart needs a fresh approval and
  then resumes under the same route; a withdrawn decision mid-turn ends the
  turn. These passed before the change too: 4b had built the behaviour.
- **Two-axis review:** no standards violations. Applied: `sameRoute` names
  the resume rule, and implementation status left the glossary. Spec: added
  the routed-to-offline test.
- Results are in the PR description.

## Not covered

- **Guest cleanup of a superseded lineage:** a guest change with a new policy
  pin and re-approval on both hosts.
- **Decision identity** is the hash of the qualified decision, as since 4a.
  A re-qualified decision differs by its record (run ID and observation
  time); re-endorsing an identical record is the same decision and resumes.
- **A recovered resume under a changed route** supersedes its predecessor
  by the same rule; no test drives it.
- **The owner-run offline canary:** slice 4d. **No real factory:** slice 5.

Production remains disabled.
