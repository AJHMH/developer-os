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
