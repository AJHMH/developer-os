# Claude reached through a metered API key on the gateway

Status: accepted (2026-11-07); answers ADR 0003's open question. Amended by ADR 0008: Codex is removed, so there is no provider fallback

Claude Code joins Codex as a coding provider. Anthropic's consumer terms, as
understood on 2026-11-07, do not allow a Pro/Max subscription credential to be
held and relayed by a third-party controller, which is how ADR 0002 handles the
ChatGPT subscription. The owner chose **metered provider access**: the
controller holds an Anthropic API key and relays Messages API requests through a
host gateway and session relay of the same shape as ADR 0002, so the credential
still never reaches the coding VM.

## Considered options

- **Claude Code signed in to the subscription inside the VM.** Rejected: it puts
  a live credential inside the worker, undoing ADR 0002's central property.
- **Subscription token relayed by the controller.** Rejected on terms.

## Consequences

- This breaks the original spec's subscription-only rule. The owner chose
  **provider fallback**: when a delivery's Codex usage is exhausted it moves,
  once and without asking, to Claude Code on paid access. Its per-delivery
  **spend budget** is what bounds that, not a fresh owner approval.
- Subscription usage windows and usage approvals don't apply to Claude; its
  turns are bounded by the spend budget instead of usage observations.
- Claude gets its own pins, owner coding admission scope, gateway (Messages
  API, pinned model) and relay port; no admission record admits both providers.
