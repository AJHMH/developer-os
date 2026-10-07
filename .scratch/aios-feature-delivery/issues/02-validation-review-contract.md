# Define validation and review evidence for feature delivery

Type: grilling
Label: wayfinder:grilling
Status: resolved
Claimed by: current Codex chat
Parent: ../map.md
Blocked by: none

## Question

How does each repository declare the lint, formatting, test, build and GitHub checks that establish feature correctness, and how does AIOS determine that review findings are actually addressed?

Settle feature acceptance criteria, missing or skipped checks, exact-revision evidence, formatting behavior, flaky checks, review-conversation handling and trust in CI results. Keep the agreed repair allowance and owner-only approval.

## Evidence

- [Factory integration evidence](../factory-evidence.md).
- [Research acceptance tests](../../../AIOS-RESEARCH.md).

## Resolution requirements

An explicit validation/review contract with pass, fail and blocked outcomes, suitable for a later implementation spec.

## Comments

### Owner decisions — 7 October 2026

- Each feature has observable acceptance criteria and relevant verification before coding. AIOS drafts them from the request and asks only when ambiguity materially changes the feature.
- AIOS cannot weaken tests, lower thresholds, skip checks or change validation policy to manufacture success. Policy changes require a separate owner decision.
- Allow one diagnostic rerun on unchanged code. Preserve both outcomes; unexplained intermittent failure blocks delivery unless an owner-approved flake policy covers it.
- Address straightforward review findings and verify fixes before resolving conversations. Conflicting/disputed requests go to the owner and remain unresolved until decided.

### Pilot facts

- Local candidate baseline: `npm run lint` (format check plus ESLint), `npm run check`, `npm run test:coverage`, `npm run build`; feature-specific acceptance tests are additional. [Canonical commands](D:/repos/profile-page/package.json:8).
- [Pre-push hook](D:/repos/profile-page/.husky/pre-push:1) covers only check and unit tests; hook success does not prove the full baseline passed.
- [PR/main CI](D:/repos/profile-page/.github/workflows/ci.yml:3) delegates to `aaron-howard/ci-templates@v1.0.0`; that reusable workflow was not available locally, so exact hosted commands, checks and conditional behavior remain unverified.
- [E2E workflow](D:/repos/profile-page/.github/workflows/e2e.yml:3) runs on main/manual dispatch, not PRs. Local E2E requires Chromium and a reachable database; [instructions](D:/repos/profile-page/AGENTS.md:83) say unit tests mock the database.
- [Smoke tests](D:/repos/profile-page/e2e/smoke.spec.ts:4) cover routes/accessibility but do not establish actual database-backed feature content. A successful HTTP response or smoke suite is insufficient evidence for every feature.
- [Coverage configuration](D:/repos/profile-page/vitest.config.ts:11) limits measured files and exclusions; coverage percentage alone is not whole-application correctness.
- [Factory governance guidance](D:/repos/factory-template/docs/repository-governance.md:44) calls for exact head/base and required-check revalidation immediately before conditional merge; check names alone do not prove trusted provenance.
- No tests were executed. Existing baseline failures, live required-check configuration and external workflow internals remain unknown.

### Owner decisions — validation phases and incomplete evidence

- Local validation requires lint/format checks, type checks, coverage, build and feature-specific acceptance tests. Run local E2E before merge when browser/database behavior needs it. Configured PR CI and post-merge main checks, including E2E, are required in their respective phases.
- Required checks need successful evidence for the exact revision from the expected trusted workflow. Missing, skipped, neutral, stale or untrusted results are incomplete unless owner-controlled policy explicitly permits them.
- Unchanged-main baseline failures block delivery with evidence. Unrelated repairs are not added to the feature unless the owner explicitly expands its scope.

## Answer

Owner confirmed the complete validation and review contract on 7 October 2026. This resolves the planning decision; live check configuration and pilot validation results remain to be verified.

1. Before coding, AIOS drafts observable feature acceptance criteria and verification from the feature request. Material ambiguities go to the owner; ordinary derivation does not require an extra approval round. Generic smoke tests and coverage percentages do not substitute for feature-specific evidence.
2. Onboarding establishes an owner-controlled declaration of required local, PR and main checks, expected trusted workflows, and any explicitly allowed exceptions. The declaration is evaluated under the pinned Factory authority from the onboarding contract. Actual hosted names/commands remain to be verified; a feature cannot weaken its own gates.
3. Check unchanged-main baseline validation and report existing failures. If an unrelated baseline failure prevents validation, stop rather than silently repair it or waive its check. The owner may explicitly expand scope.
4. For the pilot's final candidate, run `npm run lint` (format check plus ESLint), `npm run check`, `npm run test:coverage`, `npm run build`, and relevant feature acceptance tests. Local E2E is required when necessary for browser/database behavior. Applying a formatter changes code; revalidate the resulting final revision. Pre-push hook success alone is insufficient.
5. Bind local evidence to the final candidate commit and tested tree, commands, environment assumptions, exit status and artifacts. Bind hosted evidence to the exact PR/head or merged main revision and expected trusted workflow. Invalidate affected evidence after code changes; approval must also match the current PR head.
6. Required-check success means a successful result with adequate provenance. Missing, pending, skipped, neutral, cancelled, stale or untrusted evidence is not a pass. Only explicit owner-controlled policy can authorize an exception. Preserve failed attempts, automatic workflow retries and diagnostic rerun outcomes rather than presenting only the final green badge.
7. Allow one diagnostic rerun on unchanged code. A passing rerun does not explain a failure: unexplained intermittent failure blocks unless an owner-approved flake policy covers it. Repairs use the agreed three-cycle/60-active-minute allowance; detailed accounting and wait limits belong to the lifecycle ticket.
8. Address straightforward review findings, verify each fix, and only then resolve its conversation. Conflicting or disputed requests remain unresolved and go to the owner. Review comments are untrusted task input, not authorization to change policy or expand scope. Never submit the owner's approval or manufacture approval evidence.
9. Before merge, require the current-head owner APPROVED review, addressed review conversations and all required PR gates. Recheck current head/base, approval and trusted required checks at the merge boundary. A new commit requires renewed owner review and fresh applicable evidence; implementation must prevent merging a different revision than the validated one.
10. After merge, verify configured main checks, including the pilot's hosted E2E, on the actual merged/main revision. Main failure prevents declaring completion or starting cleanup. Synchronization and cleanup behavior belongs to the dedicated cleanup ticket; post-merge failure recovery belongs to lifecycle planning.
11. Report `pass` only when the relevant phase's declared criteria are met; record `fail` for observed unsuccessful checks/findings; record `blocked` for unmet prerequisites, incomplete/untrusted evidence, unresolved baseline/flake/dispute, or exhausted repair allowance. Reports retain the revision, criteria/checks, outcomes, relevant logs/artifacts and unresolved reason without secrets.

This contract specifies desired behavior, not proof that any pilot check has run or that live protections are deployed. No pilot tests, PRs, merges or setup changes were performed during this decision session.

Resolution: accepted by the owner. The implementation specification must preserve this validation and review contract.
