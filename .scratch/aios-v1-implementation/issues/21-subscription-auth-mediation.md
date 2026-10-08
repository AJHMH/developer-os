# 21: Qualify model-only subscription authentication mediation

**What to build:** Deliver a capability decision through qualification/status: a supported mediation mechanism must separate subscription inference from reusable owner credentials, host MCP/discovery and publication authority. Test credential-free protocol/capability canaries before any authorized live inference. Unsupported or unverifiable mediation reports an actionable blocker; do not copy owner authentication files, buy credits or substitute paid API access. A negative finding completes the investigation but leaves the production gate blocked and requires an owner tradeoff decision; it does not satisfy this ticket's positive qualification criteria.

**Blocked by:** 18.

**Status:** ready-for-agent

## Parent and governing contract

Supports open parent ticket [04](04-isolated-worker-gate.md), governed by the [canonical specification](../../aios-feature-delivery/spec.md) and owner-approved runtime/scope revision. Use the approved public-controller command/observation testing seam. Readiness describes specified work, not production qualification. No implicit weaker-runtime fallback or paid inference is authorized.

## Acceptance criteria

- [ ] A supported mechanism demonstrates model-only subscription mediation without reusable owner credentials, host MCP/discovery or publication authority entering the worker.
- [ ] Credential-free protocol/capability canaries precede any authorized live inference; owner authentication files, credit purchases and paid API substitutions are forbidden.
- [ ] Unsupported/unverifiable mediation returns an actionable blocker and owner tradeoff; a negative investigation does not satisfy positive qualification or unblock ticket 22.
