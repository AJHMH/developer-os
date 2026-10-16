# 04: Launch an isolated worker with a fail-closed qualification gate

**Status:** ready-for-agent — remaining implementation started; production qualification pending

**What to build:** Run a pinned dedicated Podman worker for admitted feature work
only after fresh, version-bound host, workspace, model-only authentication,
network and lifecycle qualification. Unsafe or unverifiable configurations refuse
launch; there is no host/shared-runtime fallback.

**Active dependency blockers:** None. [02: onboarding readiness](02-onboarding-readiness.md)
and [03: ownership and recovery](03-ownership-pause-recovery.md) are completed
prerequisites, not current blockers.

**Information needed from the owner:** No unanswered requirement blocks the next
implementation slice. Later live enrollment/inference still requires the relevant
external configuration and fresh explicit authorization; historical approvals do
not authorize a new run.

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
  integration, explicit resume and qualification remain unfinished. A generic request must
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
