# 09: Monitor trusted PR checks for the current revision

**Implementation reconciliation — 15 October 2026:** The controlled controller slice is implemented in current source and covered by the corresponding implementation receipt. Native adapter/qualification acceptance remains open, so this ticket is not marked fully completed. See the [current status](../../../docs/implementation-status.md).


**What to build:** The controller observes expected trusted PR checks for the exact head, advances only on valid success, routes actionable failures into repair and preserves missing or stalled-check blockers.

**Blocked by:** 08: [Publish signed code and create an App-authored PR](08-signed-app-publication.md).

**Status:** ready-for-human

## Source and governing contract

Read the [approved canonical specification](../../aios-feature-delivery/spec.md) before implementation. User-story coverage: 20, 21, 22, 32. Use the domain glossary and approved public-controller command/observation testing boundary; assert visible behavior and permitted/forbidden effects rather than implementation internals.

This is an implementation slice, separate from resolved wayfinder decisions. Unimplemented or unqualified phases remain blocked. Controlled adapters and temporary repositories demonstrate behavior before real host/repository qualification; they do not establish live readiness. Preserve existing user material, authority boundaries and credentials. Do not enable live pilot delivery before all qualification prerequisites pass.

## Current evidence reconciliation — 15 October 2026

The controlled implementation is present on merged main and has a [ticket 09 receipt](../ticket09-implementation-receipt.md). Checked implementation criteria below apply to that controlled scope. Merging its development PR does not establish native controller acceptance.

### Remaining native acceptance

- [ ] Native complete GitHub check history, trusted provenance, conditional updates, deadlines and uncertain rerun reconciliation.
- [ ] Independently qualify the integrated delivery path on Windows and macOS; parent 04 and later tickets 15–17 remain open. Production delivery stays disabled.

## Acceptance criteria

- [x] Required check identity includes expected revision and trusted publisher/workflow, not name alone; stale or spoofed results never enable advancement.
- [x] Skipped, neutral, missing, cancelled and untrusted required evidence is incomplete unless a trusted exception explicitly covers it.
- [x] Failures and automatic/diagnostic reruns remain recorded, and actionable failures use the existing cumulative repair/validation/publication loop.
- [x] Declared timeouts override the 60-minute default per CI phase; expiration produces evidence and no repeated unbounded polling behavior.
- [x] A new head invalidates prior applicable evidence; resumed monitoring reconciles current PR and durable phase without resetting waits or allowances.
- [x] Public tests cover success/failure, stale head, same-name spoofing, unavailable checks, timeout, retry history and process interruption.


## Controlled implementation — 2026-10-14

The checked criteria describe the controlled public-controller slice. Exact-head
workflow/publisher admission, retained attempt history, durable deadlines, one
diagnostic rerun and cumulative repair are covered by public fixtures. Real
temporary signed Git objects exercise conditional updates to the same PR.

See [trusted PR checks](../../../docs/trusted-pr-checks.md) and
[implementation receipt](../ticket09-implementation-receipt.md). Native GitHub
pagination and provenance, rerun reconciliation, credential isolation and
conditional update behavior still require Windows/macOS qualification. No live
provider calls, GitHub writes or production delivery are enabled by this slice.
