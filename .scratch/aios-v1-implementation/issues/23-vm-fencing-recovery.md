# 23: Fence and reconcile VM descendants across controller interruption

**What to build:** Deliver public pause/cancel/restart behavior with independent management verification of stopped descendants, stale-controller fencing, concurrent ownership rejection, orphan reconciliation and exact delivery/session identity. Crash-injection tests demonstrate uncertainty blocks redispatch and safe recovery preserves work and usage. Client termination alone does not establish worker termination. Include live synthetic process evidence beyond the two previously observed descendants.

**Blocked by:** 19.

**Status:** completed

## Parent and governing contract

Supports open parent ticket [04](04-isolated-worker-gate.md), governed by the [canonical specification](../../aios-feature-delivery/spec.md) and owner-approved runtime/scope revision. Use the approved public-controller command/observation testing seam. Readiness describes specified work, not production qualification. No implicit weaker-runtime fallback or paid inference is authorized.

## Acceptance criteria

- [x] Public pause/cancel/restart independently verifies descendants stopped or reports uncertainty, including live synthetic process evidence beyond the prototype census.
- [x] Stale-controller fencing, concurrent ownership rejection and exact delivery/session orphan reconciliation prevent overlapping redispatch.
- [x] Crash-injection demonstrates preserved work/usage and fail-closed uncertainty; killing the client alone is insufficient evidence.

## 10 October native Windows observation

The [native acceptance runner](../podman-fencing-acceptance.mjs) completed actual offline round trips, concurrent ownership rejection, delayed stale-sender refusal even with its client dispatch check bypassed, and a controller process kill after native acceptance. Recovery retained durable unknown-usage state and work, stopped the exact orphan session, and allowed a fresh synthetic round trip. Four independent censuses each observed eight processes and zero remaining. [Evidence](../ticket23-native-fencing.json) is limited to fixed synthetic Windows offline lifecycle; production resume/inference and macOS remain unqualified.
