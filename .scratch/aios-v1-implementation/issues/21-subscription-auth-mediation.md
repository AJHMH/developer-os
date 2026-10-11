# 21: Qualify model-only subscription authentication mediation

**What to build:** Deliver a capability decision through qualification/status: a supported mediation mechanism must separate subscription inference from reusable owner credentials, host MCP/discovery and publication authority. Test credential-free protocol/capability canaries before any authorized live inference. Unsupported or unverifiable mediation reports an actionable blocker; do not copy owner authentication files, buy credits or substitute paid API access. A negative finding completes the investigation but leaves the production gate blocked and requires an owner tradeoff decision; it does not satisfy this ticket's positive qualification criteria.

**Blocked by:** 18.

**Status:** ready-for-agent

## Parent and governing contract

Supports open parent ticket [04](04-isolated-worker-gate.md), governed by the [canonical specification](../../aios-feature-delivery/spec.md) and owner-approved runtime/scope revision. Use the approved public-controller command/observation testing seam. Readiness describes specified work, not production qualification. No implicit weaker-runtime fallback or paid inference is authorized.

## Acceptance criteria

- [x] A supported mechanism demonstrates model-only subscription mediation without reusable owner credentials, host MCP/discovery or publication authority entering the worker.
- [x] Credential-free protocol/capability canaries precede any authorized live inference; owner authentication files, credit purchases and paid API substitutions are forbidden.
- [x] Unsupported/unverifiable mediation returns an actionable blocker and owner tradeoff; a negative investigation does not satisfy positive qualification or unblock ticket 22.

- [ ] The public qualification/status capability decision reflects trusted positive evidence, bound to exact source/runtime/account configuration and run, while granting no further inference authority.

The checked criteria above are demonstrated for the pinned macOS AppleHV/Codex fixed-request fixture. They do not establish Windows or general feature delivery qualification. The public-interface requirement remains open; ticket 21 is not complete.

## 10 October capability progress

The credential-free, digest-pinned official Codex 0.161.0 app-server initialization/account-read and host-loopback synthetic relay canaries passed through controller qualification; persisted status still reports qualified:false. The relay tests fixed Responses-only routing, stripped owner headers, and denied unrelated endpoints and capabilities. No real subscription credentials or inference were used. [Observation](../ticket21-protocol-observation.json).

Owner-approved preparation created only stable Developer OS registration metadata in separate external host storage. At that preparation milestone the browser authorization broker, ID-token verification and encrypted host credential store were unimplemented; the macOS progress below supersedes their implementation status. VM credential isolation, independently enforced model-only endpoint access and completed subscription inference remain unimplemented/unqualified. The preparation command cannot authorize delivery. Ticket 21 stays open and 22 remains blocked. See [separate setup plan](../chatgpt-setup.md).


## macOS broker implementation (10 October)

Separate `authorize-auth` setup now binds fresh PKCE/state/nonce to a loopback
callback, exchanges only the issued dynamic client ID, verifies RS256 ID tokens
against fixed OpenAI JWKS and checks issuer/audience/expiry/nonce. Returning
sign-in requires the selected verified identity; denial, invalid callbacks,
forged signatures and missing plan permission fail safely. macOS credentials are
intended for host-only Keychain storage with no token in process arguments,
browser hints, candidate files or command output.

Controlled tests cover the authorization broker and setup refusal. Native
Keychain persistence passed with a disposable 64 KiB synthetic payload. Owner
browser consent and verified authorization succeeded after correcting the
string-only audience check to accept the issued client as a singleton array.
Validated credentials are stored only in macOS Keychain; plan permission is
present, and delivery remains disabled. See the non-secret
[storage observation](../ticket21-keychain-observation.json). VM
relay/credential isolation, revocation and subscription inference remain
**not-run**. This is implementation progress, not
positive qualification; all acceptance boxes and ticket 22 remain blocked. See
[separate setup](../chatgpt-setup.md) for the concrete operator command.

## 11 October revocation and VM fixture qualification

Controller qualification/status now records version-bound host-loopback relay
revocation: an accepted in-flight upstream request is cancelled, its response
is suppressed, and the revoked capability cannot forward another request.
Fresh canary instances use fresh grants. These are synthetic credentials only.

The independently pinned macOS AppleHV VM passed host/guest synthetic credential
file denial with positive controls before and after, a scrubbed environment,
no worker mounts or network, and verified process shutdown. The reported
credential isolation scope is **synthetic-restricted-alpine**. A fixed prompt
and result also passed bounded stdin transfer through disposable restricted VM
workers. [Native evidence](../ticket21-vm-credential-isolation.json).

A [one-shot inference harness](../ticket21-inference-test.mjs) and
[prepared plan](../ticket21-inference-plan.json) are ready for separate owner
approval. Preparation uses no account tokens or inference. Execute requires
approval of that exact run and unknown usage; credentials stay on the host,
one fixed Responses request has a 30-second deadline/64 KiB response bound,
and no retries, refresh or paid fallback are permitted. A successful completed
response must return the exact fixture result through the isolated worker.

This fixture does not qualify the actual Codex worker, its endpoint policy or
its delivery-scoped capability. No live inference has run; all acceptance
boxes remain open and ticket 22 stays blocked. Production gates remain false.

## 11 October approved inference result

The owner approved run `2c477e41-7dc6-47a9-9e0f-fa6429d5a362`, including unknown remaining subscription usage. It completed exactly one fixed subscription Responses request, without retries, returned `AIOS model-only inference complete` through the restricted Alpine fixture, and revoked its relay grant. The external one-shot marker prevents replay. See [non-secret result](../ticket21-inference-observation.json). This supersedes the earlier “no live inference” milestone.

Actual Linux ARM64 Codex qualification is now being tested with the integrity-pinned official 0.161.0 binary and synthetic capability only. No additional inference is authorized by the consumed fixture approval. All positive qualification acceptance boxes remain open; ticket 22 and production dispatch stay blocked.

## Actual Codex credential-free VM observation

The official npm Linux ARM64 Codex 0.161.0 executable, SHA-256 `0129f94f4f1197bd75f6c4265889061f386ed302bbc50c6e57e3e0660dfb28a7`, now passes initialization and `account/read` with no account and no OpenAI auth requirement inside the restricted share-free VM. The observer audits actual Codex cgroup processes: UID 65534 in the rootless user namespace, no capabilities, seccomp, no-new-privileges, and an exact environment containing only base variables, an empty disposable Codex home and a synthetic capability. Synthetic credential paths remain inaccessible; all observed processes stop. [Observation](../ticket21-codex-worker-observation.json).

Initial failures remained blocked. Codex requires its empty home to exist before startup. Reading mapped process UIDs/environment requires the management rootless user namespace; the worker gained no privilege. Bounded protocol parsing drains both streams without exposing their contents.

This is actual Codex protocol and synthetic credential-exclusion evidence, not a Codex inference integration. A trusted delivery-scoped relay must still demonstrate independently enforced endpoints and capabilities for actual worker requests. That is the next implementation step; the consumed Alpine inference approval cannot authorize another run.

## Codex relay endpoint and delivery-capability qualification (11 October)

The credential-free actual Codex turn now completes through a synthetic Responses relay whose HTTP handler runs in trusted rootless VM management, outside the worker PID and mount namespaces. It joins only that worker's isolated network namespace. Qualification/status records `endpointEnforcement:passed`, `deliveryCapabilities:passed`, `endpointScope:synthetic-codex-relay`, and the exact delivery ID. [Native observation](../ticket21-codex-endpoint-observation.json); [public acceptance check](../ticket21-endpoint-acceptance.mjs).

The allowed route is only `POST /v1/responses`. Checks require the selected model, streaming, no response storage, the expected user marker, the delivery header and its fresh capability. Methods, unrelated/query routes, upgrades, malformed input, incorrect/peer capabilities and mismatched delivery IDs are refused. The fixture admits ordinary Codex context and function declarations alongside the required prompt; it does **not** prove an exclusive production input/tool schema. It has no upstream connection or owner token.

Separate worker network namespaces deny cross-delivery endpoint access. Independent peer positive controls distinguish revocation and expiry from an unavailable service or spent quota. The revoked primary and expired control both retain unused quota; the peer's exhausted request budget also refuses replay. Real-time expiry stops its service. Worker and management relay processes all stop before the independent binding is checked again. Peer worker cleanup is journaled; relay control-pipe closure and deadline terminate the service.

This supersedes the earlier pending synthetic Codex endpoint/capability milestone. It performs no subscription request and consumes no new inference approval. The remaining work is a host-only subscription gateway joined to this boundary, with an explicit admitted input/tool policy, owner-grant binding, in-flight revocation and usage approval. Overall `qualified:false` and production readiness remain false. Positive ticket acceptance boxes remain open and ticket 22 remains blocked.

## Host-only subscription gateway integration (11 October)

Actual restricted Codex now completes its turn through the VM management relay,
bounded private management frames and a host-only subscription gateway. Native
qualification/status reports `hostGateway:passed`, `gatewayIntegration:passed`
and `gatewayScope:synthetic-host-subscription`. The final source passed with
`pins-ticket21-gateway-v2.json`. [Observation](../ticket21-gateway-observation.json).

The host independently binds one disposable capability to the delivery, selected
account identity, authorization registration, fixed request and 30-second grant.
It reserves one request before reading credentials; changed identity, expired
credentials and missing plan scopes cannot dispatch. Codex developer context,
additional tool declarations and earlier user context are explicitly discarded.
Only the final fixed prompt is canonicalized upstream; no worker headers, URLs,
tools or context are forwarded. Provider metadata is also discarded: a verified
completed exact result becomes a minimal Responses stream for Codex. Cancellation
races provider completion and suppresses in-flight results. The only real provider
adapter uses the fixed subscription Responses origin without redirects, retries,
refresh or paid fallback. No reusable credential or account callback is serialized
to the VM. Worker/management shutdown and fresh binding checks still pass.

The qualification used a synthetic account with the broker's actual `urn:uuid:`
host-identity format and synthetic provider; it spent no subscription usage. A
[prepared actual-Codex inference plan](../ticket21-gateway-inference-plan.json)
and [harness](../ticket21-gateway-inference.mjs) are ready. Execute requires fresh
approval of the exact run and unknown remaining usage; it consumes an external
one-shot marker before Keychain access. Preparation never opens Keychain. The
previous Alpine approval is consumed and cannot authorize this run. Expired
credentials refuse without automatic renewal. All acceptance boxes remain open,
`qualified:false` and production readiness remain false; ticket 22 stays blocked
until separately approved real integration succeeds. [Review](../ticket21-gateway-review.md).

The owner-approved actual-Codex run `2b8ba949-c1a5-49e3-81bc-dd96106e1d6d`
refused before provider dispatch because the host credential had expired before
plan preparation. Its external one-shot marker is consumed; request count was
zero and no retry/automatic refresh occurred. Returning browser authorization
renewed the same account/registration/scopes into Keychain using existing consent.
[Refusal and renewal receipt](../ticket21-gateway-inference-observation.json).
A fresh plan `05cac8f2-d0f7-4b2a-87af-ef8a5e84720d` is prepared after another
successful synthetic native qualification. It requires a new exact-run approval;
no real actual-Codex subscription inference has succeeded yet.

Renewed approved run `05cac8f2-d0f7-4b2a-87af-ef8a5e84720d` also refused.
Its account binding, scopes and credential validity through the grant were safely
confirmed; the old harness did not retain a provider-stage receipt. It may have
used subscription allowance (at most one provider request); exact dispatch and
refusal stage are unverified. No retry was sent. The expired first run's receipt
is retained separately in [expired observation](../ticket21-gateway-expired-observation.json).

Controlled public-status testing reproduced a documented provider shape gap:
completed Responses can contain a reasoning item alongside the assistant message.
The corrected gateway discards reasoning metadata, verifies both streamed and
completed exact text, and returns only the minimal stream. This is a demonstrated
compatibility correction, not proof of the refused live run's cause. Future
refusal receipts retain only a fixed stage, attempt count and HTTP status; an
attempted but refused inference is labeled unverified rather than not-run.
Final corrected synthetic native qualification and all 123 tests pass. Fresh
plan `971f4e43-fa29-466d-9045-e9bfd2b92fd0` awaits separate owner approval.

Corrected approved run `971f4e43-fa29-466d-9045-e9bfd2b92fd0` refused at the
provider transport stage with one attempt and HTTP 200; completed inference and
usage remain unverified. [Retained provider refusal](../ticket21-gateway-provider-refusal.json).
The provider wrapper required SSE MIME metadata before reading the body. Controlled
HTTP-adapter red/green testing reproduced rejection of a valid bounded SSE body
labeled application/json. Acceptance now relies on the actual bounded body and
strict completion/exact-text checks, not MIME labels. HTTP 200 with malformed
content still refuses. The actual refused response body was not retained, so its
format/cause remains unverified. Fixed origin, redirect denial, no tools/context,
size/deadline, one-shot use and canonical VM output remain enforced. Fresh final
synthetic/native qualification passed. Plan `717a2831-d4f6-445f-9368-2e719cacf753`
requires its own owner approval; no automatic retry was performed.

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

## Diagnosis loop and authorized evidence preparation

The diagnosis established that three different synthetic discrepancies generate
the same retained completed-text failure flags. It has not reproduced the actual
live discrepancy. See [diagnosis and offline command](../debug/completed-message-diagnosis.md).
The owner authorized preparing bounded event-structure, length and comparison
diagnostics only, with no live inference. Exact completion consistency remains
unchanged. All 123 existing tests and formatting pass. Fresh native proof and an
exact separately approved plan remain necessary before another live request.

## Authorized v3 adoption and preparation

The owner authorized the exact candidate SHA above. It was written exclusively
with mode 0600 to the external `pins-ticket21-gateway-v3.json`; v2 was retained.
Fresh native synthetic qualification passed against the current identity and
diagnostics. Prepared run `208706f5-a6bd-49e1-9c33-5b6aa813d112` is unapproved
for live inference. See `ticket21-gateway-inference-plan.json` and
`ticket21-gateway-observation.json`. No Keychain reads or subscription requests
were performed during preparation. Production delivery remains disabled.

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
