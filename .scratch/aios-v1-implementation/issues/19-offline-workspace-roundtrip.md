# 19: Run and safely collect an offline delivery canary

**What to build:** Deliver an offline controller-driven synthetic workspace round trip: admitted ordinary files enter a fresh dedicated VM worker, restricted execution produces an artifact, verified stop precedes safe output collection, and status/evidence records the exact session and bindings. Reject unsafe paths, links/reparse inputs, secrets, Git metadata and concurrent writes. No reusable owner credentials, engine sockets, host mounts or repository scripts on the controller. The demo is synthetic and grants no feature-delivery readiness.

**Blocked by:** 18.

**Status:** completed

## Parent and governing contract

Supports open parent ticket [04](04-isolated-worker-gate.md), governed by the [canonical specification](../../aios-feature-delivery/spec.md) and owner-approved runtime/scope revision. Use the approved public-controller command/observation testing seam. Readiness describes specified work, not production qualification. No implicit weaker-runtime fallback or paid inference is authorized.

## Acceptance criteria

- [x] A fresh restricted offline worker receives admitted synthetic files, produces an artifact and returns it through the controller after independently verified stop.
- [x] Unsafe paths, links/reparse inputs, secrets, Git metadata and concurrent-write output are rejected.
- [x] Session/binding evidence is retained; owner credentials, host mounts, engine sockets and host execution of repository scripts remain excluded.

## Implementation progress — 9 October 2026

The controller now implements a fixed synthetic offline command and trusted VM-management boundary. It requalifies admission, admits ordinary synthetic bytes, durably records exclusive ownership/session/pin evidence before dispatch, checks the fresh worker's effective bindings, revokes and independently verifies shutdown before collecting, and accepts only the exact bounded ordinary output with matching before/after digests. Evidence is retained outside the candidate repository. Unknown, timed-out, mismatched and unsafe outcomes prevent import; uncertainty retains ownership across restart. Recovery stops without redispatch or automatic collection. Production readiness remains false.

Controlled tests through the approved public controller seam verify the round trip, pause during dispatch, timeout/late dispatch fencing, recovery, unsafe path/metadata/secret/hardlink/junction input rejection, output snapshot changes, linked/secret output rejection, stale receipts and weakened effective configuration. These establish controller behavior, not native isolation or a completed live acceptance criterion.

The [native observation](../ticket19-live-observation.json) records refused admission on `aios-podman-noshare`: observed Windows x64 Hyper-V and engine 6.0.2, but no external pin policy, complete provenance/dedication or effective worker-control evidence. No VM/worker was started, no output collected and no inference or credential import performed. The CLI has no native trusted offline management driver; it refuses rather than substitutes host execution or weaker isolation.

**Remaining blocker:** implement and qualify the native management driver against an external owner-controlled pin policy, including fresh dedicated worker creation/transfer, independently verified fenced descendant stop, and stopped-worker output export. Supply positive native admission evidence and demonstrate the round trip through this controller before closing ticket 19 or unblocking dependent tickets 20/23. Acceptance criteria remain open; `ready-for-agent` describes the remaining implementable work.

Validation: typechecking and formatting passed; the complete host test suite passed all 59 tests with no skips. CodeRabbit source reviews identified CLI help, transaction-failure artifact cleanup/error preservation, and shutdown-ledger failure handling. All were addressed; the final credential-free `src/` review completed with zero findings. A storage-outage regression verifies a retained dispatched session cannot release ownership and can be explicitly recovered after the ledger becomes available.

## Native completion — 10 October 2026

The preceding 9 October blocker is resolved. The CLI now wires the native Windows Hyper-V/Podman management driver and provides explicit `pin-offline` enrollment. Enrollment pins the observed immutable boot-image manifest, cached Alpine template, engine, host, synthetic worker and authority-bound policy. It never treats stored mount intent as effective enforcement. A fixed qualification worker supplies actual readonly-root, mount, uid/capability/no-new-privileges and offline-network observations; its shutdown is independently verified before admission is granted. Production `ready` and `liveReady` remain false.

Each canary gets a fresh restricted container inside the dedicated no-share VM. An ordinary synthetic file is copied by a fixed management-created archive, without mounting the host or executing candidate scripts. The worker creates its result in tmpfs and emits the fixed bounded artifact through the engine log. A machine-wide management lock, single-controller authority registration and durable session/fence/revocation records prevent delayed duplicate dispatch. After independently checking cgroup/PID-start-time shutdown, collection compares two immutable stopped-worker log snapshots and materializes an ordinary single-linked controller spool. No guest-selected path, archive or general repository output is imported.

[Native acceptance evidence](../ticket19-native-roundtrip.json) records live admission and the exact successful delivery/session/policy/binding digests, expected output digest and independent shutdown census: **two observed processes, zero remaining**. The explicit [acceptance runner](../podman-native-acceptance.mjs) also verifies changed VM-image pin refusal, metadata/hardlink/credential-like input refusal, conservative shutdown uncertainty and exact-session recovery through a reopened controller. Controlled regression tests retain unsafe path/reparse and changed-output-snapshot coverage. Stopped workers and guest journals are retained; no VM deletion, inference, owner credential import or billing change occurred.

Initial rejected runs exposed Windows SSH command truncation, generated environment defaults, mountinfo substring matching and the stopping/stopped journal mismatch. Corrected stdin transport, explicitly fixed environment, parsed mount targets and journal reconciliation supersede those attempts; no safety check was removed. CodeRabbit's minor post-start cleanup finding was fixed. Final review completed with zero findings; typechecking, formatting and all **61 tests** passed with no skips.

Ticket 19's synthetic Windows acceptance criteria are complete. Parent ticket 04 stays open, and full forbidden-access, online authentication, adversarial fencing/recovery and macOS qualification remain in their existing tickets. Tickets 20 and 23 are now unblocked for their broader proof obligations.
