# 06: Validate baseline and candidate behavior inside isolation

**What to build:** The delivery validates unchanged main before coding and the final candidate afterward, returning complete revision-bound evidence or blockers for the declared formatting, lint, type, coverage, build and feature-specific checks.

**Blocked by:** 05: [Implement a bounded feature and safely admit the worker result](05-bounded-feature-candidate.md).

**Status:** ready-for-agent

## Source and governing contract

Read the [approved canonical specification](../../aios-feature-delivery/spec.md) before implementation. User-story coverage: 16, 17, 18, 19, 20, 21, 22, 23. Use the domain glossary and approved public-controller command/observation testing boundary; assert visible behavior and permitted/forbidden effects rather than implementation internals.

This is an implementation slice, separate from resolved wayfinder decisions. Unimplemented or unqualified phases remain blocked. Controlled adapters and temporary repositories demonstrate behavior before real host/repository qualification; they do not establish live readiness. Preserve existing user material, authority boundaries and credentials. Do not enable live pilot delivery before all qualification prerequisites pass.

## Acceptance criteria

- [ ] Owner-controlled declarations specify local/PR/main checks, trusted publishers, timeouts and permitted exceptions; candidate edits cannot weaken commands, thresholds or policy.
- [ ] Unchanged-main baseline is evaluated before the implementation stage; unrelated failures block rather than silently expanding repair scope.
- [ ] The pilot baseline covers lint/format verification, type checking, coverage and build plus feature acceptance; necessary browser/database tests run with disposable synthetic infrastructure.
- [ ] Dependency lifecycle and validation scripts run inside the qualified worker boundary with declared registries/caches; no production database credentials or privileged host-script fallback is used.
- [ ] Formatting changes trigger revalidation. Evidence identifies tested tree/final candidate, command/environment assumptions, status and artifacts; pre-push hook/smoke success alone is insufficient.
- [ ] Required missing/pending/skipped/neutral/cancelled/stale/untrusted results remain incomplete absent an explicit trusted exception; all failed attempts and workflow retries are retained.
- [ ] One diagnostic rerun on unchanged code is allowed; unexplained intermittency still blocks without owner-approved flake policy. Hung commands are stopped/reconciled before overlap.
- [ ] Public tests cover baseline ordering, malicious scripts, E2E requirements, exact-revision invalidation, timeout and flake policy with meaningful temporary fixtures.

