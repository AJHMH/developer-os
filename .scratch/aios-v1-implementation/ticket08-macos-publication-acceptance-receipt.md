# #267: native publication acceptance on macOS

11 November 2026. macOS 27.3.0 arm64. Run by the owner from a freshly built
`main` at `b9bcb1b` (#295). The report records `buildFresh: true` but not its
source revision. It wrote only to the disposable repository
`AJHMH/aios-publication-acceptance`: one signed branch and one PR. It touched
no `main`, approved nothing and merged nothing, and used no model.

This proves the native publisher's two ports
([signed publication](../../docs/signed-publication.md#native-publisher-267)):
- the owner's key signs through ssh-agent;
- the owner's `gh` login pushes, conditionally;
- GitHub verifies the signature;
- the Software Factory App opens the PR with a narrowly scoped token.

## Identities

- **Owner record:** `~/.developer-os/admission/publication-identity.json`,
  private. It holds identities and key paths only.
- **Signing key:** the owner's `~/.ssh/id_ed25519`, unlocked into ssh-agent
  with `ssh-add --apple-use-keychain`. The key's SHA-256 is `144a1613…`.
- **App:** `ajhmh-software-factory[bot]` (App 5180250, installation
  167664341). Its key's SHA-256 is `3d7808f7…`, which differs from the
  signing key's.
- **Each PR token:** `pull_requests: write` and `contents: read` on the one
  repository, revoked after use.

## Runs

1. **`issue08-publication-acceptance-20261111-192924.json`** (`c7c256c`).
   Blocked at `base-revision`, before any write. Asked for a commit's tree,
   GitHub answers with the commit's SHA, so `main`'s files never matched.
   Fixed in #293.
2. **`issue08-publication-acceptance-20261111-194222.json`** (`2937791`).
   - **Sign and push passed:** GitHub reported the head `42acc352…` Verified
     (`valid`), signed and pushed by the owner.
   - **PR creation was refused** with no reason given. #294 added GitHub's
     status and reason to the error.
3. **`issue08-publication-acceptance-20261111-201148.json`** (`704cce6`).
   - **Sign and push passed** again.
   - **PR creation was refused** with `HTTP 422: Validation Failed; not all
     refs are readable`: on a private repository, a `pull_requests`-only
     token can't read the branches. The owner chose to add `contents: read`,
     which went in with #295.
4. **`issue08-publication-acceptance-20261111-203853.json`** (`b9bcb1b`):
   `observed-native-publication-acceptance`, SHA-256
   `e3bad358d214988dee4f12f52627ae0092f11c9f6ef9e2171962b54b485c2d0e`.

Runs 2 and 3 left their signed branches with no PR; they're harmless.

## Passing run

All six stages passed:

- **`publication-authority`:**
  - the `gh` login is `aaron-howard`, the agent holds the signing key, and the
    owner can push;
  - the App's PR authority is `pull_requests:write`;
  - the two keys differ.
- **`base-revision`:** `main` at `871a1389…`, rebuilt from its files. One file
  was added under `acceptance/`.
- **`sign` (1 s):** the commit `c73dcb9a4bc3e7de3ada131cd03649adbad548e1`,
  locally verified against the owner's key. Its tree is the admitted tree, and
  its parent is `main`.
- **`push` (3 s):** pushed to
  `aios/feature-acceptance-5a2a239d-f0e5-4ac6-bf88-2e01d755993e` with a lease
  expecting absence. GitHub reports it `verified: true`, reason `valid`.
  The committer is `aaron-howard`, and the activity record names
  `aaron-howard` as the pusher.
- **`pull-request` (5 s):** the App opened
  [AJHMH/aios-publication-acceptance#1](https://github.com/AJHMH/aios-publication-acceptance/pull/1).
  Its author is `ajhmh-software-factory[bot]`, and its head is `c73dcb9a…`
  onto `main`.
- **`reconcile` (6 s):** reconciling found the signed commit, the branch and
  PR #1 again. A repeated push and a repeated PR creation returned the same
  branch and PR, with no second write.

## Not covered

- **The CLI's `publish-feature`** doesn't install these ports yet; that's
  #267's second part. A delivery's publication also needs the owner's
  production admission record (ticket 04), which doesn't exist yet.
- **Interrupted writes, natively.** An unanswered push or PR creation is only
  reported absent once it can't land; tests cover this.
- **An update to an existing branch, natively.** Tests cover it with real Git.
