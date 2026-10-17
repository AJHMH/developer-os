# 04: Host target facts and adapters

Status: ready-for-agent
Progress: completed
Source: [Claude architecture review](../source-review.md)

## Scope

Centralize Windows/Hyper-V and macOS/AppleHV target facts, explicit OS-version domains, binding/effective-control validation, pins and deadlines; make shared names neutral and unify acceptance assertions.

Affected files: podman-host.ts, podman-platform.ts, windows-qualification.ts, sandbox-worker.ts, windows-controls.ts, scripts/assert-*-qualification.mjs.

## Completion criteria

Target tables distinguish Darwin kernel from macOS product versions; mismatch/admission/qualification and acceptance tests pass.

## Comments

17 October 2026: Owner authorized all recommendations, including speculative CLI and deletion decisions. Live inference, production enablement and Issue #4 qualification work are outside this diversion.

17 October 2026 implementation evidence: Host target table, kernel/product OS domains, shared binding/effective predicates and common acceptance assertions are implemented. Platform and qualification regressions pass; shared management uses target deadlines and Codex digest data.
