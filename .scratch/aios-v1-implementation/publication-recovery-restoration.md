# Publication recovery test restoration

The issue 14 test split reused the existing `publication-recovery.test.mjs`
filename and replaced its original tests. The initial report counted only five
standalone tests; three loops generated ten additional cases. This repair restores
all 15 scenarios across three uniquely named files, five cases per file, with the
original shared split-port fixture extracted into a helper. Existing issue 14
tests remain intact.

## Preservation audit

Baseline: `833ce7851cd897617d30d89204dd4624d7725e87`, main immediately
before PR #38. Run from the repository root:

```sh
node .scratch/aios-v1-implementation/publication-recovery-restoration-audit.mjs
```

- All 57 other original test/helper files match the baseline byte-for-byte.
- The original publication suite's 15 standalone tests, seven authority cases
  and twelve signature/remote evidence inputs are retained.
- Every original recovery statement and loop is restored; shared fixture and
  assertion bodies match apart from formatting and the helper's relative import.
- Missing original statements: zero. Changed original assertion bodies: zero.
- Focused restored suite: 15 passed, zero failures (22.8 seconds).
- Hosted full-suite validation is required on the published repair head.

Production code, coverage thresholds, approval rules, Windows shard count,
concurrency and all deadlines are unchanged. Native qualification and production
gates remain open as documented for issue 14.

## Hosted scheduling evidence

The first repair head passed all restored tests, Linux, macOS, coverage (after
one retained instrumentation diagnostic rerun), both approval gates and seven
Windows shards. Windows shard 1 passed all 61 assertions twice, but setup plus
562–581 seconds of tests exceeded the unchanged ten-minute total job budget.

Node assigns alphabetically discovered files modulo eight. Renamed the fast
publication port refusal file to `publication-remote-port-refusal.test.mjs`,
verified byte-for-byte unchanged against its parent. This moves the eight-case
remote evidence group from shard 1 to shard 8, the five-case current publication
recovery group from shard 8 to shard 7, and the fast port refusals from shard 7
to shard 1. All other assignments remain unchanged. No test count, assertion,
concurrency, shard count, production code, policy or deadline changed.

## Reviewed collector adoption

Factory PR #70 (`15ce04e0730e18b4c3bfd331972ebd1355e0535f`), authored by the Software Factory
bot and approved by the human owner in GitHub, bounds all collector Node test
invocations at four file workers. The public command regression failed before the
change and passed after it (2.3 seconds); all 14 coverage tests and typechecking
passed. Developer OS adopts that exact reviewed commit in its lock, reusable
validation/certification calls and approval-refresh tool pin. The independent
`FACTORY_DISTRIBUTION_REVISION` must select the same reviewed revision.

All test scenarios, 120-second governed command budgets, ten-minute Windows job
budgets, coverage thresholds, no-decrease enforcement and current human-review
requirements remain intact. Earlier failed instrumentation attempts remain in
GitHub. The within-suite concurrency experiment was reverted after negligible
improvement; restored assertion bodies are unchanged.

The human owner merged Factory PR #70 at `805c50d54254acd62e2f8f5aa78d0338b6346ce0`
and deleted its feature branch after all 13 PR checks passed. The merge commit
and approved head `15ce04e` have identical Git tree
`117c496643421c9e197e0160fe0cb30a710c06a7`; the merge signature is verified.
The final consumer pins and independent variable select that durable merged
revision. The previous in-flight consumer run retained an old approved-variable
value and its rerun could no longer resolve the deleted-branch workflow commit;
those attempts remain recorded.
