# Ticket 24: Windows controls and qualification continuation

Review base: signed commit `d52513a7aca681c4f0041f36fc44ad81784979fa`.

## Scope and safety gates

The public `qualify-windows-controls` command exercises signing/agent and
publication-helper exclusion using disposable positive-control fixtures,
root/non-root denial, effective mounts, competing repository ownership,
revoked native fencing, actual controller termination and exact-session
reconciliation. Each result binds the current controls/native source, observed
host/policy, stopped session and independent zero-process censuses.

The pinned Codex probe reads saved history, records original PID/start identities,
crashes only Codex inside its dedicated probe worker, verifies those identities
have disappeared and restarts app-server. It resumes the exact saved thread and
checks retained history without another turn or inference request. This is a
crash/resume test. General production stopping behavior is unchanged.

Public report aggregation requires every required control to have matching
measured evidence. An explicit failed probe cannot be replaced by supplemental
success. Controlled results cannot qualify a Windows host. Historical usage
authorization records freshness at dispatch; future requests still require fresh
account/window/run authorization, ownership and fencing.

Production execution, arbitrary feature work, signed publication, owner approval,
merge and the full parent pilot remain separate gates. The synthetic site task
uses the fixed admitted fixture and isolated script/HTTP validation.

## Retained refusals

The initial in-process resume and EOF/TERM restart attempts did not establish
repeatable native qualification. Their fixed failure classifications were
`codex-explicit-resume` and `codex-resume-exit`. Workers were stopped through the
existing cleanup path. The approved execution preflights for
`5a85df0a-bc83-4cd2-9cf5-fe854e357bc3` and
`1766fed9-545d-4d59-91cd-f0e88514d508` refused before credential access,
OpenAI requests or approval consumption. Their original plans are retained as
`ticket24-windows-resume-preflight-refused-plan.json` and
`ticket24-windows-resume-v5-preflight-refused-plan.json`. Neither approval can
authorize changed bindings.

The final dedicated crash/resume probe passed with fresh v6 external pins and
prepared run `60ef9ace-44af-4b9b-a0f0-3b3fdeb86161` without accessing credentials.

## Standards

Independent Standards review found no blocking findings. Runtime and native
versions, pins, evidence modes, stopped sessions and censuses are checked before
acceptance. Old Codex process identities are journaled before termination;
bounded independent disappearance checks precede restart. Historical usage
evidence does not grant redispatch. Failure classifications emit fixed enums.

## Spec

Independent Spec review found no corrective findings in this continuation.
Explicit saved-thread resume adds no inference request. Generated signing and
publication fixtures establish their stated exclusion boundaries; fixed model,
dependency and site traffic do not establish arbitrary application or pilot
delivery. EOF/TERM refusals remain prior failed attempts. Full qualification
requires fresh source-bound live capability and remaining final observations.

Standards: 0 unresolved findings. Spec: 0 corrective findings; native completion
and downstream qualification remain distinct.

## Final lease and authentication checks

The v8 native preparation passed actual saved-thread crash/resume and all relay
capability denials. Gateway construction now follows mandatory isolation, so its
original 30-second single-request lease covers inference rather than preparation.
The synthetic capability relays have a bounded 60-second lifetime under the
unchanged 55-second host watchdog; the separate expiry-denial probe remains 1.5
seconds. Independent Standards and Spec reviews cleared this change and its
public-driver regression test.

All six v8 supplemental controls passed with zero remaining processes. The
approved v8 run `e1860e24-8f3d-474a-ab94-31e742a8ee31` then refused at account
validation because the protected access token had expired. Approval was consumed,
provider attempts were zero, and no retry, token refresh or paid fallback occurred.
Its plan and receipt are retained in the `v8-expired-auth` artifacts. A separately
owner-authorized browser sign-in completed using CurrentUser DPAPI; replacement
inference still requires its own fresh exact approval.

## Validation

The final v8 source passed `npm test`: 172 total, 171 passed, one macOS-only ACL
skip, no failures. Typechecking, source/test formatting and `git diff --check`
passed. The public-driver gateway-factory regression first failed against the old
implementation, then passed after moving lease construction behind isolation.

Independent final Standards review found no blocking violations or baseline
smells requiring changes. Independent final Spec review found no corrective
source blockers. Both require the final public acceptance/report to pass before
claiming ticket completion.

Approved replacement run `bb18f46b-1b99-473b-ae3e-3565a9f66d18` passed actual
inference with saved-thread crash/resume, zero additional inference requests,
gateway revocation and zero remaining worker/relay processes. The first public
capability requalification refused `codex-relay-revocation` before endorsement;
the credential-free refusal is preserved. Fresh requalification subsequently
passed and the protected current-source capability record was endorsed, retaining
an exclusive private backup of its predecessor. This historical record authorizes
no future inference.

## Completed native acceptance

The fixed public HTML task passed authentication, synthetic task and isolated
validation. Native synthetic online run `6381d171-77b4-4697-ae5f-82c9789f1c3f`
passed model/dependency access, bypass denial and revoked zero-process shutdown.
Its fresh dispatch-time unknown-usage allowance was bound to account, window and
run. The harness first establishes positive account qualification before granting
usage after the final preflight; independent Standards review cleared that sequence.

The final public report passes all nine live checks. Its report-only recovery fix
recognizes historical uncertainty only when a later verified stopped event covers
the fence and every current/archived session is stopped. Regression tests first
failed, then passed; independent Standards and Spec reviews cleared the fix.
No native/controller binding changed, so no additional inference was required.
See `ticket24-windows-complete-qualification.json`.

Credential-free transient `codex-relay-revocation` and `codex-resume-kill` refusals
remain recorded, as does the pre-dispatch usage-scope refusal. They stopped the
acceptance sequence; no gate was weakened. Production is disabled. These fixed
worker-boundary observations do not complete parent 04 or general delivery/pilot,
signed publication, owner review or merge.

Final post-recovery-fix validation: full suite 172 total, 171 passed, one
macOS-only ACL skip, zero failures. Typechecking, formatting and diff whitespace
checks passed. Both review axes have zero unresolved corrective findings.
