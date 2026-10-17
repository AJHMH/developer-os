# 02: VM management channel

Status: ready-for-agent
Progress: completed
Source: [Claude architecture review](../source-review.md)
Blocked by: 04

## Scope

Consolidate guest authority layout, private-file validation, journal/fence locking, stage vocabulary, SSH transport and target deadlines. Controls and synthetic exercises invoke named actions.

Affected files: podman-native.ts, windows-controls.ts, synthetic-task.ts, podman-host.ts, windows-codex-crash.ts.

## Completion criteria

Whole guest actions run against fake Podman under local Python; existing offline/control/synthetic/fencing tests remain green.

## Comments

17 October 2026: Owner authorized all recommendations, including speculative CLI and deletion decisions. Live inference, production enablement and Issue #4 qualification work are outside this diversion.

17 October 2026 implementation evidence: Complete guest actions run under local Python/fake Podman; combined channel, platform and qualification regressions pass (54 tests). Remaining specialized probe regressions are retained alongside public action tests to avoid losing safety coverage.
