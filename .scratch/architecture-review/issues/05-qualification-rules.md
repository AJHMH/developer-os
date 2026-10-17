# 05: Named qualification rules

Status: ready-for-agent
Progress: completed
Source: [Claude architecture review](../source-review.md)
Blocked by: 04, 03

## Scope

Make nine report checks and fallback predicates explicit; stamp code versions when evidence is produced. Move mutable qualification projection out of status/list while retaining fresh fail-closed pin checks.

Affected files: windows-qualification.ts, subscription-decision.ts, controller.ts.

## Completion criteria

Each rule has passing/refused evidence tests, stale pins fail closed, status/list do not mutate stored qualification or launch private-storage probes.

## Comments

17 October 2026: Owner authorized all recommendations, including speculative CLI and deletion decisions. Live inference, production enablement and Issue #4 qualification work are outside this diversion.

17 October 2026: Named rules and stamped versions replace report-time source reads. Explicit qualification persists the private-storage decision; status/list verify pins without subprocesses. Rule/decision/report regression run: 70 passed. Integrated validation is recorded in the parent spec.
