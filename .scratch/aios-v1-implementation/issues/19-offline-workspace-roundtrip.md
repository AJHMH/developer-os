# 19: Run and safely collect an offline delivery canary

**What to build:** Deliver an offline controller-driven synthetic workspace round trip: admitted ordinary files enter a fresh dedicated VM worker, restricted execution produces an artifact, verified stop precedes safe output collection, and status/evidence records the exact session and bindings. Reject unsafe paths, links/reparse inputs, secrets, Git metadata and concurrent writes. No reusable owner credentials, engine sockets, host mounts or repository scripts on the controller. The demo is synthetic and grants no feature-delivery readiness.

**Blocked by:** 18.

**Status:** ready-for-agent

## Parent and governing contract

Supports open parent ticket [04](04-isolated-worker-gate.md), governed by the [canonical specification](../../aios-feature-delivery/spec.md) and owner-approved runtime/scope revision. Use the approved public-controller command/observation testing seam. Readiness describes specified work, not production qualification. No implicit weaker-runtime fallback or paid inference is authorized.

## Acceptance criteria

- [ ] A fresh restricted offline worker receives admitted synthetic files, produces an artifact and returns it through the controller after independently verified stop.
- [ ] Unsafe paths, links/reparse inputs, secrets, Git metadata and concurrent-write output are rejected.
- [ ] Session/binding evidence is retained; owner credentials, host mounts, engine sockets and host execution of repository scripts remain excluded.
