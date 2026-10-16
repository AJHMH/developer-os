# Native Windows storage phase profile

Baseline: merged PR #50, `22f55c368e4bf7723885a1390dcb034172a31813`.
Local main and origin/main matched; all 24 active main checks passed before
this diagnostic slice. The policy's conditional certification job was skipped.
The original timeout remains unexplained; no cause-specific repair is claimed.
The prior repair allowance retains 14 active minutes; this diagnostic slice
continues that allowance, with CI waits excluded.

## Question and experiment

Do successful cold initializations spend most elapsed time in the measured
stdin/path/identity/ACL stages, or outside those stages? The latter includes
PowerShell startup, instrumentation initialization, I/O and process exit; it
must not be labeled pure startup time.

A Windows-only, explicitly invoked synthetic probe calls the existing public
initializer and strict native storage ACL observation. It records fixed stage
labels with relative milliseconds, total native invocation time, exit/timeout
metadata and source/runtime identity. Four fresh hosted runners each execute
up to four sequential samples; later samples share host caches. Sampling stops
on the first refusal. No storage action is retried, no deadline is increased,
and no owner credential, path, identity, raw error or input is recorded.

The 15-second native deadline, minimal environment, existing ACL/DPAPI code and
all production source remain unchanged. The probe creates and removes only
its own newly created synthetic setup directories. Successful timings cannot
explain the historical failure; a reproduced failure is still needed.

Temporary workflow hardening review: no findings. Pull-request trigger only,
contents-read permission, hosted runners, SHA-pinned actions, credentials not
persisted, no secrets, and no candidate text interpolated into run scripts.
The sampling workflow will be removed after collecting observations.

Status: diagnostic observation pending. Issue 04 and production qualification
remain blocked; this is not a storage timeout fix or a gate waiver.
