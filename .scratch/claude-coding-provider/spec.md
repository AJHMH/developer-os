# Claude as a second coding provider

Status: needs-triage

## Goal

Let a delivery's coding worker run Claude models, reached through the owner's
Claude subscription, while keeping every existing delivery contract: isolated
worker, fresh usage authority per turn, owner coding admission by exact pins,
repair budget, fencing, collection and evidence. Codex stays available and
unchanged.

## Starting point

ADR 0003 (`docs/adr/0003-coding-provider-seam.md`) adds the seam:
`CodingProvider`, `CodingAgent` (`src/coding-agent.ts`), `provider` on sessions,
the rule that a provider change starts a new lineage, and
`SubscriptionAuthMode`. Codex is the only implementation.

## Non-goals

- No paid API fallback or credit purchase (the original spec's
  subscription-only rule still holds).
- No production enablement; this reaches qualification at most.
- No change to Codex pins, evidence or behaviour.

## Constraints

- Anthropic's terms decide whether the controller may hold and relay a
  subscription credential (issue 01). If it may not, the official Claude Code
  CLI keeps its own login inside the VM, and the mediation design changes
  accordingly. That would be a new ADR, not a quiet weakening of ADR 0002.
- Each provider gets its own pins and owner admission scope; an admission
  record never admits two providers.

## Issues

1. `01-subscription-terms-research.md`: can a Claude subscription be mediated?
2. `02-claude-code-cli-pin-and-guest.md`: pinned CLI, guest and `claudeAgent`.
3. `03-messages-gateway-and-relay.md`: Messages API gateway and relay.
4. `04-claude-credential-mediation.md`: credential issuer, client and scopes.
5. `05-claude-usage-reader.md`: subscription usage reader.
6. `06-provider-qualification.md`: per-provider probes and admission.
