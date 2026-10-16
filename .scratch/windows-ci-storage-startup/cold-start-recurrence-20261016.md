# Cold Windows storage recurrence — 16 October 2026

Owner authorized a separate baseline repair before further Issue 04 work.
Local main and origin/main matched `d9a43e3184a7a99a9a7670765e2a4c49766a9e48`.
Main is not green: [cold Windows job](https://github.com/AJHMH/developer-os/actions/runs/38943230607/job/117115815829)
failed both unchanged tests. The authorization fixture reports initialize at
16,104 ms, exitCode null, timedOut true, signaled true. The separate native
module-free storage regression refused at 15,101 ms. No ACL rejection is proven.

Three ranked hypotheses: startup before script entry; .NET/ACL initialization
after entry; stdin read/decode stall. Temporary `[DEBUG-coldauth]` test-only
fixed-label milestones distinguish them without recording paths or input.
The native helper, 15-second deadline, ACL/DPAPI checks and assertions are unchanged.
Only initialization is instrumented; protect/unprotect frames are untouched.

This is diagnosis, not a claimed repair. Hosted Windows evidence is required.
Issue 04 remains paused, production disabled, qualification gates unchanged.

## First diagnostic observation

PR #50 commit `29ff3ac` cold job `117117953732` passed: initialize 3,248 ms,
all milestones present; subsequent operations approximately 0.25–0.38 seconds.
This does not reproduce or explain the original timeout and is not a repair.
Four temporary fresh-runner samples repeat the same two tests, same 15-second
helper deadline and same assertions. They do not replace any required job.

Workflow hardening review: zero critical/high/medium/low findings in the added
workflow. Pull-request trigger, contents-read token only, hosted runners,
SHA-pinned actions, no secrets or shell interpolation of candidate text,
checkout credentials not persisted. Remove diagnostic workflow after diagnosis.
