# 15: Qualify the complete controller boundary on Windows

**What to build:** On Windows 11 x64 the public workflow and real adversarial isolation probes produce a version-bound readiness record or an actionable qualification blocker, enabling only demonstrated host behavior.

**Blocked by:** 14: [Clean eligible merged branches and report delivery completion](14-eligible-cleanup-completion.md).

**Status:** ready-for-agent

## Source and governing contract

Read the [approved canonical specification](../../aios-feature-delivery/spec.md) before implementation. User-story coverage: 13. Use the domain glossary and approved public-controller command/observation testing boundary; assert visible behavior and permitted/forbidden effects rather than implementation internals.

This is an implementation slice, separate from resolved wayfinder decisions. Unimplemented or unqualified phases remain blocked. Controlled adapters and temporary repositories demonstrate behavior before real host/repository qualification; they do not establish live readiness. Preserve existing user material, authority boundaries and credentials. Do not enable live pilot delivery before all qualification prerequisites pass.

## Current evidence reconciliation — 15 October 2026

Complete-controller/pilot acceptance has not run. Fixed worker qualification in tickets 24–25 does not satisfy this ticket. Dependencies remain enforced; ready-for-agent describes specification readiness, not permission to skip upstream gates.

## Acceptance criteria

- [ ] Record actual OS/architecture/hypervisor, runtime/worker/image and policy pins; changed/unverified combinations cannot inherit a readiness result.
- [ ] Execute real host-file, credential/helper/signing-socket, restricted-network/model-proxy, malicious dependency/configuration and cross-delivery probes using canaries, not actual secrets.
- [ ] Demonstrate safe workspace admission/import and full isolated validation with disposable browser/database resources; no credential-bearing host fallback.
- [ ] Verify Windows-specific signing/trusted auth adapters, process descendants/orphans, pause/cancel, explicit-session resume and interrupted-effect recovery.
- [ ] Qualification tests drive the public controller and publish evidence outside the worker boundary, including effective configuration and negative probe outcomes.
- [ ] Unavailable infrastructure/credentials yield blocked/not-run; mocks and successful macOS tests never count as Windows qualification.
- [ ] Owner provisioning remains separate from delivery; this ticket does not silently change App access, protections or key material.

