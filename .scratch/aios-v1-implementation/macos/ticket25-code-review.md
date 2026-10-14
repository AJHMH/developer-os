# Mac validation implementation review

Fixed point: PR 13 merge `02c11ac49be5ea41be2ee9f6d1b8f36b7723c810`.
Scope: local working-tree implementation, tests, assertion script and Mac documentation. No commits were created.

## Standards axis

Initial review and multiple focused follow-up rounds: zero documented-standard breaches and zero actionable heuristic findings. Shared compatibility names are documented. Additional relay framing, post-turn headroom and bounded Mac proof scheduling fixes preserve Windows behavior. The proof deadline and fixture TTL are separate from the real provider lease.

## Spec axis

Independent AppleHV targeting and evidence refusal match issue 25. Windows receipts cannot satisfy Mac qualification. The stale Windows refusal reason in the Mac assertion was corrected. No other implementation findings. Acceptance remains incomplete until fresh native checks, protected authentication, exact owner-approved one-shot inference, usage gating, online policy and fixed isolated task all pass. Production remains disabled.

The 14 October bounded path/credential probes, fail-closed container-existence query and stable eight-process descendant fixture received focused Standards and Spec follow-ups: zero findings on both axes. Actual regressions preserve the acceptance threshold and worker limits. The VM capacity adjustment is separately measured native configuration evidence.

Final Mac task admission/dispatch scope correction and PID-bound Mac keep-awake lifecycle received both focused review axes: zero findings. Final host suite and all nine native acceptance checks passed; production remains disabled.
