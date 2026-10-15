# 07: Repair validation findings within persisted allowances

**Implementation reconciliation — 15 October 2026:** The controlled controller slice is implemented in current source and covered by the corresponding implementation receipt. Native adapter/qualification acceptance remains open, so this ticket is not marked fully completed. See the [current status](../../../docs/implementation-status.md).


**What to build:** A failed candidate check returns a batch of findings to the isolated worker, revalidates the resulting change and either progresses with evidence or stops with a preserved repair-budget blocker.

**Blocked by:** 06: [Validate baseline and candidate behavior inside isolation](06-isolated-validation.md).

**Status:** ready-for-human

## Source and governing contract

Read the [approved canonical specification](../../aios-feature-delivery/spec.md) before implementation. User-story coverage: 30, 31. Use the domain glossary and approved public-controller command/observation testing boundary; assert visible behavior and permitted/forbidden effects rather than implementation internals.

This is an implementation slice, separate from resolved wayfinder decisions. Unimplemented or unqualified phases remain blocked. Controlled adapters and temporary repositories demonstrate behavior before real host/repository qualification; they do not establish live readiness. Preserve existing user material, authority boundaries and credentials. Do not enable live pilot delivery before all qualification prerequisites pass.

## Current evidence reconciliation — 15 October 2026

The controlled implementation is present on merged main and has a [ticket 07 receipt](../ticket07-implementation-receipt.md). Checked implementation criteria below apply to that controlled scope. Merging its development PR does not establish native controller acceptance.

### Remaining native acceptance

- [ ] Native repair execution, active-time accounting, interruption, shutdown and protected revalidation.
- [ ] Independently qualify the integrated delivery path on Windows and macOS; parent 04 and later tickets 15–17 remain open. Production delivery stays disabled.

## Acceptance criteria

- [x] A repair cycle is one attempt to fix a batch followed by relevant verification; default allowance is three cycles or 60 active repair minutes, whichever is exhausted first.
- [x] Diagnosis, edits and local revalidation count; initial coding, CI/approval waits, pauses and downtime are excluded.
- [x] Usage survives restart, new comments and failed repairs; exhaustion prevents further repair until an explicit owner extension is durably recorded.
- [x] The repair worker cannot lower thresholds, skip gates, edit trusted policy, acquire publication credentials or expand scope to unrelated baseline repairs.
- [x] Each attempt records findings, changed tree, verification results and remaining allowance; verified success invalidates stale evidence and advances only the appropriate phase.
- [x] Public tests cover exact allowance boundaries, interruption, extension, batch accounting and attempted policy weakening; real execution remains subject to qualification.



## Implementation receipt — 2026-10-14

The controlled slice implements the criteria above through the public controller
and controlled coding/validation boundaries. Checked items describe that tested
scope; native execution remains unqualified. See [bounded repair](../../../docs/bounded-repair.md)
and [validation results](../ticket07-implementation-receipt.md).

Independent review corrected unchanged-tree verification and fenced evidence
association across interrupted final inspection. Parent native qualification,
hosted integration and complete pilot delivery remain open.
