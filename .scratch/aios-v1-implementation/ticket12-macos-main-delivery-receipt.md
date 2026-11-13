# #271: a real delivery through native main verification, on macOS

12 November 2026. macOS 27.3.0 arm64, VM `aios-macos-noshare`. The owner
ran it from a freshly built, clean `main` at `078d864` (#309), with
`scripts/run-native-cli-delivery-acceptance.mjs --through-main`.

This was one real delivery on the owner's disposable repository
`AJHMH/aios-publication-acceptance`, through the native merge (#270), and
then main verification: `monitor-main-checks` verified the merged main
through the default branch's own GitHub Actions push run. It used the same
records as the [merge delivery](ticket11-macos-merge-delivery-receipt.md).

## Owner setup

The workflow ran only on pull requests, so main had no checks. The owner
changed `.github/workflows/ci.yml` to also run on pushes to `main`, adding a
`main-ci` job (`test -f index.html`) that runs only on push, while `pr-ci`
runs only on pull requests:

1. **PR [#13](https://github.com/AJHMH/aios-publication-acceptance/pull/13)**,
   opened through the contents API. Its commit `767550b7…` was unsigned, so
   the signed-commit rule blocked the merge ("the base branch policy
   prohibits the merge").
2. The owner replaced it with a commit signed by the owner's key,
   `c2ed7ba2…`, Verified, and squash-merged. Main became `6b64e555…`,
   signed by GitHub, and its first `main-ci` push run, `43362575603`,
   passed.

Before the delivery, a live read-only observation of PR 13 was complete: the
merge commit at main's tip, with `main-ci` passing and the skipped `pr-ci`
reported as skipped.

## Passing run

`issue12-main-delivery-20261112-220222.json`,
`observed-native-delivery-through-main`, SHA-256
`f69a520a320b8f4b5c78369b47e4e713b751ecf481480f045f920df2482b299a`. It passed on
the first run.

Delivery `dc3e7f17-0382-42c3-9107-45d5d43c99a3`. All 16 stages passed, in
about 3.3 minutes:

- **Repository facts:**
  - the ruleset;
  - the owner as the only person who can push;
  - PR 12's owner-signed head;
  - the production admission.
- **Baseline (29 s), coding (26 s) and candidate (35 s):**
  - the baseline passed 5 of 5 checks on `main` at `6b64e555…`;
  - one Claude Code turn: 5 requests, $0.066;
  - the candidate passed 6 of 6 checks.
- **Publication (20 s):** the owner-signed commit `0eb21835…`, parent
  `6b64e555…`, in
  [AJHMH/aios-publication-acceptance#14](https://github.com/AJHMH/aios-publication-acceptance/pull/14),
  opened by the App.
- **PR checks (25 s):** `pr-ci` run `43363080741` passed.
- **Review (8 s):** ungated, then `ready-to-merge`.
- **Merge (18 s):**
  - main was fast-forwarded from `6b64e555…` to `0eb21835…`;
  - GitHub shows PR 14 merged, with main at that head;
  - `reconcile-merge` found the same single merge.
- **`cli-monitor-main-checks` (26 s):**
  - main's own push run `43363163379` of `.github/workflows/ci.yml@main`
    ran `main-ci` on exactly `0eb21835…`, and it succeeded;
  - the outcome is `passed` for that revision, and the phase is
    `main-verified`;
  - the monitor waited through the run's start, as it does for the PR
    checks.

GitHub reports main at `0eb21835…`, Verified.

## Finding: an unchanged candidate was published and merged

PR 14 changes no files: `0eb21835…` has the same tree as its parent. The
request, "Add a visible contact hint.", was already met on main by PR 12, so
Claude Code rightly changed nothing, and the candidate passed validation
because the page does show the hint.

Even so, nothing stopped the delivery from going on:
- it published an empty, owner-signed commit;
- the change gate classified zero changed files as ungated;
- the merge fast-forwarded main to it.

Main verification is still real evidence: main moved to a new commit, and
the default branch's own push run verified it. But a delivery whose
candidate makes no change should not publish. That is a follow-up. Later
real-delivery runs also need a request main doesn't already meet.

## Not covered

- **A failing main check**, and the owner's resolution through a new signed
  PR. Tests cover it.
- **Main advancing between merge and verification.** Tests cover
  reassessment and the raced observation.
- **Main sync and cleanup** (#272 and #273).
- **Production stays disabled.** The pilot (#275) remains.

PRs 9 to 11 are still open in the disposable repository. They are harmless.
