# 16: Qualify the complete controller boundary on macOS

**What to build:** On macOS 14+ Apple silicon the same public workflow and real isolation matrix produce independent qualification evidence rather than inheriting Windows results.

**Blocked by:** 14: [Clean eligible merged branches and report delivery completion](14-eligible-cleanup-completion.md).

**Status:** ready-for-agent

## Source and governing contract

Read the [approved canonical specification](../../aios-feature-delivery/spec.md) before implementation. User-story coverage: 13. Use the domain glossary and approved public-controller command/observation testing boundary; assert visible behavior and permitted/forbidden effects rather than implementation internals.

This is an implementation slice, separate from resolved wayfinder decisions. Unimplemented or unqualified phases remain blocked. Controlled adapters and temporary repositories demonstrate behavior before real host/repository qualification; they do not establish live readiness. Preserve existing user material, authority boundaries and credentials. Do not enable live pilot delivery before all qualification prerequisites pass.

## Acceptance criteria

- [ ] Record actual macOS/Apple-silicon runtime, worker/image and policy pins and reject unsupported or changed unqualified setups.
- [ ] Run real file/credential/network/proxy/dependency/configuration/cross-delivery canary probes; verify effective isolation rather than vendor defaults alone.
- [ ] Demonstrate native signing/trusted authentication, safe path/link/output admission and full Linux-isolated web validation with disposable test infrastructure.
- [ ] Verify actual descendant/orphan termination, pause/cancel, explicit-session resume and controller recovery on macOS; no Windows-only helper or key-path assumptions.
- [ ] Evidence is stored outside the worker and distinguishes passed, failed and not-run/blocked cases for every required boundary.
- [ ] Windows readiness cannot substitute; inaccessible macOS infrastructure blocks qualification instead of labeling support proven.
- [ ] Provisioning stays separate and owner-controlled; no implicit governance changes or production-test credentials.

