# Coding standards

Judgement calls for review. Anything a check can decide belongs in a check.

- **Bounded retries make progress.** A loop bounded by attempts must still reach
  later items when earlier ones keep failing, and must end when nothing moved.
- **A digest-moving change is reviewed before it merges.** Fix each review thread
  on a PR that moves a digest in `docs/owner-hosts.md`, rather than resolving it
  for later: a later fix costs another re-pin on both hosts.
- **Removals keep what a later step inspects.** Name what resume, recovery and
  collection read, and test that each still works after the removal.
