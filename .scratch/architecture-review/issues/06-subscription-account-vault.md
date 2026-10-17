# 06: Subscription account and credential vault

Status: ready-for-agent
Progress: completed
Source: [Claude architecture review](../source-review.md)

## Scope

Own canonical account identity, registration validation, issuer/scopes and expiry eligibility. Define a neutral vault interface for Keychain and Windows and separate private-storage verification from vault construction.

Affected files: auth-host.ts, auth-status.ts, subscription-auth.ts, subscription-gateway.ts, keychain-store.ts, windows-auth-store.ts.

## Completion criteria

Account/expiry tests and fake-vault tests pass; host authentication and private-storage regressions retain their platform guarantees.

## Comments

17 October 2026: Owner authorized all recommendations, including speculative CLI and deletion decisions. Live inference, production enablement and Issue #4 qualification work are outside this diversion.

17 October 2026 implementation evidence: Authentication, private-storage, gateway and decision regressions pass: 55 passed, 2 platform skips. Neutral vault adapters and shared account/registration validation are implemented.
