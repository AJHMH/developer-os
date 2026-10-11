# Ticket 21: relay and VM fixture review

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
