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

## Native results and limitations

Run `38979409445`, source `bade224`, retained 26 successful real push traces
on each host, with no missing or truncated traces. Maximum observed elapsed
times were 468 ms and 842 ms; maximum Git-root exit times were 0.451143 s and
0.818814 s. Transport, packing and unpacking child roles were observed. The
difference between parent elapsed time and Git's recorded root exit time ranged
from 16.38–21.96 ms and 22.89–32.91 ms on these hosts. This is instrumented
healthy-push evidence, not historical startup, scheduler or filesystem attribution.

Host 1 passed all 102 shard tests (78 passed, 24 existing skips) and its subsequent
real-Git refusal control. Host 2 had 77 passed, 24 skips and one unrelated
`tests/auth-setup.test.mjs:41` failure: authentication preparation returned the
generic ordinary-external-storage refusal after 15.467 s. Its Git pushes all
succeeded; the subsequent refusal control did not run because the shard failed.
The overall run failed and is retained as failed evidence, not a passing shard.
No original main-sync null status was reproduced. The authentication failure was
not repaired, reclassified as a timeout, or waived by this experiment.

`native-observations.json` binds summaries and artifact fingerprints to the exact
source/run. Sanitized native event arrays remain in its named CI artifacts and
the private downloaded copies. The temporary workflow is removed.

### Diagnostic parser correction

The initial parser counted a trailing blank line as malformed evidence. The
real-Git refusal regression was strengthened to expect zero malformed lines;
it failed before the correction and passed after blank lines were ignored.
The positive original scenario also passed with three successful push traces and
zero malformed lines. The native source summaries preserve their original
reported counters; they are not retroactively rewritten. A reported trailing
blank is not proof of native trace corruption. Command options, results and
all original deadlines/assertions remain unchanged. The corrected parser has
local real-Git controls; the native observations bind the earlier parser source.

### Remaining gate and allowance

The historical cause remains PARTIAL and no cause-specific behavior repair is
justified. Normal tests/application code never load this probe. A future failing
execution with phase evidence is still required for causal diagnosis. All earlier
failed attempts and qualification gates remain open.

Conservatively charge 15 additional active investigation minutes from the prior
20 remaining: five active minutes remain. CI waits are excluded. The parser
correction uses the third repair cycle (following sampler supervision and the
complete pin correction). Further applicable repair cycles require an explicit
owner extension; restarts and passing probes do not reset this limit.
