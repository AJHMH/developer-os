# Implementation status

Reconciled 16 October 2026 through main `8b92f19` and retained repository evidence; controlled tickets 13 and 14 merged in PRs #37 and #38. PR #39 restored publication recovery scenarios and adopted reviewed Factory diagnostics/evidence reuse; all 24 main checks pass. This is an implementation reference for contributors and operators. Qualification receipts apply to their recorded source and host bindings; they do not qualify every later revision.

## Implemented and verified scope

| Area                                    | Implemented behavior                                                                                                          | Evidence and limits                                                                                                                                                                                                                                                     |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Intake and controls (01–03)             | Durable SQLite requests/status, onboarding snapshots, canonical ownership, queue, pause/cancel/recovery and usage approval    | [Ticket index](../.scratch/aios-v1-implementation/README.md); multiple state directories do not share authority                                                                                                                                                         |
| Offline worker (18–20, 23)              | Dedicated pinned Podman VM admission, ordinary-file canary transfer, positive-control denial, fencing and descendant recovery | Native fixed synthetic observations; [Windows](windows-worker-qualification.md) and [Mac](macos-worker-qualification.md) evidence are independent                                                                                                                       |
| Authentication and online gates (21–22) | Protected host auth, revocable model-only mediation, exact-run approval, usage/dependency/network gates                       | Implemented and demonstrated for fixed fixtures; [21](../.scratch/aios-v1-implementation/issues/21-subscription-auth-mediation.md), [22](../.scratch/aios-v1-implementation/issues/22-online-access-usage-gate.md); generalized production dispatch remains unqualified |
| Windows worker qualification (24)       | All nine report checks passed with independent shutdown assertion                                                             | [Final Windows report](../.scratch/aios-v1-implementation/ticket24-windows-relay-headroom-final-report.json); fixed worker scope, production disabled                                                                                                                   |
| Mac worker qualification (25)           | All nine report checks passed, including approved inference, fixed task and isolated validation                               | [Completion receipt](../.scratch/aios-v1-implementation/ticket25-macos-validation-20261013.md); fixed worker scope, production disabled                                                                                                                                 |
| Feature candidate (05)                  | Criteria/clarification, clean source admission, feature branch, bounded coding and stopped-worker output admission            | [Receipt](../.scratch/aios-v1-implementation/ticket05-implementation-receipt.md); controlled coding transport, native dependency remains open                                                                                                                           |
| Validation and repair (06–07)           | Baseline/candidate checks, revision-bound evidence, durable repair budgets and explicit extensions                            | [Validation](isolated-validation.md), [repair](bounded-repair.md); controlled integrations                                                                                                                                                                              |
| Publication and PR checks (08–09)       | Signed-publication orchestration, separate App PR authority, conditional reconciliation, trusted checks and bounded repair    | [Publication](signed-publication.md), [PR checks](trusted-pr-checks.md); native credential-bearing integrations absent                                                                                                                                                  |
| Review and merge (10–11)                | Scoped review repair, exact-head owner approval, conditional merge and bounded base refresh                                   | [Review](review-owner-approval.md), [merge](conditional-merge.md); controlled integrations, no native GitHub execution                                                                                                                                                  |
| Main verification (12)                  | Actual merged/current-main linkage, trusted checks, persistent deadlines and recovery                                         | [Receipt](../.scratch/aios-v1-implementation/ticket12-implementation-receipt.md); native observer absent                                                                                                                                                                |
| Main synchronization (13) | Fresh verified target, conditional controlled fast-forward, durable intent and read-only reconciliation | [Contract](main-synchronization.md), [receipt](../.scratch/aios-v1-implementation/ticket13-implementation-receipt.md); native adapter absent, production disabled |
| Cleanup and completion (14) | All-branch inventory, exact-tip eligibility, conditional deletion and independent recovery; fresh-main completion gate | [Contract](branch-cleanup.md), [receipt](../.scratch/aios-v1-implementation/ticket14-implementation-receipt.md); controlled scope only, native ports absent |
| Factory adoption and approval refresh   | Pinned consumer workflows, native CI/CodeQL configuration, observer/resolver and original-job rerun worker                    | [Hosted refresh receipt](../.scratch/factory-approval-refresh/hosted-validation-20261014.md); adoption is distinct from retained certification                                                                                                                          |

## Remaining production gates

Parent ticket 04 remains open for production admission. Its issue record now separates completed fixed-worker work from remaining implementation and native qualification; 02/03 are satisfied prerequisites. The merged first slice binds coding launch data across inspection before dispatch. The merged second slice preserves controller callbacks, owns prepared launch bytes/arguments and guards effect acceptance/checkpoints against drift. The third slice refreshes independent pins after shutdown and around collection, fencing uncertain shutdown and refusing collection drift. A separate offline native first-launch transport now stages plain files, launches pinned Codex, fences/stops the exact session and collects stable stopped output. It is not installed in the controller or qualified: production resume, model-only access, usage/dependency integration and independent native mount/timer/lifecycle qualification remain open. The offline transport now supports an explicitly named stopped predecessor and exact thread with fresh file admission and independent timers; changed-base resume, controller integration and real native resume qualification remain open. See the [resume receipt](../.scratch/aios-v1-implementation/ticket04-native-explicit-resume-receipt.md). See the [native transport receipt](../.scratch/aios-v1-implementation/ticket04-native-transport-receipt.md). A subsequent [offline lifecycle repair](../.scratch/aios-v1-implementation/ticket04-native-offline-lifecycle-receipt.md) addresses engine observation limits, lease renewal and repeated timer cleanup exposed by native macOS attempts; a bounded offline macOS checkpoint-stop/recovery/file-collection observation passed and qualification remains open. Passing fixed synthetic worker reports does not enable generalized coding or validate complete delivery. Tickets 05–14 contain implemented controlled slices; their native acceptance requirements remain open. Native feature planning/coding, validation, signing/publication, PR observation/review, conditional merge and main observation need trusted integrations and independent qualification.

Ticket 15 has started prerequisite assessment and explicit fixed-worker report scope; its complete-controller Windows acceptance remains blocked.

Ticket 13 now has controlled synchronization and read-only reconciliation with real temporary Git tests; its native adapter remains absent. Ticket 14 now implements controlled eligibility, conditional cleanup, independent recovery and completion; its native ports remain absent. Tickets 15–16 require later complete-controller Windows/macOS qualification. Ticket 17 requires the observed profile-page pilot after both pass. No current command completes that end-to-end workflow. Production remains disabled; do not reuse historical inference approvals.

Factory certification remains open: the repository retains successful adoption/check evidence, but this audit found no successful certification receipt with matching producer, certificate and artifact/SBOM identities. Current remote secrets, rules and approvals were not re-inspected. Historical missing-token or schema observations are not claims about current remote state.

## Architecture decisions

The earlier audit found no repository ADR records. The subsequently authorized
architecture refactor now records its module, CLI and deletion decisions in
[ADR 0001](adr/0001-architecture-module-boundaries.md). Historical runtime scope
remains in [CONTEXT](../CONTEXT.md), the [canonical specification](../.scratch/aios-feature-delivery/spec.md)
and [resolved runtime decision](../.scratch/aios-feature-delivery/issues/07-runtime-scope-revision.md).

## Reading historical material

Specifications describe the target contract; they are not completion receipts. Dated research, rejected prototypes, diagnostics and review logs preserve what was known at their recorded revision. Their old not-run/blocker statements must be read alongside this reference and later receipts. Existing agent skills and templates describe reusable workflows rather than repository implementation status.

## Markdown audit coverage

The audit covers root project documents, `docs/`, and Markdown under `.scratch/`. Reusable `.agents/skills/` documents and `AGENTS.md` remain unchanged because they specify agent workflows rather than implemented product capabilities. `docs/agents/` and `.scratch/setup-review/` retain their instruction/template role.

Historical implementation receipts remain revision-specific records. Resolved wayfinder issues, completed early tickets and the completed Factory refresh issues retain their existing completion states. Tickets 15–17 keep their unfinished states; tickets 13–14 record controlled implementation with native acceptance open. The Windows storage-startup diagnosis already records its successful same-source rerun and needs no new repair claim. The retrospective spec is now marked complete against its six-item review receipt.

The following historical/design documents have explicit pointers to the current implementation reference; their original evidence and rejected attempts are preserved:

- [.scratch/aios-feature-delivery/factory-evidence.md](../.scratch/aios-feature-delivery/factory-evidence.md)
- [.scratch/aios-feature-delivery/map.md](../.scratch/aios-feature-delivery/map.md)
- [.scratch/aios-feature-delivery/pilot-readiness.md](../.scratch/aios-feature-delivery/pilot-readiness.md)
- [.scratch/aios-feature-delivery/spec-draft.md](../.scratch/aios-feature-delivery/spec-draft.md)
- [.scratch/aios-feature-delivery/ticket-breakdown-draft.md](../.scratch/aios-feature-delivery/ticket-breakdown-draft.md)
- [.scratch/aios-feature-delivery/worker-isolation-research.md](../.scratch/aios-feature-delivery/worker-isolation-research.md)
- [.scratch/aios-v1-implementation/chatgpt-setup.md](../.scratch/aios-v1-implementation/chatgpt-setup.md)
- [.scratch/aios-v1-implementation/debug/completed-message-diagnosis.md](../.scratch/aios-v1-implementation/debug/completed-message-diagnosis.md)
- [.scratch/aios-v1-implementation/debug/completed-message-repair-plan.md](../.scratch/aios-v1-implementation/debug/completed-message-repair-plan.md)
- [.scratch/aios-v1-implementation/docker-mcp-support-request.md](../.scratch/aios-v1-implementation/docker-mcp-support-request.md)
- [.scratch/aios-v1-implementation/macos/code-review.md](../.scratch/aios-v1-implementation/macos/code-review.md)
- [.scratch/aios-v1-implementation/macos/local-only-review-20261014.md](../.scratch/aios-v1-implementation/macos/local-only-review-20261014.md)
- [.scratch/aios-v1-implementation/macos/refused-attempts.md](../.scratch/aios-v1-implementation/macos/refused-attempts.md)
- [.scratch/aios-v1-implementation/macos/retained-evidence-20261014.md](../.scratch/aios-v1-implementation/macos/retained-evidence-20261014.md)
- [.scratch/aios-v1-implementation/macos/ticket25-code-review.md](../.scratch/aios-v1-implementation/macos/ticket25-code-review.md)
- [.scratch/aios-v1-implementation/macos/ticket25-local-validation-history.md](../.scratch/aios-v1-implementation/macos/ticket25-local-validation-history.md)
- [.scratch/aios-v1-implementation/macos/untracked-cleanup-20261014.md](../.scratch/aios-v1-implementation/macos/untracked-cleanup-20261014.md)
- [.scratch/aios-v1-implementation/mcp-gateway-research.md](../.scratch/aios-v1-implementation/mcp-gateway-research.md)
- [.scratch/aios-v1-implementation/mcp-prototype-verdict.md](../.scratch/aios-v1-implementation/mcp-prototype-verdict.md)
- [.scratch/aios-v1-implementation/native-qualification-2026-10-07.md](../.scratch/aios-v1-implementation/native-qualification-2026-10-07.md)
- [.scratch/aios-v1-implementation/podman-owner-setup.md](../.scratch/aios-v1-implementation/podman-owner-setup.md)
- [.scratch/aios-v1-implementation/podman-prototype-progress.md](../.scratch/aios-v1-implementation/podman-prototype-progress.md)
- [.scratch/aios-v1-implementation/podman-ticket-proposal.md](../.scratch/aios-v1-implementation/podman-ticket-proposal.md)
- [.scratch/aios-v1-implementation/ticket21-broker-review.md](../.scratch/aios-v1-implementation/ticket21-broker-review.md)
- [.scratch/aios-v1-implementation/ticket21-endpoint-review.md](../.scratch/aios-v1-implementation/ticket21-endpoint-review.md)
- [.scratch/aios-v1-implementation/ticket21-gateway-review.md](../.scratch/aios-v1-implementation/ticket21-gateway-review.md)
- [.scratch/aios-v1-implementation/ticket21-host-identity-investigation.md](../.scratch/aios-v1-implementation/ticket21-host-identity-investigation.md)
- [.scratch/aios-v1-implementation/ticket21-inference-runbook.md](../.scratch/aios-v1-implementation/ticket21-inference-runbook.md)
- [.scratch/aios-v1-implementation/ticket21-public-capability.md](../.scratch/aios-v1-implementation/ticket21-public-capability.md)
- [.scratch/aios-v1-implementation/ticket21-relay-vm-review.md](../.scratch/aios-v1-implementation/ticket21-relay-vm-review.md)
- [.scratch/aios-v1-implementation/ticket22-public-access.md](../.scratch/aios-v1-implementation/ticket22-public-access.md)
- [.scratch/aios-v1-implementation/ticket24-pr-readiness.md](../.scratch/aios-v1-implementation/ticket24-pr-readiness.md)
- [.scratch/aios-v1-implementation/ticket24-qualification-report.md](../.scratch/aios-v1-implementation/ticket24-qualification-report.md)
- [.scratch/aios-v1-implementation/ticket24-windows-controls-review.md](../.scratch/aios-v1-implementation/ticket24-windows-controls-review.md)
- [.scratch/aios-v1-implementation/ticket24-windows-inference-review.md](../.scratch/aios-v1-implementation/ticket24-windows-inference-review.md)
- [.scratch/aios-v1-implementation/ticket24-windows-main-repair.md](../.scratch/aios-v1-implementation/ticket24-windows-main-repair.md)
- [.scratch/aios-v1-implementation/ticket24-windows-task-review.md](../.scratch/aios-v1-implementation/ticket24-windows-task-review.md)
- [.scratch/aios-v1-implementation/ticket4-review-validation.md](../.scratch/aios-v1-implementation/ticket4-review-validation.md)
- [.scratch/windows-qualification-retro/pr11-validation.md](../.scratch/windows-qualification-retro/pr11-validation.md)
- [.scratch/windows-qualification-retro/review.md](../.scratch/windows-qualification-retro/review.md)
- [AIOS-RESEARCH.md](../AIOS-RESEARCH.md)
- [claude-explanation.md](../claude-explanation.md)
- [copilot-explanation.md](../copilot-explanation.md)
- [gemini-explanation.md](../gemini-explanation.md)
