# Onboard Developer OS with the Software Factory

**Status reconciliation — 15 October 2026:** Consumer CI adoption and approval refresh are implemented and merged. Earlier missing-workflow/governance/schema observations below belong to their recorded revisions; local configuration now pins Factory `3f64904a7a71985382fa5d5da29cc0e0610d5d2c`. No successful certification receipt was found, so full certification remains open. Current remote secrets/protections were not re-inspected. See [implementation status](../../../docs/implementation-status.md).


Status: needs-info

Blocked by: reviewed Factory distribution 1.1.0 merge; approved pin selection;
live governance; scoped certification read credential; current owner GitHub review.

Implement the [specification](../spec.md) and retain the exact source, Factory,
producer, review, check, certificate and artifact/SBOM identities. All work remains
a proposal until genuine review and hosted evidence succeed.

## Comments

2026-10-10: Owner selected AJHMH/developer-os and both feature delivery and CI
certification, supplied the external App key location, and authorized formatting
cleanup. App read/PR-write access was verified. Unchanged main typecheck and 65
tests passed outside the Windows filesystem sandbox. No rulesets, classic branch
protection, Actions workflows or Actions variables existed at inspection.
