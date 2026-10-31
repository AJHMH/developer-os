# Coding provider seam

Date: 2026-10-29
Status: accepted (seam only; no second provider is admitted)

## Context

The coding worker runs exactly one CLI, Codex. The transport and runtime
interfaces (`IsolatedCodingTransport`, `FeatureRuntime`, `PinnedCodingRuntime`)
were already provider-neutral, as the spec's "replaceable coding adapter"
asked. What crossed them was not:
- the locked argv (`lockedCodingArgv`);
- the observed-turn contract (`codingTurn`, Codex's `exec --json` events);
- the controller's own `thread.started` check while a turn streams.

The owner intends to add Claude models, reached through a Claude subscription
in the same spirit as the mediated ChatGPT subscription (ADR 0002). This ADR
fixes the seam a second provider plugs into. It does not admit one.

## Decision

1. **Coding provider.** `CodingProvider` (`src/coding-agent.ts`) names the CLI
   a session runs. Today it is only `"codex"`.
2. **Coding agent.** `CodingAgent` holds one provider's argv, its transcript
   validation and its conversation binding. `codexAgent` is the existing Codex
   logic, moved unchanged. A `FeatureRuntime` names its `agent`; absent means
   Codex. `PinnedCodingRuntime` takes one, defaulting to `codexAgent`.
3. **Sessions record their provider.** `CodingSession.provider` and
   `supersededLineages[].provider` are written only for a provider other than
   Codex. Absent means Codex. Existing evidence, fixtures and Codex records
   therefore stay byte-for-byte as before.
4. **A provider change starts a new lineage.** A resume requires the same
   route *and* the same provider. Otherwise the controller supersedes the old
   lineage, exactly as for a route change (slice 4c). One CLI never continues
   another's conversation or home.
5. **Usage auth mode.** `SubscriptionAuthMode` is the set of accepted usage
   reader modes, only `"chatgpt"` today. `assessSubscription` takes the
   accepted modes, defaulting to that set.

## What stays per provider

These are deliberately not generalized until a second provider is specified
(see `.scratch/claude-coding-provider/`):
- **Pins.** `CodingPins.codeModeHostSha256` is Codex's companion binary. The
  owner coding admission record is owner-written and pinned, so a second
  provider needs its own pin shape and admission scope, not a silent
  migration.
- **Wire API.** The gateway, relay and fixtures accept only the Responses
  request shape for `gatewayModel` at `api.openai.com`.
- **Credential.** The OpenAI issuer, client and scopes in `subscription-account`,
  `auth-broker`, `auth-host` and `subscription-auth`.
- **Usage reader.** `codexSubscriptionReader` reads through `codex app-server`.
- **Guest.** The Python guest's mounts, `CODEX_HOME`, its `locked()` copy of the
  argv and its retained-home rules.
- **Branch prefix.** Feature branches stay `codex/feature-<id>`, a delivery
  naming convention rather than a provider claim.

## Open question

Whether a Claude subscription credential may be held by the controller and
relayed, as the ChatGPT one is, or must stay inside the official Claude Code
CLI's own login, depends on Anthropic's current consumer and Claude Code
terms. The owner settles this
(`.scratch/claude-coding-provider/issues/01-subscription-terms-research.md`)
before any Claude credential code is written. Nothing in this seam depends on
the answer.

## Consequences

- Adding a provider means a new `CodingAgent`, a transport and guest that run
  its pinned CLI, and per-provider pins, gateway, credential and usage reader.
  The controller's dispatch, fencing, usage gate, repair budget and collection
  are unchanged.
- No production or qualification claim changes. Codex remains the only
  admitted coding transport.
