# 17: Demonstrate an observed profile-page pilot delivery

**What to build:** One owner-agreed small feature in AJHMH/profile-page completes the actual end-to-end workflow with an evidence bundle, after both hosts and the pilot repository are qualified.

**Blocked by:** 15: [Qualify the complete controller boundary on Windows](15-windows-qualification.md); 16: [Qualify the complete controller boundary on macOS](16-macos-qualification.md).

**Status:** ready-for-agent

## Source and governing contract

Read the [approved canonical specification](../../aios-feature-delivery/spec.md) before implementation. User-story coverage: 1, 24, 27, 39, 49. Use the domain glossary and approved public-controller command/observation testing boundary; assert visible behavior and permitted/forbidden effects rather than implementation internals.

This is an implementation slice, separate from resolved wayfinder decisions. Unimplemented or unqualified phases remain blocked. Controlled adapters and temporary repositories demonstrate behavior before real host/repository qualification; they do not establish live readiness. Preserve existing user material, authority boundaries and credentials. Do not enable live pilot delivery before all qualification prerequisites pass.

## Current evidence reconciliation — 15 October 2026

Complete-controller/pilot acceptance has not run. Fixed worker qualification in tickets 24–25 does not satisfy this ticket. Dependencies remain enforced; ready-for-agent describes specification readiness, not permission to skip upstream gates.

## Acceptance criteria

- [ ] Confirm intended canonical repository/default branch, live App scope/author, effective protections/check names, trusted policy and working signed identities before any pilot write; missing prerequisites stop with an onboarding checklist.
- [ ] Agree the small pilot feature at intake and record observable acceptance plus relevant verification; do not substitute generic smoke/component tests for the demonstration.
- [ ] Observe signed branch publication, App-authored PR, required local/PR checks, verified review fixes if needed and the sole owner's actual current-head approval.
- [ ] Observe conditional approved-head merge, configured main checks including E2E, safe local/remote main alignment and eligible cleanup/retention.
- [ ] The report links revisions, signature/PR/review/check evidence, phase results, allowance usage and cleanup outcomes without secrets; a blocker is not represented as completion.
- [ ] Relevant independent Windows and macOS qualification evidence remains valid; no weaker execution fallback or host inference is accepted.
- [ ] Interrupted/failed live outcomes preserve state and use the existing reconciliation/blocker behavior; no unapproved main repair, policy bypass or production-test credentials.

