# Investigate worker isolation on Windows and macOS

Type: research
Label: wayfinder:research
Status: resolved
Claimed by: research subagent in current Codex chat
Parent: ../map.md
Blocked by: none

## Question

Which concrete isolation mechanism can host a pinned Codex CLI worker on Windows and macOS while preventing access to owner Git/GitHub credentials, App PEM, signing keys, controller state, arbitrary host files and unauthorized remote effects?

Investigate primary vendor documentation and existing Factory contracts. Account for model-only authentication, controlled network access, workspace writes, local checks and dependency execution, restart/resume isolation, cross-platform process cancellation, dependency/tool requirements and database-backed E2E. Distinguish documented guarantees from untested assumptions. Propose an acceptance test matrix and a fail-closed launch contract; do not install or execute infrastructure.

## Resolution requirements

A cited research artifact identifying a practical candidate and its limitations. A document is not proof of host enforcement: actual isolation remains an execution-readiness gate. Link findings here; resume the runtime grilling ticket for owner selection.

## Answer

[Worker isolation research](../worker-isolation-research.md) identifies pinned Docker Sandboxes microVMs with pinned Codex CLI as the preferred evaluation candidate. Documented platform prerequisites narrow support to Windows 11 Intel/AMD x64 with Windows Hypervisor Platform and macOS 14+ Apple silicon. Owner selection is still required.

The report specifies ordinary-file workspace materialization, credential exclusion, model-only proxy authority, disabled SSH/skills/MCP/host hooks, controlled dependency networking, isolated validation/E2E, safe output import and lifecycle probes. All enforcement tests remain unperformed; no release is qualified or adopted. Stop execution if required evidence is unavailable.

Research findings are preserved in the working tree because this repository has no initial commit from which to create the usual research branch. No installations, agent runs, secret reads or remote writes were performed.
