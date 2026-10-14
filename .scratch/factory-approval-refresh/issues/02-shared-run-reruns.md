# 02: Serialize shared consumer reruns and refresh attempt job IDs

Status: resolved

Source: hosted verification of issue 01, PR 17.

The read-only observer and trusted resolver succeeded. Apply requested original
human job 115933938654, then retained an unconfirmed request for sibling 115933938709. GitHub advanced run 38587627749 to attempt 2 and recreated both job
IDs; the sibling's current ID became 115936638745. The first refreshed approval
passed; the second remained failed. No approval, merge or bypass was fabricated.
[Retained worker failure](../hosted-partial-failure.log).

- [x] Public CLI/REST regression reproduces the exact partial failure.
- [x] Wait for the shared workflow and current attempt; re-resolve both target IDs.
- [x] Preserve head/base/review/permission checks before every dispatch.
- [x] Full validation and independent review: 278 tests, 276 passed, two skips; both review axes zero findings.
- [x] Signed App repair PR with technical checks passing.
- [x] Actual owner approval and guarded repair merge.
- [x] Fresh hosted probe demonstrates both automatic checks and invalidation.

Repair cycle 1. The initial implementation's controlled fixtures omitted GitHub's
attempt-ID reassignment behavior; hosted evidence exposed it. Approval/check
waits are separate from active repair work.

## Comments

Completed on 2026-10-14. [Hosted validation receipt](../hosted-validation-20261014.md) records App merges in PRs #16, #18 and #20, both automatic job refreshes on PR #21, stale-approval rejection, and probe cleanup. The probe was approved before its initial jobs finished; the receipt preserves that limit.
