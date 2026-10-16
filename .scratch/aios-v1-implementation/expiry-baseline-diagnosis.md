# Windows expiry fixture baseline investigation

Status: investigation in progress; main validation remains blocked.

The owner authorized this separate baseline repair on 16 October 2026 before further Issue 04 implementation. Production worker qualification remains open.

## Observed failure

Main `1fe02cc983f9f05f215ad5a32068655fb6071ddd`, CI run `38924113332`, Windows shard 6 job `117051158017`: the synthetic expiry test failed after 20006.5 ms with process status `null` and empty stderr. The outer Python process exceeded its 20-second timeout. The same unchanged test passed in PR #46 in 9451.9 ms. Neither result identifies which internal phase consumed the failing run's time.

## Diagnostic change

Retain flushed monotonic phase timings for Python startup, child startup, server readiness, first connection, accepted request, pending body read, expiry arming and child exit. Include the process timeout error and termination signal in assertion failures. Emit phase diagnostics on successful runs too, enabling hosted comparisons. Markers contain fixed names and elapsed times only.

No production source, timeout, expiry bound, assertion, shard assignment, workflow, coverage threshold or approval rule changes.

## Local evidence

- Unchanged fixture: both tests pass; expiry scenario approximately 6.75 seconds.
- Injecting 14 seconds before Python startup reproduces the original outer-timeout symptom. This demonstrates timeout mechanics, not the actual Windows root cause.
- The instrumented injected-delay run still fails at 20 seconds, now reporting `ETIMEDOUT`, `SIGTERM`, readiness at 3.278 seconds after Python startup, and expiry arming at 5.098 seconds. This confirms diagnostics survive the outer timeout without relaxing it.
- Instrumented normal fixture: both tests pass. Type checking passes.

## Remaining gate

Collect hosted Windows phase timings before choosing a repair. A passing rerun alone does not explain the earlier intermittent failure. Do not mark main green, baseline repaired, or Issue 04 qualified from these diagnostics.
