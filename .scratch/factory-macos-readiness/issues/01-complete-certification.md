# Complete Developer OS Factory certification

**Status reconciliation — 15 October 2026:** Consumer CI adoption and approval refresh are implemented and merged. Earlier missing-workflow/governance/schema observations below belong to their recorded revisions; local configuration now pins Factory `3f64904a7a71985382fa5d5da29cc0e0610d5d2c`. No successful certification receipt was found, so full certification remains open. Current remote secrets/protections were not re-inspected. See [implementation status](../../../docs/implementation-status.md).


Status: ready-for-human

The macOS audit prepared local dependencies, portable test fixtures and active
no-bypass governance. See `docs/factory-macos-readiness.md` for verified facts.

Remaining work: reviewed Factory security/SAST profile schema correction;
review and publish the local portability/subprocess repair with current owner
approval; configure the expiring repository-only certification read token
directly in GitHub; update the independently approved pin; run exact-source
CodeQL and all Factory gates; assemble matching producer evidence and retain a
successful hosted certificate. Production macOS worker qualification is separate.

## Comments

Original failing reports and local test log are retained alongside this ticket.
No credentials, gate exceptions or fabricated approvals were introduced.
