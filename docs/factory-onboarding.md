# Factory onboarding

Developer OS is an implemented Factory consumer alongside `AJHMH/profile-page`, using the `node-24-typescript-cli` profile. Consumer adoption was merged; full certification remains unverified in retained evidence.

`factory.lock.yaml`, both reusable calls and the approval-refresh tool select
Factory `26c641d207c0754eeb2037679d944cebe62977ff` (Factory PR #74).
Factory PR #74 received owner review and merged. Set the
independently approved `FACTORY_DISTRIBUTION_REVISION` to the reviewed revision
before the consumer upgrade can pass adoption inspection. The new certification
path retains the successful exact-head PR package and gate reports, checks that
the merged tree and baseline match, and rechecks live approvals and protection.
Native CI, CodeQL and Factory adoption run on PRs; merging to main does not repeat
them. Certification stays an explicit dispatch using the PR head and its producer
run ID, with no consumer build or test execution. See the
[rollout record](../.scratch/pr-evidence-certification/spec.md).

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

## Stacked PRs and last-push approval

Merging a stacked PR into its dependency branch is a push to that branch. If the
owner performs that merge, GitHub records the owner as the latest pusher even
when the commit author is the Factory bot. The owner's subsequent approval of
the dependency PR cannot satisfy `require_last_push_approval`, which requires a
different approving actor. Passing Factory approval checks do not override this
native GitHub requirement.

For stacked work, have the Factory App perform authorized merges into dependency
branches after their own review and check requirements pass. Verify the branch
activity actor before asking the owner to approve the final dependency head.
If an owner push has already caused this blocker, publish any needed corrective
follow-up through the App and obtain a fresh owner review on the resulting head.
Do not disable last-push approval, fabricate reviews, or assume an empty/no-op
push changes the latest reviewable pusher.

PR #35 demonstrated this distinction: the owner's squash merge of PR #34 made
the owner the last pusher, despite bot authorship and two current-head approvals.
The corrective App follow-up documents this requirement; it still needs its own
fresh owner approval and passing checks.

Keep a separate external owner policy for each repository. The local controller
already models canonical identities and separate repository ownership, but
production worker qualification and feature-delivery gates remain subject to the
AIOS implementation tickets. This CI proposal cannot enable unqualified worker
execution or certify production delivery readiness.

See the pinned Factory's `docs/developer-os-onboarding.md` and consumer
certification runbook for evidence assembly, verification and recovery. Recover
an adoption by a reviewed revert of its lock/calls and independent pin selection;
never waive gates to make onboarding green.
