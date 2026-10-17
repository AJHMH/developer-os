# 10: Declarative CLI command table

Status: ready-for-agent
Progress: completed
Source: [Claude architecture review](../source-review.md)
Blocked by: 04

## Scope

Encode command option acceptance, runtimes and dispatch in a command table. Preserve command names and JSON/error/exit behavior; record the exact-plan exposure decision without enabling production delivery.

Affected files: cli.ts, tests/cli-guardrails.test.mjs.

## Completion criteria

Table tests cover allowed/forbidden options plus process-level CLI smoke tests; all existing CLI behavior tests pass.

## Comments

17 October 2026: Owner authorized all recommendations, including speculative CLI and deletion decisions. Live inference, production enablement and Issue #4 qualification work are outside this diversion.

17 October 2026: Declarative command options, runtimes and dispatch replace branching guards. Per-command contract tests and process-level delivery tests pass; rerun-pr-check now accepts its required check-id. Exact-plan CLI decision is in ADR 0001. Integrated validation is recorded in the parent spec.
