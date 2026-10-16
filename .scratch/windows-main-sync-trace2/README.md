# Opt-in Windows fixture Git phase investigation

Status: PARTIAL. Main `92447c2` passed all 24 executed checks after PR #55
merged; local main and origin/main matched. The original Windows push cause is
still unknown. Main's shard retained 29 Git observations, maximum 299 ms, with no
null status or spawn error. A passing main run does not explain the prior failure.

The owner authorized continuation within the existing allowance, with all
subprocess limits, isolation and safety checks unchanged. Twenty active minutes
remained at the start of this phase; CI waits do not consume that allowance.

## Probe and controls

The explicit external-process preload observes only Git pushes with the existing
isolated main-sync fixture argument signature. Normal tests and application code
never load it. It preserves the command, arguments, subprocess options and result;
it only adds Git's diagnostic event-file destination to that command's environment.
It neither warms Git nor adds workload stress or retries.

Git temporarily writes its native trace inside a newly created private temporary
directory. The probe reads at most 64 KiB and retains at most 128 allowlisted
phase/exit events, numeric timings and numeric process relationships. Raw trace
arguments, repository paths, process identifiers, error messages and environment
values are never published. Raw fixture traces are removed on process exit;
cleanup failure is explicit. Missing, truncated or unreadable traces are not
assumed healthy. The native trace can include temporary fixture arguments on disk;
it is not an owner-credential or production-repository trace.

Three explanations remain distinguishable: no Git execution/startup progress;
transport child progress without completion; or time spent in packing/index work.
These are predictions for future trace evidence, not historical conclusions.
The temporary comparison runs the complete original Windows shard 3/8 once on
each of two hosts, unchanged concurrency two and unchanged five-second Git limit.
The workflow will be removed after its artifacts are reconciled.

`verify-trace.mjs` runs the existing public test with a controlled real Git refusal
at the external process seam. It failed before phase capture existed, then passed
with retained push/exit evidence and no branch argument or fixture directory in
the published record. A positive control passed the unchanged original scenario
and retained three successful native pushes. This tests diagnostic correctness;
it does not reproduce the unexplained historical null status. The refusal control
runs after the complete native shard so it cannot warm that observation.
