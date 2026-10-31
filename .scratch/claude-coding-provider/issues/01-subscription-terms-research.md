# 01: Can a Claude subscription be mediated?

Type: research
Status: ready-for-human

## Question

The ChatGPT subscription is held by the controller and relayed to the worker
as a revocable capability (ADR 0002). Anthropic's consumer terms and Claude
Code documentation restrict using a Pro/Max subscription's OAuth credentials
outside Anthropic's own clients. Determine from the *current* terms:
- whether the controller may hold a Claude subscription token and call
  `api.anthropic.com` on the worker's behalf;
- whether running the official Claude Code CLI, signed in to the subscription,
  inside the isolated VM is permitted for this personal, single-owner use;
- whether subscription usage can be read programmatically (see issue 05).

## Done when

The owner records a decision with links to the terms read and their date.
Issues 03, 04 and 05 are rescoped to match (mediated relay, or CLI-held
login with an egress-restricted VM).

## Blocks

03, 04, 05
