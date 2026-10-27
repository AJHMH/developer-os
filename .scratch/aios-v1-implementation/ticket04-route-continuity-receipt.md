# Issue 04: route continuity across resume

Base: `main` at `c8c7cd3`. 27 October 2026. No inference, no credentials, no
native run.

## Decision

The owner chose **decision A** for the open question in the 3a receipt
(`ticket04-model-route-binding-receipt.md`, "Open"): a resume must keep its
predecessor's mode, delivery and mediation decision. Only the relay
capability is new.

This fits slice 4. After exhaustion, the plan has a fresh restart approval
start a new session, a re-dispatch, not resume the old one, so a new decision
never needs to continue an old thread.

## What changed

- **Guest (`src/podman-coding.ts`).** When admitting a resume, next to the
  existing predecessor checks, the guest compares the predecessor's recorded
  `modelRoute` with the resume's. It refuses, before saving any record,
  reserving the predecessor or creating a worker, when:
  - the predecessor was routed and the resume is offline, or the reverse;
  - the `deliveryId` differs;
  - the `decisionSha256` differs;
  - the capability is the predecessor's (same `capabilitySha256`).

  Freshness is checked against the immediate predecessor, the only record a
  resume reads. Each capability comes from a fresh gateway grant, so reuse
  further back in a lineage isn't expected, but the guest doesn't check it.
- **Tests (`tests/worker-native-resume.test.mjs`).** Five tests drive
  `NativePodmanCodingTransport.run` against the guest simulator (the real
  guest program, fake Podman), one per refusal. Each shows that no successor
  worker was created, and that the predecessor stays resumable: a matching
  resume, same mode, delivery and decision with a fresh capability, then
  claims it. That no record is saved first follows from the check's place in
  the code, before the record save; the tests don't observe it directly.
- **Runbook (`docs/worker-qualification.md`, "Routed session acceptance").**
  States the rule and the pin change, and drops the limit that said the
  guest doesn't compare routes.

## Pins change

The coding guest program changed, so the coding `policySha256` changes from
`89339099…` to
`77885706d5df5d97f39fcbc1948d6246e318e296430f645a9400e945ebe038f1`, as
computed by `transport.inspect` in the simulator. Each host's owner coding
admission record needs one re-approval before the next coding run. A record
that doesn't match prints `freshPins`, which also shows whether
`bindingSha256` moved.

A session stopped under the earlier guest can't be resumed after the upgrade:
resume admission already requires the predecessor's pins to equal the
request's. New lineages are unaffected.

## Evidence

- Written test-first, one slice at a time. Each refusal test failed with
  "Missing expected rejection" before its clause was added. The
  offline-to-routed case passed on the mode clause that the routed-to-offline
  case introduced.
- `tests/worker-native-resume.test.mjs`, `tests/routed-acceptance.test.mjs`,
  `tests/model-route.test.mjs` and `tests/coding-admission.test.mjs`: 153 of
  153 pass. Format and typecheck pass.
- **Full suite** (`AIOS_TEST_PYTHON=/usr/bin/python3 npm test`, Node 24.15.0,
  macOS): 1,256 tests, 1,250 passed, 4 skipped, 2 failed. The two failures
  are the known local SSH-signing passphrase prompts, which also fail on
  unchanged `main`.
- **Two-axis review:** no standards violations and no spec gaps in the code.
  Applied: compare against the resume's own capability hash; name the test
  helpers `predecessorUnder` and `renewed`; state freshness's scope, the
  test's evidence and the stopped-session consequence here. The resume tests
  then passed again, 85 of 85, and the pin above is from after those edits.

## Not covered (native)

- Not yet run natively. After merge and record renewal, the routed acceptance
  on each host exercises the matching path (its resume keeps the delivery and
  decision with a fresh capability). The refusals are covered in the
  simulator only.

Production remains disabled.
