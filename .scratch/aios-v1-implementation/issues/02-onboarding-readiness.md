# 02: Report repository onboarding readiness without changing setup

**What to build:** A delivery request verifies repository identity and owner-controlled onboarding requirements, then presents verified facts, unknowns and a precise missing-prerequisite checklist without provisioning or weakening setup.

**Blocked by:** 01: [Submit a feature request and inspect durable delivery status](01-durable-request-status.md).

**Status:** ready-for-agent

## Source and governing contract

Read the [approved canonical specification](../../aios-feature-delivery/spec.md) before implementation. User-story coverage: 5, 6, 7, 8. Use the domain glossary and approved public-controller command/observation testing boundary; assert visible behavior and permitted/forbidden effects rather than implementation internals.

This is an implementation slice, separate from resolved wayfinder decisions. Unimplemented or unqualified phases remain blocked. Controlled adapters and temporary repositories demonstrate behavior before real host/repository qualification; they do not establish live readiness. Preserve existing user material, authority boundaries and credentials. Do not enable live pilot delivery before all qualification prerequisites pass.

## Acceptance criteria

- [ ] Canonical repository/default-branch identity is checked against selected remote/local inputs; the profile-page identity discrepancy blocks writes until verified rather than being silently rewritten.
- [ ] Trusted Factory release/commit and owner policy provenance are recorded outside candidate control; candidate policy changes cannot relax evaluation.
- [ ] Readiness covers App repository access/PR identity, sole approver, effective checks/protections, signing/publication identity and required validation infrastructure.
- [ ] Signing configuration alone is labeled unproven until local signature and GitHub verification evidence exist; unavailable live facts remain unknown/blocked.
- [ ] Missing or conflicting prerequisites yield an actionable checklist and prevent worker/remote delivery effects; no implicit App install, protection change or provisioning occurs.
- [ ] Public-controller tests cover verified, missing, unreachable and spoofed/candidate-controlled inputs without exposing credentials.

