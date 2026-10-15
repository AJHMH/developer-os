# Ticket 10 implementation receipt

Date: 2026-10-14. Base: 2124bcfcd1282a7ce79a0ab795835b5087016a12.
Branch: codex/ticket10-review-owner-approval.

Implemented controlled review observation, scoped repair and verified conversation
resolution through the public delivery controller. Exact-head human owner reviews
are evaluated using trusted eligibility, permissions and PR author identity.
Approval reaches `ready-to-merge` without redundant chat authorization; actual
conditional merge is ticket 11. Approval waiting has no deadline or reminder loop.
See [review contract](../../docs/review-owner-approval.md).

Review repairs preserve the existing cumulative allowance, explicit worker session,
original publication and thread fingerprints. Successfully revalidated changed
output uses the existing signed conditional publication update. Conversation
resolution requires that exact repair's validation, published head, passing checks
and current trusted scope assessment. Durable intents and receipts reconcile
uncertain effects without repeated writes; read-only recovery remains possible
while paused/cancelled or after checks fail.

## Validation

- AIOS_TEST_PYTHON=/usr/bin/python3 caffeinate -is npm test: 466 total,
  464 passed, two platform-specific skips, zero failures (197.1 seconds), including
  all 17 new review tests and existing PR-check/publication/repair regressions.
- npm run typecheck: passed.
- npm run format:check: passed.
- git diff --check: passed.
- All 21 retained local snapshots match their inventory SHA-256 hashes; they remain
  untracked and outside this commit.

Focused public-controller tests cover eligible owner publication and review,
bot/self/stale/dismissed reviews, permission drift, required changes, incomplete
history, disputed scope, safe projected evidence, indefinite approval waiting,
repair/republication, restart, current-head invalidation, uncertain resolution,
quiescent retry, pause/fencing, changed thread content, concurrent observations,
reassessment at dispatch, future timestamps and CLI refusal without native ports.
Tests use the real ledger and temporary Git repositories with controlled external
adapters. Existing repair/publication tests retain their real signed Git coverage.

## Standards review

Independent review reports zero remaining hard violations or heuristic findings.
The identified stale-assessment dispatch and future-dated approval defects were
reproduced and fixed with public regressions. Dispatch now uses the current thread
assessment; malformed future approvals cannot become newest authority.

## Spec review

Independent review reports no remaining actionable findings for the controlled
slice. The owner-publication eligibility conflict was fixed: configured owner
signing/pushing is compatible with reviewing an App-authored PR when trusted
effective policy confirms eligibility. PR-author self-review is still rejected.

## Remaining qualification

Native GitHub review ports remain unimplemented or unqualified. Both Windows and
macOS need complete pagination/order/dismissal evidence, effective owner permission
and protection policy checks, independent scope assessment, thread fingerprints,
conditional resolution, credential isolation, clock behavior and uncertain-effect
recovery. Earlier worker, signer, publication and PR-check qualification gates
remain open. Native readiness is not inferred from controlled fixtures. No live
GitHub writes, owner-review submission, provider inference or production worker
runs were performed. Initial hosted Factory coverage timed out during head instrumentation; the
follow-up below addresses test scheduling and requires hosted confirmation. Production delivery remains disabled pending applicable qualification.

## PR 32 coverage follow-up

Factory run 38660011633 on 87ce111 failed before producing coverage percentages:
`head coverage instrumentation failed or timed out`. The pinned adapter limits
each instrumentation run to 60 seconds; the original Linux uninstrumented suite
already took 65.3 seconds. The 17 new review scenarios ran serially in one file.

Split those scenarios into approval/admission, repair, and resolution test files
with shared fixture builders. Every test body and assertion is unchanged; each
scenario retains its own temporary repository and ledger. Node can now schedule
the independent files concurrently. Production behavior, coverage thresholds,
exclusions and timeouts are unchanged.

- Full c8-instrumented suite: 466 total, 464 passed, two platform skips, zero
  failures (161.0 seconds on this Mac; hosted timing must be checked separately).
- Changed-source coverage against 2124bcf: 747/749 lines (99.7%) and 323/343
  branches (94.2%).
- Typecheck, build, formatting and diff whitespace checks passed.
- Independent Standards and Spec reviews found no actionable issues; all 17 test
  bodies were verified byte-for-byte unchanged after extraction.
- The 21 retained snapshots remain outside the change. Native qualification
  requirements above remain open.

## Windows CI sharding

The main Windows job took 18m28s before ticket 10; both PR 32 runs exceeded
its 20-minute limit. Focused Factory App diagnostic run 38664085816 passed all
17 review tests, taking 470.9 combined seconds across three isolated jobs.
Run 38664531332 measured 301 synchronous Git launches consuming 14.5 of
16.3 seconds in one review scenario. This is measured Git process overhead,
not evidence that Windows ACL helpers caused that scenario's cost.

The Windows workflow now runs Node's complete test discovery in four disjoint
built-in shards, each with a ten-minute job budget and two concurrent files.
Every shard retains install, typecheck, format and build checks. The exact required
check `Validate Developer OS CLI (Windows)` is an always-running aggregate that
passes only when every shard succeeds. Failed, cancelled or skipped dependencies
fail it. TAP logs are uploaded for each shard. Linux/macOS commands are unchanged.

Local validation ran all four exact shard commands: 466 tests total, 464 passed,
two platform skips, zero failures. Shards completed in 55.5, 127.8, 92.8 and
116.7 seconds on macOS. Workflow YAML parsed and the aggregate shell condition
rejected every non-success result. Independent Standards and Spec reviews found
no actionable findings and confirmed complete, disjoint Node test discovery.
Hosted Windows timing confirmation is required after publishing.

The separate expiry flake remains unproven: 15 focused Windows repetitions passed;
the concurrent diagnostic's background review process exceeded its wait, making
that load experiment inconclusive. No assertions, test exclusions, production
behavior, or coverage thresholds were changed. All 21 retained snapshots remain
outside this change. Native qualification requirements remain open.

## Remaining Factory timeout investigation

Factory run 38665403113 attempt 1 completed coverage measurements but its unit
prerequisite ended without an exit code; attempt 2 stopped during head
instrumentation. The pinned adapter applies a fixed 60-second budget to these
stages, separately from the contract's 120-second test-command budget.

A local full instrumented reproduction with a 60-second watchdog timed out.
The isolated PR-check file passed all 25 tests in 58.5 seconds under c8.
Redistributing its exact test definitions into observation, admission, repair
and deadline files reduced focused instrumented time to 40.7 seconds. All 19
top-level definitions (including the seven-case loop) retain identical hashes.
Fresh per-test repositories, clocks and adapters remain isolated.

The full post-change instrumented suite passes 466 tests total (464 passed,
two platform skips) in 163.5 seconds on this Mac. This is not a full-suite speedup
against the prior 161-second local result; hosted Factory confirmation is required.
Changed lines remain 747/749 (99.7%), branches 323/343 (94.2%). Formatting and
whitespace checks pass. Independent Standards and Spec reviews found no issues.
No source behavior, coverage exclusions, assertions or execution budgets changed.
The Windows workflow retains all discovered files automatically. The 21 snapshots
remain untracked and unchanged. Native qualification requirements remain open.
