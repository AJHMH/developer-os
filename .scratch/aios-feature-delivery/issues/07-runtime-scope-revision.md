# Reconsider the isolated worker runtime and qualification scope

Type: grilling
Status: resolved

## Question

Should the approved Docker Sandboxes execution foundation be revised to dedicated Podman-backed VMs, and should completed Windows offline feasibility be separated from production worker qualification?

## Evidence

- Existing approved runtime decision: [Choose the v1 execution foundation and specification boundary](05-runtime-foundation.md).
- [Windows Podman prototype evidence](../../aios-v1-implementation/podman-prototype-progress.md), signed prototype commit659d13b.
- Host-share-free Hyper-V VM configuration and live mount observations; restricted worker uid65534; no engine sockets or MCP environment names; offline network positive controls passed; two observed lifecycle descendants disappeared after forced stop; basic offline properties survived VM restart.
- These are scoped observations, not full adversarial assurance or online worker readiness.
- Docker human support case00239659 remains pending; Gordon's automated response is not a human determination.

## Resolution — approved by owner

Select dedicated Podman-backed VMs as the candidate runtime, Windows Hyper-V first. Preserve Windows11x64 and macOS14+Apple-silicon product scope, with independent host qualification and no container/host fallback. This is a deliberate revision to the approved Docker-specific runtime choice, not an implicit exception.

Preserve original implementation ticket4 as the parent qualification gate. Recognize its Windows offline feasibility sub-scope as demonstrated, without closing the original acceptance criteria. Split remaining implementation into explicit blocking tickets in the subsequent to-spec/to-tickets phase. Production feature delivery remains blocked until the required adapter and qualification gates pass.

Remaining work categories: VM/template/image/version bindings and admitted file transfer; production controller/CLI integration; externally enforced online model/dependency allowlist; model-only subscription authentication without copying owner credentials; synthetic Windows-host and MCP service canaries; stronger cross-delivery and escape attempts; concurrent fencing/orphan/recovery semantics; independent macOS qualification. Subscription usage observations/approval remain distinct from a financial cap.

No purchases, paid API fallback or governance subscription assumed. Do not substitute raw owner auth files for authentication mediation. If no supported subscription mediation can satisfy isolation, return that tradeoff to the owner before live inference.

## Owner decisions needed

1. Candidate runtime revision from Docker-specific execution to Podman-backed dedicated VMs.
2. Keep original qualification ticket open and split verified feasibility from remaining blocking implementation, rather than declaring original ticket complete.
3. Proceed Windows-first, retain macOS as an explicit unqualified host with execution blocked until its own qualification passes.

Owner approved all three decisions on 7 October 2026. This resolves the runtime and scope decision; it does not qualify Podman for production execution. Hand off to /to-spec and /to-tickets to revise the canonical specification and blocking implementation tickets. No implementation changes during this wayfinding session.

