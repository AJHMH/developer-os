# AIOS feature delivery — wayfinder map

Label: wayfinder:map
Status: resolved

## Destination

A buildable v1 specification for a local developer AIOS that carries a feature request through signed code, validated App-authored PRs, owner-approved merge, main verification and synchronization, and merged-branch cleanup.

## Notes

- Planning only: this map produces decisions, not implementation. When the route is clear, hand off to `/to-spec`, then `/to-tickets`, then `/implement`.
- Consult `/wayfinder`, `/grilling`, and `/domain-modeling` each session. Use `docs/agents/issue-tracker.md` for local ticket claims, blocking and resolutions. Resolve at most one non-research ticket per session.
- Agreed starting constraints, confirmed by the owner on 7 October 2026: personal repositories; local CLI receives repository path and written feature request, optionally linked to an issue; one owner is the human approver.
- Preserve Factory identity separation: configured Git identity pushes signed commits; Software Factory App authors PRs. The App PEM authenticates the App, not commit signing. Never read or copy secret contents into planning artifacts. Key material remains external under `D:/keystore`.
- Owner's current-head GitHub APPROVED review authorizes merge once all required gates pass. New commits require renewed approval. Do not submit human approval from agent credentials.
- Require configured local checks and required GitHub checks; correct review findings before resolving conversations. Repair limit: three cycles or 60 active repair minutes, whichever occurs first; initial implementation, CI/approval waits, pauses and downtime are excluded. Exhaustion produces an evidence-backed blocker report.
- After merge, configured checks on main must pass. Synchronize main without discarding local work. Delete only non-main branches whose work is merged; unmerged branches need a separate human decision.
- Sources: [AIOS research](../../AIOS-RESEARCH.md), [Factory integration evidence](factory-evidence.md), [domain glossary](../../CONTEXT.md). Recommendations in research are not accepted implementation decisions.
- Target-repository onboarding, real signing capability and deployed GitHub protections remain unverified. This planning session neither installs the App nor changes permissions, creates PRs, merges or deletes branches.

## Decisions so far

- [Reconsider the isolated worker runtime and qualification scope](issues/07-runtime-scope-revision.md): owner approved Podman-backed dedicated VMs as the candidate, Windows-first qualification, and separation of demonstrated offline feasibility from remaining production blockers; this supersedes the earlier Docker-specific candidate selection.

- [Choose the v1 execution foundation and specification boundary](issues/05-runtime-foundation.md): TypeScript CLI/SQLite controller, isolated Codex microVM worker, Windows/macOS host scope and mandatory qualification before pilot execution.

- [Investigate worker isolation on Windows and macOS](issues/06-worker-isolation.md): cited microVM candidate and fail-closed host acceptance matrix; owner selection and empirical readiness remain open.

- [Define delivery lifecycle, recovery and waiting behavior](issues/03-delivery-lifecycle.md): one active delivery per repository, durable recovery, bounded repairs and check waits, and owner-approved post-merge repair.

- [Define Factory onboarding and authority for personal repositories](issues/01-factory-onboarding.md): owner-approved onboarding contract for the profile-page pilot, pinned Factory authority and observed end-to-end acceptance.
- [Define validation and review evidence for feature delivery](issues/02-validation-review-contract.md): feature acceptance and trusted exact-revision checks, with explicit handling of baseline failures, flakes and review disputes.
- [Define main synchronization and branch-cleanup eligibility](issues/04-main-sync-cleanup.md): clean-main fast-forward, current-tip merge evidence, explicit retention exclusions and resumable cleanup.

## Not yet specified

None remaining for this planning destination. Exact version pins, adapter details and acceptance procedures belong in the implementation specification under the resolved contracts. Live readiness and enforcement must be demonstrated before execution, not assumed from research.

## Handoff

Published [Developer AIOS v1: owner-approved feature delivery](spec.md) with `ready-for-agent` status after owner confirmation of its public-controller testing seam. Continue with `/to-tickets` using this canonical specification; keep implementation tickets separate from the resolved decision tickets.

The owner has confirmed all planning contracts. Continue with `/to-spec` using the named decisions and linked evidence, then `/to-tickets` and `/implement`. Map resolution means the route to the specification is clear; it does not mean the runtime is built or the pilot is onboarded.

## Out of scope

- Implementing or deploying v1 during wayfinding.
- Shared-team and multi-user operation for v1.
- Approving PRs as the owner, bypassing repository protections, or merging without a current owner review.
- Automatically deleting unmerged branches or discarding local changes.
- General-purpose desktop automation, unrelated agent workloads, and distributed multi-agent infrastructure in this first feature-delivery specification.
