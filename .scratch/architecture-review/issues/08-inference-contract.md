# 08: Fixed inference request contract

Status: ready-for-agent
Progress: completed
Source: [Claude architecture review](../source-review.md)
Blocked by: 06

## Scope

Own the canonical request, marker and response in one module; supply generated contract values to Python fixture and relay configuration instead of duplicate literals/guards.

Affected files: subscription-gateway.ts, codex-endpoint.ts, online-native.ts.

## Completion criteria

Whole fixture request/response tests use shared contract and refuse altered requests/tools; gateway/endpoint/online tests pass.

## Comments

17 October 2026: Owner authorized all recommendations, including speculative CLI and deletion decisions. Live inference, production enablement and Issue #4 qualification work are outside this diversion.

17 October 2026: Canonical inference contract generates Python configuration and SSE. Whole Python HTTP fixture and host predicate agree on positive/hostile requests, including null-tools refusal. Integrated validation is recorded in the parent spec.
