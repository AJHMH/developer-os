# PR #39 intermittent validation findings

Status: failures observed in hosted CI; no causal repair established.

Original run `38819543094` failed Windows shard 6 at the existing 20-second
synthetic-expiry Python subprocess limit and shard 8 at the existing five-second
management-fixture limit. Both unmodified shards passed on the single diagnostic
rerun. Successful reruns do not prove a fix.

Focused Windows probes completed 100 management and ten expiry cases without
skips or failures. Passive full shards also passed. No faithful reproduction
was obtained, so no speculative Python change or timeout increase was made.
Temporary subprocess telemetry and diagnostic jobs have been removed.

A separate Factory contract run (`38824892538`) exceeded its unchanged
120-second test-command budget. Captured output was not truncated. A public-CLI
output-drain probe passed with zero, 256 KiB and 2 MiB on each stream, providing
no evidence for output backpressure.

A controlled full-inventory experiment on one Linux runner in run `38826230629`
measured concurrency 4, 6, then 4: test-command times were 98.563, 96.066 and
100.446 seconds. Each ran 552 tests: 549 passed, three platform skips, zero
failures. The small difference does not justify changing the established
concurrency of four. The aggregate timeout did not reproduce in this experiment.

All production settings, assertions, coverage thresholds, approval requirements
and execution budgets remain intact. These observations document uncertainty;
they do not establish a root cause or guarantee against recurrence.
