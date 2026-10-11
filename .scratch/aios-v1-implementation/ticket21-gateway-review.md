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

## Approved diagnostic run: completed text inconsistency

Run `824eb1a1-a8da-4536-b1dc-75e9993bece0` was explicitly approved with
unknown usage and consumed once. It refused after one provider attempt. Safe
receipt: 7,472 bytes, 14 event records, six deltas, completed=true, failed=false,
deltaMatches=true, completedOutputPresent=true, completedOutputAllowed=true,
completedTextMatches=false, errorCode=none. The provider stream reached completion
and its accumulated deltas matched the fixed marker, but completed message text
did not. No provider content was retained, so the exact discrepancy is unknown.
The gateway withheld the result and revoked its grant; no retry, refresh or paid
fallback was performed. Usage may have been consumed. The exact-match consistency
check remains enforced. Live integration remains unverified, positive acceptance
open and production delivery disabled. Next work is a controlled reproduction of
completed-message inconsistency before any separately approved live run.

## Approved diagnostic run refused before provider dispatch

The owner approved run `208706f5-a6bd-49e1-9c33-5b6aa813d112` including
unknown usage, with no retries, refresh or paid fallback. The exact plan was
executed once. Fresh synthetic qualification passed, then the consumed run
refused at account validation with zero provider attempts. Safe host-only
metadata confirms the credential expired before plan preparation; identity,
issuer, registration, plan permission and required scopes match. See
`ticket21-account-refusal-metadata.json` and the latest inference receipt.
No credentials were renewed, and no live provider request was sent.

The previous completed-text discrepancy receipt is retained separately as
`ticket21-completed-text-refusal.json`. This run gives no additional response
structure evidence and cannot identify that discrepancy. The offline diagnosis
remains at the information gap documented in `debug/completed-message-diagnosis.md`.
No production parser change or consistency relaxation is justified. Continuing
live diagnosis requires separately authorized credential renewal and a fresh
exact approved plan; this run's marker must never be reused. Positive ticket 21
acceptance stays open and production delivery disabled.

## Same-account renewal and fresh unapproved diagnostic plan

The owner authorized same-account browser renewal and fresh preparation only.
Returning sign-in succeeded with existing registration/scopes and validated
credentials stored in macOS Keychain. Fresh native synthetic qualification passed
using authorized v3 pins. Plan `237f6664-3fc6-4152-aac0-dba167f1f4d2` is prepared
and awaits its own exact live-run approval including unknown usage. No inference
was executed. Separate safe host-only preflight confirms matching identity/host,
required scopes and plan permission, with validity beyond a 30-second grant;
credentials expire at 2026-10-11T19:32:08.763Z (2:32 p.m. Central).
See `ticket21-renewed-credential-preflight.json`. This timestamp is an observation,
not permission to renew or retry during inference. Approval must be used before
both plan and credential expiry, with time for qualification and the full grant.
The original completed-message discrepancy remains unresolved; strict completion
consistency and disabled production delivery remain enforced.

## Approved renewed run narrows completed-message discrepancy

Run `237f6664-3fc6-4152-aac0-dba167f1f4d2` executed once after owner approval,
with unknown usage and no retries, refresh or paid fallback. It refused after one
provider attempt. Safe diagnostics show 34-character deltas and text-done both
match, followed by successful completion with zero message items/text parts.
Usage may have been consumed; live integration remains unverified. The offline
observed-shape command reproduces that refusal. A proposed strict linked-event
repair and remaining uncertainties are recorded in
`debug/completed-message-repair-plan.md`; no production acceptance change was made.
The expired prior run's receipt was archived as `ticket21-expired-diagnostic-refusal.json`.

## Owner-selected linked-event repair implemented

The owner chose strict linked-event validation. Public qualification canary
regression first failed (hostGateway not-run instead of passed), then passed
with the repair. A single assistant message must be established by valid linked
item/part events; deltas, text-done, content-done and item-done must agree exactly
with the fixed result. Successful completion must refer to the created response;
any terminal message echo must also match. Missing, duplicate, wrong-link,
conflicting, tool, incomplete and post-completion mutations refuse. Reasoning
metadata is discarded. Named protocol states make transition guards explicit.
The canonical VM response now includes content_part.done.

Offline command `node .scratch/aios-v1-implementation/debug/completed-message-loop.mjs linked-sparse`
passes with the recorded 14-event/six-delta shape and synthetic fully linked
finalization payloads. This is a structural reconstruction, not original bytes:
the live receipt did not retain final item/part content, so the repair still
requires separate actual qualification. The matching full-envelope control passes.

All 123 tests and formatting passed; the final state-name cleanup passed build
and all nine public admission tests. Standards review: zero hard violations and
zero unresolved judgments. Spec review: zero corrective findings. Fresh native
synthetic qualification passed against the final gateway source and v3 policy.
Prepared plan `55f1cce4-6ea9-484d-8433-51e5cf6ed98f` is UNAPPROVED for live
inference. No additional provider attempt, refresh or fallback occurred after
the consumed approved run. Credentials were last observed to expire at 2:32 p.m.
Central today; a future grant must fit their remaining validity and plan expiry.
Positive acceptance stays open and production delivery remains disabled.

## Successful exact approved actual-Codex gateway run

Approved run `55f1cce4-6ea9-484d-8433-51e5cf6ed98f` completed the fixed actual
Codex turn through the host-only subscription gateway. Its approval was consumed;
no retry, refresh or paid fallback occurred. Receipt verifies subscriptionInference
passed, gateway revocation, actual process credential isolation, endpoint policy,
five delivery capability checks and zero remaining worker/relay processes.
Current gateway and worker hashes match the exact approved plan. Production
remains disabled and the consumed run grants no future inference authority.
See `ticket21-gateway-inference-observation.json`; the prior failed stream receipt
is retained as `ticket21-sparse-completion-refusal.json`.

This positively qualifies the exact macOS mediation fixture. Parallel Spec review
identifies a remaining requirement: publish the positive capability decision
through public qualification/status, bound to trusted evidence and exact
source/runtime/account configuration. Scratch receipts must not be trusted as
candidate-importable authority. Distinguish mechanism qualification from current
run authorization, invalidate drift, and preserve production readiness false.
The current public report still describes synthetic scope and qualified=false.
Ticket 21 stays ready-for-agent with this integration requirement open; ticket
22's authentication dependency remains blocked until the public decision exists.
Windows, generalized prompts, usage monitoring/re-dispatch and production network
policy remain separate work. Standards review has no new code findings. No source
changed after the already reviewed/tested 98ae5c2 repair.
