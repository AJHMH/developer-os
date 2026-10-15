# Windows qualification retrospective review

> Historical/design artifact: statements below apply to the recorded investigation, proposal or revision. For implemented capabilities, later completion evidence and remaining production gates, see [implementation status](../../docs/implementation-status.md).


Reviewed against `1c0f61470ea008d7eff48b22f2923af8ccf4f0d7` on 12 October 2026.
Spec: `.scratch/windows-qualification-retro/spec.md`.

## Standards

Independent Standards review cleared the first corrective batch. Read-only macOS
inspection refuses missing helper deployment without compilation or writes.
Native isolation/Codex exception handlers freeze the first failure before cleanup;
synthetic generated-code checks preserve direct wait timeout classification through
successful and failing cleanup. No remaining blocking findings or baseline smells.

## Spec

Independent Spec review cleared the retained-online-session assertion gap.
Completion now requires current and archived offline/online sessions stopped.
All six approved items are implemented; planning, separate approvals, script
integrity, fail-fast sequencing, shared locks and production refusal remain intact.
No remaining corrective findings.

## Validation

- `npm run typecheck`: passed.
- `npm run format:check`: passed.
- `git diff --cached --check`: passed.
- Focused auth/native-platform/completion tests: 19 passed.
- Final `npm test` on Windows: 186 tests, 185 passed, one macOS-only ACL
  observation skipped, zero failures. Generated Python management regression ran
  with the bundled Python runtime via `AIOS_TEST_PYTHON`.
- Windows CI matrix configured; hosted CI has not run for this unpushed change.

Only synthetic accounts, fake process/host adapters and fixed child scripts were
used. No owner credential reads, native VM acceptance, refresh or inference.
Native source/policy bindings changed: ticket 24 receipts remain historical, and
fresh owner-authorized enrollment/acceptance is required for this build.
Production remains disabled. One corrective review batch; zero open findings per
axis. Commit on the existing branch; publication and merge remain separate.
