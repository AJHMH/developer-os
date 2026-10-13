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

## Third owner-approved Windows repair cycle

The owner authorized one further Windows-only repair cycle for the confirmed
thread/read persistence error. Diagnosis retained fixed error code/reason flags
and numeric cgroup task counters without raw errors, stderr or credential data.
The pinned public Codex artifact contains the matching unavailable-history-store
and SQLite initialization errors, and supports Tokio/Rayon thread configuration.
The pre-fix `probe-read-pids-v2` receipt records 32 tasks against the 32-task limit,
98 kernel task-limit hits and a history-read -32603 refusal. This demonstrates
resource pressure alongside the store refusal, not a direct SQLite internal trace.

Windows Codex subprocesses now receive exactly TOKIO_WORKER_THREADS=1 and
RAYON_NUM_THREADS=1. Their process-environment audit requires these values.
The 32-task ceiling, memory/network/credential restrictions, durable history,
exact-process crash, exact-thread resume and cleanup gates remain unchanged.
macOS receives neither new variable. The generated public-driver regression
exercises both launch branches and refuses unexpected credentials, altered thread
counts and missing capability. It passed with the bundled Python interpreter.

Fresh policy: offline-native-v3-0decfa9fc9d2f52da282e40cd68d77a3859fb1d62308d309bcc50bb44e921875,
external pins `pins-windows-ticket24-thread-budget-20261012.json`.
The source-bound native probe passed persistence, crash/resume with zero additional
inference requests, capability denials and zero worker/relay survivors. Its
persistence checkpoint records 29/32 tasks and two limit hits: pressure is reduced,
not eliminated. Earlier failed and passing diagnostics are retained; a passing
attempt alone does not erase intermittent failure evidence.

Typecheck, format check, build and diff whitespace checks passed. The sandboxed
full suite encountered EPERM protected-storage/temp-file errors. The unsandboxed
host suite passed 202 tests: 201 passed, zero failed, one platform-specific skip
(57.0 seconds), using synthetic accounts and fake child boundaries. Review:
Standards zero blocking findings, one minor duplication heuristic for persistence
reason labels; Spec zero corrective findings. Full Windows qualification remains
pending; production is disabled and no live inference/refresh/usage grant ran.

All six source-bound supplemental controls passed, including two independent
zero-process censuses. Final controller qualification/preparation also passed and
wrote fresh unapproved plan df296f65-5156-4c82-882f-fde2719cce09, expiring October 12
at 9:08 PM Central. The read-only auth status remains eligible. No live request or
approval consumption occurred. The old pre-sign-in proposal remains historical.

Prepared fresh-pinned capability/task/online harnesses and a hash-bound operator
manifest. They were syntax checked, but their remaining acceptance stages have
not executed. Next boundary: owner approval of the exact one-request plan and a
separate one-run synthetic unknown-usage allowance. Finish Windows capability,
fixed task, online access and aggregate stopped-session report before macOS handoff.
The owner-approved cycle produced a passing repair and is now recorded; any new
repair batch after a refusal needs an owner extension under CONTEXT.md.

### Approved inference execution refused before live authority

The owner approved exact plan df296f65-5156-4c82-882f-fde2719cce09 and separately
approved one fresh synthetic online allowance. Execution attempted once on the
unchanged source/pins. The credential-free preflight refused at codex-explicit-resume:
32/32 tasks, 29 task-limit hits, history-store error -32603. The original Codex
identity was gone (zero remaining), but replacement durable history was unavailable.
The Tokio/Rayon caps therefore do not establish reliable crash/resume qualification.
Prior passing observations remain preserved and are not promoted to completion.

The runner refused before approval consumption, credential access or gateway
construction; zero provider attempts occurred. The exact inference approval and
synthetic online allowance remain unconsumed. Capability, task and online stages
were not dispatched. Public delivery execution and all retained sessions/runs are
stopped. See ticket24-windows-thread-budget-execution-refusal.json and its full
public status receipt. Production remains disabled and no macOS work occurred.

This failed revalidation consumes the third owner-approved cycle. Under CONTEXT.md,
"Repair cycle": "An attempt to fix a batch of validation or review findings
followed by relevant revalidation." Further repair requires a new owner extension;
there is no automatic retry, inference or refresh. Any source/pin correction
invalidates this exact plan and requires fresh plan approval. Next repair should
measure the resumed process's task demand without raising the 32-task ceiling or
relaxing durable history, exact identity, credential isolation or cleanup checks.

## Fourth owner-approved Windows repair cycle

The owner approved one Windows-only cycle to measure and repair resumed app-server
task pressure, with no new inference, refresh, online allowance or macOS authority.
Diagnostic-only probes expose bounded task-category counts, not raw process names.
The original Codex crash left only two baseline worker tasks. A later failing
probe recorded 12 runtime tasks, ten SQLite tasks, eight other Codex tasks, zero
allocator tasks, 32 total tasks and 102 limit denials. Thus runtime pressure remains
without original-process leakage or allocator background threads.

Primary pinned sources: Codex rust-v0.161.0 arg0/src/lib.rs builds the default Tokio
runtime; state/src/sqlite.rs sets five writable connections per pool and exposes
only sqlite_home. Tokio Builder documents separate blocking-worker limits and a
ten-second idle lifetime. Sources:
https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/arg0/src/lib.rs
https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/state/src/sqlite.rs
https://docs.rs/tokio/latest/tokio/runtime/struct.Builder.html#method.thread_keep_alive

Added a Windows-only observed-headroom gate before thread/start and thread/resume.
It allows at most twelve seconds for total tasks <=26 and runtime tasks <=4 while
requiring the original 32-task limit. Persistent pressure refuses; macOS bypasses
this observation. No extra turn, binary replacement, disabled SQLite/history,
changed crash identities or relaxed cleanup was introduced. The generated public
regression failed before the gate, then passed recovery and persistent-pressure
cases with a fake clock. Numeric diagnostics refuse malformed counts/private names.

Fresh native revalidation pins were pins-windows-ticket24-task-headroom-20261012.json,
policy offline-native-v3-7152568ff8b2a5fc5f5065f8f5a3e72053615b6293bda2f3a8bc71e07d3e4727.
Revalidation reached saved-history verification and exact crash/resume, but refused
at codex-relay-revoke-denial: empty response, command exit255, 30/32 tasks and nine
limit hits. Original Codex tasks were gone (zero); post-crash tasks were two.
This is a failed repair revalidation, not qualification. See probe-task-headroom
receipt. No passing retry or further functional repair followed.

Standards review found missing public diagnostic-stage allowlisting. Both fixed
headroom stages were added, with a red-to-green public qualification regression
that retains counters and refuses live readiness/private fields. All ten admission
tests passed. This reporting correction changed source binding after the native
refusal; that receipt stays tied to its recorded pins and is not reclassified.
Typecheck, format check, build and diff checks passed. Final host suite: 204 tests,
203 passed, zero failed, one platform skip (56.3 seconds). An earlier full suite
before the reporting correction passed the same test count; its log is retained.

Independent read-only VM census observed zero running rootless and rootful
containers. No provider request, credential read, token refresh or approval
consumption occurred. The prior exact inference approval and online allowance
remain unused, but source drift invalidates the old plan. Its file was moved to
...gateway-inference-plan-unconsumed-before-task-headroom.json to prevent accidental
execution. No current exact plan or macOS handoff is ready; production is disabled.

The fourth cycle is consumed by failed native revalidation. Further functional
repair requires another owner extension under CONTEXT.md. The next repair should
address task headroom during post-resume relay denial requests; bounded readiness
before startup/resume alone is insufficient. Preserve the 32-task ceiling and
failures, and prepare a fresh exact plan only after stable source-bound controls.

Final independent review: Standards diagnostic integration finding resolved,
zero remaining hard breaches; minor existing vocabulary-duplication judgment only.
Spec zero corrective findings. Reviews confirmed the retained refusal is not
promoted to qualification after the reporting change.

### Fifth owner-approved Windows cycle: relay task headroom (2026-10-12)

The owner approved one Windows-only repair cycle for post-resume relay denial
checks. The existing observed headroom gate now runs before a request in the
Windows Codex worker while its child exists. It retains the 32-task ceiling,
12-second bounded wait, runtime/task thresholds, exact process identity, saved
history, empty-body HTTP 403 denial, revocation and cleanup checks. Peer requests,
pre-start requests and macOS retain their existing paths. No request retry was
added. A fixed codex-relay-task-budget failure stage is publicly allowlisted.

A generated-driver regression verifies the routing, original stage restoration
and refusal before subprocess execution. Targeted tests passed 15/15. Build,
typecheck, formatting and diff checks passed. Full synthetic host suite passed
203/204, zero failures, one platform skip (58.5 seconds).

Fresh pins: pins-windows-ticket24-relay-headroom-20261012.json; policy
 offline-native-v3-8bd17c91289ded04e8c484da20783c54b559f70c2d13c57debdd79091f267735.
The native protocol probe passed. All six native Windows controls passed:
ssh-gpg, github-binding, effective-mounts, repository-fencing, orphan-resume and
descendant-stop. All control censuses reported zero remaining processes and
productionEnabled=false. Separate Standards and Spec reviews found zero
corrective issues. Historical failed receipts remain bound to their original pins.

Host auth inspection found the token expired. The owner explicitly approved a
separate browser sign-in, which completed with Windows CurrentUser DPAPI storage.
The subsequent eligibility check passed without refresh or inference. No provider
request or inference/online approval consumption occurred in this repair cycle.
The old source-bound plan remains invalid and unconsumed. Final preparation and
fresh exact inference approval are separate; Windows completion and the macOS
handoff still require inference, public capability, synthetic task and online
qualification on these current bindings. Production remains disabled.

Final credential-free preparation passed on the same source/pins and produced
unapproved exact run 7012b784-d1e8-4b52-9190-f693e835849e, expiring October 12
at 9:46 PM Central. The relay-headroom plan permits exactly one fixed
 gpt-6.1-sol request, 30 seconds/64 KiB, no retry/refresh/paid fallback, unknown
usage only with owner approval. No live inference ran. Independent VM census
found zero running rootless and rootful containers; the acceptance lock released.
The prior online synthetic allowance is still unused. Await fresh exact-plan
approval before inference and subsequent Windows qualification stages.
