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
