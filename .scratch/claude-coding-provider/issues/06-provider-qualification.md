> **Moved to GitHub:** https://github.com/AJHMH/developer-os/issues/220 on 7 November 2026. This file is history; update the issue instead.

# 06: Per-provider qualification and admission

Type: task
Status: needs-triage

## What to build

- VM probes for the Claude CLI beside `codexProbeStages` in `vm-management.ts`.
- A separate owner coding admission scope for the Claude pins, so an
  admission record admits exactly one provider.
- The decision record (`subscription-decision.ts`) names its provider instead
  of the fixed `*-codex-subscription` scopes.

## Blocked by

02, 03, 04, 05
