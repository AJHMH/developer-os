# 05: Implement a bounded feature and safely admit the worker result

**What to build:** A feature request becomes observable acceptance criteria, a trusted feature branch and an explicit isolated Codex session. The controller safely imports stopped-worker output as a candidate, without publishing or declaring completed delivery.

**Blocked by:** 04: [Launch an isolated worker with a fail-closed qualification gate](04-isolated-worker-gate.md).

**Status:** needs-info — controller slice implemented; native qualification dependency 04 remains open

## Source and governing contract

Read the [approved canonical specification](../../aios-feature-delivery/spec.md) before implementation. User-story coverage: 3, 4, 11, 30, 31, 37. Use the domain glossary and approved public-controller command/observation testing boundary; assert visible behavior and permitted/forbidden effects rather than implementation internals.

This is an implementation slice, separate from resolved wayfinder decisions. Unimplemented or unqualified phases remain blocked. Controlled adapters and temporary repositories demonstrate behavior before real host/repository qualification; they do not establish live readiness. Preserve existing user material, authority boundaries and credentials. Do not enable live pilot delivery before all qualification prerequisites pass.

## Acceptance criteria

- [x] Ordinary requests produce criteria and relevant verification without redundant approval; materially ambiguous requirements preserve a blocker for the owner.
- [x] A feature branch derives from the admitted revision; main is never the worker editing target, and no credential-bearing Git metadata is shared.
- [ ] The pinned CLI adapter handles noninteractive structured events, exit/failure outcomes and explicit session resume without assuming current help proves compatibility.
- [x] Default initial coding allowance is 120 active minutes, configurable and persisted across restart; exhaustion blocks and continuation requires recorded owner extension.
- [x] Before output import the worker is stopped; traversal, symlink/hardlink/reparse escape, unsafe Git metadata/hooks and concurrent output are rejected.
- [x] Admitted changes retain an exact tested-tree/candidate identity and policy provenance; no repository-supplied scripts execute on the trusted host.
- [x] Public tests cover criteria, worker failure/resume, deadline/extension and malicious output. Until baseline/candidate validation is integrated, live delivery is explicitly disabled.

## Implementation and qualification boundary

Implemented the public controller slice, pinned structured-event adapter, explicit session resume, durable active allowance and owner extension, verified shutdown and stopped candidate admission. Controlled temporary-repository tests cover these behaviors. The pinned adapter acceptance item remains open for actual native CLI compatibility and isolated transport qualification; help output and controlled observations do not establish that proof. Dependency 04 and full native controller qualification must be resolved before enabling live delivery. Candidate validation is explicitly `not-run`; ticket 06 owns verification of the exact candidate.

Validation and independent review: [ticket 05 implementation receipt](../ticket05-implementation-receipt.md).
