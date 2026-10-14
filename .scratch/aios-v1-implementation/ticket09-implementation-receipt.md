# Ticket 09 implementation receipt

Date: 2026-10-14. Base: 7f7657dd4e40db50361228189b7542b1d88fa7cb.
Branch: codex/ticket09-trusted-pr-checks.

Implemented the controlled trusted PR-check slice through public monitorPRChecks,
rerunPRCheck and repairPRChecks operations. Observations bind the exact published
head, PR identity, owner policy, publisher and workflow. Complete attempt history
retains failures and treats unexplained passing retries as flaky. Persisted CI
clocks and deadlines survive restart; one diagnostic rerun intent per head uses
bounded dispatch and explicit reconciliation. Trusted actionable failures enter
the existing cumulative repair and isolated validation loop. Changed repaired
output can update the same PR with a signed child commit and conditional branch
tip comparison. See [trusted PR checks](../../docs/trusted-pr-checks.md).

## Validation

- AIOS_TEST_PYTHON=/usr/bin/python3 caffeinate -is npm test: 447 total,
  445 passed, two platform-specific skips, zero failures (143.7 seconds).
  This includes all 25 new trusted PR-check tests and existing publication/repair
  regressions.

- npm run typecheck: passed.
- npm run format:check: passed.
- git diff --check: passed.
- All 21 retained local snapshots match the inventory SHA-256 hashes and remain
  untracked, unchanged and outside this commit.

Public tests cover exact-head success, publisher/workflow spoofing, missing and
non-success evidence, retry history, owner exceptions, default and declared
limits, stale concurrent observations, runtime drift, sanitized malformed fields,
CLI refusal, pause/cancel, restart and uncertain rerun recovery. A regression
reopens the ledger while timed-out rerun reconciliation is in flight and verifies
the durable timeout remains intact. Real temporary SSH-signed Git objects test
repair publication to the existing branch and PR. GitHub observations remain
controlled fixture data.

## Independent review

Standards review and Spec review report no remaining actionable findings for the
controlled slice. Review fixes preserve timeout evidence during reconciliation,
recheck runtime binding at dispatch, reject malformed timestamp fields and remove
a poll-count cutoff that could shorten an owner-declared deadline. Repair attempts
retain the hosted-check run identity to avoid replaying a successful repair batch.

## Remaining qualification

Native GitHub ports remain unimplemented or unqualified. Windows and macOS need
qualification of full pagination/attempt history, workflow and App provenance,
clock behavior, diagnostic rerun reconciliation, conditional branch updates,
credential isolation and interruption. Owner Git signing and App PR transport
retain ticket 08's qualification requirements. Review/approval, merge, main
verification and completion are later slices. No live GitHub writes, provider
inference or native production worker runs were performed. Hosted CI and Factory
coverage have not been evaluated for this branch. Production delivery remains
disabled pending host/repository qualification and live pilot authorization.
