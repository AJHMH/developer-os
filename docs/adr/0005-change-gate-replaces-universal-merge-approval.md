# Change gate replaces universal merge approval

Status: accepted (2026-11-07)

Every delivered pull request used to wait for the owner's exact-head GitHub
approval, which made the owner the bottleneck of an agent system whose point is
to deliver without them. The owner decided that merge approval is now required
only for a **gated change**: one the delivery controller's **change gate**
classifies as destructive or wide-impact (CONTEXT.md). Every other required
gate (validation evidence, trusted PR checks, signing, review findings, main
verification) still applies to every PR.

The gate is fixed rules the controller evaluates on the PR head's diff and the
repository's state, not the coding worker's self-declaration and not a reviewer
model, because the thing being gated must not grade itself and the decision has
to be reproducible evidence. Each new head is classified afresh, so a PR cannot
become ungated by splitting a gated commit across pushes without each head
being judged.

## Consequences

- Onboarded repositories' branch protection must stop requiring an approving
  review for every PR, while the controller still refuses to merge a gated head
  without one. Onboarding verifies that pairing.
- The rule thresholds (file and line counts, protected paths) live in code and
  change by ordinary PR; changing which *categories* gate is a change to this
  ADR.
- This repo's own development PRs were already published without owner review
  (see owner memory); this ADR covers delivered feature PRs.
