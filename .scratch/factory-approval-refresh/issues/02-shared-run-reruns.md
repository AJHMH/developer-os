# 02: Serialize shared consumer reruns and refresh attempt job IDs

Status: ready-for-agent

Source: hosted verification of issue 01, PR 17.

The read-only observer and trusted resolver succeeded. Apply requested original
human job 115933938654, then retained an unconfirmed request for sibling
115933938709. GitHub advanced run 38587627749 to attempt 2 and recreated both job
IDs; the sibling's current ID became 115936638745. The first refreshed approval
passed; the second remained failed. No approval, merge or bypass was fabricated.
[Retained worker failure](../hosted-partial-failure.log).

- [x] Public CLI/REST regression reproduces the exact partial failure.
- [x] Wait for the shared workflow and current attempt; re-resolve both target IDs.
- [x] Preserve head/base/review/permission checks before every dispatch.
- [x] Full validation and independent review: 278 tests, 276 passed, two skips; both review axes zero findings.
- [ ] Signed App repair PR with technical checks passing.
- [ ] Actual owner approval and guarded repair merge.
- [ ] Fresh hosted probe demonstrates both automatic checks and invalidation.

Repair cycle 1. The initial implementation's controlled fixtures omitted GitHub's
attempt-ID reassignment behavior; hosted evidence exposed it. Approval/check
waits are separate from active repair work.
