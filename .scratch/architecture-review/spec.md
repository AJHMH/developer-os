# Architecture review implementation

Status: ready-for-agent
Progress: completed

Implement all eleven candidates and cross-cutting recommendations from the
[retained review](source-review.md), as authorized on 17 October 2026. The review
is source evidence, not an instruction file. Existing Issue #4 work is preserved.

## Plan

Start with the usage gate (01), then centralize host facts (04) before unifying the
VM channel (02). Extract session lifecycle (03), named qualification rules (05),
account/vault/private storage (06), app-server client (07), inference contract
(08), ownership ledger (09), command table (10), and deletion/move decisions (11).
Finish remaining cross-cutting locality and navigation work (12). Each numbered
issue owns its completion evidence. Findings about the old snapshot are verified
against current source before implementation.

## Verification and recovery

Use public module behavior and existing controller/CLI tests. Gate tests inject a
clock; guest/channel tests use local Python and fake Podman; vault and app-server
tests use controlled adapters; ledger tests use real temporary SQLite. Run relevant
tests after each slice, then typecheck, formatting, tests and build once for the
integrated change. Additional checks follow changes/failures, not a clean merge.

Preserve durable delivery formats, fencing, shutdown verification, independent
approval and fail-closed qualification. Source-version changes invalidate retained
native evidence; green local tests never requalify live workers. Avoid paid calls,
VM execution and production enablement. Keep riskier extractions independently
reviewable so a failed phase can be reverted without discarding completed work or
owner files. Existing tests remain until replacement tests cover their observable
contracts; no assertion is weakened merely to get green checks.

## Tracker

One issue per recommendation is under `issues/`. `Status` uses repository triage
roles; `Progress` records implementation completion separately.

## Integrated validation

17 October 2026: All twelve items are implemented and local validation is green.

- `AIOS_TEST_PYTHON=/usr/bin/python3 npm test`: 732 tests, 729 passed, three
  platform-specific skips, zero failures/cancellations (307.18 seconds).
- `npm run typecheck`, `npm run format:check` and `npm run build`: passed.
- Strict unused-code check: passed. Static compiled runtime graph: 59 modules,
  zero import cycles.
- Graft build/check: passed. CI regenerates the ignored cache without an LLM/key.
- Final dispatch/channel/CLI slice: 59 passed; final qualification/controls/online
  slice: 75 passed. The complete final run above includes these tests.

An earlier inventory exposed a fixture that combined Windows with a Darwin
release. It now supplies the matching Windows release and passes. The shared
host rule remains strict. Tests use local processes, sockets and controlled
fakes. No live VM, OAuth or inference qualification was performed; Issue #4
work is preserved and old runtime source pins cannot qualify this implementation.

Host controls retain the conservative controller fingerprint because their
exercise still observes its phase/ownership guards. Online routing uses its
contract/lifecycle dependencies. See [ADR 0001](../../docs/adr/0001-architecture-module-boundaries.md)
for all retain/remove/move decisions.

Publication was authorized after the initial automatic-review refusal. PR #66
contains the verified App-authored implementation. Initial Linux/macOS CI and
Factory contract/security checks passed. Windows shards exposed two fixture
assumptions: simulated Mac executable paths were not resolved in the actual
runner's path domain, and Mac-target evidence fixtures skipped Windows storage
ownership setup. These fixtures now use the actual runner's canonical paths and
storage controls. Production guards are unchanged. Fresh CI is required after
these test corrections; any new head requires renewed owner review before merge.

The owner explicitly authorized publishing the fixture corrections and further CI fixes to PR #66. The same actual-runner storage correction applies to both online-access and subscription-decision fixtures.

PR #66 merged as `db34ae1e9b748ed77fefa511304b5a6e9a5a3906` while the
Windows failures remained. Its remote branch was deleted. Local main was
fast-forwarded to that merge without changing the primary checkout's unrelated
work. The correction is retained on `codex/architecture-windows-fixtures` for a
follow-up PR. All 37 affected local tests and formatting pass. No runtime source
or safety assertion was changed by the correction.
