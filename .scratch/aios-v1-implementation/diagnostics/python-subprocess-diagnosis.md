# Windows Python subprocess diagnosis

Status: reproducing and minimizing; no root cause established.

At PR #39 head `e7a5903`, shards 1 and 2 pass after file scheduling repairs.
Shard 6 fails the synthetic expiry fixture at its existing 20-second subprocess
limit; shard 8 fails the generated management failure-preservation fixture at
its existing five-second subprocess limit. Both report `status: null`; the old
assertion messages omit the process error code, signal and partial progress.
The complete job logs are retained in Actions run `38819543094`, jobs
`116712471051` and `116712470722`.

## Feedback loop

Run from repository root (the local Python selection is host-specific):

```sh
AIOS_TEST_PYTHON=/usr/bin/python3 node \
  --import ./.scratch/aios-v1-implementation/diagnostics/python-subprocess-probe.mjs \
  --test --test-concurrency=1 \
  --test-name-pattern='^synthetic expiry arms|^generated native management freezes' \
  tests/codex-endpoint.test.mjs tests/podman-platform.test.mjs
```

Local result: two passed, zero failures, 6.85 seconds. Expiry subprocess:
6.71 seconds, all three stage markers reached. Management subprocess: 38 ms,
entry/import markers reached. This establishes the executable loop, not a local
reproduction of the Windows failure. A faithful Windows reproduction must come
from a Windows runner; there is no native Windows execution surface on this Mac.

The temporary CI probe repeats those exact assertions alone and alongside one
existing real local-CAS Git fixture. Full Windows shards retain their complete
inventory and original limits, with the same sanitized telemetry preload.
No test is skipped, no assertion changes, and failure in any probe repetition
fails its diagnostic job. Initial narrowing keeps both failing cases to compare
the common subprocess seam; after a Windows failure is captured, remove any
case or concurrent work that is not necessary to reproduce it.

Telemetry is tagged `[DEBUG-pr39-spawn]` and `[DEBUG-pr39-python:...]`.
It records elapsed time, error code, signal, status, output byte counts and fixed
stage presence, never arguments, environment values or program output. The
Python marker lines are removed from the returned stderr. Instrumentation will
be removed after diagnosis; this directory is explicitly temporary diagnostic
material. No timeout, concurrency cap, production policy or approval rule changes.

## Initial Windows narrowing result

All six focused repetitions passed: expiry 6.66–8.16 seconds; generated
management 72–102 ms. Full instrumented shard 6 passed with expiry at 9.53
seconds. Full instrumented shard 8 passed with management at 2.70 seconds.
These are successful measurements, not a reproduction or proof of a fix.

The next probe retains the original Python source byte-for-byte (child markers
disabled), repeats the exact management assertion up to 100 times and the expiry
assertion up to ten times, and stops at the first failure. Parent-side telemetry
still records error code, signal and duration. This tests the unmodified child
path before proceeding to causal hypotheses.

The passive repetitions use their own fresh Windows runner. Management is its
first Python workload; the staged expiry probe cannot warm it first. A separate
`stages` runner retains the initial comparative probe. Interpreter identity is
read through shell command resolution without starting Python.
