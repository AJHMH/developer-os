# Define Factory onboarding and authority for personal repositories

Type: grilling
Label: wayfinder:grilling
Status: resolved
Claimed by: current Codex chat
Parent: ../map.md
Blocked by: none

## Question

What must a personal repository provide before AIOS may start feature delivery, and which existing Factory components will it reuse?

Settle first target-repository selection, App installation scope, trusted policy distribution, signed-push and post-approval merge identities, signing verification, and the treatment of missing governance prerequisites. Preserve agreed App-authored PRs and human approval; distinguish new onboarding work from existing proven capabilities.

## Evidence

- [Factory integration evidence](../factory-evidence.md).
- [Agreed starting constraints](../map.md).

## Resolution requirements

A concrete repository onboarding contract and responsibility boundary, including what is verified before any remote write. Record decisions here, not in the map body.

## Comments

### Owner decisions — 7 October 2026

- Pilot repository: [AJHMH/profile-page](https://github.com/AJHMH/profile-page).
- If App access, signing, required checks or branch protections are missing, stop with a precise onboarding checklist. Repository setup is separate from feature delivery.
- AIOS may use the configured Git/GitHub identity to push signed commits and execute merge after a valid owner current-head review, limited to explicitly onboarded repositories. Never submit approval reviews with these credentials.
- The credential arrangement is a candidate to test, not a claim that signing, pushing or merging already works. Establish empirical evidence in the pilot before treating it as a proven integration.
- Read-only readiness inspection is complete; no pilot changes or external writes were performed.
- [Pilot readiness evidence](../pilot-readiness.md) records available local contracts and unverified prerequisites. The selected target remains `AJHMH/profile-page`; saved local origin differs and live identity could not be checked.

### Owner decisions — trust and pilot acceptance

- Pin an explicitly selected trusted Factory release/commit and owner-maintained policy. Feature branches may not weaken their own approval or validation rules. Do not automatically adopt the latest Factory version.
- Prove the integration through one observed end-to-end delivery of a small agreed feature: signed push, App-authored PR, current-head owner review, protected merge, main checks, synchronization and eligible cleanup.

## Answer

Owner confirmed the complete onboarding contract on 7 October 2026. This resolves the planning decision; operational readiness remains to be demonstrated.

1. Pilot target is `AJHMH/profile-page`. Verify canonical GitHub identity and actual default branch against the local checkout before remote writes; do not silently substitute its currently saved `aaron-howard/profile-page` origin.
2. An explicitly onboarded repository identifies its trusted Factory release/commit, owner-controlled policy and required validation/protection settings. A candidate feature branch cannot supply weaker authority for evaluating itself.
3. Verify App installation access for that repository and App-authored PR capability. Keep App credentials scoped to PR operations, using its external PEM for authentication; the App does not sign commits or perform code pushes/merges with its existing read-only Contents permission.
4. Use the configured Git/GitHub identity for signed pushes and post-approval merge, scoped to onboarded repositories. Demonstrate signing locally and GitHub signature verification; configured signing settings alone do not establish readiness. Never submit owner approval from these credentials.
5. Verify the designated sole owner approver, current-head review enforcement, required checks and branch protections. The owner's actual GitHub APPROVED review on the current PR head authorizes merge once all gates pass; any new commit requires renewed approval.
6. Check declared local/CI/main validation requirements and their infrastructure, including this pilot's E2E dependencies. Missing identity, App, signing, validation or governance prerequisites block delivery with a precise checklist. Repository provisioning is separate from feature delivery; no protection bypass or automatic prerequisite repair.
7. Prove the candidate arrangement with one observed small end-to-end feature delivery. Keep setup separate; component checks may diagnose failures but do not replace the end-to-end acceptance demonstration. Preserve evidence for signing, PR identity, reviewed/merged revisions, checks, synchronized main and eligible cleanup.
8. Reuse Factory PR-authentication, current-head review, governance and trusted refresh components only within their verified scope. AIOS supplies full feature orchestration; existing formatting remediation is not a full delivery engine. Exact adapter/version selection, recovery, validation semantics and replay-preserving cleanup are assigned to the remaining map tickets.

The exact Factory version, live App/ruleset state and working credentials are execution-readiness facts still to establish. Approving this contract does not assert that the pilot is onboarded or authorize provisioning, remote writes, key changes or branch deletion during planning.

Resolution: accepted by the owner. Implementation must use this contract and retain the readiness checks described above.
