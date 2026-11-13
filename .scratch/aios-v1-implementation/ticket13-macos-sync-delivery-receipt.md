# #272: a real delivery through native main sync, on macOS

13 November 2026. macOS 27.3.0 arm64, VM `aios-macos-noshare`. The owner
ran it from a freshly built, clean `main` at `eee53f0` (#313), with
`scripts/run-native-cli-delivery-acceptance.mjs --through-sync`.

This was one real delivery on the owner's disposable repository
`AJHMH/aios-publication-acceptance`. It went through the native merge
(#270) and main verification (#271), then main sync:
- `sync-main` fast-forwarded the delivery's own checkout to exactly the
  verified revision;
- `reconcile-main-sync` then found it aligned.

It used the same records as the
[main delivery](ticket12-macos-main-delivery-receipt.md). Every run now asks
for a unique line (`Delivery check <8 hex>`), so main never already meets the
request.

## First run: blocked before publication

`issue13-sync-delivery-20261113-090747.json` blocked at `cli-publish-feature`
after 2.6 seconds. Every earlier stage passed, including the candidate's
acceptance check, for $0.055 (4 requests). Nothing was written to GitHub.

**Cause:** ssh-agent had no identities. The publisher's `inspect()` reported
`signingAvailable: false`, while the push and the App's PR permission were in
place. The owner loaded the key with
`ssh-add --apple-use-keychain ~/.ssh/id_ed25519` and ran again.

**Follow-up:** the refusal says only "Publication blocked…". It should name
the missing signing key, and the run should check signing before it spends
anything on the model.

## Passing run

`issue13-sync-delivery-20261113-093545.json`,
`observed-native-delivery-through-sync`, SHA-256
`a04e5557664ebafd3c2793b7e9572a6e29d63950e079ee23079c25cc76252ef0`.

Delivery `b2e404e3-1e33-42ab-9ea7-9cf6e671e13f`. All 17 stages passed, in
about 3.5 minutes:

- **Repository facts and owner inputs:** the ruleset, the owner as the only
  person who can push, PR 14's owner-signed head, and the production
  admission.
- **Baseline (31 s), coding (27 s) and candidate (36 s):**
  - the baseline passed 5 of 5 checks on `main` at `0eb21835…`;
  - one Claude Code turn: 5 requests, $0.056;
  - the candidate passed 6 of 6 checks, with the acceptance check finding the
    unique line.
- **Publication (22 s):** the owner-signed commit `26f4541d…`, parent
  `0eb21835…`, changing `index.html`, in
  [AJHMH/aios-publication-acceptance#15](https://github.com/AJHMH/aios-publication-acceptance/pull/15),
  opened by the App.
- **PR checks (26 s):** `pr-ci` run `43454534996` passed.
- **Review (8 s):** ungated, then `ready-to-merge`.
- **Merge (19 s):**
  - main was fast-forwarded from `0eb21835…` to `26f4541d…`;
  - GitHub shows PR 15 merged, with main at that head;
  - `reconcile-merge` found the same single merge.
- **Main checks (26 s):** main's own push run `43454662769` ran `main-ci` on
  exactly `26f4541d…`, and it succeeded. The phase is `main-verified`.
- **Host checkout unchanged:** the delivery's clone was still on main at
  `0eb21835…` and clean.
- **`cli-sync-main` (10 s):**
  - the clone's local main fast-forwarded from `0eb21835…` to `26f4541d…`;
  - the clone is on main and clean, with HEAD and main both at `26f4541d…`;
  - `reconcile-main-sync` found it `aligned`, and the phase is
    `main-synchronized`.
- **Coding-session cleanup** passed.

GitHub reports main at `26f4541d…`, Verified.

## Not covered

- **A dirty, divergent or busy checkout.** Tests cover each refusal: tracked,
  staged and untracked work, another worktree on main, held locks, a
  configured filter or include, a foreign origin, and an ignored file the
  fast-forward would overwrite.
- **Main moving between verification and sync.** Tests cover the re-observed
  refusal.
- **Branch cleanup and the completion report** (#273).
- **Production stays disabled.** The pilot (#275) remains.

PRs 9 to 11 are still open in the disposable repository. They are harmless.
