# 24: Qualify the Windows production worker path

**What to build:** Deliver the complete Windows worker-boundary qualification report through real controller/CLI integration, combining exact pins, admitted transfer, offline/online controls, authentication, allowance gates and fencing/recovery. Run a synthetic end-to-end worker task and isolated validation with safe result collection. Enable only the qualified host/binding; failures remain blockers. This does not replace later signed publication, approval, merge or full pilot qualification.

**Blocked by:** 22, 23.

**Status:** ready-for-human

## Parent and governing contract

Supports open parent ticket [04](04-isolated-worker-gate.md), governed by the [canonical specification](../../aios-feature-delivery/spec.md) and owner-approved runtime/scope revision. Use the approved public-controller command/observation testing seam. Readiness describes specified work, not production qualification. No implicit weaker-runtime fallback or paid inference is authorized.

## Acceptance criteria

- [x] A real controller/CLI synthetic worker task and isolated validation exercise pinned transfer, authentication, offline/online policies, usage gates, safe collection and fencing/recovery.
- [x] The complete version-bound Windows worker qualification report admits only the positively qualified host/binding and refuses missing/failed controls.
- [x] Signed publication, human approval, merge and full delivery/pilot qualification remain separate downstream gates.

## Comments

### 11 October qualification-report slice

Added a read-only public controller/CLI `qualification-report` snapshot. It
binds results to the observed Windows VM/worker/policy version and keeps
controlled adapter observations distinct from native evidence. Missing controls
remain `not-run`, failed or mismatched Windows bindings remain blocked, and the
report cannot enable production delivery. See
[`ticket24-qualification-report.md`](../ticket24-qualification-report.md).

This work ran on a Darwin arm64 Mac with AppleHV. It did not run Windows
Hyper-V qualification, live authentication, provider inference or a full
synthetic worker task/isolated validation. Those acceptance criteria remain
open until native Windows evidence is available.

### 11 October Windows handoff continuation

Resumed the Mac handoff on native Windows x64/Hyper-V at production source
`e9ccc1ad744c20e8a4c003394577f28cecfba10b`, with fresh external v3 pins.
Serial offline round-trip, fencing/crash recovery and synthetic isolation passed.
The full automatic suite passes 160 tests with one macOS-only ACL skip.
Windows portability fixes affect test fixtures only; production code is unchanged.
See [handoff and retained evidence](../ticket24-qualification-report.md).

The public report still blocks complete qualification: required isolation probes
are missing, aggregate fencing probes are not fully populated, and authentication,
online policy, usage, production synthetic work and isolated validation remain
not-run. All complete acceptance boxes remain unchecked; no inference or
production execution was authorized by these results.

### 11 October Windows protected-authentication prerequisite

Added separate Windows x64 authorization using CurrentUser DPAPI and native
owner/ACL checks, including refusal of permissive retained registration files.
Synthetic OAuth callbacks exercise verified account identity and native encrypted
storage readback; no owner credentials or provider inference were used.
Native synthetic online transport now sends fixed guest source through stdin to
avoid Windows SSH argument truncation. Production authentication gates remain.

Owner approved preparation of independent Windows sign-in. External registration
is prepared at `C:\Users\mraar\.developer-os-model-auth\windows-ticket24`;
browser consent is pending. Authentication mediation, online/usage evidence,
complete probe aggregation and the full synthetic worker task/isolated validation
remain blockers. All acceptance boxes remain unchecked.

Validation: full suite 163 tests, 162 passed, one macOS-only ACL skip; no failures.
Standards and Spec reviews both cleared the metadata ACL fix. This evidence
qualifies the protected-authentication prerequisite slice, not production delivery.

### Independent Windows sign-in and inference preparation

Windows sign-in completed successfully with protected DPAPI credentials and
subscription-use scope. Actual isolated Linux x64 Codex 0.161.0 passed independent
synthetic host-gateway, credential-exclusion, endpoint/capability and shutdown
qualification under fresh Windows pins. The exact one-request inference plan is
prepared, with unknown remaining usage requiring explicit owner approval.
See [review and provenance](../ticket24-windows-inference-review.md) and
[exact plan](../ticket24-windows-gateway-inference-plan.json).
No real inference has run; production remains disabled and complete acceptance
criteria remain open.

### Exact approved Windows inference passed

Owner-approved run `dfbabb04-9892-496e-867b-58bcfa213173` and explicit unknown
usage allowance completed the fixed actual Codex turn through the host-only
subscription gateway. Approval was durably consumed; no retry, refresh or paid
fallback occurred. The receipt records credential isolation, endpoint enforcement,
five capability checks, gateway revocation and zero remaining worker/relay
processes. See [live receipt](../ticket24-windows-gateway-inference-observation.json).
Production remains disabled. Publishing the trusted Windows capability decision,
general online/usage qualification, complete report controls and production task/
isolated validation still remain. Complete acceptance stays open.

### Trusted Windows capability and fixed task completion

The public controller/CLI now reads the trusted Windows capability decision from
external protected state, including native ownership/ACL verification of every
authority input. The already-consumed inference approval stays consumed and
grants no new inference authority. Authentication drift during requalification
prevents task dispatch.

The actual Windows Hyper-V `synthetic-task` completed a fixed admitted HTML edit,
negative and positive repository-script validation, and byte-identical HTTP
validation inside the restricted offline worker. Native shutdown independently
observed eight processes and verified zero remaining before safe result import.
The public report now marks authentication, syntheticTask and isolatedValidation
passed with live evidence. See [task receipt](../ticket24-windows-synthetic-task-observation.json),
[public report](../ticket24-windows-qualification-after-task.json), and
[review/validation](../ticket24-windows-task-review.md).

Standards and Spec reviews cleared the changes. The final suite passed 167 tests,
with one macOS-only ACL skip (168 total); typechecking and formatting passed.
Initial execution and duplicate-spool collection refusals are preserved as failed
attempts with verified shutdown. No provider request, image/policy replacement or
production execution occurred during this continuation.

Complete acceptance remains unchecked. The fixed deterministic fixture does not
prove general Codex feature implementation or the complete application validation
set. The public report remains blocked on complete isolation probes, native model
and dependency online-policy evidence, fresh online usage authorization, and
complete fencing/recovery aggregation. Publication, approval, merge and pilot
qualification remain separate downstream gates.

### 12 October completed native Windows qualification

The current v8 Hyper-V binding passed all nine live public qualification checks:
host binding, offline transfer, complete adversarial isolation, online policy,
authentication, usage gate, fencing/recovery, synthetic task and isolated
validation. See [complete public report](../ticket24-windows-complete-qualification.json)
and [independent review and retained refusals](../ticket24-windows-controls-review.md).

The independently approved fixed inference run
`bb18f46b-1b99-473b-ae3e-3565a9f66d18` passed actual pinned Codex saved-thread
crash/resume with zero extra inference requests and verified worker/relay cleanup.
The trusted protected capability record is current-source bound and grants no
future inference authority. One separately approved credential-free online run
`6381d171-77b4-4697-ae5f-82c9789f1c3f` passed fixed model/dependency access, bypass
denial and revocation; dispatch-time account/window/run usage evidence remains
historical proof, never a reusable grant.

The public fixed HTML task passed negative/positive repository-script checks and
byte-identical loopback HTTP validation, with safe collection only after verified
shutdown. All six supplemental controls passed, including native revoked-sender
fencing, queued repository contention, killed-controller recovery and two
independent descendant censuses. All current and retained sessions are stopped.

Historical uncertain recovery events remain preserved, but a later verified
stopped event and stopped session inventory reconcile them. Unresolved current
or archived sessions, malformed recovery fences and newer uncertainty still block
the report. The regression demonstrated this aggregation bug before the fix.

The expired-token inference refusal remains consumed with zero provider attempts;
separate browser sign-in and fresh exact approval preceded the successful run.
Transient credential-free probe refusals and an operator usage-scope sequencing
refusal are retained; none enabled production or consumed synthetic online
traffic authorization.

Ticket 24 worker-boundary acceptance is complete and remains ready for human
review. The evidence covers the fixed request, generated credential/helper
fixtures and deterministic site task. Parent 04, general feature delivery, signed
publication, approval, merge and full pilot qualification remain separate gates.
Production is disabled.

### Current main Windows requalification

The October 12 worker acceptance above is historical after main merge and source
changes. Fresh Windows qualification on main `1b5b545` remains blocked by Codex
saved-history persistence, with an earlier kill-command exit 255 also retained.
The additional approved repair cycle fixed a reproduced Windows relay buffering
race but final native revalidation still refused. See
[current repair evidence and next boundary](../ticket24-windows-main-repair.md).
No fresh inference plan or macOS handoff is ready; production remains disabled.
