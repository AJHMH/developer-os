# Ticket 08 implementation receipt

Date: 2026-10-14. Base: 5717dff9a149c432f9f5272daf42469520805ccd.
Branch: codex/ticket08-signed-publication.

Implemented the controlled signed-publication slice through public
publishFeature and reconcilePublication operations. Admission binds the exact
validated candidate, Git tree, source parent, policy and validation environment.
Separate Git and App ports enforce signing/push identity, PR author, sole eligible
approver and scoped authority. Durable intent precedes every effect; uncertain
acceptance requires observation and proven quiescence before retry. Execution
identities prevent a stale publisher from changing a newer publication run.
See [signed publication](../../docs/signed-publication.md) for the contract.

## Validation

- npm run typecheck: passed.
- npm run format:check: passed.
- node --test tests/publication.test.mjs: 34 passed, zero failures.
- AIOS_TEST_PYTHON=/usr/bin/python3 caffeinate -is npm test: 407 total,
  405 passed, two platform-specific skips, zero failures (91.4 seconds).
- git diff --check: passed.
- All 21 retained local snapshots match the inventory SHA-256 hashes and remain
  untracked, unchanged and outside this commit.

Public tests cover exact-tree/signature/identity refusal, revoked authority,
restart and uncertain acceptance, wrong PR author, existing branch conflicts,
pause/cancel, concurrent callers, late callbacks, artifact/environment drift,
durable intent and CLI refusal without native integrations. A temporary generated
SSH key signs a real Git commit, independently verifies its signature and pushes
conditionally to a local bare remote. The source checkout remains unchanged.
GitHub signature, publisher and App observations are controlled fixture data.

## Standards review

Independent review found zero remaining hard violations or heuristic findings.
The identified stale-publisher race was fixed with persisted execution identity
and guarded final transitions; a public regression reproduces the overlapping
reconciliation and continuation window.

## Spec review

Independent review found zero remaining actionable findings for the controlled
slice. Native acceptance remains partial and explicitly open in the ticket.

## Remaining qualification

Native credential-bearing owner Git and scoped Factory App ports remain
unimplemented or unqualified. Both Windows and macOS require qualification of
secret handling, effective trusted Git configuration, conditional branch creation,
actual GitHub verified signatures, installation scope, PR reconciliation and crash
windows. No live GitHub writes, native production worker or provider inference
were performed. Remote CI/Factory coverage has not been evaluated for this branch.
Production delivery remains disabled pending host/repository qualification and
live pilot authorization.

## PR 30 follow-up

The first hosted run passed Linux/macOS and CodeQL, but Factory branch coverage
blocked publication (changed 86.6%, required 90%, with an overall decrease).
Windows reached its ten-minute job deadline without an assertion failure; its
publication file was interrupted. The Windows-only CI budget is now twenty minutes;
production observation deadlines and test-file concurrency remain unchanged.

Added public-controller coverage for split-port recovery of lost sign/push/PR
acceptance, quiescent retry, existing PR reuse, unknown pre/post-write observations,
independently changed signature/head evidence, mismatched repositories and pauses
at each adapter dispatch boundary. Shared fixture extraction preserves existing
behavior. No production code was changed.

Local full-suite coverage run: 419 tests, 417 passed, two platform skips, zero
failures (101.2 seconds). Three subsequently added dispatch-pause cases passed
separately. Both independent reviews found no remaining actionable issues after
correcting one public error-message assertion. Hosted coverage and Windows
completion still require verification on the updated head.
