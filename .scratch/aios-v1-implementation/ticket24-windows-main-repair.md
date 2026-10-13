# Ticket 24: Windows qualification on main 1b5b545

Status: blocked. Windows only; not ready for macOS handoff.

The owner approved one additional Windows repair cycle. Its final native
revalidation refused at `codex-resume-persistence`; the cycle is consumed.
Further repair needs an owner extension under CONTEXT.md's repair budget.

## Confirmed correction

Relay subprocess stdout was buffered while readiness checks observed its OS
descriptor. A fixed fake child writing two frames together reproduced a stranded
second frame. Detaching only stdout on Windows fixes that mismatch without
changing buffered stdin writes, protocol limits, time limits or admission checks.

Regression: `windows-relay-framing-regression.mjs` exits 1 with
`secondFrameReady: false`; `--unbuffered` exits 0 with
`secondFrameReady: true`. Initial harness quoting/child-string mistakes were
corrected before these observations; those earlier failures are not red evidence.

New fixed allowlisted Windows revocation substages and a post-kill original-PID
census improve diagnostics. A failed kill still raises; disappearance alone does
not permit resume or admission. Two independent reviews found no outstanding
Standards or Spec findings in this correction.

Final typecheck, format check and build passed. Full synthetic test suite:
201 tests, 200 passed, 0 failed, 1 skipped (57.1 seconds). The native acceptance
failure below is separate and still blocks delivery.

## Retained native evidence

- `ticket24-windows-main-1b5b545-controls-observation.json`: all six supplemental
  controls passed on unchanged main; historical after source changes.
- `ticket24-windows-main-1b5b545-preparation-refusal.json`: preparation refused
  at general relay revocation before any live inference plan or provider request.
- `ticket24-windows-main-1b5b545-probe-diagnostic.json`: kill command exit 255.
- `ticket24-windows-main-1b5b545-probe-instrumented.json`: an instrumentation
  variable mistake was corrected; do not attribute this failure to the worker.
- `ticket24-windows-main-1b5b545-probe-instrumented-v2.json`: persistence refusal.
- `ticket24-windows-main-1b5b545-probe-instrumented-v3.json`: same diagnostic
  source passed once; this did not establish reliable qualification.
- `ticket24-windows-main-1b5b545-probe-relay-fix.json`: final repair source still
  refused at persistence (12,888 ms). This preserves the blocker.

Final external pins were enrolled separately as
`pins-windows-ticket24-relay-fix-20261012.json`, with policy version
`offline-native-v3-1bfa0789f6d68908479ee11a7829bfbd9bfa8f7b0bc63a92901c781ee6ba8a89`.
Original pins and receipts were preserved. Main-named preparation/acceptance
copies and their external manifest are historical and must be refreshed after
the remaining repair; they are not authorization or current-source evidence.

No owner credential read, live inference, token refresh, synthetic online usage
allowance, production execution or macOS qualification occurred in this cycle.
No current exact inference plan is ready. Earlier live approvals are not reusable.

## Next authorized boundary

First obtain another Windows-only repair cycle. Distinguish persistence protocol
error, thread-identity mismatch and missing saved history using bounded redacted
diagnostics; independently resolve the kill exit 255 without weakening verified
crash/census checks. Re-enroll fresh pins and validate the final source, including
all six supplemental controls. Only after credential-free preparation is stable,
complete separate browser sign-in, prepare a fresh exact inference plan and
request approval. A separate fresh synthetic online allowance is also required.
Finish Windows public qualification/task/isolated validation before macOS handoff.
