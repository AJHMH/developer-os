# Job inventory during rerun transition

Status: resolved

PR #19 head aecd79a approved by the owner triggered observer 38596020537 and worker 38596041217. Original Factory run 38595682394 advanced to attempt 2 through github-actions[bot]. First approval passed; second retained its old failure. Worker stopped about seven seconds after startup with only the first request recorded. A transient missing target inventory is a hypothesis consistent with that immediate read-side failure, not independently observed historical REST data.

A public CLI regression reproduces that partial report by temporarily omitting job entries after successful POST. The fix tolerates missing entries only after its own successful request, within the unchanged wait budget. Both exact current-attempt jobs must be completed before another request; duplicate or invalid metadata still blocks.

- [x] Reproducing test fails before fix
- [x] Temporary-gap and permanent-gap tests pass after fix (53 refresh tests)
- [x] Full suite and independent review: 280 tests, 278 passed, two platform skips; AIOS_TEST_PYTHON=/usr/bin/python3. Formatting passes.
- [x] Repair published and merged after current-head human approval
- [x] Fresh hosted proof of both automatic checks and stale approval rejection

## Comments

Completed on 2026-10-14. [Hosted validation receipt](../hosted-validation-20261014.md) records App merges in PRs #16, #18 and #20, both automatic job refreshes on PR #21, stale-approval rejection, and probe cleanup. The probe was approved before its initial jobs finished; the receipt preserves that limit.
