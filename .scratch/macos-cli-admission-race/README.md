# Concurrent CLI admission baseline repair

Status: implementation and complete local validation pass; final-head hosted
validation and review remain required. The owner authorized this separate repair on
16 October 2026 after PR #52's macOS check failed. It does not resolve the
separate Linux runtime or Windows storage investigations, or qualify Issue 04.

## Failure and reproduction

[PR #52 macOS job 117150053624](https://github.com/AJHMH/developer-os/actions/runs/38953371587/job/117150053624)
failed `competing CLI processes admit exactly one owner for the same repository`:
a contender exited 1 with the fixed generic repository/state access error.
The run used macOS 26 arm64 and Node 24.21.0. Of 617 tests, 614 passed,
one failed and two existing platform cases skipped. All other PR #52 checks
completed successfully; its final approved head remains `6983850`.

No production or existing test changes in PR #52 caused this source difference:
its net diff only retains Linux diagnostics. The original generic CLI error
contains no underlying SQLite stack, so it cannot establish which storage
interleaving occurred on that host.

The original selected two-contender test passed 100 local repetitions. A bounded
synthetic public-CLI loop then reproduced a storage refusal with eight contenders
(attempt 75) and 32 contenders (attempt 35). A targeted trace reproduced it at
attempt 48 with 32 contenders: `deliveries.sqlite-wal` was a regular, non-symbolic
file whose stat reported zero links while SQLite removed it. Additional bounded
150-by-32 Node 24.15.0 and 100-by-32 Node 24.21.0 probes did not reproduce the
hosted generic error. These passing observations are preserved as limits, not
proof that the original refusal disappeared.

Two deterministic regressions replace dependence on lucky scheduling:

1. At the agreed public controller/filesystem seam, return a real unlinked-open
   inode observation during WAL admission. Before the fix, the second request
   fails ordinary-storage validation instead of queueing. This local refusal
   takes tens of milliseconds and matches the observed zero-link race.
2. At the public controller/native SQLite storage seam, interpose a real brief
   writer after migration commits but before journal configuration. SQLite
   returns `ERR_SQLITE_ERROR`, `errcode=5`, `database is locked`, despite the
   existing configured busy timeout. The CLI maps that native error to the
   hosted generic message. Before the fix the public controller regression
   fails; after it, the second request queues. This reproduces a concrete
   mechanism for the hosted symptom without claiming a retained historical
   stack that does not exist.

SQLite documents that WAL sidecars are removed by the last connection and that
its busy handler need not be called for every lock conflict:
[WAL behavior](https://www.sqlite.org/wal.html),
[busy handler](https://sqlite.org/c3ref/busy_handler.html).

## Repair and safety

Only a regular zero-link WAL/SHM observation receives one fresh stat. Absence
remains permitted for these disposable SQLite sidecars; any replacement must
pass the unchanged ordinary-file, symbolic-link and single-link checks.
A second ambiguous observation refuses. The main ledger receives no exception.

Journal-mode promotion now handles only SQLite's exact BUSY error within the
existing five-second lock budget. Its own bounded wait uses a monotonic deadline
and short sleeps; SQLite's internal wait is disabled only for that owned journal
operation to prevent nested waits from extending the budget. The original
5,000 ms busy timeout is restored on success or error. Other native SQLite and
unclassified storage errors immediately refuse. Full synchronous durability,
transactional repository ownership and fail-closed qualification remain intact.

The 13 new regression scenarios cover both successful interleavings, unsafe
replacement links/directories, repeated ambiguity, main-ledger refusal,
unclassified/read-only failures, persistent contention and a delayed BUSY result
that arrives after its original budget. Persistent contention refuses before
its six-second fixture writer releases; total test duration includes waiting for
that fixture to finish, not an increased production deadline.

Six zero-link inode scenarios explicitly skip Windows because their fixture
requires POSIX unlinked-open-inode semantics. The native hard-link/directory
refusals and all journal-wait scenarios execute on Windows too. Existing tests
and their assertions are unchanged. The deterministic tests use public delivery
results; their filesystem/native SQLite controls are external storage scheduling
and failure seams, not production-only test hooks.

## Evidence and remaining gates

- Original zero-link regression: failed before production changes, passed after.
- Real writer interposition: failed with native SQLite BUSY before the journal
  change, passed after; sustained contention still refuses within the original
  budget. A late BUSY result does not receive a new wait allowance.
- All 13 focused regressions pass locally. The 19 existing controls tests also
  passed in the earlier combined run, preserving one owner and queued followers.
- After the repair, 100 eight-contender cohorts passed under Node 24.21.0.
  This stress observation supplements the deterministic regressions; it is not
  causal proof by itself.
- Node 24.21.0 was obtained in a private temporary directory from the official
  distribution and verified against its published SHA256 list; no repository
  dependency or toolchain declaration changed.
- Temporary stack probes were confined to ignored compiled output or a private
  baseline copy. Rebuilding removed them; no debug instrumentation remains in
  production source, tests or compiled output.
- Initial two-axis review found zero Spec or hard Standards findings. One test
  readability finding replaced a negative duration sentinel with explicit named
  case data. All 13 scenarios passed again under Node 24.21.0 with their timings
  and assertions preserved. This adds no production behavior change.
- The first complete local invocation lacked sandbox loopback permission.
  An independent listener probe returned `EPERM` from `listen`; callback/expiry
  fixture failures made that invocation unsuitable for repository validation.
  Its output is retained at `/private/tmp/macos-admission-full-suite.log`.
  The uniquely verified temporary-Node runner and its descendants were stopped
  before the unchanged network-enabled invocation began. Those callback
  fixtures passed in the replacement invocation. No assertion was relaxed.
- Complete local validation with loopback permission passed on Node 24.21.0:
  630 tests, 628 passed, two existing platform skips, zero failures, in 305.205 s.
  Source production code matches reviewed commit `2d2d6de`; the named-case
  readability follow-up preserves the exact test timings/assertions and also
  passed all 13 focused cases. Final-head review and hosted checks remain
  required before readiness. Commits use the verified Software Factory App.
- Type checking, formatting and the original-test preservation audit pass. The
  sole test-tree change is the new 13-case file; all original tests are byte-for-
  byte unchanged. All 21 owner reports match their recorded SHA256 inventory.

The 21 preexisting owner reports must remain byte-identical. Main is still at
`04a911e`; neither this branch nor a successful local test changes main's checks.
Linux's retained allowance remains 40 active minutes/one diagnostic repair cycle;
Windows remains 24 active minutes. Charge this separate macOS repair 20 active
minutes and two repair cycles conservatively; initial implementation and CI waits
are excluded. Remaining macOS allowance: 40 active minutes or one cycle. The second cycle
addresses the review readability finding; the first covers the baseline repair.
