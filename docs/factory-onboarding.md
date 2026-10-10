# Factory onboarding

Developer OS joins `AJHMH/profile-page` as a separate Factory consumer. This
proposal targets the full TypeScript CLI through distribution 1.1.0's
`node-24-typescript-cli` profile. It does not replace profile-page or alter its pin.

`factory.lock.yaml`, `factory-contract.yaml` and the two immutable reusable calls
declare the proposed adoption. The lock and both calls now pin the reviewed Factory PR #67 merge SHA
`2a294c1a65a95612f6963ea2c8ff382dd12fc9db`. The external Actions variable
`FACTORY_DISTRIBUTION_REVISION` must independently select that same SHA.

Native CI runs typecheck, formatting, all tests and build on Node 24. CodeQL scans
the full TypeScript CLI and GitHub Actions at the exact source revision. The
Factory produces validation, policy, coverage, security, SAST and actual owner
review reports. A successful main push produces the compiled CLI bundle and SBOM.
Certification dispatch uses that producer, the matching merged PR and the six
unchanged passing reports; validation alone is not certification.

Before certification, the operator must authorize the approved pin and additive
no-bypass branch protection requiring all eight Factory checks, native CI and
both CodeQL checks. Require one actual owner approval, signed commits, resolved
threads, stale dismissal, linear history and protection against deletion and
force pushes. Configure the expiring repository-only certification read token
directly in GitHub. Never place keys or credentials in candidate files.

The Factory App installation has been verified for this repository with Contents
read and Pull requests write. Local signing and GitHub verification must be
checked on the actual proposal head; App authorship does not supply human review.
Only `aaron-howard` supplies the final-head GitHub approval.

Keep a separate external owner policy for each repository. The local controller
already models canonical identities and separate repository ownership, but
production worker qualification and feature-delivery gates remain subject to the
AIOS implementation tickets. This CI proposal cannot enable unqualified worker
execution or certify production delivery readiness.

See the pinned Factory's `docs/developer-os-onboarding.md` and consumer
certification runbook for evidence assembly, verification and recovery. Recover
an adoption by a reviewed revert of its lock/calls and independent pin selection;
never waive gates to make onboarding green.
