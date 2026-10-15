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
