# 04: Launch an isolated worker with a fail-closed qualification gate

**What to build:** The controller runs a sandbox qualification probe, records version-bound host evidence and starts/stops a pinned microVM worker only under admitted workspace, model-only credential and network policy. Unsafe or unverifiable configurations refuse launch.

**Blocked by:** 02: [Report repository onboarding readiness without changing setup](02-onboarding-readiness.md); 03: [Queue, pause, cancel and recover repository-owned deliveries](03-ownership-pause-recovery.md).

**Status:** in-progress

## Source and governing contract

Read the [approved canonical specification](../../aios-feature-delivery/spec.md) before implementation. User-story coverage: 12, 13, 14, 15. Use the domain glossary and approved public-controller command/observation testing boundary; assert visible behavior and permitted/forbidden effects rather than implementation internals.

This is an implementation slice, separate from resolved wayfinder decisions. Unimplemented or unqualified phases remain blocked. Controlled adapters and temporary repositories demonstrate behavior before real host/repository qualification; they do not establish live readiness. Preserve existing user material, authority boundaries and credentials. Do not enable live pilot delivery before all qualification prerequisites pass.

## Acceptance criteria

Implementation progress: controller/CLI qualification reports, version/policy-bound canary protocol, ordinary-file materialization and effective configuration/descendant lifecycle gates are implemented with controlled runtime tests. The native sbx runtime remains unimplemented; sbx is unavailable on this host. Live enforcement and independent Windows/macOS qualification remain unperformed. Acceptance boxes remain open pending the actual runtime driver and enforcement evidence; downstream live delivery stays blocked.

- [ ] The selected adapter targets pinned Docker Sandboxes microVMs and Codex CLI on the agreed Windows/macOS configurations; missing prerequisites or changed unqualified versions refuse launch without host/container fallback.
- [ ] Only newly materialized admitted ordinary files enter the workspace; Git metadata, owner environment/home/keystore, ledger, signing/SSH sockets and host Docker authority are excluded.
- [ ] Effective mounts and policy prove disabled shared skills, host MCP, SSH forwarding, untrusted host hooks and GitHub bindings; mock declarations alone cannot qualify a real host.
- [ ] Dedicated model-only proxy authentication, spending control, restricted endpoints and controlled dependency access are enforced and tested with synthetic canaries; unknown enforcement blocks.
- [ ] Public pause/cancel/restart controls stop or reconcile sandbox descendants and orphans; killing a client alone is not treated as proof.
- [ ] Adversarial probe results include credential/file/network/cross-delivery denial and explicit not-run/blocked outcomes. Full independent host qualification remains required before live pilot enablement.
