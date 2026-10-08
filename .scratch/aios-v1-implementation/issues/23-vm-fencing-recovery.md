# 23: Fence and reconcile VM descendants across controller interruption

**What to build:** Deliver public pause/cancel/restart behavior with independent management verification of stopped descendants, stale-controller fencing, concurrent ownership rejection, orphan reconciliation and exact delivery/session identity. Crash-injection tests demonstrate uncertainty blocks redispatch and safe recovery preserves work and usage. Client termination alone does not establish worker termination. Include live synthetic process evidence beyond the two previously observed descendants.

**Blocked by:** 19.

**Status:** ready-for-agent

## Parent and governing contract

Supports open parent ticket [04](04-isolated-worker-gate.md), governed by the [canonical specification](../../aios-feature-delivery/spec.md) and owner-approved runtime/scope revision. Use the approved public-controller command/observation testing seam. Readiness describes specified work, not production qualification. No implicit weaker-runtime fallback or paid inference is authorized.

## Acceptance criteria

- [ ] Public pause/cancel/restart independently verifies descendants stopped or reports uncertainty, including live synthetic process evidence beyond the prototype census.
- [ ] Stale-controller fencing, concurrent ownership rejection and exact delivery/session orphan reconciliation prevent overlapping redispatch.
- [ ] Crash-injection demonstrates preserved work/usage and fail-closed uncertainty; killing the client alone is insufficient evidence.
