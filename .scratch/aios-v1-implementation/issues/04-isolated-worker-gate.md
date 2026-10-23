# 04: Launch an isolated worker with a fail-closed qualification gate

**Status:** ready-for-agent — implementation partial; resumed by owner; production qualification pending

**What to build:** Run a pinned dedicated Podman worker for admitted feature work
only after fresh, version-bound host, workspace, model-only authentication,
network and lifecycle qualification. Unsafe or unverifiable configurations refuse
launch; there is no host/shared-runtime fallback.

**Active dependency blockers:** None. [02: onboarding readiness](02-onboarding-readiness.md)
and [03: ownership and recovery](03-ownership-pause-recovery.md) are completed
prerequisites, not current blockers.

**Current baseline and historical failures:** Before this continuation, local and
GitHub main were synchronized at `7aba7fb64101a9461363fbaa66729158fde161af`.
All 25 main check results completed successfully or were explicitly non-applicable;
the Developer OS CI, Factory validation and CodeQL workflows passed. The owner
then explicitly requested resuming Issue 04. Earlier Windows storage and Linux
contract timeouts remain unexplained; this passing observation neither fixes
nor waives those historical failures. A new baseline failure stops further
implementation and requires separate authorization before unrelated repair.
02/03 remain completed. See the
[Windows phase diagnosis](../../windows-ci-storage-startup/phase-profile-20261016.md).

**Information needed from the owner:** No unanswered requirement blocks the next
implementation slice. Later live enrollment/inference still requires the relevant
external configuration and fresh explicit authorization; historical approvals do
not authorize a new run.

## Current continuation

PR #70 merged as `003c89730a360082fd22a41815c941a4e7cb0aea` with all applicable
checks and current-head human approval passing. Its tree exactly matches validated
head `1e6a765`; those results were reused. Local main was fast-forwarded and the
merged task branch retired, without a suite rerun merely for the merge.

The next native launch-admission slice binds the caller-declared source revision,
branch and admitted plain-file manifest digest at both host and guest boundaries.
The host refuses a digest mismatch before observations; the guest independently
rehashes transferred bytes before materialization. The guest persists provenance
and compares it with the guarded launch request before starting the container.
This is prerequisite groundwork for explicit-session resume, which remains
unqualified and refused. It does not establish a Git revision's relationship to
file contents; that admission remains the controller's responsibility. Native
Windows/macOS qualification for the changed runtime is not-run. Historical
version-bound macOS timer evidence remains retained, without qualifying these
new policy bytes. See [launch provenance](../ticket04-native-launch-provenance-receipt.md).

PR #69 merged as `a132a7456ed53709317cf11ee43dd79d20d7c5de` with all applicable
head checks passing. Its source tree equals validated head `6b8adff`; those
results were reused, local main was fast-forwarded and the merged task branch
was retired. The original dirty checkout remains untouched. A post-merge
approval refresh refused because the PR was closed; no approval was granted,
and that workflow result is retained separately from source validation.

The first fresh macOS controller-loss observation refused the timer-execution
property before intentional controller loss. Exact-session recovery passed; no
expiry proof was obtained. A bounded disposable native manager probe exposed a
property wire-shape mismatch, reproduced through the public transport test seam.
The reviewed repair corrects direct property decoding without changing timer
limits, command/session validation or production enablement. Fresh committed-source
macOS lease and fixed-deadline observations now pass, with positive post-controller-
loss controls, successful exact-session timer kill records, independent process
disappearance, explicit recovery and unchanged canary collection. The first failed
attempt remains retained; Windows and broader production qualification stay open. See [native timer evidence](../ticket04-native-timer-property-receipt.md).

Continued after PR #68 merged as `a44e5bfbd95e1f7afb1e82224e6012f6b7c42d1f`.
Its tree exactly matches approved, validated head `911ae1c`; those passing results
were reused without a post-merge suite rerun. Local main was fast-forwarded while
unrelated dirty work was preserved in its original checkout. The PR #68 branch
is retained because another worktree still uses it.

The next slice supplies an explicit offline controller-loss acceptance procedure
for the lease and fixed deadline. It requires positive running controls, confirmed
controller loss without cleanup, independent disappearance, and a successful
manager execution record for the exact session's kill command before recovery.
Natural exit, prior controller cleanup, unknown/failed/ambiguous timer execution,
pin drift and uncertain recovery cannot pass. Real host runs remain **not-run**;
production execution and native qualification remain disabled. See the
[controller-loss procedure receipt](../ticket04-controller-loss-procedure-receipt.md).

Resumed after architecture PRs #66 and #67 merged. The synchronized baseline is
`f42a132fc0206f6c583100b9d218c6d9af2599a1`; its passing results were reused
without a post-merge validation rerun. New Issue 04 source changes receive fresh
validation.

Independent exact-session process and timer observation is implemented as the
next prerequisite for native expiry/controller-loss qualification. Observation
never renews the lease, stops the worker, consumes logs or reconciles lifecycle
phase. Observed process disappearance alone cannot authorize collection; explicit
verified stop remains required. See the
[observation receipt](../ticket04-native-session-observation-receipt.md).
Native expiry/controller-loss qualification, general integration and explicit
resume remain open; production execution remains disabled.

## Completed work

Completed means the recorded fixed-worker scope, not arbitrary production feature
work or automatic qualification of later source/runtime versions.

- [x] Dedicated, pinned Podman VM admission and ordinary-file offline transfer
  through the public controller (18–19).
- [x] Positive-control synthetic access-denial and escape probes, independent
  descendant stopping, stale-sender fencing and interrupted-controller recovery
  (20 and 23).
- [x] Protected host authentication, model-only mediation, restricted online
  access and usage approval demonstrated for fixed requests/tasks (fixed scope of
  21–22; the broader usage-monitoring criterion in 22 remains open).
- [x] Independent fixed-worker qualification on Windows Hyper-V and macOS
  AppleHV, including fixed inference and isolated task validation (24–25).
- [x] Version-bound macOS offline general-transport lease and fixed-deadline
  controller-loss observations, with independently observed disappearance,
  exact timer execution, explicit recovery and unchanged canary collection
  (runtime commit `c27ff3f`; no Windows or production qualification inferred).
- [x] Controlled general feature lifecycle contracts and tests exist. Their native
  coding/validation integrations are not installed or qualified.

Evidence: [implementation status](../../../docs/implementation-status.md),
[Windows worker runbook](../../../docs/windows-worker-qualification.md),
[macOS worker runbook](../../../docs/macos-worker-qualification.md), and the
version-bound receipts linked from issues 18–25. Existing public reports explicitly
say `scope: fixed-worker` and retain `productionEnabled: false`.

## Remaining implementation

- [ ] Integrate the general coding transport with the pinned dedicated VM. The
  `NativePodmanCodingTransport` now supplies an offline first-launch transport.
  `PinnedCodingRuntime` and controller admission remain controlled-only;
  `PodmanHostAdapter.start()` still refuses production execution. Native
  production integration and resume qualification remain unfinished. The offline
  transport now supports an explicitly named stopped predecessor and thread;
  base refresh and production resume are still refused. A generic request must
  not broaden fixed-task credentials, mounts, endpoints or management authority.
- [ ] Bind each launch and explicit-session resume to admitted plain-file input,
  exact executable/runtime/policy pins, current delivery ownership and fresh
  model-only access authority. Recheck after asynchronous observations before
  dispatch; reject drift or unsupported configuration.
- [ ] Supply general-worker isolated execution, controlled dependency phases and
  stopped-worker collection primitives. Later tickets 05–06 consume these worker
  capabilities; their complete feature/validation workflow is not an additional
  issue 04 acceptance gate. Candidate scripts never run on the credential-bearing
  host.
- [ ] Complete native general-session usage monitoring, exhaustion with work
  preservation, and fresh restart/re-dispatch authorization (remaining 22 scope).
- [ ] Connect general-worker pause/cancel/restart to independently observed
  descendant/orphan shutdown and exact-session recovery. Uncertain effects block
  collection, release and redispatch.

These items concern the worker/qualification boundary. Signed publication, PR
review, conditional merge, main synchronization and branch cleanup have their own
later tickets; completing all of them is not an extra acceptance condition here.

## Remaining qualification and completion rule

Each criterion below needs a real native observation for the general integrated
worker, with fresh source, host/provider, engine/image/template, Codex and effective
policy bindings. Controlled tests and old fixed-worker reports cannot check it off.

- [ ] Changed/missing pins refuse launch on Windows and independently on macOS,
  with no weaker fallback.
- [ ] Only newly materialized ordinary admitted files enter; Git metadata, owner
  environment/home/keystore, ledger and signing/SSH/engine sockets are excluded.
- [ ] Effective mounts and configuration exclude host shares, skills/MCP, SSH
  forwarding, untrusted host hooks, GitHub binding and guest management authority.
- [ ] Positive-control canaries prove external endpoint/dependency restrictions,
  model-only credential mediation and usage/restart controls for general sessions.
- [ ] Public lifecycle controls demonstrate safe import, descendant/orphan
  stopping, fencing and recovery for general coding and validation.
- [ ] Both hosts retain independent adversarial results, effective configuration,
  exact version bindings, failed attempts and actionable blocked/not-run outcomes.

Issue 04 closes only when the remaining worker implementation and those native
criteria are satisfied. Production dispatch remains disabled until then. Complete
platform delivery qualification (15–16) and the observed pilot (17) remain separate.

## Current implementation work

The resumed slice continuously verifies both independent native timers while a
worker is running, including before renewing its lease. Loss of the fixed deadline
or a missing/inactive/failed lease stops the run before accepting output; renewal
cannot revive a lease that was already observed inactive. Existing durations,
renewal cadence and shutdown/collection requirements remain unchanged. Simulator
evidence is implementation validation only; independent native timer expiry and
controller-loss qualification remain open. See the
[timer continuity receipt](../ticket04-native-timer-continuity-receipt.md).

The first remaining slice implements general coding launch-data binding at the
existing public controller/observation seam. It refuses changes to arguments,
admitted file bytes/digest, and baseline-refresh payloads across asynchronous pin
inspection before any worker dispatch. This is controlled integration groundwork,
not an installed native coding transport or completed production admission.

The merged second slice preserves controller callback authority across inspection and gives
transport preparation its own admitted argument/file/pin snapshot. Guarded
dispatch/checkpoint callbacks check that snapshot around fresh authorization;
stream and result acceptance also reject drift. A retained inspection reference
cannot rewrite prepared bytes. The native transport still must call the guard and
independently remeasure pins at its actual effects. See the
[dispatch-authority receipt](../ticket04-dispatch-authority-receipt.md).

The third slice refreshes independently measured executable/policy/host pins after
exact-session shutdown and before/after stopped-worker collection. Shutdown is
attempted even with changed pins; an unverified observation leaves the session
uncertain, blocking import, release and redispatch until exact-session recovery.
Collection drift prevents candidate admission. This is controlled lifecycle
integration, not native process-census qualification. See the
[lifecycle-binding receipt](../ticket04-lifecycle-binding-receipt.md).

A naming-only [Windows shard follow-up](../ticket04-windows-shard-balance-receipt.md)
retains all test contents while addressing the discovery-order scheduling change
and tight shard headroom observed after that slice merged.

The fourth slice adds a native, explicitly offline first-launch transport behind
`IsolatedCodingTransport`. It measures the supported host and dedicated VM, stages
ordinary files into a fresh guest-private workspace, launches the pinned Codex
artifact under deny-all networking, and polls bounded output. Durable revocation,
independent process census, bounded management timers and stable stopped-file
collection preserve fail-closed behavior. Its `live` identity cannot be relabeled
as controlled; the controller does not install it or enable production.

This is implementation evidence from external OS/process fixtures, including
execution of the transported Linux management program. It is **not** native
Windows/macOS qualification. Fresh model-only authority, explicit resume,
controlled dependencies, usage/exhaustion integration, storage/resource controls
and adversarial qualification of the new mounts/timers remain open. Existing
fixed-worker receipts cannot qualify this transport. See the
[native transport receipt](../ticket04-native-transport-receipt.md).

The current offline native lifecycle slice repairs engine-observation limits,
lease renewal cadence and idempotent timer cleanup exposed by real macOS launch
attempts. It also separates checkpoint refusal from runtime-binding drift.
Failed attempts remain retained. The macOS offline checkpoint-stop, fresh-session
recovery and unchanged ordinary-file collection observation passed. All 617 local
tests passed or were explicitly skipped (615 passed, two platform skips). PR #49
passed all 26 active checks and merged as `d9a43e3`. Production remains disabled,
and no general native qualification criterion is checked off. See the
[offline lifecycle receipt](../ticket04-native-offline-lifecycle-receipt.md).

The owner-authorized unrelated relay baseline repair merged as verified bot
commit `f96b8f0` in [PR #41](https://github.com/AJHMH/developer-os/pull/41), after
all checks and current-head owner approval passed. Its six relay tests and full
555-test run passed, with unchanged coverage rules. The original baseline failure
is retained in its repair receipt; it does not reopen completed 02/03.

See the [launch-admission receipt](../ticket04-launch-admission-receipt.md) for
this implementation slice and the remaining native integration work.

## Source and governing contract

The [approved canonical specification](../../aios-feature-delivery/spec.md),
including its approved Podman runtime revision, governs user stories 12–15. No
OpenRouter account, paid fallback, historical Docker workaround, or new owner
credential is required merely to start implementation. Live provisioning and
inference authority remain separate owner actions.

## Comments

<details>
<summary>Historical investigation — superseded by the current sections above</summary>


Entries below retain what was known at their recorded dates. Old `needs-info`,
missing-Mac, missing-authentication and Docker statements are historical, not
active blockers. The current runtime is dedicated Podman-backed VMs.

7 October follow-up: the owner supplied a live diagnostic with all 13 checks passing after reboot and Docker sign-in. The owner then selected a subscription-usage approval gate instead of immediately provisioning OpenRouter: at 20% remaining, or unknown usage, require approval; exhaustion must stop without credit purchases/API fallback. The controller gate and documented app-server usage reader are implemented. A live read using pinned official Codex 0.161.0 returned 4% weekly usage, matching the desktop. This does not finish the native worker driver, authentication isolation or adversarial sandbox qualification. Existing credits/automatic reload are separate billing controls and this gate is not an exact hard-dollar cap.

The owner confirmed no dedicated proxy is configured. OpenRouter is an integration candidate: its [Responses API](https://openrouter.ai/docs/api/api-reference/responses/create-responses) and [per-key credit limits](https://openrouter.ai/docs/api_reference/limits) are documented. This is not selection or qualification: streaming/tool compatibility, endpoint-scoped credential injection, exhausted-key rejection and concurrent/in-flight spend behavior must be tested. No account, key, credits or inference requests were provisioned. CodeRabbit reviewed this progress slice; its single minor finding requests Linux executable discovery, which is outside the approved Windows/macOS v1 scope and was not applied.


7 October native test: owner approved initializing the global deny-all policy. A mountless, skills-off shell sandbox successfully started, daemon inspection showed no runtime mounts, and a real external HTTPS canary was denied. However, daemon inspection also showed an automatically enabled MCP gateway and uploaded gateway secret. This fails the approved host-MCP isolation requirement. The sandbox was stopped and inspected as stopped; full descendant fencing is not yet proven. See [native qualification evidence](../native-qualification-2026-10-07.md). No inference or owner credential import occurred. Native launch remains blocked; the old daemon/authentication prerequisites are now resolved.

8 October UTC prototype result: passing `--static-mcp=` on a fresh mountless, skills-off, deny-all sandbox did not disable dynamic MCP. A proper initialize / initialized / tools-list sequence returned HTTP 200 and exposed code-mode, mcp-add, mcp-config-set, mcp-exec and mcp-find. Global/per-sandbox outbound deny-all does not isolate this internal gateway path. No tool was invoked, no server registered and no credential contents accessed. The sandbox was stopped and daemon inspection confirmed stopped. These are rejected workaround candidates, not evidence that every possible workaround is impossible. See [research](../mcp-gateway-research.md) and [throwaway live prototype](../mcp-boundary-prototype.mjs), preserved on `codex/prototype-ticket4-mcp`.

7 October Podman prototype: dedicated Hyper-V VM initialization returned success under task-local empty default volumes configuration. Effective mount inspection is blocked until Windows login permissions refresh after Podman added the account to Hyper-V Administrators. No VM start or guest workload was issued; no isolation proof yet. See [progress](../podman-prototype-progress.md). Prototype preserved on codex/prototype-ticket4-podman; runtime switch remains unapproved/unqualified.

7 October positive-control network test passed: a live synthetic guest HTTP endpoint responded to controls before and after offline worker denial. Evidence and scope limits recorded in podman-prototype-progress.md; reproducible podman-network-prototype.mjs retained on codex/prototype-ticket4-podman. No inference or owner credentials; ticket remains open.

7 October owner-approved wayfinder revision: [Reconsider the isolated worker runtime and qualification scope](../../aios-feature-delivery/issues/07-runtime-scope-revision.md) selects Podman-backed dedicated VMs as the candidate, retains this parent qualification gate open, separates demonstrated Windows offline feasibility from remaining blocking implementation, and proceeds Windows-first while retaining independently blocked macOS qualification. The canonical spec and blocking tickets must be revised through /to-spec and /to-tickets before the next implementation slice. This approval does not establish live readiness or waive any unproven control.

### 10 October current boundary

Tickets 20 and 23 now have reproducible synthetic native Windows acceptance: positive-control access denial, four bounded escape attempts, and eight-process shutdown with stale-sender/crash recovery. The observed namespace gap was fixed with a tighter seccomp policy; failed attempts remain retained. Ticket 21 has passed credential-free host protocol and loopback relay canaries, and separate non-secret registration preparation only. Its real authorization broker, VM mediation and subscription inference remain outstanding, as do online policy and production worker qualification (22/24). Parent 04 remains needs-info. The owner confirmed no Mac is available; macOS 14+ Apple-silicon qualification (25 and later 16) is explicitly blocked. No live readiness, production dispatch, paid API fallback or acceptance waiver follows from Windows synthetic evidence.

### 10 October independent macOS implementation

The owner supplied this Apple-silicon Mac and explicitly requested this parent
ticket's macOS path. The earlier absence-of-Mac statement is now historical.
Native AppleHV admission, fixed ARM64 byte transfer/result collection, synthetic
access-denial controls, eight-process descendant stop, pause/stale-sender fencing
and controller-crash/exact-session recovery have independent Mac evidence.
Credential-free digest-pinned Codex protocol/relay inspection also passed.
See [macOS qualification](../../../docs/macos-worker-qualification.md) and the
retained `ticket4-macos-*.json` reports.

Parent 04 remains **needs-info**. Tickets 21/22/24 still block actual
authentication, online access, inference and production worker validation;
ticket 25's full qualification and later ticket 16 remain incomplete. This
owner-authorized offline host work does not waive their dependency gates.
`ready`/`liveReady` remain false; production start still refuses.

</details>


## 17 October: explicit native session resume slice

Implemented offline transport resume through `NativeCodingRequest.resumeFrom`
(previous operation ID, fence and stopped state) plus the exact CLI thread ID.
The prior thread must have been observed in a complete pinned CLI stream event.
Guest management independently verifies the predecessor's durable identity,
stopped container/process census, inactive timers, matching runtime binding and
same source revision/branch before transferring its private session home.
It durably reserves the predecessor once, stages freshly admitted ordinary files
in a new workspace/container, and applies fresh dispatch gates, allowance,
independent timers and stopped collection. Global last-session selection is
refused. Conflicting or missing resumed thread output refuses and stops the worker.

This is implementation at the existing offline transport seam, not native
qualification or production installation. Changed-base resume remains refused;
controller predecessor plumbing, fresh model-only/usage authority and independent
Windows/macOS real CLI resume/isolation observations remain open. Production
remains disabled and the parent ticket stays partial. See the
[resume receipt](../ticket04-native-explicit-resume-receipt.md) for validation and
retained diagnostic limitations.

Continued 17 October after main `461b62e`: the candidate was rebased and reviewed
again. Resume now refuses a retained home containing Codex configuration
(`config.toml`, `hooks.json`, `AGENTS.md`, `AGENTS.override.md`, `skills/`,
`rules/`), so one turn cannot configure the next, and resumed turns pin
`sandbox_mode="workspace-write"` as first launch does. An offline,
credential-free native resume procedure is provided; its outcome is not-run.

## 18 October: native resume partial-transfer recovery slice

Added `NativePodmanCodingTransport.recoverInterruptedResume`. When a resume
moves the predecessor's private home and then stops before it attempts launch,
this call returns the home to the explicitly named predecessor and releases
only that successor's reservation. The successor is consumed for good. The
following cases refuse and leave the home where it is:
- launch was saved as attempted (`launchAttempted`), or the successor ran;
- the successor is not stopped;
- the predecessor named does not match the successor's admission;
- a foreign reservation, a moved home with no reservation, homes present in
  both sessions, or a lost home.

Home contents are not rechecked here; the next resume's retained-home check
does that.

This is implementation at the offline transport seam only. Controller
orchestration and native qualification of recovery remain open, and production
remains disabled. See the
[recovery receipt](../ticket04-native-resume-transfer-recovery-receipt.md) for
crash-point coverage, the mutation table and the guards that are redundant by
design.

## 18 October: controller explicit-session resume plumbing

The controller now passes explicit-session resume through to the transport.

- A resumed coding turn names its exact stopped predecessor as `resumeFrom`.
  The session persists it, and the pinned launch binding fences it.
- A resume that stops without observing its CLI thread may have moved the
  predecessor's retained home. Until the same trusted runtime verifies
  recovery, it blocks dispatch, phase resume and release as `UNCERTAIN_SESSION`.
  Recovery runs after the turn, or through `recover` after a pause or
  controller loss.
- A recovered resume names the original predecessor again.
- The guest now also recovers a resume that was refused before its
  preparation was recorded, which until now stayed blocked forever.

A resume that launched without an observed thread still needs owner
reconciliation, which doesn't exist yet. Production remains disabled, and
native qualification is not-run. See the
[controller resume receipt](../ticket04-controller-resume-plumbing-receipt.md).

## 18 October: reconciling a launched resume with no observed thread

This closes the last case left blocked by the controller resume slice. When
recovery is refused because the resume had launched, the controller now
reconciles it from the guest's own thread record:
- If the guest recorded the expected thread, the successor is adopted as the
  next predecessor.
- Otherwise coding stays blocked until the owning delivery explicitly calls
  `retireResume`. That decision is recorded. It quarantines the moved home,
  which is never reused, and coding restarts fresh.

Nothing is moved in either case. Production remains disabled, and native
qualification is not-run. See the
[reconciliation receipt](../ticket04-resume-reconciliation-receipt.md).

## 19 October: fresh model-only authority for coding turns

Every coding launch, resume and repair now needs fresh subscription usage
authority from `UsageApprovalGate`:
- It must come from a known model-only account, the same one the feature's
  first launch used.
- It is bound inside the prepare transaction to exactly that coding operation.
- It is rechecked at the runtime's dispatch callback after asynchronous pin
  inspection.

Exhaustion is never overridden, and each approval authorizes one operation.
Usage monitoring during a turn, and binding to the qualified mediation
account, remain open. Production remains disabled. See the
[authority receipt](../ticket04-coding-model-authority-receipt.md).

## 19 October: usage monitoring during coding turns

A running coding turn now re-observes usage every `codingUsagePollMs`.
Exhaustion, an account change or a lost observation interrupts it through the
exact-session stop and records the lapse. A started thread stays resumable,
and continuing needs fresh, newly bound authority. A final usage check before
collection means a turn that completed after its authority lapsed is never
admitted. Binding to the mediation account and production restart
authorization remain open. Production remains disabled. See the
[monitoring receipt](../ticket04-coding-usage-monitoring-receipt.md).

## 19 October: linking coding usage to the qualified mediation account

The owner chose "match when qualified". When a delivery has a qualified
model-only mediation decision, coding re-qualifies first, and its usage must
come from exactly that decision's account. The first such launch links the
feature. A linked feature refuses coding if the decision is withdrawn or its
evidence regresses. A delivery without a decision keeps the current controlled
behavior, and a strict requirement is deferred to production integration.
Usage and decision account IDs are derived differently, which can make
mediated launches fail closed; reconciling them belongs to production
integration. See the
[mediation account receipt](../ticket04-coding-mediation-account-receipt.md).

## 19 October: reconciling usage and mediation account IDs

Usage observations hash the Codex login email, while mediation decisions hash
the vault credential's OAuth identity, so they never matched. The owner chose
an endorsed binding: the decision record now carries `usageAccountId`, the
usage-reader account for the same subscription. Every comparison against
observed usage uses it, across inference, the online canary, polling, coding
and unknown-usage endorsement. Plans still record the vault account. Records
without the endorsement stop qualifying until re-endorsed. See the
[reconciliation receipt](../ticket04-account-id-reconciliation-receipt.md).

## 19 October: owner re-endorsement of decision records

Records without `usageAccountId` stopped qualifying, and nothing writes
mediation decisions. The owner chose a re-endorsement tool:
`scripts/endorse-subscription-usage.mjs` previews the usage account from a
fresh, measured observation through the pinned host Codex, and writes it into
the protected record only with explicit confirmation. It refuses invalid or
non-private records, unusable observations, an unexpected account and any
re-binding. See the
[endorsement receipt](../ticket04-decision-endorsement-receipt.md).

## 20 October: owner restart approval after a usage interruption

After a usage interruption, coding stays blocked until the owner calls
`approveCodingRestart`. The approval names the interrupted operation and the
feature's account, and the one re-dispatch that reaches dispatch spends it,
after binding fresh usage authority. Interruptions are recorded before the
worker is stopped. Fresh usage alone never restarts, and exhaustion is never
overridden. Pause, cancel and recovery restarts are unchanged. Native
qualification of usage and restart controls through a production adapter
remains open. Production remains disabled. See the
[restart authorization receipt](../ticket04-restart-authorization-receipt.md).

## 20 October: owner cleanup of a retired resume lineage

Retirement now keeps the retired session's binding, and the owner can call
`cleanupRetiredLineage(id, operationId)`. The guest checks that the retired
session and every predecessor are stopped, gone and reserved in order, then
removes their session folders and stopped containers and keeps their records
as tombstones that are never resumed. The delivery records the cleanup once,
and an unverified cleanup records nothing. Native qualification remains open.
Production remains disabled. See the
[cleanup receipt](../ticket04-retired-lineage-cleanup-receipt.md).

## 20 October: resuming a coding conversation onto a moved main

Before any candidate exists, a moved main can be revalidated, and coding then
builds from the new main and advances the feature branch, which must still be
an ancestor. A resume whose predecessor used another revision names the exact
`{ from, to }` move. The pinned runtime binds it, the native guest accepts the
predecessor only for that move, Codex is told, and the delivery records it. No
extra owner approval is needed; every other turn check still applies. Base
refresh after admission stays with repair. Production remains disabled. See the
[base move receipt](../ticket04-base-move-resume-receipt.md).

## 20 October: native macOS acceptance of coding sessions

The owner ran `scripts/run-native-coding-acceptance.mjs` on the Mac against
`aios-macos-noshare`, offline and without credentials. Every stage passed:
- offline threads;
- resume onto a moved main;
- refused reuse of a consumed predecessor;
- recovery of a stranded resume;
- reconciliation, retirement and idempotent cleanup of a launched,
  thread-less resume.

Two real findings were fixed on the way. Turns now end once Codex reports its
thread, because offline Codex never exits. The guest now strips Codex's
regenerated `skills/.system`, `tmp` and `.tmp` before reusing a home, while
still refusing any other configuration or link. Windows and credentialed runs
remain open. Production remains disabled. See the
[native session acceptance receipt](../ticket04-native-session-acceptance-receipt.md).

## 21 October: resume vocabulary in the glossary

`CONTEXT.md` now defines coding-session resume, retained session home, resume
recovery and resume reconciliation (adopted and unresolved), alongside the
earlier usage interruption, coding restart approval, base move, retired resume
lineage and lineage cleanup entries. Documentation only.

## 21 October: native Windows acceptance of coding sessions

The owner ran the same offline acceptance on the Windows PC against
`aios-podman-noshare`, from `main` at `1b34398`. Every stage passed with
identical runner and transport builds to the final Mac run, in about 4.4
minutes. No Windows-specific change was needed. Both hosts have now observed:
- offline threads;
- resume onto a moved main;
- refused reuse;
- recovery;
- reconciliation, retirement and lineage cleanup.

Credentialed resumed turns and production integration remain open. Production
remains disabled. See the
[native session acceptance receipt](../ticket04-native-session-acceptance-receipt.md).

## 21 October: owner coding admission

The pinned coding runtime now accepts a live VM transport when an owner coding
admission record names its exact fresh pins. The record is a private,
owner-written file per host, kept outside any repository. It is re-read at
every check, so removing or editing it, or any pin change, stops further
coding. The controller, CLI and production default are unchanged; production
delivery remains disabled. A new owner-run offline acceptance drives one
controller coding turn through the real transport, with synthetic planning,
validation, onboarding and usage. Native runs on both hosts remain. See the
[coding admission receipt](../ticket04-coding-admission-receipt.md).

## 21 October: native inspection sends only the session identity

The owner's admission acceptance on the Mac, from a clean `main` at `7411ab2`,
admitted the runtime but recorded no coding thread. A diagnostic wrapper,
run from outside the repository, showed the cause. Before launch, the pinned
runtime re-inspects pins with the whole request, callbacks included, and the
native transport's `inspect` tried to `structuredClone` it. The transport now
sends only the session identity, as its stop and launch-time inspection
already did. A new native-fixture test reproduces the failure. The runtime,
controller and existing assertions are unchanged, and production remains
disabled. The owner's native admission runs on both hosts follow the merge. See
the [inspection identity receipt](../ticket04-admission-inspect-identity-receipt.md).

## 22 October: native macOS admission acceptance

The owner ran the coding admission acceptance on the Mac against
`aios-macos-noshare`, from a clean `main` at `3a4863c`, under their own record.
Every stage passed. The admitted runtime refused each changed pin, one
controller coding turn ran through the real transport for about 65 seconds, and
the controller recorded a stopped coding thread. Delivery stayed blocked at
`DELIVERY_NOT_ENABLED`. Offline Codex exhausted its one-minute allowance, so no
candidate was produced. Planning, validation, onboarding and usage were
synthetic, with no credentials or inference. The Windows admission run remains.
Production remains disabled. See the
[coding admission receipt](../ticket04-coding-admission-receipt.md).

## 22 October: native Windows admission acceptance

The owner ran the coding admission acceptance on the Windows PC against
`aios-podman-noshare`, from `main` at `389dc7b`, under a Windows record they
wrote themselves. The record's folder and file are owned by the owner and
grant access only to the owner, SYSTEM and Administrators. One run was refused
before coding because the record's `approvedAt` was not a canonical UTC time.
After the owner corrected it, every stage passed. One controller coding turn
ran through the real transport for about 72 seconds, a stopped thread was
recorded, and delivery stayed blocked at `DELIVERY_NOT_ENABLED`. The passing
report shows a dirty tree whose cause was not identified. Its built module
digests equal those of the clean Mac run. Both hosts have now observed owner
coding admission. Production remains disabled. See the
[coding admission receipt](../ticket04-coding-admission-receipt.md).

## 22 October: offline native validation executor

At the owner's direction, validation gained a native executor. It is offline
only, runs checks in the image the owner's contract declares and loaded
themselves, and is admitted by a separate per-host owner validation record.
`PinnedValidationRuntime` implements `ValidationRuntime` over
`NativePodmanValidationTransport`:
- each check runs in a fresh offline, read-only, unprivileged container over
  exactly the transferred tree;
- a guest timer bounds each check at its timeout;
- stop removes every container and measures the final tree.

Contracts declaring registries, caches or another image are refused before any
check. The shared host plumbing was extracted from the coding transport
without changing coding behavior or pins. The controller, the CLI and
production are unchanged. The owner's native acceptance runs on both hosts
follow. See the
[native validation executor receipt](../ticket04-native-validation-executor-receipt.md).

## 22 October: native macOS validation acceptance

The owner ran the offline validation acceptance on the Mac against
`aios-macos-noshare`, from a clean `main` at `4c3cab5`, under their own
validation record. The checks ran in the pinned Alpine image already in the
VM. Every stage passed. The controller's baseline validation ran its five
isolation probes through the real executor, each in a fresh container: tree
present, no network, read-only root, unprivileged user and no engine socket.
The attempt stopped with the tested tree unchanged. One earlier run was
refused at the record before any check, because the record had been saved
over the coding record's file with a mistyped pin. The Windows validation run
remains. Production remains disabled. See the
[native validation executor receipt](../ticket04-native-validation-executor-receipt.md).

## 23 October: stable VM identity in the native binding

The owner's Mac coding record was refused after a VM restart because the
binding moved. Apple's hypervisor gives the VM a new hardware UUID on every
boot, and both guest management programs bound that UUID. The owner confirmed
this across a stop and start. At the owner's direction, both programs now name
the VM by its `/etc/machine-id`, which survives restarts and differs for a new
VM. Both programs changed, so each host's coding and validation records need
one re-approval by the owner. The older qualification path in
`src/vm-management.ts` still binds the hardware UUID; changing it is the
owner's call. Production remains disabled. See the
[stable VM identity receipt](../ticket04-stable-vm-identity-receipt.md).

## 23 October: the binding ignores Podman's last-start time

After the machine ID change, a restart still moved the Mac binding. The owner
compared the machine's Podman configuration and machine ID across a restart.
The machine ID held, but Podman rewrites `LastUp` in the configuration on
every start, and the binding hashed the whole configuration. The binding now
leaves out `LastUp` and nothing else. Every other configuration change still
needs a new record. The policy pins are unchanged, and each record needs one
binding update. See the
[stable VM identity receipt](../ticket04-stable-vm-identity-receipt.md).

## 23 October: a Mac VM restart keeps the owner's records

After both binding fixes merged, the owner re-approved the Mac coding and
validation records from a clean `main` at `4e52d7d`. Then they stopped and
started the VM and ran the coding acceptance again without touching the record.
It passed with the same binding. The validation acceptance passed under its
re-approved record, after one refusal caught a mistyped pin. The Windows
records still need re-approval for the new guest programs, and a Windows
restart check remains. Production remains disabled. See the
[stable VM identity receipt](../ticket04-stable-vm-identity-receipt.md).
