# 22: Dispatch online inference under independently enforced access policy

**What to build:** Deliver controller dispatch with external model-endpoint enforcement, separate controlled dependency access and the existing subscription allowance approval gate. Demonstrate permitted synthetic traffic and denied host/MCP/arbitrary destinations, including bypass attempts; worker privilege cannot alter the outer policy. Low/unknown usage requires a run-scoped owner grant, exhaustion stops with preserved work, and restart/re-dispatch rechecks. No paid fallback or financial-cap claim. Actual subscription inference remains gated by verified mediation and existing owner authorization.

**Blocked by:** 20, 21 (positive authentication qualification required).

**Status:** ready-for-agent

## Parent and governing contract

Supports open parent ticket [04](04-isolated-worker-gate.md), governed by the [canonical specification](../../aios-feature-delivery/spec.md) and owner-approved runtime/scope revision. Use the approved public-controller command/observation testing seam. Readiness describes specified work, not production qualification. No implicit weaker-runtime fallback or paid inference is authorized.

## Acceptance criteria

- [ ] Model endpoints are enforced outside worker authority; separate dependency access and synthetic permitted/denied traffic demonstrate bypass resistance.
- [ ] At 20% or less remaining in any allowance, or unknown usage, dispatch requires a delivery/account/window/run-scoped owner grant; exhaustion stops and preserves work, with foreground monitoring and fresh restart/re-dispatch checks.
- [ ] Only positively qualified authentication permits inference; no paid fallback, purchase, automatic recharge or exact financial-cap claim is introduced.

## Ticket 21 positive fixture evidence

The exact macOS actual-Codex subscription gateway run passed; see ticket 21 and
`../ticket21-gateway-inference-observation.json`. Authentication remains a blocking
dependency because the positive capability decision is not yet exposed through
trusted public qualification/status. The consumed fixture grant cannot authorize
online dispatch. Production gates and this ticket's acceptance remain open.
