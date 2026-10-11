# 25: Independently qualify the macOS worker path

**What to build:** Deliver the same controller/worker contract on macOS 14+ Apple silicon with an explicitly selected, supported VM provider and independent live evidence for every required control. Portability work stays inside this verifiable host slice. Missing macOS infrastructure reports blocked/not-run and keeps execution disabled; Windows evidence is not inherited. Existing ticket 16 remains the later complete-controller delivery qualification.

**Blocked by:** 24.

**Status:** ready-for-agent

## Parent and governing contract

Supports open parent ticket [04](04-isolated-worker-gate.md), governed by the [canonical specification](../../aios-feature-delivery/spec.md) and owner-approved runtime/scope revision. Use the approved public-controller command/observation testing seam. Readiness describes specified work, not production qualification. No implicit weaker-runtime fallback or paid inference is authorized.

## Acceptance criteria

- [ ] A supported macOS 14+ Apple-silicon VM provider is explicitly selected and independently verified through the same public controller/worker contract.
- [ ] Live macOS evidence covers every required worker control, including transfers, authentication, network policy, usage gates and recovery; Windows results are not inherited.
- [ ] Absent infrastructure or unverified controls report blocked/not-run and disable execution; later full-controller macOS qualification remains required.

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
