> **Moved to GitHub:** https://github.com/AJHMH/developer-os/issues/218 on 7 November 2026. This file is history; update the issue instead.

# 04: Claude credential mediation

Type: task
Status: needs-triage

## What to build

Generalize the OpenAI-only pieces of `subscription-account.ts`,
`auth-broker.ts`, `auth-host.ts` and `subscription-auth.ts` so each provider
names its own issuer, client, scopes, token endpoint and JWKS. The vault
(`credential-vault.ts`) is already provider-neutral. The vault credential
account identity must include the provider.

## Blocked by

01
