# #270: a real delivery through native merge, on macOS

12 November 2026. macOS 27.3.0 arm64, VM `aios-macos-noshare`. The owner
ran it from a freshly built, clean `main` at `4468309` (#307), with
`scripts/run-native-cli-delivery-acceptance.mjs --through-merge`.

This was one real delivery through merge, on the owner's disposable
repository `AJHMH/aios-publication-acceptance`, with the same records as the
[first real delivery](first-real-delivery-receipt.md):
- the real CLI;
- the owner's admitted Claude Code and validation runtimes;
- the production admission `eb4f607a…`;
- the publication record;
- the owner's `gh` login.

It merged by fast-forward, as the owner chose (#270): the owner's login
pushed the PR's exact head to `main`, with a lease on main's expected
revision. Only the criteria file was synthetic. It wrote one signed branch,
one App PR and one fast-forward of `main`, and submitted no review.

## Passing run

`issue11-merge-delivery-20261112-204230.json`,
`observed-native-delivery-through-merge`, SHA-256
`87bd6440adb7c00911a89f9da8c7527386e749e00c2cf9b640c50d6b80515828`. It passed on
the first run.

Delivery `e6e612fc-ea73-437b-8fa1-cf272d5e5d39`. All 15 stages passed, in
about 3 minutes:

- **`repository-facts` (3 s):**
  - the ruleset;
  - the owner as the only person who can push;
  - the App's PR 11, whose head is owner-signed and Verified, also verified
    locally;
  - the production admission naming the coding pins.
- **Baseline (29 s), coding (31 s) and candidate (34 s):**
  - the baseline passed 5 of 5 checks on `main` at `55ac2d51…`;
  - one Claude Code turn: 6 requests, $0.073 of $5;
  - it added the contact hint, and the candidate passed 6 of 6 checks.
- **`cli-publish-feature` (22 s):**
  - the owner-signed commit
    `37be509bd2ebe5748f608b1de1ba49440d380a2a`, parent `55ac2d51…`;
  - [AJHMH/aios-publication-acceptance#12](https://github.com/AJHMH/aios-publication-acceptance/pull/12),
    opened by the App.
- **`cli-monitor-pr-checks` (25 s, 2 polls):** `pr-ci` run `43354268470`
  succeeded, from `github-actions`, `.github/workflows/ci.yml@main`.
- **`cli-monitor-review` (9 s):** ungated, authorized for exactly
  `37be509b…`, `ready-to-merge`.
- **`cli-merge-feature` (18 s):**
  - `merge-feature` re-checked the PR checks, the review and the production
    admission;
  - it observed main at `55ac2d51…`, the owner as actor with push access,
    the rules enforced and `pr-ci` required;
  - it recorded the intent, then fetched the PR head and main into its own
    Git;
  - it fast-forwarded `main` to `37be509b…` with
    `--force-with-lease=refs/heads/main:55ac2d51…`;
  - the attempt is `merged`: merge commit `37be509b…`, which is the head
    itself, main `37be509b…`, phase `merged`;
  - GitHub's own view: main's tip is `37be509b…`, and PR 12 is merged, by
    `aaron-howard`, with `merge_commit_sha` `37be509b…`.
- **`cli-reconcile-merge`:** found that same single merge, with no second
  write.
- **`host-checkout-unchanged`, `coding-session-cleanup`:** the local clone
  stayed on its `main`, and the coding session was removed by its exact
  identity.

Afterwards, GitHub reports `main` at `37be509b…`, Verified, committed by
`aaron-howard`. Its `index.html` carries the hint.

## Not covered

- **A gated head merged on the owner's approval.** The review acceptance
  covers the approval natively, but no delivery merged on it.
- **Main advancing before merge.** `refresh-merge-base`, and a lease losing
  a real race on GitHub. Tests cover the race against a real bare remote.
- **An uncertain merge reconciled after a crash.** Tests cover it.
- **Main verification, main sync and cleanup** (#271 to #273).
- **Production stays disabled.** The run still reports
  `DELIVERY_NOT_ENABLED`; the pilot (#275) remains.

PRs 9 to 11 are still open in the disposable repository, now behind main.
They are harmless.
