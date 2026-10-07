# Profile-page pilot readiness

Read-only inspection on 7 October 2026. Selected pilot: [AJHMH/profile-page](https://github.com/AJHMH/profile-page). No secrets read and no repository or GitHub changes made.

## Local evidence

- Checkout: `D:/repos/profile-page`. Saved origin: `https://github.com/aaron-howard/profile-page.git`; cached `origin/HEAD` is `main`. A transfer/rename may explain the identity difference, but it was not verified.
- [Repository instructions](D:/repos/profile-page/AGENTS.md:23) prohibit direct main commits and require a feature branch, PR and review. [Reusable CI](D:/repos/profile-page/AGENTS.md:19) references `aaron-howard/ci-templates@v1.0.0`.
- [CI workflow](D:/repos/profile-page/.github/workflows/ci.yml:3) runs on PRs/main, with delegated Semgrep and validation jobs.
- [E2E workflow](D:/repos/profile-page/.github/workflows/e2e.yml:3) runs on main/manual dispatch; [database requirement](D:/repos/profile-page/.github/workflows/e2e.yml:18) refers to a `DATABASE_URL` secret. Its value was not inspected.
- [Local validation documentation](D:/repos/profile-page/docs/CI-CD.md:56) and [package scripts](D:/repos/profile-page/package.json:12) declare check, formatting, lint, coverage and E2E operations. [E2E prerequisites](D:/repos/profile-page/AGENTS.md:73) include Chromium and a reachable database.
- Local signing settings enable `commit.gpgsign` and name GnuPG. Signature verification could not launch GPG in this environment, so verification output is inconclusive. Settings alone do not prove working signing.
- No Factory-specific onboarding contract, App workflow or signing policy was found in inspected root/docs/workflow files. This is a bounded source inventory, not proof that no external protections exist.

## Unverified live prerequisites

GitHub API connectivity and public-page fetching failed. Verify canonical repository identity/default branch, installed App repository access, sole approver identity, effective protections and required checks, signing locally and on GitHub, and configured credentials' push/merge authority before pilot writes.

Keep selected `AJHMH/profile-page` as the intended target; do not silently replace it with the saved local remote or rewrite that remote during planning.
