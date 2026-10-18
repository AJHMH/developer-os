# Issue 04: independent native session observation

## Scope and behavior

Baseline: validated main `f42a132fc0206f6c583100b9d218c6d9af2599a1`.
Production execution remains disabled. This prerequisite does not complete Issue
04 or qualify Windows/macOS native timer behavior.

`NativePodmanCodingTransport.observeSession` reads a bound session's protected
phase, container running state, current cgroup process count, disappearance of
tracked processes, and lease/deadline timer states. It verifies operation/fence,
authority labels, runtime and policy pins. Missing or malformed evidence refuses.
It does not renew timers, stop processes, consume logs or update lifecycle phase.

The observer can report that an independently stopped worker has disappeared
while the journal still says running. Collection continues to refuse until the
separate explicit stop/recovery path verifies shutdown and records stopped.

## Implementation evidence

The initial regression failed because `observeSession` did not exist. Thirteen
additive cases now cover stopped evidence, positive running evidence followed by
simulated independent expiry, changed fencing identity, unavailable/malformed/
pending timer observations and contradictory host results. They execute the
existing external guest simulator or external host seam. They are not native
qualification evidence.

Focused native transport and lifecycle regression: 68 passed, zero failures or
skips. Typecheck, formatting and build passed. Full suite: 745 tests, 742 passed, 3 platform skips, zero failures
(295.7 seconds). Local Graft refresh and whitespace checks also passed.

## Standards

No findings. Vocabulary, module boundaries and lifecycle authority are preserved.

## Spec

No findings within this bounded prerequisite. Native qualification remains open.

Standards: 0 findings, no worst issue. Spec: 0 findings, no worst issue.

## Next qualification step

Prepare a bounded native timer/controller-loss acceptance procedure with a
positive running control and independent observations before explicit cleanup.
Record exact source/runtime pins and retain failed attempts. A checkpoint stop is
not timer-expiry proof. Fresh live enrollment/inference authorization and the
remaining general integration, resume, usage and resource-bound criteria remain
separate gates.
