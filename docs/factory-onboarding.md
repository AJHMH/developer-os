# Factory onboarding

Developer OS is an implemented Factory consumer alongside `AJHMH/profile-page`, using the `node-24-typescript-cli` profile. Consumer adoption was merged; full certification remains unverified in retained evidence.

`factory.lock.yaml` and both reusable calls currently pin distribution 1.1.0 at `3f64904a7a71985382fa5d5da29cc0e0610d5d2c`. This supersedes the earlier PR #68 pin. The independent GitHub variable must match; its current remote value was not re-read in this documentation audit. [Hosted approval-refresh evidence](../.scratch/factory-approval-refresh/hosted-validation-20261014.md) records successful adoption, CodeQL and native CI at its recorded revision.

Native CI runs typecheck, formatting, all tests and build on Node 24. CodeQL scans
the full TypeScript CLI and GitHub Actions at the exact source revision. The
Factory produces validation, policy, coverage, security, SAST and actual owner
review reports. A successful main push produces the compiled CLI bundle and SBOM.
Certification dispatch uses that producer, the matching merged PR and the six
unchanged passing reports; validation alone is not certification.

For certification, the operator must verify the approved pin and additive
no-bypass branch protection requiring all eight Factory checks, native CI and
both CodeQL checks. Require one actual owner approval, signed commits, resolved
threads, stale dismissal, linear history and protection against deletion and
force pushes. Configure the expiring repository-only certification read token
directly in GitHub. Never place keys or credentials in candidate files.

The operator authorized the Factory App installation for all current and future
AJHMH repositories with Contents, Workflows and Pull requests write. Publication
must use a short-lived installation token restricted to `AJHMH/developer-os` and
the permissions needed for that operation; revoke it after publication. Keep the
private key outside the checkout and credentials out of Git URLs and logs.

Publish signed proposal commits through the Factory App so the latest pusher is
independent of the owner. Verify the App push identity and GitHub signature on the
actual proposal head before requesting review. App authorship alone does not
satisfy the latest-push approval rule. Only `aaron-howard` supplies the final-head
GitHub approval; a new push requires renewed approval and passing checks.

Keep a separate external owner policy for each repository. The local controller
already models canonical identities and separate repository ownership, but
production worker qualification and feature-delivery gates remain subject to the
AIOS implementation tickets. This CI proposal cannot enable unqualified worker
execution or certify production delivery readiness.

See the pinned Factory's `docs/developer-os-onboarding.md` and consumer
certification runbook for evidence assembly, verification and recovery. Recover
an adoption by a reviewed revert of its lock/calls and independent pin selection;
never waive gates to make onboarding green.
