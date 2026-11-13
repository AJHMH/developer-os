# #273: a real delivery through native branch cleanup, on macOS

13 November 2026. macOS 27.3.0 arm64, VM `aios-macos-noshare`. The owner
ran it from a freshly built, clean checkout of
[AJHMH/developer-os#315](https://github.com/AJHMH/developer-os/pull/315) at
`6ccf532`, with `scripts/run-native-cli-delivery-acceptance.mjs
--through-cleanup`. That PR head differs from the merged one only in tests
added for coverage.

This was one real delivery on the owner's disposable repository
`AJHMH/aios-publication-acceptance`. It went through:
- the native merge (#270);
- main verification (#271);
- main sync (#272);
- then branch cleanup: `cleanup-branches` deleted every branch merged into
  the verified main, kept every other branch, and completed the delivery.
  `reconcile-cleanup` found that same single completed cleanup.

It used the same records as the
[sync delivery](ticket13-macos-sync-delivery-receipt.md).

## Passing run

`issue14-cleanup-delivery-20261113-110447.json`,
`observed-native-delivery-through-cleanup`, SHA-256
`2ad9d95932fe916682d48f8011f1a47b1d1bae2d57c293e21ca3fe9bd1dd0267`. It passed on
the first run.

Delivery `bf998f89-365c-43c1-a164-690ea5aba98b`. All 18 stages passed, in
about 7.2 minutes:

- **Baseline (31 s), coding (29 s) and candidate (36 s):**
  - the baseline passed on `main` at `26f4541d…`;
  - one Claude Code turn: 5 requests, $0.058;
  - the candidate passed 6 of 6 checks.
- **Publication (23 s):** the owner-signed commit `881d6806…`, parent
  `26f4541d…`, in
  [AJHMH/aios-publication-acceptance#16](https://github.com/AJHMH/aios-publication-acceptance/pull/16),
  opened by the App.
- **PR checks (26 s):** `pr-ci` run `43469531538` passed.
- **Review (8 s):** ungated, then `ready-to-merge`.
- **Merge (19 s):** main was fast-forwarded from `26f4541d…` to `881d6806…`,
  and `reconcile-merge` found the same single merge.
- **Main checks (25 s):** `main-ci` push run `43469665566` passed on exactly
  `881d6806…`.
- **Main sync (9 s):** the clone's main was fast-forwarded from `26f4541d…`
  to `881d6806…`, clean, and reconciled `aligned`.
- **`cli-cleanup-branches` (215 s):**
  - the round is `completed` at `881d6806…`, with nothing blocked, and the
    delivery's phase is `completed`;
  - **deleted (5):**
    - this delivery's feature branch, locally and on GitHub;
    - the merged feature branches of the
      [merge](ticket11-macos-merge-delivery-receipt.md),
      [main](ticket12-macos-main-delivery-receipt.md) and
      [sync](ticket13-macos-sync-delivery-receipt.md) deliveries;
  - **retained (13), all `unmerged`:** the open and unmerged acceptance
    branches. They include the
    [first real delivery](first-real-delivery-receipt.md)'s, which reached
    `ready-to-merge` but never merged, and the earlier PR-check and review
    acceptance branches;
  - main was never a candidate;
  - GitHub no longer has the feature branch;
  - `reconcile-cleanup` found the same single completed round;
  - the next action reads "Delivery complete at the recorded verified and
    synchronized main revision; eligible branches deleted and expected
    retentions recorded. Production delivery remains disabled."
- **Coding-session cleanup** passed.

The delivery's output at `completed`, with its cleanup round, is the
completion report: the revision, each deleted and retained branch with its
reason, and the next action.

## Findings

- **Cleanup took 215 s**, most of the run. Every inventory makes one ruleset
  call per branch name, and each removal re-took the whole inventory. #317
  made a removal re-check only its own branch; see the speed-up run below.
- **Podman Desktop was open**, and the run passed anyway.

## Speed-up run (#317)

The owner reran the delivery from `main` at `0d7bf3e` (#317), with removals
that re-check only their own branch:
`issue14-cleanup-speed-20261113-115541.json`,
`observed-native-delivery-through-cleanup`, SHA-256
`278fed2aa88b46d39ec396cc4453a24ffd263b1c7009bf57602637c8a2a27d7d`. All 18 stages
passed, for $0.059. The delivery merged
[AJHMH/aios-publication-acceptance#17](https://github.com/AJHMH/aios-publication-acceptance/pull/17),
with main at `04157931…`, and cleanup:
- deleted its own feature branch, locally and on GitHub;
- kept the same 13 unmerged branches;
- blocked nothing, and completed the delivery.

`cli-cleanup-branches` took 90 s.

The coordinator takes a full inventory to plan, another after each deletion
to confirm its outcome, and a last one to finish. Each full inventory takes
about 20 s, so each deletion now costs one inventory instead of two:

| Run          | Deletions | Full inventories                     | Cleanup |
| ------------ | --------- | ------------------------------------ | ------- |
| First        | 5         | 12                                   | 215 s   |
| Speed-up run | 2         | 4, plus 2 single-branch re-checks    | 90 s    |

The rest of the time is those inventories. Each makes sequential `gh api`
calls: rules for every branch name, and PR history for every unmerged branch.

## Not covered

- **Protected, replay and worktree retention, and squash linkage,** on a real
  repository. Tests cover each, against a real bare remote and a GitHub
  stand-in.
- **A tip racing the deletion, a refused deletion, and recovery of an
  uncertain one.** Tests cover them.
- **Production stays disabled.** The pilot (#275) remains.
