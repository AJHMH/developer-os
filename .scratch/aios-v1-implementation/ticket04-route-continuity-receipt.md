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

## Native routed acceptance under the new guest (27 October 2026)

After PR #122 merged at `f64fdae`, each host's coding record was renewed and
the routed acceptance rerun. On both hosts the first run blocked at
`owner-record-names-fresh-pins` and printed `freshPins`. Only `policySha256`
had changed, from `89339099…` to `77885706…`, as computed in the simulator.
`bindingSha256` and the other pins were unchanged. Each record got the new
pin and a new `approvedAt`. Those blocked runs are not kept.

Both reruns used a clean (`sourceDirty: false`), freshly built `main` at
`f64fdae`, with the same runner (`0706a59c…`), coding probe (`6e7b3db4…`),
gateway (`7df3a76b…`) and build (`4347151d…`, dist `4f987495…`) hashes.

| | macOS (`aios-macos-noshare`) | Windows (`aios-podman-noshare`) |
|---|---|---|
| Report | `macos/ticket04-routed-acceptance-20261027-190802.json` | `windows/ticket04-routed-acceptance-20261027-201606.json` |
| SHA-256 | `b7eba303…` | `cd759a2d…` |
| Outcome | `observed-offline-routed-acceptance` | `observed-offline-routed-acceptance` |
| Stages passed | 9 of 9 | 9 of 9 |
| Coding probes passed | 26 of 26 | 26 of 26 |
| Launch requests (keep-alives) | 5 (3) | 6 (4) |
| Resume requests (keep-alives) | 2 (0) | 2 (0) |
| Total time | about 60 s | about 123 s |

On both hosts the resume (fence 2) kept the launch's delivery and decision
with a new relay capability, so the new check admitted it natively:
- it continued the launch's thread and exited 0;
- code-mode tools worked through the relay and gateway, with no
  `unexpected` requests and no gateway refusals;
- its grant was revoked as `stopped`, and a later use was refused as
  `revoked`;
- the exact stop left 0 processes, and `routed-resume.txt` was collected.

The launch passed the same way, with the probe after the first request and
before the edit. This answers "Not covered (native)" above for the matching
path. The refusals remain covered in the simulator only, since the runner
never sends a mismatched resume.

**Windows host note.** Earlier the same evening, Windows runs from the older
`5763a29` checkout were blocked first by the stale `gvproxy` socket again,
then by a full VM disk. As the Windows session reported it (not
independently checked here), each stopped coding session keeps its own copy
of the Codex binary, about 350 MB, and nothing removes it; 21 sessions held
5.9 GB of the 10 GB disk. The owner approved trimming the copies from
sessions stopped more than 24 hours earlier. Those runs predate #122 and are
not kept. Bounding retained session binaries is a guest change, so it would
need another policy re-approval on both hosts.

Production remains disabled.
