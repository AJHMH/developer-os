# Issue 04: native resume partial-transfer recovery

Status: offline transport recovery is implemented on
`codex/issue04-resume-transfer-recovery` and reviewed on both axes. Hosted
checks and native qualification remain open. This slice does not wire anything
into the production controller, and production remains disabled.

## Boundary and behavior

`NativePodmanCodingTransport.recoverInterruptedResume(session, resumeFrom)`
returns a retained private session home to its explicitly named predecessor.
It applies only when a resume moved that home and then stopped before it
attempted to launch. Before this slice, such a home stayed blocked for good:
the predecessor was reserved and the successor could not run.

The host refuses malformed input before it touches the guest:
- both sessions need a UUID operation ID and a safe-integer fence of at least 1;
- the two operations must differ, and the predecessor fence must not be newer;
- the predecessor must be named as `stopped`, with a `start` or `resume` intent.

A guest result other than `recovered: true` is reported as uncertain.

Under the shared management lock, the guest `recover-resume` action refuses
unless all of these hold:
- The successor is `stopped` and has never attempted launch. Launch now saves
  `launchAttempted` in the same durable write as the `launching` phase, so a
  missing container is not taken as proof that the successor never ran.
- The successor has no process group or pids, and it has not been recovered
  already.
- The predecessor the caller names matches the one in the successor's
  admission.
- Any successor container is not running and has no pid.
- The predecessor's durable identity matches, its phase is `stopped`, and its
  reservation is either absent or held by this successor.
- If the home is still in the successor, the predecessor has no home and is
  still reserved by this successor, because prepare reserves before it moves.
- If the home is not in the successor, it is already back in the predecessor.
  A lost home refuses, and the predecessor stays blocked.

Each step is idempotent. Recovery moves the home back, releases only this
successor's reservation, and then marks the successor `recovered`. After that,
the successor's identity can never be reused. The predecessor can then be
resumed again by a new, explicitly admitted operation.

Recovery does not recheck the home's contents. The next resume's
retained-home check still runs before any transfer: ownership, no links or
special entries, the size bounds, and the Codex configuration refusals.

## Crash-point coverage

Prepare saves the successor, saves the reservation, moves the home, creates the
pod, and then launches. The tests reach each interruption point through the
public seam and the external guest fixture:
- **Interrupted after the move** (pod create fails): the home returns, the
  reservation is released, and a later explicit resume succeeds.
- **Interrupted after an earlier partial recovery**, either with the home
  already returned or with the home returned and the reservation released:
  recovery completes. These two states are the same as a crash after the
  reservation and before the move, and a crash before the reservation.
- **Launch attempted** (pod start fails after the marker is saved): refused.
- **Launched successor:** refused.
- **Successor never stopped** (host lost mid-prepare): refused, because the
  prepare may still be live.

The other refusals each assert that no retained home moved:
- different predecessor (a real, valid, unreserved second session);
- already recovered;
- moved home without a reservation;
- foreign reservation, both before and after the home was returned;
- homes present in both sessions;
- lost home;
- malformed identities, which make no guest request.

## Evidence and retained corrections

Tests use only the agreed seam: the transport's public `run`, `stop` and
`recoverInterruptedResume` methods, against the external Linux guest fixture.
The guest harness gained two fault flags: `createUnavailable` and
`startUnavailable`. Some refusal tests inject faults by editing external guest
state; each place is labeled, and no assertion reads a management journal.

TDD notes:
- The positive recovery regression failed against the baseline transport,
  which had no recovery method.
- The Spec review found two acceptance holes, and each new test failed first:
  - An absent container was treated as proof the successor never launched.
    The `launchAttempted` marker fixed this.
  - A moved home with no reservation was accepted. It is now refused.
- The Standards review removed a test helper that recomputed the guest's
  private naming hash; paths now come from fixture state. It also merged
  duplicated setup and aligned host validation.

Mutation table: each guard was removed in turn, the code was rebuilt, and the
recovery tests were rerun.

| Guard | Pinned by |
| --- | --- |
| successor phase `stopped` | unstopped-successor |
| `launchAttempted` | launch-attempted-successor |
| `recovered` | already-recovered |
| reservation absent or held by this successor | foreign-reservation-after-return |
| home in both sessions | both-homes |
| moved home must still be reserved | moved-home-without-reservation |
| lost home | lost-home refusal |
| host: same operation, newer fence, non-stopped state, malformed UUID | malformed-identities |

Some guards stay as defense in depth. No test can isolate them, because an
earlier guard always refuses first:
- **Successor group/pids:** a successor with pids has already passed the
  launch marker.
- **Container running or pid:** a running container likewise implies the
  launch marker is set.
- **Admission names the predecessor:** a different predecessor reaches the
  both-homes or reservation guard.
- **Predecessor identity and phase:** prepare only reserves a stopped
  predecessor whose identity it has verified.
- **Host "uncertain" check:** the real guest either fails or returns
  `recovered: true`.

One correction from this run: the first mutation table did not rebuild `dist`,
and the tests import the compiled transport, so that table measured nothing.
A stale mutated build also made the baseline look red once. The table above
comes from a rerun that rebuilt after every mutation and again after
restoring the source.

Final validation, cloud Linux on Node 24:
- typecheck and Prettier pass;
- 14 focused recovery tests pass;
- the full `npm test` reports 830 tests: 826 pass, 4 skipped, 0 fail, exit 0,
  2m48s.

No Codex binary, credentials, online inference or real VM was used. A native
macOS resume runbook exists from the explicit-resume slice; its outcome is
still not-run, and it does not exercise recovery.

## Still open

- Controller predecessor plumbing and recovery orchestration.
- Fresh model-only and usage authority.
- Base-refresh resume.
- Real Windows and macOS resumed CLI, recovery and isolation qualification.
- Production remains disabled, and the parent ticket stays partial.
