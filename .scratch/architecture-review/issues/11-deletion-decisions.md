# 11: Deletion and canary placement decisions

Status: ready-for-agent
Progress: completed
Source: [Claude architecture review](../source-review.md)
Blocked by: 02, 08

## Scope

Evaluate every deletion candidate against current callers and qualification evidence. Remove obsolete Docker Sandbox implementation when supported; keep admittedPath and any live dependencies. Decide the relay seam, move crash helper into guest ownership, and move gateway canaries next to qualification code. Record retained choices.

Affected files: sandbox-worker.ts, sbx-host.ts, workspace.ts, model-relay.ts, windows-codex-crash.ts, subscription-gateway.ts.

## Completion criteria

Each candidate has a documented remove/move/retain decision with caller evidence; no remaining imports of removed code; applicable regressions pass.

## Comments

17 October 2026: Owner authorized all recommendations, including speculative CLI and deletion decisions. Live inference, production enablement and Issue #4 qualification work are outside this diversion.

17 October 2026: Caller-backed remove/move/retain decisions are recorded in ADR 0001. Removed the unused sandbox line, retained ordinary-file admission and revocable relay, inlined crash helper, separated gateway canaries. Direct admission and gateway/relay regressions pass. Integrated validation is recorded in the parent spec.
