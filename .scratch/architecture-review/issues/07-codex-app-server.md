# 07: Pinned Codex app-server client

Status: ready-for-agent
Progress: completed
Source: [Claude architecture review](../source-review.md)

## Scope

Centralize bounded JSON-RPC initialization/account read sessions with explicit environment policy, pinned executable identity, deadline and output bounds. Preserve owner-account usage reads and isolated mediation probes.

Affected files: codex-usage.ts, codex-mediation.ts.

## Completion criteria

One fake app-server exercises both callers, rejects changed digests, malformed/oversized output and timeout; existing usage/mediation tests pass.

## Comments

17 October 2026: Owner authorized all recommendations, including speculative CLI and deletion decisions. Live inference, production enablement and Issue #4 qualification work are outside this diversion.

17 October 2026: One pinned bounded JSON-RPC client serves owner usage and isolated mediation. Real fake app-server tests cover timeout, malformed/oversized output, digest and caller-mutation refusal. Integrated validation is recorded in the parent spec.
