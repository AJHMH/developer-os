# Ticket 25 macOS worker validation — completed 14 October 2026

> Historical/design artifact: statements below apply to the recorded investigation, proposal or revision. For implemented capabilities, later completion evidence and remaining production gates, see [implementation status](../../../docs/implementation-status.md).


Status: VERIFIED. The public Mac assertion passes all nine live checks with
`outcome: qualified`, no blockers and `productionEnabled: false`.
Validated the local repaired source based on PR 13 merge
`02c11ac49be5ea41be2ee9f6d1b8f36b7723c810`; changes remain uncommitted.
Windows receipts were not inherited.

## Final results

- Darwin arm64, explicit rootless AppleHV, Podman engine 6.1.3; dedicated VM
  configuration: 2 CPUs, 3 GiB memory, 20 GiB disk. Fresh source/VM policy:
  `/Users/aaronhoward/.developer-os/ticket4-macos/pins-ticket25-memory-3072-20261014.json`.
- All nine checks passed: host binding, offline transfer, adversarial isolation,
  online policy, authentication, usage gate, fencing/recovery, synthetic task
  and isolated validation. [Final public report](macos/ticket25-final-qualified-report.json).
- Owner-approved real inference `71c3b80f-9874-4c01-b86c-ef7bc9205091`
  completed through actual Codex and host-only subscription gateway. One fixed
  provider request; explicit crash/resume used zero additional inference
  requests. The gateway was revoked and the approval durably consumed.
- Separately approved VM-local online run `29df18b4-761a-4619-a3eb-f80f78ae51c8`
  passed model/dependency/bypass enforcement and its one-run unknown-usage gate.
  The fixed HTML task passed negative script and loopback HTTP validation inside
  isolation, followed by verified shutdown and safe collection.
- Final assertion verified 46 retained worker sessions and 11 online runs are
  stopped. Independent rootless and rootful running-container censuses are empty.
  The dedicated VM was then stopped and the temporary keep-awake assertion released.
- Host suite: 225 tests, 223 passed, zero failed, two Windows-only skips. Build,
  typecheck, formatting and diff checks passed. Both review axes found zero
  outstanding issues across the implementation and focused repairs.

## Scope and limits

This qualifies the fixed synthetic Mac worker slice. Production delivery stays
disabled; ticket 16 remains the later complete-controller/pilot qualification.
The real inference approval grants no further authority. Credentials stay in
host Keychain and trusted host memory; no refresh or paid fallback was used.
An intermediate credential-free Codex resume hit the unchanged 32-task ceiling
and was safely refused; that evidence is retained. Qualification does not claim
that every startup will fit the process budget or exhaustive escape resistance.

Repairs include bounded batched denial probes, fail-closed engine queries,
stable persistent descendant fixtures, host sleep prevention for explicit native
acceptance, sufficient measured VM capacity, and Mac-specific task scope checks.
Earlier relay/persistence/gateway scheduling repairs and their regressions are
recorded below. Historical refusals were not converted into passing evidence.

## Historical baseline and continuation log

The following entries describe observations at their original points in time;
the VERIFIED results above are the current completion state.

Status: partial. Validated main `02c11ac49be5ea41be2ee9f6d1b8f36b7723c810`,
the merge of [PR 13](https://github.com/AJHMH/developer-os/pull/13).
The owner is copying last night's handoff from Windows; it was unavailable
during this run. Windows observations were not promoted into Mac evidence.

## Results

- Typecheck, format check and build passed.
- Host suite: 204 tests, 202 passed, zero failed, two Windows-specific skips.
  Run with `AIOS_TEST_PYTHON=/usr/bin/python3`: default `python` is absent.
  Initial sandbox loopback failures and default-interpreter failure are retained.
- Fresh Darwin arm64/AppleHV admission passed for `aios-macos-noshare`,
  Darwin 27.2.0, guest engine 6.1.3. Fresh external policy:
  `/Users/aaronhoward/.developer-os/ticket4-macos/pins-ticket25-20261013.json`.
- Serial transfer/input/pin refusal, uncertain shutdown, fencing, pause,
  stale sender and killed-controller recovery acceptance passed. Four
  lifecycle censuses each observed eight processes and zero remaining.
- Seven synthetic isolation probes and four bounded escape controls passed.
  Credential-free actual Codex initialization/resume, credential exclusion,
  model frame transport, synthetic host gateway, endpoint enforcement and
  cross-delivery/namespace/revocation/quota/expiry controls passed.
- Final execution stopped, acceptance lock released, independent rootless
  and rootful container censuses both empty. The pre-existing VM stays running.

## Remaining work

Read-only auth status returned `sign-in-required`, `expired: true`, and
`validForInferenceWindow: false`. No login, refresh, inference or usage
approval consumption occurred. New source/policy bindings require fresh
evidence; historical capability receipts grant no new inference authority.
Fresh owner browser sign-in and a reviewed exact one-shot plan/approval
are required before inference; synthetic online usage approval is separate.

The public report, six-control entry point and fixed HTML task remain
explicitly Windows-targeted in `src/windows-qualification.ts`,
`DeliveryController.qualifyWindowsControls` and the scope gate in
`DeliveryController.syntheticTask`. Independent Mac support remains necessary
for full Ticket 25 acceptance. Offline results do not populate every public
probe. `ready` and `liveReady` remain false; production stays disabled.
Review the handoff before selecting the remaining implementation sequence.
Ticket 16 remains later full-controller/pilot qualification.

## Retained evidence

Sibling `ticket25-macos-current-{roundtrip,fencing,isolation}.json` receipts;
`macos/current-main-enrollment.json`, `current-main-before.json`,
`current-main-after.json`, `current-main-native-acceptance.log`,
`current-main-host-python3-tests.log`, `current-main-tests.log`,
`current-main-host-tests.log`, `current-main-auth-status.json`, and
`current-main-stopped-census.json`.

The `ticket25-macos-*-acceptance.mjs` copies change receipt destinations only;
original scripts, old pins and historical receipts are preserved. Native
execution used the shared canonical-state serial lock.

## Authorized continuation: local implementation and native refusal diagnosis

The owner authorized finishing Mac validation and requested notification for
sign-in and exact inference approval. Local, uncommitted implementation adds
independent AppleHV report targeting, `qualify-macos-controls`, the scoped Mac
fixed HTML task, and `scripts/assert-macos-qualification.mjs`. The shared
six-control implementation retains its existing `windowsControls` storage field;
its source version and independent binding/policy must match. Windows receipts
cannot satisfy the Mac report. Documentation describes the new entry points.

The first native six-control run passed on `pins-ticket25-final-20261013.json`;
its receipt is `ticket25-macos-controls-observation-before-headroom.json`.
Preparation subsequently refused at `codex-resume-kill` with exit 255. Focused
probes also refused at saved-history read and relay expiry. The latter recorded
two process-limit hits, 29/32 worker tasks, seven runtime and twelve SQLite tasks.
No inference plan or provider request was created by these refusals.

A simple sleeping-process saturation fixture did **not** reproduce the failure;
it is negative evidence, not proof of the cause. The actual native Codex loop
provided the resource-limit evidence. The Mac repair applies the existing
Windows one-thread runtime settings and bounded observed headroom gates without
raising the 32-task ceiling. It also uses the existing exact PID-handle/cgroup/
start-time crash helper on Mac, avoiding a management exec inside the worker.
Bounded task counters are now collected on failed Mac stages. A generated-driver
regression failed before the repair and passed afterward. The ARM64 guest
fake-child helper regression passed changed-identity, unrelated-cgroup,
all-target validation, permission-failure and exact-target kill checks.

Final host suite: 207 tests, 205 passed, zero failed, two Windows-only skips.
Build, typecheck, formatting and diff checks passed. Final source hashes are in
`macos/ticket25-source-hashes.json`. Fresh repair policy is external:
`/Users/aaronhoward/.developer-os/ticket4-macos/pins-ticket25-headroom-20261013.json`.
The first repair acceptance stopped at admission, before worker execution; the
direct native observer subsequently verified its binding and effective controls.
The refusal is preserved rather than promoted to success. Current native
revalidation and credential-free plan preparation are pending. The earlier
native pass does not qualify the changed repair source.

The first sign-in callback timed out without completion. No browser sign-in,
refresh, provider inference or new usage approval was completed by this work.
Fresh sign-in and exact one-shot approval remain required. Production stays
disabled. Diagnostic and failed-attempt files are retained under `macos/`.

## Relay and scheduling continuation

The final command-window host run passed 209 of 211 tests with two Windows-only skips. Native six-control qualification passed but gateway preparation refused. The actual guest trace captured a synthetic relay request subprocess timeout at four seconds before Codex started (`macos/current-gateway-stage-diagnostic.json`). Five harmless isolated VM execs measured 106, 138, 138, 5784 and 138 ms, all successful. Thus VM scheduling can exceed the former subprocess bound; this does not change the relay's two-second network timeout.

A generated-management regression reproduced a lost coalesced relay frame on Mac. Both platforms now detach relay stdout (Windows already did). Another actual generated-Python regression reproduced a 4.1-second scheduling delay hitting the four-second limit; it passes with the Mac ten-second subprocess allowance. The host gateway transport deadline is Mac 90 seconds / Windows 55 seconds. Provider authorization remains independently limited to thirty seconds and one request without retries or refresh. Trusted Mac management remains ninety seconds, preflight/guest commands thirty seconds, positive-control fixture lifetime 120 seconds.

Latest host suite: 213 tests, 211 passed, zero failures, two Windows-only skips (`macos/ticket25-relay-scheduling-full-tests.log`). Fresh external source policy: `/Users/aaronhoward/.developer-os/ticket4-macos/pins-ticket25-relay-scheduling-20261013.json`. Enrollment passed in 822 ms after a 150 ms version check. Earlier enrollment refusal and all failed probe evidence remain retained.

Independent Standards and Spec reviews found no outstanding implementation findings; retained report: `macos/ticket25-code-review.md`. Current hashes include the canary, platform adapter and acceptance scripts. Native controls and credential-free plan preparation on this source are underway. Earlier receipts cannot qualify this changed source. No real inference, sign-in completion or fresh inference/usage allowance has occurred.

The fresh repaired-source controls run refused before completion; it is not a
new pass (`macos/ticket25-relay-scheduling-native-preparation.log`). Protected
public status confirms execution stopped. Independent pre-restart guest census
found rootless/rootful inventories both empty and no Python probe process.
Repeated exact Podman API version preflights also refused while direct local
VM commands remained available. The dedicated VM was stopped and restarted,
preserving image and authority records, to revalidate from a clean boot. This
restart is environment diagnosis, not evidence that the native failure is fixed.

## History pressure and protocol timing

The clean-boot full probe passed isolation and model-frame transport but refused
its relay request. An indexed follow-up reached crash/resume and refused.
A narrower actual gateway probe then reproduced saved-history read failure at
32 tasks with 87 task-limit hits (error code -32603; bounded reason `history`).
These distinct observations are retained separately rather than treated as passes.
The Mac completed-turn branch now waits for existing observed task headroom
before requesting persisted history; its two-second persistence window begins
after the wait. An actual generated-branch regression failed before the guard
and passed afterward, including refusal-before-dispatch and unchanged Windows
branch behavior.

The guarded actual probe recorded zero task-limit hits, 23 tasks before the
exact crash, and zero remaining original Codex processes. It then refused at
`codex-protocol-deadline`. The Mac fixed proof window is now sixty seconds
(Windows: thirty-five), synthetic namespace grants 120 seconds (Windows: sixty),
and gateway transport 180 seconds including preparation and cleanup (Windows:
fifty-five). Provider authority is still separately capped at thirty seconds,
one request, no retries or refresh. A generated-deadline regression failed
before the change and passes Mac 36-second continuation, 61-second refusal and
unchanged Windows 36-second refusal. Current native validation remains pending.

The pinned upstream [SQLite implementation](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/state/src/sqlite.rs)
uses fixed-size database pools; its [runtime builder](https://github.com/openai/codex/blob/rust-v0.161.0/codex-rs/arg0/src/lib.rs)
does not configure blocking-thread capacity. This supports investigating burst
pressure, but does not prove an upstream defect or an ARM-specific cause.
The official binary was not modified, and persistent crash/resume checks were
not removed or replaced by in-memory history.


The current actual gateway proof passed in 56,853 ms with zero remaining
processes (`macos/ticket25-resume-window-native-probe.log` and
`macos/ticket25-resume-diagnostic.json`). This is an actual synthetic Codex
proof, not owner subscription inference or full qualification. Final host
suite: 215 total, 213 passed, zero failed, two Windows-only skips
(`macos/ticket25-resume-window-full-tests.log`). Build, typecheck, formatting
and diff checks passed. Fresh policy is
`/Users/aaronhoward/.developer-os/ticket4-macos/pins-ticket25-resume-window-20261013.json`.
Combined controls and source-bound inference-plan preparation are pending.
The dedicated VM's supervised launch session remains open for validation;
ending the prior launch session was followed by VM shutdown. All earlier
failed observations are retained and are not reused as successful evidence.


### Current continuation status

Owner browser sign-in completed and host-only macOS Keychain storage was
verified. Account eligibility is current; inference authorization remains false.
No live provider request has been made and no exact-run approval has been consumed.

Additional source repairs cover deterministic synthetic expiry readiness and
deferring the provider gateway's thirty-second lease until the first correctly
bound transport frame. Frame identity is checked before credential access;
the provider still permits one request, no retries, refresh or fallback.
Current host suite: 221 tests, 219 passed, zero failures, two Windows-only skips.
Both focused review axes reported zero findings.

Full macOS qualification remains incomplete. Current public native preparation
refused in offline isolation with `Native offline operation unavailable`, before
Codex or provider inference. This is being traced using actual child-process
status rather than accepted as passing evidence. The previous successful native
proof and six-control receipts are historical source-bound evidence, not final
qualification of the latest local repairs. Production remains disabled.


### Final observed refusal

The final current-source public probe admitted the host in 7,812 ms, but
model-frame request transport failed after 44,644 ms. The subprocess exited 1
with a timeout category; the independent Codex gateway diagnostic recorded
`codex-relay-denial-7`, a 10,000 ms command timeout. These are failing native
observations and do not qualify the worker.

The public final report is `macos/ticket25-final-qualification-report.json`:
`outcome: blocked`, `productionEnabled: false`. The public assertion refuses
with `macos-acceptance-incomplete`; authentication qualification, usage gating,
real inference, fixed task and final isolated validation remain incomplete.
Owner sign-in succeeded, but this is distinct from worker authentication
qualification. No approval is requested because no valid exact-run plan exists.
Independent rootless and rootful running-container censuses both returned `[]`.
All repairs remain local and uncommitted; PR 13 itself was not changed.

The delivery execution is stopped, both running-container censuses were empty,
and the dedicated validation VM was stopped successfully after capture.


### 14 October timeout continuation

Owner authorized continued timeout repair and native validation. Restarted
AppleHV VM; idle exec measurements were 532, 254, 349, 267 and 243 ms.
A current-source pre-repair public synthetic proof passed, including all five
capability checks, actual Codex and explicit resume. A repeated preparation
refused, so that pass was not treated as reliable final qualification.

The effective isolation path used five unbounded separate exec calls and
accepted any nonzero exit as evidence that a forbidden path was absent. These
are now one bounded management command over the same five quoted arguments.
Transport errors refuse qualification. The generated-source regression failed
with `unbounded native exec` before the fix and passed afterward, including a
Podman transport exit 125. Both review axes reported zero findings.
Current host suite: 222 total, 220 passed, zero failures, two Windows-only skips;
build, typecheck and formatting passed. Current policy:
`/Users/aaronhoward/.developer-os/ticket4-macos/pins-ticket25-bounded-effective-20261014.json`.
Fresh original native acceptance is in progress; no provider inference ran.
Temporary timing instrumentation remains only in the clearly marked debug
harness; instrumented observations are diagnostics, not qualification receipts.


The original native roundtrip exposed a separate fixture race: shutdown evidence
contained seven processes with zero remaining. The actual descendant block had
seven persistent processes; an eighth was transient. A real isolated regression
recorded `[7,7,7]` and refused. The fixed orphan shell starts two persistent sleeps,
producing `[8,8,8]` and zero remaining after shutdown. Acceptance and the 32-task
limit were preserved.

The remaining eight unbounded host-credential reads were batched into one
bounded exec over the same paths and `/proc/1/root` variants. Container-existence
checks now have bounded management timing and refuse codes other than explicit
exists (0) or absent (1). Both actual generated branches fail regressions with
their previous implementations and pass after repair; temporary old-branch
mutation hashes and exact restoration are recorded. Both reviewers found zero
new issues. Host suite: 224 tests, 222 passed, two Windows-only skips, zero failed.
Build, typecheck, formatting and diff checks passed.

Fresh native roundtrip and fencing passed under
`pins-ticket25-bounded-worker-20261014.json`; four fencing censuses observed
9, 8, 9 and 9 processes, each with zero remaining. Full isolation, controls and
exact inference-plan preparation remain in progress. Existing owner credentials
are now expired; another sign-in will be requested only after native readiness.


### Measured VM capacity repair

After the source repairs, an actual public probe still refused at
`codex-relay-expiry`, command timeout 10,000 ms, with zero process-limit hits.
During that run, the 2 GiB guest had about 98 MiB available; memory pressure
reported `some avg10=37.96`, `full avg10=32.10`, and substantial I/O stalls.
This identifies guest capacity pressure independently of the preserved 32-task
worker limit. The dedicated stopped VM was changed to 3 GiB, retaining 2 CPUs,
20 GiB disk, rootless AppleHV, the same image and worker limits. No other capacity
variable or provider lease was widened.

Fresh policy is `pins-ticket25-memory-3072-20261014.json`. During the same public
synthetic proof, available memory was 1,665 MiB, memory stall averages zero and
I/O full avg10 0.01. The current-source public proof passed all five delivery
capability checks, credential isolation, endpoint enforcement, model-frame
transport, actual Codex and explicit resume. Admission took 3,540 ms; request
and response transport took 4,589 and 4,315 ms. The previous blocked-stage
file is historical and is not a failure from this passing run.

All native baseline/control scripts and exact inference-plan preparation are
now being repeated together on the 3 GiB VM. No provider request has been made.


The 3 GiB repeated native suite passed roundtrip, fencing and full isolation,
including actual Codex, explicit resume, endpoint enforcement and all five
capability checks. Fencing's four censuses each observed nine processes with
zero remaining. Six native control checks passed (`ssh-gpg`, `github-binding`,
`effective-mounts`, `repository-fencing`, `orphan-resume`, `descendant-stop`),
with zero remaining processes and production disabled. Exact plan preparation
is running after these independent checks. Owner completed a fresh sign-in;
host status is eligible, unexpired and valid for the inference window, while
inference authorization is false.


### Ready for owner inference approval

The serial 3 GiB suite completed all five stages: native roundtrip, fencing,
full isolation/Codex, six controls and exact plan preparation. Both control
shutdown censuses observed nine processes and zero remaining. The exact plan
is `ticket25-macos-gateway-inference-plan.json`, run
`71c3b80f-9874-4c01-b86c-ef7bc9205091`: one fixed `gpt-6.1-sol` request,
30-second deadline, 65,536-byte response maximum, no retries/refresh/fallback,
unknown remaining subscription usage. No tools/context are forwarded upstream;
credentials remain in host Keychain and trusted memory.

Owner approval is pending for that exact inference and, separately, one
VM-local synthetic online qualification run. No real inference has run.
Full worker qualification, the fixed task and final isolated validation remain
pending those steps; production remains disabled. Current public report and
status are captured as `macos/ticket25-ready-for-inference-{report,status}.json`.


Owner approved exact inference run `71c3b80f-9874-4c01-b86c-ef7bc9205091`
and one VM-local synthetic online qualification run despite unknown usage.
The inference completed through the actual isolated Codex and real host-only
subscription provider; explicit crash/resume passed with zero additional
inference requests and zero remaining worker/relay processes. Gateway revocation
is recorded; the approval was durably consumed. No provider retry is allowed.
The public controller accepted its protected macOS mechanism receipt.

A later credential-free task prequalification refused at `codex-explicit-resume`:
32 tasks, 11 process-limit hits and history error -32603. This is separate from
the completed live inference. The task was refused before execution; process
limits stayed enforced and the session is stopped. The actual refusal is retained
as `macos/ticket25-task-before-retry-refusal.json`. A fresh disposable task session
is being attempted without any provider request or new inference approval.


### Host wake and task-scope corrections

The timed-out task retry overlapped actual Mac maintenance sleep/dark-wake
cycles. VM memory afterward was healthy with zero pressure. A temporary
keep-awake assertion was started; the explicit native runner now binds
`caffeinate -is -w` to its own PID on Mac and releases it in finally (or when
the runner dies). Worker/controller/inference limits are unaffected.
Both focused reviews found zero issues in this lifecycle-only utility change.

The awake task qualification passed the complete Codex proof, but the task
still refused before dispatch. Two remaining `offlineCanary` synthetic-runtime
guards hard-coded the Windows mechanism scope. They now derive a supported
scope from the admitted binding and recheck that same original scope at dispatch;
unsupported scopes still refuse. The full synthetic-site controller regression
was extended to Mac and Windows. The Mac test failed before the correction;
both pass afterward, including authentication-drift refusal. Full host suite:
225 total, 223 passed, two Windows-only skips, zero failures. Build, typecheck,
format and diff checks passed. Both reviewers reported zero new findings.

The native driver/gateway source hash was checked against the protected successful
inference receipt and is unchanged. The source-bound inference evidence remains
valid; no second provider request is required or authorized. Actual fixed-task
acceptance is being repeated through the corrected public controller.


The corrected actual native fixed task completed through the public CLI.
Authentication, syntheticTask and isolatedValidation now pass in the public
report. Negative repository-script validation, the admitted HTML edit and
loopback HTTP validation ran inside the worker; safe collection followed
verified shutdown. The one owner-approved VM-local synthetic online run is
now executing, with no provider calls. Final all-nine-check assertion remains
pending that result.


The one approved synthetic online run `29df18b4-761a-4619-a3eb-f80f78ae51c8`
passed model/dependency/bypass checks and its fresh one-run usage authorization,
with zero remaining processes and production disabled. No provider call occurred.
All retained worker sessions and online runs are stopped; independent rootless
and rootful censuses are empty.

The final public assertion correctly rejected stale six-control evidence because
`windowsControlsVersion` also binds controller source. The controller scope fix
changed that version (native/inference bindings are unchanged). Seven of nine
checks pass; isolation and fencing depend on a refreshed current-version control
receipt. Those six controls are now being rerun without any additional online
usage dispatch or inference. Prior report is retained as
`macos/ticket25-final-report-diagnostic.json`.


Refreshed current-controller six-control evidence passed with zero remaining
processes. These intentional pause/cancel/crash/recovery tests replace the
disposable delivery's offline/task state, so final transfer/task checks correctly
refused until a fresh fixed task completes afterward. The task is being rerun
last; completed real inference and synthetic online receipts are retained.
No additional provider request or online usage approval is involved.
