# 01: Usage approval gate

Status: ready-for-agent
Progress: completed
Source: [Claude architecture review](../source-review.md)

## Scope

Own observation assessment, account fallback, scope carry-forward, owner approval, bind-once operation grants and freshness in one module with an injected clock. Reject future timestamps consistently.

Affected files: subscription.ts, controller.ts, online-access.ts.

## Completion criteria

Direct gate tests cover all decisions, stale/future/invalid dates, account/scope drift and bind-once use; controller and online-access regressions pass.

## Comments

17 October 2026: Owner authorized all recommendations, including speculative CLI and deletion decisions. Live inference, production enablement and Issue #4 qualification work are outside this diversion.

17 October 2026 implementation evidence: Public usage-gate regressions, controller controls and online usage tests pass; expiry/account/scope checks now share one gate.
