> **Moved to GitHub:** https://github.com/AJHMH/developer-os/issues/217 on 7 November 2026. This file is history; update the issue instead.

# 03: Messages API gateway and relay

Type: task
Status: needs-triage

## What to build

A provider-specific counterpart to `GeneralSessionGateway` and the session
relay for the Anthropic Messages API:
- a pinned Claude model in place of `gatewayModel`;
- request shape rules for `/v1/messages` (model, system, messages, tools,
  thinking, max tokens), refusing anything else;
- one fixed origin, `https://api.anthropic.com`, with `redirect: "error"`;
- Claude Code reaching the relay through `ANTHROPIC_BASE_URL` on the worker's
  loopback, carrying only the revocable capability.

## Blocked by

01 (only if the credential may be mediated; otherwise rescope to egress
restriction for a CLI-held login).
