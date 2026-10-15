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

## Rejected scheduling hypothesis

Serial file run `d0404df`, CI 38769070684, shard 2 still failed: first initialization timed out at 15,035 ms; the next initialization passed in 4,974 ms. Serialization alone does not fix this failure and is reverted. Fixed-label script milestones now distinguish process entry, module imports, path parsing and ACL application without recording any request, path or raw child error.

## Failing bootstrap milestone

Run 38770509393, shard 2, first initialize: 15,014 ms, timed out; milestones `entered`, three `module-start`, then `modules-ready`, with no `path-ready` or `acl-ready`. The cold bootstrap consumes the deadline before ACL work. The next initialization passes at 2,135 ms. Run 38770571500's isolated cold probe passed at 6,850 ms, preserving the observed variability. This is a cold PowerShell bootstrap dependency, not proof of a permission denial or of concurrency as the sole cause.

Native regression: disable module autoloading and deny `Import-Module` and `ConvertFrom-Json` at the actual helper invocation, then require real registration, protected metadata checks, DPAPI create/read/replace and retained-file refusals to succeed under the unchanged deadline. The complete eight-shard suite remains unchanged.
