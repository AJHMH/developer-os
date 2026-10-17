# PR 58 validation blockers: partial diagnosis

Owner authorized using the remaining ten active investigation minutes for the
separate Linux contract timeout and Windows authentication-setup refusal. This
local receipt is outside PR 58's approved head; no fix, threshold change or rerun
has been applied. Both original failure artifacts remain retained on GitHub.

PR 58 head `bbae420a0927dfe48485f6f0bd6929a79cea12aa` is approved. Its ordinary
production sources, tests, CI workflow and Factory contract exactly match green
main `9096ab6bc2b3df07a0f000437a13341b6b37c8f5`.

## Linux contract execution

Run 38990739963, job 117272374013. Test command started 01:25:06.971 UTC and was
terminated at 01:27:06.980, preserving the 120-second deadline (timedOut true,
SIGKILL, no exit status). Artifact `factory-adoption-bbae420a0927dfe48485f6f0bd6929a79cea12aa-38990739963`
contains the original distribution result. The numeric resource samples are
retained in linux-resource-comparison.json; command output/paths are omitted.

Compared with passing main run 38989322030 (99.62 seconds), this failed execution
had I/O pressure some/full increases of 52.766/47.517 seconds versus 3.605/2.371,
and CPU I/O-wait 38.10% versus 2.34%. Both had zero observed CPU steal or cgroup
throttling and negligible memory pressure. These are host/group observations,
not per-test storage attribution or proof of causation. They support an
I/O-associated slowdown on this failed host; the device, process and operation
responsible remain unknown. No tight deterministic reproduction exists.

## Windows authentication setup

Run 38990739746, shard 3: first test in tests/auth-setup.test.mjs:41 failed in
15308.319 ms. The CLI returned status 1 with its generic ordinary external storage
refusal. The unchanged native storage helper has a 15000 ms child deadline, but
the failed test retained no child error code, signal or script milestone. Similar
duration is not proof of ETIMEDOUT. Existing prior cold-start observations do not
explain this failed host. A future useful capture must record bounded status and
stage metadata at the real CLI child, preserving every original ACL/DPAPI check,
argument, environment and deadline. No warmup or healthy retry can close this.

## Outcome and limits

All PR 58 checks finished: Windows shard 1 and both human-approval gates passed;
Linux contract execution and Windows shard 3 failed, causing the Windows aggregate
to fail. No rerun was requested. Main remains synchronized and fully green at
9096ab6, while PR 58 remains blocked. The historical shard 1 timeout is unresolved.

The owner-authorized ten-minute diagnostic allowance is consumed by comparison,
artifact preservation and source-bound review (CI waits excluded). Two additional
repair cycles remain, with no cause-specific repair attempted; elapsed allowance
must not reset on restart. Further implementation/experiments need an explicit
active-time extension. The next Windows capture boundary and Linux attribution
gap are above. Production code, assertions, deadlines, coverage and approval rules
remain unchanged. No failure is designated a permitted flake.

## Owner extension

The owner subsequently added 30 active investigation minutes for actual Windows
fixture subprocess evidence and continued Linux I/O attribution. The independent
change is recorded in `../auth-setup-process-evidence/`. This extension supersedes
the time blocker above; it does not erase the failed attempts or reset cycles.
