# Ticket 24: Windows qualification on main 1b5b545

Status: blocked at `codex-persistence-read-error`; no executable inference plan.
Windows only; not ready for macOS handoff. The first cycle's refusal below is
historical; see the separately approved second cycle at the end.

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

## Second owner-approved Windows repair cycle

Replaced Windows `podman exec killall` with the exported fixed trusted-management
helper in `src/windows-codex-crash.ts`. The caller validates the dedicated
container authority and cgroup. The helper opens exact pidfds, validates every
recorded start identity and cgroup before any signal, then sends SIGKILL to those
handles. Permission/API failure refuses without fallback. No exit 255 is
reclassified as success. Child status, original-identity disappearance, durable
history, exact-thread resume and final cleanup checks are unchanged. macOS keeps
its existing path.

The public helper fake-child regression passed changed identity, unrelated
cgroup, empty targets, invalid second target before signaling the first, and
permission-failure refusals, followed by exact-handle kill. This tests the
replacement mechanism; it does not establish the cause of the old exit 255.

Added fixed persistence read-error/thread/history substages and bounded HTTP
response byte count/status/command exit diagnostics. Public qualification keeps
live readiness false for all these refusal stages. No raw response body, stderr
or owner credential is retained. The initial diagnostic reached crash/resume
then refused at revoked-request denial. Three later diagnostic probes passed;
none erased earlier failures or established a persistence repair.

Final external pins: `pins-windows-ticket24-crash-fix-20261012.json`, policy
`offline-native-v3-0b0ad1d3389575c35df9b33d503552bc9cda2588715d84397e6f99efc369a9ee`.
The exact-crash native probe passed saved-history verification, crash/resume with
zero extra inference requests, revocation/expiry/quota/namespace/delivery checks
and zero remaining worker/relay processes. All six supplemental controls passed
on these same source pins, including the two independent zero-process censuses.
See `ticket24-windows-main-1b5b545-probe-crash-fix.json` and
`ticket24-windows-main-1b5b545-crash-controls-observation.json`.

Credential-free controller preparation then passed and wrote unapproved proposal
`4025392f-6da7-4463-a308-f7e40c145cf0`. The host access token is expired, so this
proposal must not execute. The owner separately approved a new browser sign-in;
its consent completed, returning the same verified account and protected Windows
credential. Read-only auth-status now reports eligible and valid for the inference
window. The old proposal was preserved before preparing a fresh exact plan.
Post-sign-in preparation refused at `codex-persistence-read-error` after 12,986 ms.
The recorded positive HTTP control was status 200, 2,239 bytes and command exit 0.
This identifies a protocol read error rather than a thread/history mismatch.
The delivery is stopped. See `ticket24-windows-crash-fix-post-sign-in-refusal.json`.
The old proposal was removed from the execution filename and retained as
`ticket24-windows-crash-fix-gateway-inference-plan-unapproved-pre-sign-in.json`;
it has no approval and must not execute. No current exact plan is ready.
No live request,
refresh, usage grant or production execution occurred. Production stays disabled.

Typecheck, format check and build passed. Final full suite: 201 tests, 200 passed,
0 failed, 1 platform-specific skip (57.4 seconds). Independent Standards and Spec
reviews each reported zero corrective findings. Windows authentication inference,
fresh synthetic online allowance, public capability, task and isolated validation
remain ahead; no macOS handoff or complete Ticket 24 claim is made.

The second cycle is consumed by this failed final preparation revalidation.
Further repair requires another owner extension. Next diagnosis should classify
the pinned Codex read error using fixed reason/code metadata, without retaining
raw protocol errors or weakening saved-history/crash checks. Passing attempts
remain scoped observations, not evidence that the intermittent persistence
failure has been resolved.
