# Ticket 05 implementation receipt

Implemented against main revision `94b713f420c7d52eccce6ae4d3d43922b1124fae` on macOS arm64.

The public controller now plans observable criteria, records owner clarifications, admits clean source into a separate feature branch, drives pinned noninteractive start/resume sessions, checkpoints active coding time and requires an explicit extension after exhaustion. Output is admitted only after matching descendant shutdown and a complete stable ordinary-file inventory. Candidate identity and source/policy/CLI provenance are retained; candidate validation remains `not-run`.

The executable adapter decodes bounded fragmented JSON, checks independently measured pins and validates session/event/exit identity. Its isolated-management transport is controlled only. No actual native coding CLI, provider inference, repository validation script, signing or publication ran in this task. Dependency 04, actual native CLI compatibility and later native controller qualification remain open; production delivery stays disabled.

## Validation

- Focused public-controller regressions: 23 passed, 0 failed. Tests use real temporary Git repositories and ledger reopening, with controlled external adapters.
- Full suite: 303 tests; 301 passed, 2 platform-dependent tests skipped, 0 failed. Command: `AIOS_TEST_PYTHON=/usr/bin/python3 caffeinate -is npm test`.
- Typechecking, build, formatting and diff whitespace checks passed.
- All 21 pre-existing local-only state/readiness snapshots match the retained inventory SHA-256 values. They remain untracked and unchanged.
- [Structured results](ticket05-validation.json) include hashes of local focused/full logs. The local logs live in `/private/tmp`; hashes identify this run rather than guarantee indefinite log retention.

## Standards

Independent review found and verified fixes for worktree-config filters executing on the host and concurrent clarifications overwriting an already retained answer. Regression tests reproduced each failure before the fixes. Final review reports 0 hard standards breaches and 0 heuristic findings, including final canonical-path collision and runtime-mode guards.

## Spec

Independent review found and verified a fix for changed worker binding acknowledging shutdown of an older session. Regression coverage demonstrates refusal after binding drift. Final review reports 0 remaining actionable implementation findings. Actual native CLI compatibility remains an explicitly open acceptance requirement; controlled tests establish the adapter contract only.

Final review: Standards 0 findings; Spec 0 actionable code findings, with native qualification still open.

## PR 27 CI follow-up

The initial Windows run refused ordinary source repositories because Git reports forward-slash worktree roots while Node uses native separators. Root comparison now resolves both paths before case normalization; an equivalent-path regression reproduced the refusal before the fix. Native Windows CI remains the authoritative cross-platform confirmation.

Factory coverage also rejected the initial slice: changed branch coverage was 74.52%, and global coverage decreased. Added behavioral regressions for planner failure/authority drift, malformed and cross-session CLI events, unsupported controls, coding clocks, cancellation/recovery, and collection-time source/branch/policy drift. No thresholds or exclusions were weakened.

After the fixes, the instrumented local full suite passes 322 tests with 2 Windows-specific skips and 0 failures. Local c8 totals: lines 95.08%, branches 89.31%; changed-source comparison reports 425/454 branches covered (93.61%). GitHub Factory evaluation remains authoritative. Typecheck and formatting are checked before publication. These results supersede the initial implementation test counts above; native qualification requirements are unchanged.

The next Windows run showed that separator normalization alone was insufficient: the direct source-admission regression still reported a changed root. Root comparison now uses filesystem canonical paths on both sides to handle Git/native aliases; ordinary-entry checks still reject linked workspaces. A new regression verifies that resolving identity does not admit a linked workspace. The same run also repeated existing Windows PowerShell storage-helper failures at approximately 15 seconds under concurrent test-file load. Windows CI now bounds test-file concurrency to two, preserving all tests and production timeout limits. Native CI must confirm both corrections before merge.
