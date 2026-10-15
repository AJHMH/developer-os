# Ticket 14 controlled implementation receipt

Date: 15 October 2026. Starting main: `833ce7851cd897617d30d89204dd4624d7725e87`
(merged PR #37). Branch: `codex/ticket14-eligible-cleanup`.

## Behavior

The public controller inventories all local/remote non-main tips, retains excluded
and unmerged branches, and records bounded integration evidence before requesting
conditional deletion. Exact-tip ancestry or complete unchanged-head PR linkage
is required. Unknown integration, ambiguous linkage or unsupported race control
blocks advancement. Local and remote outcomes remain independent across restart.

Each effect has durable intent and an independently observed outcome. Uncertain
operations prevent retry, synchronization and ownership release. Recovery revokes
old runner capabilities and never dispatches a deletion. Main/policy drift can
withhold completion without hiding a separately established deletion outcome.
Final completion requires fresh trusted main checks, safe alignment and complete
inventory with all eligible cleanup finished. Expected retention is not failure.

See [contract](../../docs/branch-cleanup.md) and
[issue](issues/14-eligible-cleanup-completion.md). The CLI exposes controlled
commands but installs no native cleanup adapter. Production remains disabled.

## Evidence boundary

Tests drive the public controller and real temporary working repositories/bare
remotes. Actual expected-old local reference deletion and remote lease-conditioned
delete reject races injected after inspection. Linked worktrees and ordinary
ancestry are real Git observations. PR squash/rebase linkage, effective repository
protections and operation quiescence are controlled trusted-port fixtures, not
native GitHub qualification. No repository development branch is deleted by the
implementation tests.

Initial active-worktree testing caught an incomplete fixture parser: trimming Git
output removed the final newline, so suffix matching missed the last worktree.
Exact line parsing now preserves that exclusion. The fixture explicitly prepares
per-worktree configuration so the existing synchronization guard can inspect it.
Recovery tests verify stale observations and interrupted runners cannot continue
later deletions. Original eligibility reasons/digests remain alongside outcomes.
Inventory regressions also exposed omitted-main and equivalent-name ambiguity;
the final guard requires both main tips and rejects case-folded/Unicode-equivalent
branch collisions before any deletion.

## Validation

- Full suite with `AIOS_TEST_PYTHON=/usr/bin/python3 npm test`: **543 tests, 541 passed, two platform skips, zero failures** (440.0 seconds). This run preceded the final inventory-only safeguards; the current affected suite below includes both new regressions and all cleanup scenarios.
- Final cleanup suite on current source: **26 passed, zero failures** (164.4 seconds), including actual local/remote conditional-deletion races, linked worktrees, stale recovery and inventory safeguards.
- Build, typecheck, formatting and `git diff --check`: passed.
- Missing-main and equivalent-name regressions failed before the safeguards; the corrected active-worktree cases separately passed before the final affected run.
- All 21 retained local-only snapshots match their original SHA-256 values and remain untracked, outside implementation changes.
- Logs are retained locally at `/private/tmp/ticket14-full-suite.log`, `/private/tmp/ticket14-final-focused.log`, `/private/tmp/ticket14-worktree.log` and `/private/tmp/ticket14-inventory-red.log`. Temporary logs are not permanent repository artifacts.
- Hosted CI, native Windows/macOS cleanup qualification and independent agent review have not run for this branch.

## Remaining qualification

Native Git/remote ports, credential/configuration isolation, effective protection
and replay rules, complete inventory/PR history, conditional acceptance races,
exclusive checkout/ref/worktree authority and bounded descendant quiescence still
need independent Windows/macOS qualification. Controlled completion is not
production readiness or the observed pilot. Parent 04 and native acceptance in
05–14 remain open; tickets 15–17 are separate unperformed gates.

## PR #38 coverage follow-up

The first hosted run passed the new-code threshold (254/280 branches, 90.71%) but
correctly refused the no-decrease gate: global branch coverage was 4,841/5,332
(90.79%), below baseline 4,610/5,076 (90.82%). The approval jobs failed during
that coverage prerequisite, before review evaluation. No approval rule or coverage
threshold was changed.

Added public-controller regressions for mismatched/unavailable canonical checkout,
untrusted PR linkage projection and unavailable post-effect/final inventories.
They verify branch preservation, private-diagnostic exclusion, durable uncertainty
and read-only reconciliation without repeated deletion. All three new tests pass
locally (14.9 seconds); production code is unchanged. Hosted validation remains
authoritative for the updated head.

## PR #38 bounded test scheduling

The test-only coverage follow-up passed hosted coverage, but its Factory contract
full test command reached the unchanged 120-second deadline. Native Linux passed
all 548 tests (545 passed, three platform skips) in 129.4 seconds. Windows shard 7
also reached its unchanged ten-minute deadline after passing assertions; the
11-case serial cleanup race file consumed about seven minutes by itself.

`npm test` now bounds test-file concurrency at four. Windows CI retains all eight
shards and its explicit two-file concurrency. The race cases are distributed into
smaller files with a shared fixture; all original race, inventory and CAS bodies
were verified unchanged ignoring formatting whitespace. All 13 relocated scenarios
pass locally (57.2 seconds). No assertions, inventory, production behavior,
coverage threshold or command/job deadline was weakened.

An exploratory local full run overlapped a macOS-recorded 124-second maintenance
sleep and failed the existing elapsed-time expiry assertion. That run was stopped
and retained at `/private/tmp/pr38-bounded-suite.log`; an unchanged sleep-protected
rerun uses the established `caffeinate -is` wrapper. This host interruption is not
represented as a product repair or a passing run. Hosted current-head results
remain authoritative for the scheduling change.

## PR #38 instrumented-test distribution

The bounded-concurrency head passed native Linux (all 548 tests; 82.9 seconds),
Factory contract testing (100.7 seconds under the unchanged 120-second budget),
dedicated coverage and trusted approval. The regular approval job separately
refused `head coverage instrumentation failed or timed out`; its retained artifact
contains no test failure detail. The pinned collector invokes Node directly and
does not use the npm script's concurrency flag.

Distributed the existing 34 publication scenarios across smaller files, extracting
only their shared assertion body. All original authority, signature, remote/PR
metadata and static scenario bodies are retained; focused validation passes all
34 tests (40.9 seconds). No production code, test assertions, coverage policy or
instrumentation budget changed. The complete sleep-protected local suite passed
548 tests (546 passed, two platform skips) before this layout-only change; the
focused run verifies every relocated publication scenario. Hosted current-head
validation remains authoritative.
