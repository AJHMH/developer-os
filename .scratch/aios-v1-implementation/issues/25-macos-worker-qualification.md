# 25: Independently qualify the macOS worker path

**What to build:** Deliver the same controller/worker contract on macOS 14+ Apple silicon with an explicitly selected, supported VM provider and independent live evidence for every required control. Portability work stays inside this verifiable host slice. Missing macOS infrastructure reports blocked/not-run and keeps execution disabled; Windows evidence is not inherited. Existing ticket 16 remains the later complete-controller delivery qualification.

**Blocked by:** 24.

**Status:** ready-for-human

## Parent and governing contract

Supports open parent ticket [04](04-isolated-worker-gate.md), governed by the [canonical specification](../../aios-feature-delivery/spec.md) and owner-approved runtime/scope revision. Use the approved public-controller command/observation testing seam. Readiness describes specified work, not production qualification. No implicit weaker-runtime fallback or paid inference is authorized.

## Acceptance criteria

- [x] A supported macOS 14+ Apple-silicon VM provider is explicitly selected and independently verified through the same public controller/worker contract.
- [x] Live macOS evidence covers every required worker control, including transfers, authentication, network policy, usage gates and recovery; Windows results are not inherited.
- [x] Absent infrastructure or unverified controls report blocked/not-run and disable execution; later full-controller macOS qualification remains required.

## Comments

### 10 October owner-directed offline implementation

Mac infrastructure is now available. Parent 04's explicit Mac implementation
request authorized independently implementing and observing the offline subset
without enabling production or completing blocked-by-24 acceptance. AppleHV was
selected explicitly and live synthetic transfer/isolation/fencing/recovery
evidence is retained. See [qualification scope](../../../docs/macos-worker-qualification.md).
The credential-free native Codex protocol/relay passed; actual authentication,
network mediation, inference and full production validation remain not-run.
All full acceptance boxes stay open; Windows evidence was not inherited.

### 13 October current-main macOS validation

Independent offline native acceptance passed on PR 13's merged source with
fresh AppleHV pins. Host suite passed 202 tests with two Windows-only skips;
all four lifecycle censuses and independent container checks found zero
remaining workers. Credential-free Codex/relay controls passed. Protected
Mac auth is expired; subscription inference was not run. Windows-only final
report/control/task entry points still need Mac support. The owner is copying
the Windows handoff. Full acceptance stays open; see
[validation receipt](../ticket25-macos-validation-20261013.md).

### 13 October owner-authorized completion continuation

The supplied Factory approval-refresh handoff is a separate task; the owner
explicitly authorized completing Mac validation and asked for notification at
sign-in and exact inference approval. Local implementation now supports independent
Mac qualification reports, native controls, fixed task admission and the Mac
completion assertion. Shared storage names retain compatibility but do not inherit
Windows evidence. The full host suite passes 211 tests with two Windows-only skips;
Standards and Spec implementation reviews have no outstanding findings.

Native revalidation exposed scheduling and buffered-relay issues. Generated
management regressions reproduced and verified their bounded repairs. Current
native acceptance is still pending; retained failed receipts stay refused. No
fresh sign-in, real provider inference or unknown-usage approval has completed.
Production remains disabled and all full acceptance boxes remain open. The
[validation receipt](../ticket25-macos-validation-20261013.md) records source pins,
test evidence, failures and the remaining owner-dependent gates.


### 14 October verified independent Mac worker qualification

All three acceptance criteria are implemented and verified. The current-source
public Mac assertion passes all nine live checks; 46 retained worker sessions
and 11 online runs are stopped, and independent rootless/rootful censuses are
empty. One owner-approved real inference and one separately approved VM-local
synthetic online run completed. Fixed HTML editing and isolated script/HTTP
validation passed. Production remains disabled; ticket 16 remains the later
complete-controller/pilot gate. No Windows observation was promoted into Mac
qualification. Status is ready-for-human for PR review and integration. See [validation receipt](../ticket25-macos-validation-20261013.md)
and [final public report](../macos/ticket25-final-qualified-report.json).
