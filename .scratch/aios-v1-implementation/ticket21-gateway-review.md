# Ticket 21 host-only gateway integration review

Owner-selected fixed base: `5d99f1f`. Parallel Standards and Spec review covered
that cumulative ticket diff plus the current gateway continuation, native bridge,
public status test, acceptance harness and separately approved inference harness.

## Standards

0 hard violations, 0 unresolved judgments. Host credentials remain behind a lazy
host callback. The asynchronous bridge bounds both streams, serializes requests,
checks executable integrity and revokes its grant on cleanup. Awaiting the host
observer preserves canaries through asynchronous native qualification.

## Spec

0 unresolved corrective findings or scope creep. One corrected finding aligned
approval/account host identity with the broker's canonical `urn:uuid:` registration,
separate from the VM binding digest. Realistic synthetic identity, expiry and scope
refusal controls now pass. Only the exact fixed request goes upstream, and only a
verified completed minimal result goes back to Codex. No credentials enter the VM.

Real integration remains unproved until a separately approved subscription run
succeeds. The consumed Alpine approval does not authorize this actual-Codex test.
Production and ticket 22 remain blocked; no positive acceptance box is checked.

## Validation

Red: public qualification/status lacked host gateway proof; stale native source
pins refused admission. Initial transport startup quoting and discarded Codex
`additional_tools` context failures remained blocked. Green: the final native
actual-Codex turn completed through VM relay/private frames/host gateway with a
synthetic account and provider. All five endpoint/capability controls, independent
process shutdown and final VM bindings passed. Policy:
`pins-ticket21-gateway-v2.json`, outside candidate storage. Latest bounded safe
observation: [gateway evidence](ticket21-gateway-observation.json).

Build/typecheck and formatting pass; all 123 automated tests pass. The prepared
one-shot plan binds account/registration, request, delivery, gateway source, pinned
Codex executable and VM policy/binding. An external exclusive marker is consumed
before Keychain access. Preparation used no owner credentials or inference.

## Approved run refusal and renewal

Approved run `2b8ba949-c1a5-49e3-81bc-dd96106e1d6d` consumed its marker, then
refused an already expired host credential before provider dispatch. Safe metadata
confirmed expiration preceded plan preparation and account/registration/scopes
still matched. Request count was zero. Separate previously authorized returning
sign-in renewed the same account/scopes through the browser into host-only
Keychain. Fresh plan `05cac8f2-d0f7-4b2a-87af-ef8a5e84720d` passed synthetic
qualification again and awaits its own owner approval. No code changed after
review/tests; real integration remains unqualified.

## Provider-shape correction and final review

The renewed real run refused with valid account/registration/scopes and credentials
valid through the grant. Provider dispatch and exact failure stage were not
retained by the old harness; usage may have been consumed, bounded to one request.
The receipt labels that outcome unverified. Controlled red/green testing separately
reproduced rejection of documented [Responses reasoning output](https://developers.openai.com/cookbook/examples/responses_api/reasoning_items).
The correction admits reasoning only to discard it, verifies completed message
text against deltas and the fixed result, and returns canonical minimal output.
It does not establish the cause of the previous live refusal.

Safe future diagnostics retain fixed phases, provider-attempt counts and numeric
HTTP status. Review corrected an unconditional not-run receipt: attempted refusals
are now unverified. Parallel final Standards review reports zero violations or
judgments; Spec has no unresolved security/input/credential findings after that
receipt fix. Final synthetic native qualification passed; all 123 tests and format
checks pass. Prepared corrected run: `971f4e43-fa29-466d-9045-e9bfd2b92fd0`.
No unapproved live inference or retry was performed.

## Fixed-origin transport correction

The third approved real run retained HTTP 200, one provider attempt and refusal
before body parsing. Exact provider content and completed inference remain
unverified. Controlled public-status testing reproduced rejection of valid SSE
with a non-SSE MIME label. The focused injected HTTP adapter now exercises the
same fixed-origin wrapper as production; bounded strict body/completion validation
is the authority check. Malformed HTTP 200 still refuses. This does not prove the
actual refused response shape. Parallel review reports zero Standards violations
or judgments and zero corrective Spec findings. Final native synthetic proof,
all 123 tests and formatting pass. Fresh plan:
`717a2831-d4f6-445f-9368-2e719cacf753`, awaiting exact owner approval.

## Bounded stream diagnostics after approved refusal

Approved run `717a2831-d4f6-445f-9368-2e719cacf753` consumed its approval and
refused during response validation after one provider attempt. Usage may have
been consumed; completed inference remains unverified. The retained receipt is
`ticket21-gateway-body-refusal.json`. No response body was retained, so the cause
cannot be reconstructed from that receipt.

The gateway now records byte/event/delta counts, completion and exact-match flags,
fixed format classifications and allowlisted error codes. It records no provider
text, token, claim values or reasoning metadata. Acceptance still requires a
bounded event stream with successful completion and the exact fixed result;
non-stream JSON is diagnostic only. Diagnostics and acceptance share the same
output-shape predicate. Parallel Standards and Spec reviews report zero remaining
findings. All 123 tests, formatting and fresh native synthetic qualification pass.

Fresh diagnostic plan `824eb1a1-a8da-4536-b1dc-75e9993bece0` is prepared but
unapproved. Preparation performed no subscription inference or Keychain access.
A new exact owner approval including unknown usage is required before execution.
Production delivery remains disabled and ticket 21 positive acceptance stays open.
