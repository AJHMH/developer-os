# Python command-budget fixture diagnostics

Status: diagnostic-only change. The historical five-second failure remains
unexplained. Full declared-host validation passed and both review axes are clear. Issue 04's native
resume implementation is preserved separately and production remains disabled.

## Retained failure and scope

The explicit-resume candidate on parent `19cc1ca` failed full validation in the
unchanged `guest command budgets keep Mac scheduling bounded and Windows unchanged`
test at 5003.3 ms. Its subprocess has a 5000 ms deadline, but the original bounded
output lost assertion details and no native error/signal or stage was recorded.
No exact timeout signal or cause is inferred from duration alone. One unchanged
selected-test rerun passed in 52.7 ms, and unchanged main passed all four validation
stages. Neither passing observation explains the failed candidate or rules out
workload effects. The raw source-bound result remains at
`/private/tmp/issue04-explicit-resume-final-validation.json`; the unchanged-main
comparison is `/private/tmp/issue04-explicit-resume-main-comparison.json`.

The owner explicitly authorized a separate fixture investigation using the
remaining allowance. This branch starts at main and excludes all native resume
source/tests and issue-status changes. The existing private ledger is
`/private/tmp/issue04-native-timer-continuity-ledger`, scope
`python-command-budget-fixture`. Previous charges, failures and repair cycles are
retained. This is evidence collection, not a root-cause repair or flake waiver.

## Diagnostic boundary

The actual fixture emits a bounded `[python-command-budget]` diagnostic with
parent elapsed time, unchanged 5000 ms timeout, exit status, classified native
error/signal, timeout flag, stream byte counts and clipping flag. At most 4096
stderr bytes are parsed and at most 16 recognized milestones are retained.
Milestones distinguish interpreter readiness, imports, input read, AST parse,
Darwin/Windows checks and completion, with numeric interpreter-relative timing.
Unknown labels, raw stderr, program text, executable paths and environment values
are excluded. The failure assertion's message now contains that metadata instead
of raw stderr; its predicate and all Python/stdout assertions are unchanged.
The diagnostic is emitted at the actual test rather than only in the final
failure summary; external log collector retention limits still apply.

The tight observation command is:

```sh
AIOS_TEST_PYTHON=/usr/bin/python3 node --test --test-name-pattern='^guest command budgets keep Mac scheduling bounded and Windows unchanged$' tests/podman-platform.test.mjs
```

It currently passes; there is no fast reliable reproduction of the historical
failure. No startup, parsing or scheduling hypothesis is claimed proven.

## Controls and honest corrections

A new real test-CLI regression first failed because the original fixture emitted
no bounded metadata. It now observes all seven stages from real Python. Three
POSIX executable controls exercise missing interpreter, nonzero exit and a real
five-second timeout; original fixture failure assertions still reject them. The
healthy control runs cross-platform. POSIX shebang controls are explicitly
skipped on Windows. Each nested CLI has separate 15-second supervision, which
does not alter the actual subprocess's 5000 ms deadline. Temporary executables
are private to each test and removed afterward.

The first nested-CLI control inherited Node's test IPC context and emitted no
ordinary report; the controls now clear that context only for the separate CLI.
The first stage parser omitted digits and lost `win32-check`; the literal expected
stage sequence caught that, and the parser was corrected. An early-exit control
also produced `EPIPE` because it did not read the supplied stdin; that native
code is now classified, and the ordinary exit control drains input before exiting.
This explains the control behavior, not the historical failure. Temporary debug
probes were removed.

All five selected diagnostic tests pass. An initial whole-file run without required
host permissions failed three synthetic service/loopback cases and the separate
unchanged `generated native management freezes direct wait failures before
successful or failed cleanup` case at 5021 ms. That observation is retained at
`/private/tmp/python-command-budget-focused.txt`; no cause is claimed for the
latter Python result. No assertions, limits or production code were changed to
accommodate that run. Final full validation uses the declared trusted-host profile,
unchanged 600-second supervisor and a PID-bound awake assertion.


## Final declared-host validation

The typecheck, format check, full test suite and final build passed under the
unchanged 600-second macOS profile, with no timeout or termination failure. The
test file's SHA-256 remained unchanged before/after execution and matches the
[validation record](ticket04-python-command-budget-diagnostics-validation.json).
Bounded stdout was truncated, so no exact full-suite count is claimed. Both review
axes report zero actionable findings. A preservation audit confirms every other
prior test body remains unchanged and the target Python/status/stdout predicates
and 5000 ms timeout are retained. Production source is unchanged.

This passing observation verifies the diagnostic candidate only. It does not
explain either historical failure, erase the restricted-host attempt, waive any
gate or unblock/qualify the separate native resume implementation.
