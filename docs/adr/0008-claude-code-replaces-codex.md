# Claude Code replaces Codex as the only coding agent

Status: accepted (2026-11-07); supersedes ADR 0003, amends ADRs 0002 and 0006

The owner removed Codex and the ChatGPT subscription from the system. Claude
Code is the only **coding agent**, and it reaches Claude models only through
**metered model access** (ADR 0006). The provider seam from ADR 0003 is
collapsed rather than kept with one member, so "coding provider", "provider
fallback" and provider-change lineages no longer exist.

With no subscription, usage windows, usage approvals and coding restart
approvals have nothing to measure. A delivery's **spend budget** ($10 by
default) is the only authority a coding turn needs; exhausting it is a
**budget interruption**, and only the owner's **budget extension** resumes
coding. Per-turn owner approval is gone.

## Considered options

- **Keep the Codex CLI, pointed at Claude through Anthropic's
  OpenAI-compatible endpoint.** This would keep the qualified guest, argv and
  probes, but it runs Codex off-label against a model it isn't catalogued
  for. That is the same reason ADR 0002's amendment rejected a catalog
  override.
- **Keep the seam with one provider.** Rejected because nothing is planned to
  plug into it, and every provider-shaped record and rule would carry a
  concept with one value.

## Consequences

- **Deleted:** the Codex CLI, its guest and pins (including
  `codeModeHostSha256`), the ChatGPT OAuth broker, the usage reader,
  subscription endorsement and decision records, the fixed-worker
  subscription gateway, and usage and restart approvals. This is destructive
  and wide-impact, so each deletion PR is a gated change.
- **ADR 0002's shape stands:** a credential-free relay on the worker's
  loopback, a host gateway and a revocable capability. The Responses wire
  API, `gpt-6.1-sol`, the code-mode host and the Codex argv are replaced by
  the Messages API, a pinned Claude model and Claude Code's own argv.
- **Qualification starts over.** Codex-era Mac fixed-worker and routed-run
  receipts stay as history; they qualify nothing about Claude Code.
- **Branch names:** delivered feature branches move from `codex/feature-<id>`
  to `aios/feature-<id>`.
