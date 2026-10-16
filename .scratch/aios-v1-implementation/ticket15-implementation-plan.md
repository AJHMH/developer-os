# Ticket 15: complete-controller Windows qualification

Status: started; native acceptance blocked. Starting source: `c63ee3a`.

## Scope and first slice

[Issue 15](issues/15-windows-qualification.md) qualifies the whole delivery
controller, not the fixed synthetic worker. The approved specification is
[canonical feature delivery](../aios-feature-delivery/spec.md). Tests and native
acceptance use its owner-confirmed public delivery-controller command/observation
seam (7 October 2026); no new internal test interface is introduced.

The first slice makes existing `qualification-report` output explicitly identify
`scope: fixed-worker`. A controlled report, or a live report qualifying the
fixed task, cannot count as complete-controller acceptance. Reporting remains
read-only and `productionEnabled` remains false. Historical receipts are retained
as evidence for their recorded versions; the additive label does not renew them.

## Dependency assessment

Controlled synchronization merged in PR #37; controlled cleanup/completion merged
in PR #38; PR #39 restored overwritten recovery tests and adopted Factory
collection diagnostics/reuse. Main `c63ee3a` passes all 24 checks. Those checks
verify source and controlled behavior, not the native product integrations.

The current CLI supplies no native feature planner/coding, validation,
signing/publication, PR check/review, conditional merge, main observation,
synchronization or cleanup adapters. Their controlled implementations are in
`src/feature-candidate.ts`, `src/isolated-validation.ts`,
`src/publication-adapter.ts`, `src/pr-checks.ts`, `src/review.ts`,
`src/conditional-merge.ts`, `src/main-checks.ts`, `src/main-sync.ts` and
`src/branch-cleanup.ts`. `src/cli.ts` explicitly refuses the corresponding
commands when trusted authority is unavailable. Implementing a report cannot
supply that authority. Native acceptance in issues 05–14 must precede a positive
complete-controller run; issue 14 remains the immediate dependency.

## Windows acceptance matrix

Every row is currently **not-run** for complete-controller Windows qualification.
Use synthetic canaries, disposable repositories/resources and independent
management observations. A denial needs a reachable/readable positive control;
missing infrastructure is a blocker, never evidence of enforcement.

| Gate | Required observation | Invalid substitute |
| --- | --- | --- |
| Exact binding | Windows 11 x64 build, Hyper-V host/VM/image, Node, engine, worker/template and effective policy pins; changed binding refuses reuse | Installed help, old report or macOS evidence |
| Host and authority exclusion | Host files, ledger, helpers, signing/SSH sockets, management, host MCP/skills and cross-delivery canaries denied | Merely absent endpoints or real owner secrets |
| Network/authentication | Reachable synthetic controls; external model/dependency restrictions, bypass/redirect denial and protected host-only model mediation | Copying owner auth to worker or inferring denial from outage |
| Admission/import | Admitted ordinary files only, malicious config/dependency containment, stopped-worker collection and unsafe path rejection | Host execution of repository scripts |
| Complete validation | Baseline/candidate/repair plus disposable browser/database E2E inside the qualified VM | Fixed HTML task or generic CI smoke checks |
| Publication/review/merge | Native verified signing, separate App PR identity, fresh trusted checks and owner review, expected-head merge races | Controlled adapters, agent approval or direct-main repair |
| Main/sync/cleanup | Native merged-main evidence, dirty/divergent preservation, conditional sync/delete, protection/replay/worktree exclusions | Manual agent Git operations |
| Lifecycle/recovery | Descendant and orphan censuses, pause/cancel, exact-session resume, stale-controller fencing and interrupted-effect reconciliation | Last-session selection or mocked process observations |
| Evidence integrity | Exact source/tree, current binding/policy, trusted observer, timestamps, positive/negative results and failed attempts retained outside worker; canaries redacted | Worker-authored success or latest green badge |

## Execution order and stopping conditions

1. Complete native adapter prerequisites without changing their accepted
   controlled contracts or production gate. Pin the resulting source and build.
2. On the intended Windows host, independently inspect/enroll its current external
   bindings. Provisioning and any inference approval remain explicit owner actions;
   neither this ticket nor an old inference receipt grants those permissions.
3. Drive the public controller using real native adapters and synthetic adversarial
   probes. Retain receipts outside the worker, including effective configuration,
   forbidden-effect absence, positive controls and failure history.
4. Stop on an unknown effect, failed control, missing credentials/infrastructure,
   stale binding or failed prerequisite. Record blocked/not-run plus the exact
   next action. Never widen networking, substitute host execution or relax tests.
5. Reconcile evidence against every ticket criterion. Only a complete real Windows
   run can close issue 15; macOS issue 16 and the observed pilot 17 stay separate.

## Current evidence

This chat runs on Darwin arm64, OS release 27.2.0, Node v24.15.0. No Windows
complete-controller acceptance has run. The additive report-scope regression is
controlled behavior only. Fixed-worker runner `scripts/run-windows-qualification.mjs`
and `scripts/assert-windows-qualification.mjs` retain their existing limited scope;
they must not be relabeled as this ticket's complete acceptance runner.


## First-slice verification — 15 October 2026

- The new public-controller scope regression failed before implementation
  (`undefined` instead of `fixed-worker`) and passed afterward.
- The full suite passed with permitted local loopback access and
  `AIOS_TEST_PYTHON=/usr/bin/python3`: 553 tests, 551 passed, two platform skips,
  zero failures (396.2 seconds). This verifies controlled behavior, not Windows
  qualification. The log is local at `/private/tmp/ticket15-full-suite.log`.
- Build, typecheck, formatting and whitespace checks passed.
- An earlier sandboxed focused run could not open an existing synthetic service;
  it was stopped and is not represented as a passing run. The full permitted run
  covers that same test successfully. No assertion or network policy was weakened.
