# 06: Validate baseline and candidate behavior inside isolation

**Implementation reconciliation — 15 October 2026:** The controlled controller slice is implemented in current source and covered by the corresponding implementation receipt. Native adapter/qualification acceptance remains open, so this ticket is not marked fully completed. See the [current status](../../../docs/implementation-status.md).


**What to build:** The delivery validates unchanged main before coding and the final candidate afterward, returning complete revision-bound evidence or blockers for the declared formatting, lint, type, coverage, build and feature-specific checks.

**Blocked by:** 05: [Implement a bounded feature and safely admit the worker result](05-bounded-feature-candidate.md).

**Status:** ready-for-human

## Source and governing contract

Read the [approved canonical specification](../../aios-feature-delivery/spec.md) before implementation. User-story coverage: 16, 17, 18, 19, 20, 21, 22, 23. Use the domain glossary and approved public-controller command/observation testing boundary; assert visible behavior and permitted/forbidden effects rather than implementation internals.

This is an implementation slice, separate from resolved wayfinder decisions. Unimplemented or unqualified phases remain blocked. Controlled adapters and temporary repositories demonstrate behavior before real host/repository qualification; they do not establish live readiness. Preserve existing user material, authority boundaries and credentials. Do not enable live pilot delivery before all qualification prerequisites pass.

## Acceptance criteria

- [x] Owner-controlled declarations specify local/PR/main checks, trusted publishers, timeouts and permitted exceptions; candidate edits cannot weaken commands, thresholds or policy.
- [x] Unchanged-main baseline is evaluated before the implementation stage; unrelated failures block rather than silently expanding repair scope.
- [ ] The pilot baseline covers lint/format verification, type checking, coverage and build plus feature acceptance; necessary browser/database tests run with disposable synthetic infrastructure.
- [ ] Dependency lifecycle and validation scripts run inside the qualified worker boundary with declared registries/caches; no production database credentials or privileged host-script fallback is used.
- [x] Formatting changes trigger revalidation. Evidence identifies tested tree/final candidate, command/environment assumptions, status and artifacts; pre-push hook/smoke success alone is insufficient.
- [x] Required missing/pending/skipped/neutral/cancelled/stale/untrusted results remain incomplete absent an explicit trusted exception; all failed attempts and workflow retries are retained.
- [x] One diagnostic rerun on unchanged code is allowed; unexplained intermittency still blocks without owner-approved flake policy. Hung commands are stopped/reconciled before overlap.
- [x] Public tests cover baseline ordering, malicious scripts, E2E requirements, exact-revision invalidation, timeout and flake policy with meaningful temporary fixtures.



## Implementation receipt — 2026-10-14

Controlled controller implementation is ready for review. See
[validation contract and qualification requirements](../../../docs/isolated-validation.md).
Baseline ordering, protected validation inputs, exact revision/environment binding,
owner exceptions, diagnostic reruns, shutdown/control fencing and synthetic E2E
requirements have public-controller coverage with real temporary Git repositories.
PR/main checks are declared but their live observation belongs to later delivery
slices. Native scripts, dependency lifecycle, browser/database disposal and pilot
qualification remain unverified, so the native acceptance items stay open for that
evidence. Checked items describe the controlled slice, not live readiness. Production delivery remains disabled.

Validation results: [implementation receipt](../ticket06-implementation-receipt.md).
