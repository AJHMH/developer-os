# 02: Report repository onboarding readiness without changing setup

**What to build:** A delivery request verifies repository identity and owner-controlled onboarding requirements, then presents verified facts, unknowns and a precise missing-prerequisite checklist without provisioning or weakening setup.

**Blocked by:** 01: [Submit a feature request and inspect durable delivery status](01-durable-request-status.md).

**Status:** completed

## Source and governing contract

Read the [approved canonical specification](../../aios-feature-delivery/spec.md) before implementation. User-story coverage: 5, 6, 7, 8. Use the domain glossary and approved public-controller command/observation testing boundary; assert visible behavior and permitted/forbidden effects rather than implementation internals.

This is an implementation slice, separate from resolved wayfinder decisions. Unimplemented or unqualified phases remain blocked. Controlled adapters and temporary repositories demonstrate behavior before real host/repository qualification; they do not establish live readiness. Preserve existing user material, authority boundaries and credentials. Do not enable live pilot delivery before all qualification prerequisites pass.

## Acceptance criteria

- [x] Canonical repository/default-branch identity is checked against selected remote/local inputs; the profile-page identity discrepancy blocks writes until verified rather than being silently rewritten.
- [x] Trusted Factory release/commit and owner policy provenance are recorded outside candidate control; candidate policy changes cannot relax evaluation.
- [x] Readiness covers App repository access/PR identity, sole approver, effective checks/protections, signing/publication identity and required validation infrastructure.
- [x] Signing configuration alone is labeled unproven until local signature and GitHub verification evidence exist; unavailable live facts remain unknown/blocked.
- [x] Missing or conflicting prerequisites yield an actionable checklist and prevent worker/remote delivery effects; no implicit App install, protection change or provisioning occurs.
- [x] Public-controller tests cover verified, missing, unreachable and spoofed/candidate-controlled inputs without exposing credentials.


## Implementation evidence — 7 October 2026

The public intake/status boundary now persists a timestamped onboarding report, per-requirement unknown/conflict/verified facts, owner-policy path/content hash and Factory pin, and actionable prerequisite checklist. CLI `start --owner-policy <external-file>` reads local origin and cached default-branch hints without fetching or rewriting them. Candidate-resident policy, link-redirection paths and feature-request readiness assertions cannot relax evaluation.

Readiness includes canonical identity, Factory/policy provenance, App access/authorship, sole approver, effective checks/protections, publication, matching locally/GitHub-verified signing evidence and validation infrastructure. Host-supplied read-only observations are the trusted external-system boundary. The CLI has no live verification provider in this slice: absent live facts remain unknown, and all deliveries retain `DELIVERY_NOT_ENABLED` even with a verified test report. No App installation, protection change, resource provisioning, worker or remote delivery effects are available.

Validation: typechecking and formatting pass; the full Node test suite passes 15 tests, including nine onboarding controller/CLI cases, real temporary Git inspection, policy snapshot persistence, missing/unreachable evidence, signing without GitHub evidence, credential-error suppression and candidate directory-link and repository-alias attacks. Fixtures use controlled inspection observations; this does not qualify live Factory/GitHub setup or macOS/Windows worker isolation. CodeRabbit's first external review completed for cli.ts/controller.ts/onboarding.ts with zero findings; the second review raised one major canonical-path finding, addressed with canonical-root and traversed-ancestor checks plus alias regression coverage; the final review completed for all three source files with zero findings.

