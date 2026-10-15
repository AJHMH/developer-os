# Ticket 21: relay and VM fixture review

> Historical/design artifact: statements below apply to the recorded investigation, proposal or revision. For implemented capabilities, later completion evidence and remaining production gates, see [implementation status](../../docs/implementation-status.md).


Review base: owner-selected `5d99f1f`; this continues the same implementation.
Incremental reviews were run in parallel on the existing Spec and Standards
review agents. The fixed inference plan is preparation, not execution approval.

## Standards

0 hard violations, 0 unresolved heuristic findings. A stale `revoked` reference
was caught by typechecking and corrected to use the shared grant. The final
canary invokes `grant.permits()` directly. Typecheck and formatting pass.

## Spec

0 corrective findings. Native evidence covers synthetic restricted Alpine
credential exclusion and fixed stdin transfer. Host-loopback revocation covers
in-flight cancellation and replay refusal with independent upstream controls.
Actual Codex credential mediation and endpoint enforcement remain unqualified;
no live inference or production dispatch ran. This does not complete ticket 21.

The approved-run harness consumes a one-shot marker outside the candidate before
Keychain access, validates the selected identity/scopes/expiry, fixes the upstream
and prompt, denies redirects/retries/refresh/fallback, bounds duration and bytes,
and requires completed SSE plus the exact returned fixture result. Provider
bodies, raw assertions and credential records are never printed. Unknown usage
requires a separate explicit approval for that exact account and run.

## Validation and operational observations

All 123 tests passed. Native red established that the owner-credentials probe and
then the fixed frame transport were absent. Native green proves the new bounded
fixture assertions, matching pins, durable status and stopped worker state.

The existing VM needed its startup terminal held open; ordinary execution-session
cleanup stopped its children. Fresh enrollment also detected a changed host ID
on this boot, correctly refusing older pins. Previous pin files were retained.
The final external policy is `pins-ticket21-frame.json`. Restart/drift requires
fresh enrollment and preparation; an existing approved plan cannot override it.

The saved access token was expired. Returning authorization renewed the same
verified account registration with unchanged scopes and Keychain-only storage.
No new registration, account switch, inference or VM token transfer occurred.

## Actual Codex follow-up, 11 October

The approved one-shot Alpine inference completed once and its relay grant was revoked; the separate observation records its exact scope and consumed run ID. The pinned Linux ARM64 Codex 0.161.0 initialization/account-read probe now passes in the native restricted VM, including actual process UID, environment, capabilities, seccomp and shutdown audits. The empty home directory is created inside disposable temporary storage; management observes mapped UIDs through its rootless user namespace. The worker receives no extra privileges.

Parallel follow-up review: Standards 0 hard violations and 0 unresolved judgments; Spec 0 corrective defects or scope creep. Spec still identifies missing integrated Codex-to-relay inference, independently enforced endpoints and delivery-scoped capabilities. These remain unqualified. All 123 tests pass with local loopback sockets enabled. The default filesystem sandbox refused the synthetic loopback tests; the authorized unrestricted run passes. Typecheck and formatting pass.

A credential-free feasibility check also confirms that a trusted management process can enter only the worker network namespace using `podman unshare nsenter`, without host credentials or additional worker privilege. This is feasibility evidence only; the trusted bridge and its full endpoint/revocation qualification are the next implementation step. Production gates remain false and ticket 22 remains blocked.
