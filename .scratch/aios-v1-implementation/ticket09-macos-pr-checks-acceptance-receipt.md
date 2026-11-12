# #268: native PR check acceptance on macOS

12 November 2026. macOS 27.3.0 arm64. The owner ran it from a freshly built
`main` at `2b7661b` (#298). The report records `buildFresh: true` but not its
source revision.

It wrote only to the disposable repository
`AJHMH/aios-publication-acceptance`: two signed branches, two App PRs and one
rerun. It touched no `main` of this repository, approved nothing, merged
nothing and used no model. It took about two minutes.

This proves the native monitor
([trusted PR checks](../../docs/trusted-pr-checks.md#native-monitor-268))
against real GitHub Actions:
- it observes the PR, its runs, and every job of every attempt through the
  owner's `gh` login;
- it trusts only the declared workflow, unchanged from `main`;
- its one write, a rerun of failed jobs, is recorded and then receipted by the
  run's next attempt.

## Setup

- **Owner record:** `~/.developer-os/admission/publication-identity.json`,
  SHA-256 `54704cac…`. The publications went through the native publisher
  (#267) with the owner's key in ssh-agent.
- **Acceptance CI:** the owner added `.github/workflows/ci.yml` to the
  disposable repository's `main` in commit `d51df72c…`. It has one job,
  `pr-ci`, that runs `test ! -e acceptance/fail` on pull requests to `main`.

## Passing run

`issue09-pr-checks-acceptance-20261112-091625.json`, outcome
`observed-native-pr-checks-acceptance`, SHA-256
`04f74d5ce078e2ceb5b5047e029ceacde54fd0defe121a5ad2efe4711a5d2cf8`. It passed on
the first run. All six stages passed:

- **`publish-passing` (28 s):** the App opened
  [AJHMH/aios-publication-acceptance#2](https://github.com/AJHMH/aios-publication-acceptance/pull/2),
  head `2f269451…`, owner-signed.
- **`observe-pass` (21 s):** run `43246070871`, attempt 1, `pr-ci` succeeded.
  The publisher is `github-actions` and the workflow is
  `.github/workflows/ci.yml@main`. The controller's verdict is `passed`.
- **`publish-failing` (23 s):**
  [AJHMH/aios-publication-acceptance#3](https://github.com/AJHMH/aios-publication-acceptance/pull/3),
  head `b84d1555…`, which adds `acceptance/fail`.
- **`observe-failure` (21 s):** run `43246204506`, attempt 1, `pr-ci` failed,
  with the same trusted identity. The verdict is `failed`.
- **`rerun` (1 s):** the operation `6ad3ef9f…` was recorded before dispatch.
  GitHub accepted the rerun of the run's failed jobs.
- **`observe-rerun` (21 s):** attempt 2 of the same run appeared and failed,
  as it must with the switch still present. The receipt state is `accepted`.
  Attempt 1's failure is still in the history, and the verdict stays `failed`.

## Not covered

- **The CLI commands on a delivery.** `monitor-pr-checks`, `rerun-pr-check`
  and `repair-pr-checks` install this monitor from the owner policy, but no
  real delivery has reached them. That needs the owner's production admission
  record (ticket 04), which doesn't exist yet.
- **Untrusted workflow changes, natively.** No PR here changed the workflow.
  Tests cover the `untrusted-workflow-change` publisher.
- **Pagination, natively.** Each head had one run and one job per attempt;
  tests cover multiple pages.
- **Timeouts and unanswered reruns, natively.** Tests cover the timeout and
  the two-minute absence rule.
- **A passing rerun (a flake).** Tests cover it.

PRs 2 and 3 and their branches are left open in the disposable repository.
They are harmless.
