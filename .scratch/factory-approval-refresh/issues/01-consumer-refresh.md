# 01: Refresh existing consumer human-approval checks

Status: resolved

Source: [spec](../spec.md), user request and the Windows handoff's approval-refresh
finding. The handoff is context; the current user request authorizes this work.

- [x] Trusted observer/resolver/worker integration for the two existing jobs.
- [x] Authority, stale/replay/revocation and partial-failure public tests pass.
- [x] Workflow hardening and independent Standards/Spec reviews completed.
- [x] Signed Factory App PR with technical checks passing.
- [x] Bootstrap through actual current-head owner GitHub approval.
- [x] Hosted automatic refresh and invalidation verified on a disposable probe.

## Comments

Completed on 2026-10-14. [Hosted validation receipt](../hosted-validation-20261014.md) records App merges in PRs #16, #18 and #20, both automatic job refreshes on PR #21, stale-approval rejection, and probe cleanup. The probe was approved before its initial jobs finished; the receipt preserves that limit.
