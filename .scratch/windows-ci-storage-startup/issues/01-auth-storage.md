# Diagnose and repair Windows auth-storage startup refusal

Status: needs-info

## Observed failure

Main `521c930`, CI run 38756987964, attempts 1 and 2: the first Darwin-adapter authorization fixture on native Windows fails during registration preparation after about 15.1 seconds with a generic storage refusal. The native storage layer still runs on the actual host even when the authorization adapter is synthetic. No raw credentials or storage paths are retained here.

## Diagnostic plan

Preserve the native 15-second bound and all ownership, ACL, link, registration and DPAPI checks. Observe only fixed helper stages, elapsed milliseconds, exit status and timeout/signal booleans through the actual native subprocess boundary. Distinguish helper timeout, deterministic ACL refusal and path refusal before selecting a repair. macOS cannot establish native Windows causality; hosted Windows observation is required.

## Acceptance

- [ ] Native failure classified with safe evidence.
- [ ] Minimal regression reproduces the established cause before the fix.
- [ ] Fix preserves every existing storage and authorization safety check.
- [ ] Local checks and hosted Windows matrix pass.
- [ ] Verified Factory App commit and PR; required human approval remains independent.

## Native diagnostic result

Diagnostic commit `82d0543`, CI run 38767949417, shard 2: the first helper operation was `initialize`, elapsed 15,096 ms, exit status null, `timedOut: true`, `signaled: true`. The next initialization passed in 7,518 ms; subsequent check/create/DPAPI operations passed in about 0.3–2.4 seconds. This establishes deadline exhaustion, not an observed ACL refusal. A separate shard-5 synthetic Python helper also exhausted its existing deadline on this run.

Counterfactual under test: serialize test files within each of the eight Windows shards. Keep every test and all runtime and job deadlines unchanged. Successful native cold initialization under this schedule would support runner contention; no change to production storage enforcement is proposed.
