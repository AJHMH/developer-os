# 04: Launch an isolated worker with a fail-closed qualification gate

**What to build:** The controller runs a sandbox qualification probe, records version-bound host evidence and starts/stops a pinned microVM worker only under admitted workspace, model-only credential and network policy. Unsafe or unverifiable configurations refuse launch.

**Blocked by:** 02: [Report repository onboarding readiness without changing setup](02-onboarding-readiness.md); 03: [Queue, pause, cancel and recover repository-owned deliveries](03-ownership-pause-recovery.md).

**Status:** needs-info

7 October follow-up: the owner supplied a live diagnostic with all 13 checks passing after reboot and Docker sign-in. The owner then selected a subscription-usage approval gate instead of immediately provisioning OpenRouter: at 20% remaining, or unknown usage, require approval; exhaustion must stop without credit purchases/API fallback. The controller gate and documented app-server usage reader are implemented. A live read using pinned official Codex 0.161.0 returned 4% weekly usage, matching the desktop. This does not finish the native worker driver, authentication isolation or adversarial sandbox qualification. Existing credits/automatic reload are separate billing controls and this gate is not an exact hard-dollar cap.

## Source and governing contract

Read the [approved canonical specification](../../aios-feature-delivery/spec.md) before implementation. User-story coverage: 12, 13, 14, 15. Use the domain glossary and approved public-controller command/observation testing boundary; assert visible behavior and permitted/forbidden effects rather than implementation internals.

This is an implementation slice, separate from resolved wayfinder decisions. Unimplemented or unqualified phases remain blocked. Controlled adapters and temporary repositories demonstrate behavior before real host/repository qualification; they do not establish live readiness. Preserve existing user material, authority boundaries and credentials. Do not enable live pilot delivery before all qualification prerequisites pass.

## Acceptance criteria

Implementation progress: controller/CLI qualification reports, version/policy-bound canary protocol, ordinary-file materialization and effective configuration/descendant lifecycle gates are implemented with controlled runtime tests. Native host diagnostics are now connected to the CLI and discard raw diagnostic output. Docker Sandboxes 0.47.0 is installed; its virtualization diagnostic passes after the reboot. The daemon initially reported missing Docker sign-in; subsequent detached starts fail on a backend socket access error. Supported stop/start recovery did not resolve this. Docker authentication and a dedicated model-only proxy with independently enforced spending cap need confirmation. The native worker driver remains unfinished. Live enforcement and independent Windows/macOS qualification remain unperformed. Acceptance boxes remain open; downstream live delivery stays blocked.

The owner confirmed no dedicated proxy is configured. OpenRouter is an integration candidate: its [Responses API](https://openrouter.ai/docs/api/api-reference/responses/create-responses) and [per-key credit limits](https://openrouter.ai/docs/api_reference/limits) are documented. This is not selection or qualification: streaming/tool compatibility, endpoint-scoped credential injection, exhausted-key rejection and concurrent/in-flight spend behavior must be tested. No account, key, credits or inference requests were provisioned. CodeRabbit reviewed this progress slice; its single minor finding requests Linux executable discovery, which is outside the approved Windows/macOS v1 scope and was not applied.

- [ ] The selected adapter targets pinned Docker Sandboxes microVMs and Codex CLI on the agreed Windows/macOS configurations; missing prerequisites or changed unqualified versions refuse launch without host/container fallback.
- [ ] Only newly materialized admitted ordinary files enter the workspace; Git metadata, owner environment/home/keystore, ledger, signing/SSH sockets and host Docker authority are excluded.
- [ ] Effective mounts and policy prove disabled shared skills, host MCP, SSH forwarding, untrusted host hooks and GitHub bindings; mock declarations alone cannot qualify a real host.
- [ ] Dedicated model-only proxy authentication, spending control, restricted endpoints and controlled dependency access are enforced and tested with synthetic canaries; unknown enforcement blocks.
- [ ] Public pause/cancel/restart controls stop or reconcile sandbox descendants and orphans; killing a client alone is not treated as proof.
- [ ] Adversarial probe results include credential/file/network/cross-delivery denial and explicit not-run/blocked outcomes. Full independent host qualification remains required before live pilot enablement.

## Comments

7 October native test: owner approved initializing the global deny-all policy. A mountless, skills-off shell sandbox successfully started, daemon inspection showed no runtime mounts, and a real external HTTPS canary was denied. However, daemon inspection also showed an automatically enabled MCP gateway and uploaded gateway secret. This fails the approved host-MCP isolation requirement. The sandbox was stopped and inspected as stopped; full descendant fencing is not yet proven. See [native qualification evidence](../native-qualification-2026-10-07.md). No inference or owner credential import occurred. Native launch remains blocked; the old daemon/authentication prerequisites are now resolved.

8 October UTC prototype result: passing `--static-mcp=` on a fresh mountless, skills-off, deny-all sandbox did not disable dynamic MCP. A proper initialize / initialized / tools-list sequence returned HTTP 200 and exposed code-mode, mcp-add, mcp-config-set, mcp-exec and mcp-find. Global/per-sandbox outbound deny-all does not isolate this internal gateway path. No tool was invoked, no server registered and no credential contents accessed. The sandbox was stopped and daemon inspection confirmed stopped. These are rejected workaround candidates, not evidence that every possible workaround is impossible. See [research](../mcp-gateway-research.md) and [throwaway live prototype](../mcp-boundary-prototype.mjs), preserved on `codex/prototype-ticket4-mcp`.

7 October Podman prototype: dedicated Hyper-V VM initialization returned success under task-local empty default volumes configuration. Effective mount inspection is blocked until Windows login permissions refresh after Podman added the account to Hyper-V Administrators. No VM start or guest workload was issued; no isolation proof yet. See [progress](../podman-prototype-progress.md). Prototype preserved on codex/prototype-ticket4-podman; runtime switch remains unapproved/unqualified.
