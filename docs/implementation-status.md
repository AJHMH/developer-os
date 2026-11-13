# Implementation status

Reconciled 10 November 2026 against main `86a93ed` and the Mac runs in the [v1 reconciliation](../.scratch/aios-v1-implementation/reconciliation-20261110.md), which gives the status of every v1 ticket and user story. The open v1 tickets are tracked in GitHub under [Spec: Finish Developer AIOS v1 on the Mac (#263)](https://github.com/AJHMH/developer-os/issues/263). This is an implementation reference for contributors and operators. Qualification receipts apply to their recorded source and host bindings; they do not qualify every later revision.

## Implemented and verified scope

| Area                                            | Implemented behavior                                                                                                                   | Evidence and limits                                                                                                                                                                                                                                                        |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Intake and controls (01–03)                     | Durable SQLite requests/status, onboarding snapshots, canonical ownership, queue and pause/cancel/recovery                             | [Ticket index](../.scratch/aios-v1-implementation/README.md); multiple state directories do not share authority                                                                                                                                                            |
| Fixed worker and subscription gates (18–23, 25) | Removed with Codex (#222): the fixed synthetic worker, its qualification, ChatGPT authentication, the usage gate and the online canary | Historical only: [21](../.scratch/aios-v1-implementation/issues/21-subscription-auth-mediation.md), [22](../.scratch/aios-v1-implementation/issues/22-online-access-usage-gate.md), [25 receipt](../.scratch/aios-v1-implementation/ticket25-macos-validation-20261013.md) |
| Feature candidate (05)                          | Criteria/clarification, clean source admission, feature branch, bounded coding and stopped-worker output admission                     | [Receipt](../.scratch/aios-v1-implementation/ticket05-implementation-receipt.md); native on the Mac through metered Claude Code ([CLI acceptance](feature-candidate.md))                                                                                                   |
| Validation and repair (06–07)                   | Baseline/candidate checks, revision-bound evidence, durable repair budgets and explicit extensions                                     | [Validation](isolated-validation.md), [repair](bounded-repair.md); controlled integrations                                                                                                                                                                                 |
| Publication and PR checks (08–09)               | Signed-publication orchestration, separate App PR authority, conditional reconciliation, trusted checks and bounded repair             | [Publication](signed-publication.md), [PR checks](trusted-pr-checks.md); native credential-bearing integrations absent                                                                                                                                                     |
| Review and merge (10–11)                        | Scoped review repair, exact-head owner approval, conditional merge and bounded base refresh                                            | [Review](review-owner-approval.md), [merge](conditional-merge.md); controlled integrations, no native GitHub execution                                                                                                                                                     |
| Main verification (12)                          | Actual merged/current-main linkage, trusted checks, persistent deadlines and recovery                                                  | [Receipt](../.scratch/aios-v1-implementation/ticket12-implementation-receipt.md); native observer absent                                                                                                                                                                   |
| Main synchronization (13)                       | Fresh verified target, conditional controlled fast-forward, durable intent and read-only reconciliation                                | [Contract](main-synchronization.md), [receipt](../.scratch/aios-v1-implementation/ticket13-implementation-receipt.md); native adapter absent, production disabled                                                                                                          |
| Cleanup and completion (14)                     | All-branch inventory, exact-tip eligibility, conditional deletion and independent recovery; fresh-main completion gate                 | [Contract](branch-cleanup.md), [receipt](../.scratch/aios-v1-implementation/ticket14-implementation-receipt.md); controlled scope only, native ports absent                                                                                                                |
| Factory adoption and approval refresh           | Pinned consumer workflows, native CI/CodeQL configuration, observer/resolver and original-job rerun worker                             | [Hosted refresh receipt](../.scratch/factory-approval-refresh/hosted-validation-20261014.md); adoption is distinct from retained certification                                                                                                                             |

## Remaining production gates

Natively on the Mac, a delivery runs from intake to a validated candidate: `start`, `plan-feature`, `validate-baseline`, a metered Claude Code `code-feature` turn and `validate-candidate`. The Claude Code worker qualification, the session acceptance and the metered CLI delivery acceptance all passed on the final guest; see [worker qualification](worker-qualification.md), [macOS worker qualification](macos-worker-qualification.md) and [feature candidate](feature-candidate.md).

Validation and repair (06 and 07, #265 and #266) are done natively: dependency installs with install scripts, a disposable PostgreSQL per E2E check and browser E2E checks in the admitted Playwright image passed on 11 November (#265, closed), and `repair-feature` repaired a failing candidate on Claude Code with its allowance and spend accounted ([repair receipt](../.scratch/aios-v1-implementation/ticket07-macos-repair-acceptance-receipt.md)).

Production delivery stays disabled. What remains, each as a GitHub ticket under #263:

- **Publication to cleanup (08 to 14, #267 to #273):** signed publication and the App PR, PR checks, review under the change gate, conditional merge, the main observer, main sync, and branch cleanup with the completion report. All are implemented and tested against test stand-ins. The native publisher's ports passed against a disposable repository on 11 November, with an owner-signed, GitHub-Verified commit and an App-authored PR ([receipt](../.scratch/aios-v1-implementation/ticket08-macos-publication-acceptance-receipt.md)), and `publish-feature` installs them. The native PR check monitor passed there on 12 November: a passing and a failing check of the trusted workflow, and a receipted rerun ([receipt](../.scratch/aios-v1-implementation/ticket09-macos-pr-checks-acceptance-receipt.md)). The native review adapter passed there on 12 November: an ungated head authorized without review, and a gated head authorized only by the owner's approval once the owner's marked finding was resolved ([receipt](../.scratch/aios-v1-implementation/ticket10-macos-review-acceptance-receipt.md)). The first real delivery then ran through the CLI on 12 November: Claude Code's change, validated, published as an App PR with an owner-signed commit, passed `pr-ci` and reached `ready-to-merge`, ungated ([receipt](../.scratch/aios-v1-implementation/first-real-delivery-receipt.md)). The CLI has no native adapter for merge onward.
- **Complete-controller qualification and the pilot (16 and 17, #274 and #275):** never run.

Factory certification remains open: the repository retains successful adoption/check evidence, but no successful certification receipt with matching producer, certificate and artifact/SBOM identities has been found. Current remote secrets, rules and approvals were not re-inspected.

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

Historical implementation receipts remain revision-specific records. Resolved wayfinder issues, completed early tickets and the completed Factory refresh issues retain their existing completion states. Current ticket states are in the [v1 reconciliation](../.scratch/aios-v1-implementation/reconciliation-20261110.md). The retrospective spec is now marked complete against its six-item review receipt.

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
