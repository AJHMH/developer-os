# Issue 04: shutdown and collection binding

Date: 16 October 2026. Branch: `codex/ticket04-worker-lifecycle-bindings`.
Starting main: `8b92f19e2cbcf90b43dd24aaad12deb6a2f99247` (merged PR #43).

## Baseline

Local main was fast-forwarded to the exact GitHub merge revision. All 24 active
hosted main checks passed on the first attempt; conditional certification was
skipped. No owner snapshots were removed or staged.

## Implemented behavior

The controlled pinned coding adapter always attempts exact-session shutdown,
including when execution pins have changed. It then requests a fresh independent
pin observation before trusting the shutdown receipt. Missing, changed or failed
observations leave controller shutdown uncertain; import, ownership release and
coding redispatch remain blocked. Exact-session recovery can observe shutdown
again without re-executing work or automatically collecting output.

Collection refreshes independent executable/policy/host pins both before its
management call and after the awaited response. Drift before collection refuses
that call; drift during collection prevents candidate admission. Management calls
receive frozen copies of their session identity. The transport still owns actual
native process census and safe stopped-worker file collection; these checks do
not qualify a native worker or grant model access.

## Evidence

Three public-controller regressions each failed before their safeguard:

- Changed host binding during shutdown was accepted as stopped. It now remains
  uncertain, refuses release/redispatch/import, and reconciles the same operation
  and fence after bindings are restored, with only one coding execution.
- Policy drift after the shutdown observation still reached collection. It now
  refuses before collection dispatch.
- Executable drift during asynchronous collection admitted output. It now refuses
  candidate admission.

Existing launch-only mutation fixtures are scoped to launch requests so new
lifecycle-only observations do not reinject launch faults or recursively pause.
Their existing assertions remain. The persistent executable-mismatch regression
now additionally expects uncertain shutdown and its blocker, a stricter result
because independent management pins remain mismatched. No test scenarios removed. A TypeScript AST inventory compared all 64 existing
test files against `8b92f19`: all 421 existing test declarations/titles remain,
with three new lifecycle declarations. The local audit is
`/private/tmp/ticket04-lifecycle-test-inventory.json` (no missing declarations).

Focused verification passed 59 tests across lifecycle, feature-candidate and
baseline-refresh suites. Build, typecheck, formatting and whitespace checks passed.
The first full run inside Codex's restricted sandbox could not open synthetic
callback/canary listeners. The unchanged callback regression passed outside the
sandbox with loopback access; the full suite is repeated with the same access.
The restricted-run log is retained at
`/private/tmp/ticket04-lifecycle-full-suite.log`. The permitted full suite passed 566 tests: 564 passed, two platform skips,
zero failures (350.9 seconds). Its retained log is
`/private/tmp/ticket04-lifecycle-full-permitted.log`.

## Remaining Issue 04 work

The generic native Codex/Podman transport, general model-session access/usage
controls, dependency/execution/collection integration and native lifecycle/orphan
recovery remain open. Fresh independent Windows Hyper-V and macOS AppleHV
qualification is still required. Fixed-worker receipts do not qualify this slice;
production dispatch remains disabled.
