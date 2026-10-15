# Factory onboarding alongside profile-page

**Status reconciliation — 15 October 2026:** Consumer CI adoption and approval refresh are implemented and merged. Earlier missing-workflow/governance/schema observations below belong to their recorded revisions; local configuration now pins Factory `3f64904a7a71985382fa5d5da29cc0e0610d5d2c`. No successful certification receipt was found, so full certification remains open. Current remote secrets/protections were not re-inspected. See [implementation status](../../docs/implementation-status.md).


Status: ready-for-agent

## Request

Onboard `AJHMH/developer-os` for both governed feature delivery and full CLI CI
certification without replacing `AJHMH/profile-page`.

## Acceptance criteria

- The real TypeScript CLI passes typecheck, formatting, all tests and build under
  Node 24. Existing baseline formatting cleanup is owner-authorized.
- Immutable reusable Factory calls and a matching lock bind independent source
  and Factory history; candidate settings never select trusted authority.
- The full compiled CLI, source maps, declarations, committed manifest and npm
  SBOM are retained and verified without rebuilding during certification.
- Every baseline gate, current owner GitHub approval, exact-source hosted check,
  live protection and matching producer is required for certification.
- Repository-specific App access, signed publication identity, external owner
  policy and protections are verified for delivery; qualification gaps remain
  explicit blockers. Configuration cannot enable unqualified worker execution.
- Profile-page's configuration and independently selected Factory pin remain
  unchanged. The two repositories retain separate ownership and evidence.

## Validation

Use the public Factory `distribution`, `measure-coverage`, `release-artifact`,
`consumer-evidence`, `governance` and `certify` operations plus genuine hosted
checks, current owner review and a retained successful certificate. Synthetic
tests and configuration inspection do not replace live certification.
