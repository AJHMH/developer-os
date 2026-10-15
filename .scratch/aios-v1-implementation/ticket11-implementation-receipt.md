# Ticket #11 controlled implementation receipt

Implemented 14 October 2026 on `codex/ticket11-conditional-owner-merge`, starting
from merged main `3b7e2a56196f6c3f4db8c35a6f237c94c9899664` (PR #32).

## Behavior and evidence

The public controller now supports conditional merge, read-only reconciliation,
and advanced-main refresh through the cumulative repair allowance. Durable intent
precedes effects; accepted results retain exact head/base/merge/main linkage.
Unsupported conditions, revoked gates and uncertain effects block without bypass.
Advanced-main refresh validates the baseline and candidate inside isolation and
requires normal signed republication, fresh checks and renewed approval.
See [conditional merge contract](../../docs/conditional-merge.md).

Public tests demonstrated stale/dismissed review, unresolved conversations,
changed checks, head/base races before and after observation, protection and
permission revocation, pause/cancel fencing, lost receipts across ledger reopen,
quiescent absence, malformed linkage, changed adapter bindings, competing
controllers, unsafe local main, exhausted allowances and bounded refresh retry.
No test submits an actual GitHub approval or performs a native merge.

Red/green evidence includes the initially missing merge/refresh commands, then
review-discovered regressions: a late observation overwrote a newer merged outcome,
and coding failure after a passed refreshed baseline prevented retry. Both
regressions failed before correction and passed afterward. The fixture exercises
remote conditional rejection after observation independently from local dispatch
permission. The CLI aliases refuse native authority without an installed adapter.

## Validation

- `npm run typecheck`: passed.
- `npm run format:check` and `git diff --check`: passed.
- Focused merge/recovery/base-refresh tests: 17 passed, including the separate
  policy-revocation regression.
- Full instrumented suite with `AIOS_TEST_PYTHON=/usr/bin/python3` and synthetic
  localhost services permitted: 483 tests, 481 passed, two platform skips,
  zero failures, 191.9 seconds on this Mac.
- c8 global line coverage: 16,597/17,391 (95.43%); branches: 4,566/5,053 (90.36%).
- Factory-style changed-source metrics against the starting revision:
  lines 635/639 (99.37%); branches 243/259 (93.82%). These are local metrics,
  not hosted Factory gate results or proof of native qualification.
- Independent Standards review: two recovery findings corrected and re-reviewed;
  no remaining findings. CLI aliases simplified during review.
- Independent Spec review: effect-boundary race coverage added and re-reviewed;
  no remaining findings.
- All 21 retained local snapshots match the recorded SHA-256 inventory and remain
  untracked. No cleanup or live inference was performed.

The first full attempt ran with unsuitable environment settings: sandboxed
localhost services were unavailable and the existing management tests attempted
`python` (absent here) rather than `python3`. One remaining test process was
terminated before retry. A representative relay test failed under the sandbox
and passed outside it; the Python headroom test passed with the explicit
interpreter. The corrected full run passed without test/assertion changes.

## Remaining qualification

Windows/macOS native credential separation, repository authority, effective
protections, conditional head/base and gate enforcement at the actual remote
acceptance boundary, and read-only reconciliation need observed qualification.
The adapter must refuse APIs that cannot supply those semantics. Native execution
and pilot delivery remain disabled. Main checks, safe synchronization and eligible
branch cleanup are subsequent tickets; `merged` is not completed delivery.

## PR #33 Windows checkout correction

Hosted Windows shard 4 failed all three advanced-main tests in run 38674133512. Enabling `core.autocrlf=true` locally reproduced all three failures
at the initial merge gate: checkout changed the admitted LF file bytes to CRLF.
Pinning `core.autocrlf=false` only on the fixture checkout and fast-forward
commands made the same forced-CRLF invocation pass all three tests (14.4 seconds).
The fixture now explicitly enables Windows-style Git defaults on every host,
while its materialization commands preserve the admitted bytes. Production
source admission and all assertions remain unchanged.
