# 24: Qualify the Windows production worker path

**What to build:** Deliver the complete Windows worker-boundary qualification report through real controller/CLI integration, combining exact pins, admitted transfer, offline/online controls, authentication, allowance gates and fencing/recovery. Run a synthetic end-to-end worker task and isolated validation with safe result collection. Enable only the qualified host/binding; failures remain blockers. This does not replace later signed publication, approval, merge or full pilot qualification.

**Blocked by:** 22, 23.

**Status:** ready-for-human

## Parent and governing contract

Supports open parent ticket [04](04-isolated-worker-gate.md), governed by the [canonical specification](../../aios-feature-delivery/spec.md) and owner-approved runtime/scope revision. Use the approved public-controller command/observation testing seam. Readiness describes specified work, not production qualification. No implicit weaker-runtime fallback or paid inference is authorized.

## Acceptance criteria

- [ ] A real controller/CLI synthetic worker task and isolated validation exercise pinned transfer, authentication, offline/online policies, usage gates, safe collection and fencing/recovery.
- [ ] The complete version-bound Windows worker qualification report admits only the positively qualified host/binding and refuses missing/failed controls.
- [ ] Signed publication, human approval, merge and full delivery/pilot qualification remain separate downstream gates.

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
