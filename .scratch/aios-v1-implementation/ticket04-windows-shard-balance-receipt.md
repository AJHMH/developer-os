# Issue 04: Windows shard headroom follow-up

Date: 16 October 2026. Starting main: `56ea963` (merged PR #44).
Branch: `codex/fix-ticket04-windows-shard-balance`.

## Failure and ranked explanations

Main run `38910573849`, attempt 1, cancelled Windows shard 2 at its unchanged
10-minute job limit; the required Windows aggregate correctly failed. No assertion
failure appeared before cancellation. Log retained at
`/private/tmp/pr44-main-windows-shard2.log`; hosted TAP artifact `12050344229`.
The identical PR #44 shard completed in 9m56s overall (test step 9m18s).
The earlier main `8b92f19` shard 2 also took 9m52s, while shard 3 took 5m38s.
One unchanged diagnostic rerun of the cancelled shard and aggregate was issued;
its original timeout remains retained regardless of retry outcome.

Ranked explanations were file-order workload concentration, runner-speed variation,
and a stalled child. Node's actual runner filters sorted discovery by
`index % total === shard - 1`; adding `coding-lifecycle.test.mjs` shifted every
later assignment. A local inventory differential reproduced that scheduling
change. This proves assignment drift, not Windows timing; hosted validation must
establish the candidate repair's actual result. Restoring the old grouping alone
would retain the earlier shard 2's inadequate headroom.

## Naming-only repair

- Move `coding-lifecycle.test.mjs` to `worker-coding-lifecycle.test.mjs`, after the
  previous inventory. The three new cases go to shard 1 without shifting the
  original files.
- Move `branch-cleanup-recovery.test.mjs` to
  `branch-cleanup-state-recovery.test.mjs`. This swaps only adjacent original
  slots: five cleanup recovery cases move from shard 2 to shard 3; three cleanup
  refusal cases move from shard 3 to shard 2.

All 65 test files preserve their exact bytes through the two path changes.
All 62 other pre-Issue-04-lifecycle file assignments remain unchanged. No assertion,
scenario, production code, CI workflow, concurrency, job count, timeout or coverage
rule is changed. The required aggregate still requires every shard to pass.
Independent file-content/shard audit:
`/private/tmp/ticket04-shard-balance-audit.json`.

## Verification

The two renamed files passed all eight tests (25.2 seconds). Formatting and
whitespace checks passed, and the content/shard audit passed. Production code already passed the full 566-test suite in PR #44 (564
passed, two platform skips). Hosted PR checks rerun the complete inventory on
all platforms with the new scheduling; no claim of native worker qualification
follows from this repair. Issue 04 remains open and production disabled.
