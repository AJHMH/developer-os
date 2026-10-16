# Issue 04: first remaining implementation slice

Date: 15 October 2026. Starting main: `f96b8f0` (owner-approved PR #41 baseline
repair). Branch: `codex/ticket04-general-worker-admission`.

## Issue record reconciliation

The parent now separates completed fixed-worker work, remaining general-worker
implementation and remaining native qualification. Issues 02 and 03 are satisfied
prerequisites, not active blockers. `needs-info` is replaced by `ready-for-agent`;
there is no unanswered owner requirement preventing this implementation slice.
Historical investigation is retained in a collapsed section and explicitly
superseded. Signing/publication, merge, synchronization and cleanup remain later
contracts, not additional conditions for closing this worker ticket.

## Implemented behavior

The public controller's configured pinned coding adapter now binds admitted core
launch data before asynchronous executable/policy inspection and checks it again
before worker dispatch. The binding includes operation/session/fence, source and
branch, executable/policy/host pins, exact arguments, allowance, admitted file
paths/content hashes/executable flags, and baseline-refresh revisions/manifests.
Changed launch data refuses dispatch even if the inspection returns matching pins.
The existing fresh ownership/allowance callback still runs before dispatch.

The binding is local dispatch fencing, not a qualification record or credential.
No payload or secret is logged by it. No new public test interface, native transport,
authority mode or production-enabled path is introduced. A future native transport
still must own immutable inputs and recheck authority/pins at its actual effect
acceptance, including any further asynchronous work inside the transport.

## Evidence

Four public-controller regressions inject changed command arguments, input bytes,
input digest or baseline-refresh payload during inspection. Each failed before
its safeguard because worker dispatch occurred (1 instead of 0); each now refuses
before dispatch and admits no candidate. The normal pinned launch and existing
executable-mismatch refusal remain passing.

Focused feature suite: 49 passed, zero failures (19.1 seconds). Targeted pinned
launch suite: six passed. Build, typecheck, formatting and whitespace checks pass.
The full suite with permitted local loopback access and
`AIOS_TEST_PYTHON=/usr/bin/python3` passed 559 tests: 557 passed, two platform skips,
zero failures (348.0 seconds). Its log is local at
`/private/tmp/ticket04-full-suite.log`. Repaired baseline main `f96b8f0` separately
passes all 24 hosted checks. These source checks do not qualify a native worker.

## Still required

The native generic Codex/Podman transport, fresh general-session authentication
and endpoint/dependency authority, continuous usage/exhaustion/resume behavior,
isolated execution/collection and independent lifecycle observations remain to be
implemented/integrated. General worker acceptance must then run independently on
Windows Hyper-V and macOS AppleHV with fresh version/effective-policy bindings.
Old fixed-worker receipts do not qualify this new slice. Issue 04 remains open,
as do complete-platform qualification and the observed pilot. Production is disabled.
