# 09: Monitor trusted PR checks for the current revision

**What to build:** The controller observes expected trusted PR checks for the exact head, advances only on valid success, routes actionable failures into repair and preserves missing or stalled-check blockers.

**Blocked by:** 08: [Publish signed code and create an App-authored PR](08-signed-app-publication.md).

**Status:** ready-for-agent

## Source and governing contract

Read the [approved canonical specification](../../aios-feature-delivery/spec.md) before implementation. User-story coverage: 20, 21, 22, 32. Use the domain glossary and approved public-controller command/observation testing boundary; assert visible behavior and permitted/forbidden effects rather than implementation internals.

This is an implementation slice, separate from resolved wayfinder decisions. Unimplemented or unqualified phases remain blocked. Controlled adapters and temporary repositories demonstrate behavior before real host/repository qualification; they do not establish live readiness. Preserve existing user material, authority boundaries and credentials. Do not enable live pilot delivery before all qualification prerequisites pass.

## Acceptance criteria

- [ ] Required check identity includes expected revision and trusted publisher/workflow, not name alone; stale or spoofed results never enable advancement.
- [ ] Skipped, neutral, missing, cancelled and untrusted required evidence is incomplete unless a trusted exception explicitly covers it.
- [ ] Failures and automatic/diagnostic reruns remain recorded, and actionable failures use the existing cumulative repair/validation/publication loop.
- [ ] Declared timeouts override the 60-minute default per CI phase; expiration produces evidence and no repeated unbounded polling behavior.
- [ ] A new head invalidates prior applicable evidence; resumed monitoring reconciles current PR and durable phase without resetting waits or allowances.
- [ ] Public tests cover success/failure, stale head, same-name spoofing, unavailable checks, timeout, retry history and process interruption.

