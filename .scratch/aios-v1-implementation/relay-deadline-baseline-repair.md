# Relay qualification deadline baseline repair

Owner-authorized scope expansion before issue 04 implementation, 15 October 2026.
Baseline main: `41f7c77b183a480c0a9ad89e817302636bdba574`.

Factory run `38840432658`, artifact `12021615915`, completed all eight execution
stages successfully. Unit/integration and line coverage passed. Branch coverage
refused no-decrease: head 4867/5348, baseline 4868/5349. The only differing file
was unchanged `src/model-relay.ts`, with one extra covered baseline callback at
line 264: the two-second revocation deadline.

The public synthetic relay canary returned passed with that timer still armed.
A clock-observation regression reproduced the leftover callback before the fix
(1 scheduled callback instead of 0). A forced deadline reproduced both the leak
and an unhandled connection-reset rejection. Both regressions pass after clearing
the deadline in cleanup and observing the pending request's rejection even when
the deadline wins before its normal await. Existing success/denial behavior and
the two-second deadline remain intact. This establishes the resource leak and
refusal cleanup defect; hosted coverage must independently validate the repair.

All six relay tests pass (74 ms); build and typecheck pass. The full suite is
running separately, with its log at `/private/tmp/relay-deadline-full-suite.log`.
No threshold, test selection, worker policy or production admission is relaxed.
