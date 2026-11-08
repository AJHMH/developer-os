> **Moved to GitHub:** https://github.com/AJHMH/developer-os/issues/219 on 7 November 2026. This file is history; update the issue instead.

# 05: Claude subscription usage reader

Type: task
Status: needs-triage

## What to build

A `SubscriptionReader` for the Claude subscription, adding its mode to
`SubscriptionAuthMode`, with windows, exhaustion and an account id the owner can
endorse (`subscription-endorsement.ts`). If no reliable usage source exists,
the gate must keep requiring owner approval for every turn rather than
assume headroom.

## Blocked by

01
