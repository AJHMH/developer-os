# Commit and open a PR as the Software Factory App

This guide describes the operator publication route implemented in
[`publish-operator-proposal.mjs`](../scripts/publish-operator-proposal.mjs).
Use it from a trusted POSIX host after validating the intended changes. It creates
an App-authored commit and PR with a GitHub-verified commit signature.

## Identity and signing

The publisher currently defaults to:

| Setting | Value |
| --- | --- |
| Repository for this guide | `AJHMH/developer-os` |
| Bot author and PR creator | `ajhmh-software-factory[bot]` |
| GitHub App ID | `5180250` |
| Installation ID | `167664341` |
| Verified commit committer | `GitHub/web-flow` |

These defaults are in [`publisher.mjs`](../scripts/operator/publisher.mjs).
The publisher checks the actual App and repository installation against the
prepared proposal. Explicit `--bot`, `--app-id`, and `--installation-id` options
are available during preparation for another authorized installation.

There are two separate signing operations:

1. **App authentication:** the operator supplies the Software Factory GitHub App's
   RSA private key. The publisher uses RSA-SHA256 (`RS256`) to sign a short-lived
   JWT with the App ID as issuer. It verifies the App identity and installation,
   then requests a repository-scoped installation access token.
2. **Commit signing:** the publisher authenticates with that installation token
   and calls GitHub GraphQL `createCommitOnBranch`. GitHub creates and signs the
   commit. The publisher requires `verification.verified: true`, verification
   reason `valid`, the expected bot author, and committer login `web-flow`, along
   with the expected tree and parent.

The App RSA private key authenticates API access; it is not a local Git commit
signing key. This route does not run `git commit -S`, use an operator's GPG/SSH
signing key, or make the bot the committer. GitHub holds the private key used for
its platform commit signature; the operator does not receive that key.

## Which key to supply

Supply an existing, authorized **RSA private key for the Software Factory GitHub
App**, obtained through the App's authorized administration process. The key must
match the configured App. This guide deliberately contains no PEM material,
installation tokens, or JWTs.

There is no hard-coded key filename in the publisher. Its location is supplied
at execution time with `--private-key-path`. Use a private location outside the
checkout; the example below uses a placeholder rather than claiming a particular
key file is installed on this computer. The publisher checks that the file is an
ordinary single-link file, owned by the operator, with no group/other permissions,
and parses it as an RSA key. A symlink or key inside the source repository is
refused. Mode `0600` is suitable for the key; use `0700` for its containing private
directory. Never copy the key into Git, proposal state, PR text, logs, or chat.

The installation token is restricted to this repository with contents and pull
requests write permissions. Workflow write is requested only when the proposal
changes workflow files. The publisher revokes the token during cleanup. Failed
revocation means the operation is incomplete; the token otherwise remains valid
until its issued expiry. No personal access token is used for App-authenticated
writes. Both `prepare` and `publish` use an authenticated `gh` CLI for read-only
GitHub observations. `publish` checks the remote base with `gh` before it loads
the App key, so a host without a logged-in `gh` cannot run either step.

## Prepare and publish

Prerequisites: Node.js 24 (the repository's `engines` range, `>=24.10.0 <25`)
and a `gh` CLI authenticated with read access to the repository.

Start on an explicit `codex/` branch. For a new branch, HEAD must match the current
base; for an existing remote branch, HEAD must match its remote head. Stage only
the intended files and leave no unstaged tracked changes. Preserve unrelated
untracked reports. Complete the validation required by the repository before
publication.

Use a fresh private state directory outside the checkout. Proposal files contain
source bytes and must remain private. The following commands are a template;
replace the key path, title, body file, and branch with the intended values.

```sh
# Run from the repository root on the intended codex/ branch.
umask 077
PUBLISH_DIR="$(mktemp -d "${TMPDIR:-/tmp}/factory-publish.XXXXXX")"
APP_KEY_PATH="/absolute/private/location/software-factory-app.pem"
PR_BODY_FILE="/absolute/path/to/reviewed-pr-body.md"

node scripts/publish-operator-proposal.mjs prepare \
  --repo "$PWD" \
  --state-dir "$PUBLISH_DIR" \
  --repository AJHMH/developer-os \
  --branch codex/my-change \
  --base main \
  --title "Describe the change" \
  --body-file "$PR_BODY_FILE" \
  --draft false
```

Inspect the returned private proposal, including its exact changes, parent, tree,
base, identities, PR text, and digest. Preparation loads no App key. Set
`PROPOSAL_DIGEST` to the returned digest only after reviewing that exact proposal
and confirming that publication is authorized.

```sh
PROPOSAL_DIGEST="REPLACE_WITH_REVIEWED_PROPOSAL_DIGEST"

node scripts/publish-operator-proposal.mjs publish \
  --repo "$PWD" \
  --state-dir "$PUBLISH_DIR" \
  --digest "$PROPOSAL_DIGEST" \
  --approve-digest "$PROPOSAL_DIGEST" \
  --private-key-path "$APP_KEY_PATH"
```

The digest assertion records local operator authorization. It does not provide
GitHub human review. The publisher rechecks local and remote inputs, creates the
remote branch when needed, and creates the commit with `expectedHeadOid` to
prevent overwriting an unexpected head. It verifies the accepted commit, creates
or observes the matching bot PR, checks its identity and head, and adopts the
verified commit locally. There is no separate personal `git push` step.

The supported proposal limits are 100 changed ordinary non-executable files,
2 MiB per file, and 8 MiB total. Unsafe Git configuration, linked files,
executable-mode changes, sensitive credential paths, and credential-like content
are refused. Do not bypass these refusals to publish a larger proposal.

## Verify the result and retain recovery evidence

The publisher verifies the author, signature, tree, parent, PR creator, and PR
head. Independently inspect the exact published SHA in GitHub if needed:

```sh
gh api repos/AJHMH/developer-os/commits/EXACT_COMMIT_SHA \
  --jq '{sha, author: .author.login, committer: .committer.login, verification: .commit.verification}'

gh pr view PR_NUMBER --repo AJHMH/developer-os \
  --json url,author,headRefOid,reviewDecision,mergeStateStatus,statusCheckRollup
```

Expect the Factory bot author, `web-flow` committer, and verified/valid signature.
Record the created PR link in the task handoff and monitor checks for its exact head.
Required current-head human review, coverage, branch protection, main checks, and
production qualification remain independent requirements.

Keep the private proposal and receipt if publication fails or is interrupted.
The publisher records write intent and can adopt an already accepted matching
commit or PR on replay. An uncertain write blocks further publication until its
outcome is reconciled. Do not delete receipts, force-update a branch, or choose a
new digest to evade that block. Base drift requires a newly reviewed proposal.

For the complete operator contract and recovery constraints, see
[Trusted operator tools](operator-tools.md). This manual host route does not
qualify the production controller's separate signing or publication contract.
