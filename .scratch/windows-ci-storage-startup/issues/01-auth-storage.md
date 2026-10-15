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
