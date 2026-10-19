# Sign commits and publish a PR from the macOS terminal

This guide covers personal terminal publication using SSH or GPG commit signing.
For publication as the Software Factory App, use the separate
[Factory App publication guide](factory-app-publication.md). Personal keys and
credentials do not provide the App's identity by changing a commit's name/email.

Changes prepared by an agent (Codex or Claude) in this repository are published
through the Factory App route; bot publication never substitutes the operator's
personal identity. Use this personal route only for commits you author yourself.

## Configuration observed on this Mac

Read-only inspection on October 18, 2026 found:

| Setting | Observed value |
| --- | --- |
| `gpg.format` | `ssh` |
| `user.signingkey` | `~/.ssh/id_ed25519.pub` |
| `commit.gpgsign` | `true` |
| `tag.gpgsign` | `true` |
| GPG executable | `/opt/homebrew/bin/gpg` |
| Repository origin | `https://github.com/AJHMH/developer-os.git` |

The effective name/email were the operator's personal identity. No private key
material was inspected. These settings alone do not establish that a private key
is available, registered with GitHub, or that a GPG signing key exists. This
document does not change configuration or publish anything.

## Signing and authentication are separate

Commit signing proves who signed the commit contents. Push authentication decides
which GitHub account may update a branch. PR creation uses the account authenticated
in `gh`. SSH signing works even when the remote uses HTTPS. GPG signs commits but
does not authenticate a Git push or GitHub API request.

GitHub supports SSH and GPG signatures. For SSH verification, add the public key
to the intended GitHub account as a **signing key**; authentication registration
is a separate use. For GPG verification, register the public GPG key and use a
committer email matching a key identity and a verified email on the account. See
[GitHub signature verification](https://docs.github.com/en/authentication/managing-commit-signature-verification/about-commit-signature-verification)
and [signing configuration](https://docs.github.com/en/authentication/managing-commit-signature-verification/telling-git-about-your-signing-key).

## Use the existing SSH signing configuration

Run these inspections from the repository root:

```sh
git config --show-origin --get gpg.format
git config --show-origin --get user.signingkey
git config --get user.email
ssh-keygen -lf "$HOME/.ssh/id_ed25519.pub"
ssh-add -l
```

The `.pub` file identifies the public key. Signing requires its corresponding
private key, normally `~/.ssh/id_ed25519`, or access through an SSH agent. Never
upload the private file. Only register the public key with GitHub.

If the private key is stored at that standard path, it can be loaded into the
macOS agent, with its passphrase stored in Keychain if desired:

```sh
/usr/bin/ssh-add --apple-use-keychain "$HOME/.ssh/id_ed25519"
```

If repository settings need to be set explicitly, these commands affect this
repository rather than every repository on the Mac:

```sh
git config --local gpg.format ssh
git config --local user.signingkey "$HOME/.ssh/id_ed25519.pub"
git config --local commit.gpgsign true
```

## Use GPG instead

Yes, this Mac can use GPG for signing: the executable is installed. A usable
secret signing key and successful passphrase interaction still need verification.
If you keep an exported OpenPGP secret key outside the repository, import it only
if it is the intended signing key, then confirm it with the listing below.
An SSH Ed25519 key is not an OpenPGP key; select an existing GPG key or generate
one separately. Inspect locally, without copying secret material into this repo:

```sh
gpg --list-secret-keys --keyid-format LONG
```

Choose a signing-capable key's full fingerprint. If no suitable key exists,
`gpg --full-generate-key` can create one interactively. Register only its public
export with GitHub. Substitute the real fingerprint below:

```sh
gpg --armor --export YOUR_FULL_GPG_FINGERPRINT

export GPG_TTY="$(tty)"
git config --local gpg.format openpgp
git config --local gpg.program /opt/homebrew/bin/gpg
git config --local user.signingkey YOUR_FULL_GPG_FINGERPRINT
git config --local commit.gpgsign true
```

Set `user.email` locally to the verified address belonging to that GPG identity
if necessary. Do not use the Factory bot's email with a personal key. These local
settings override the existing global SSH signing settings. To return to SSH,
set `gpg.format ssh` and restore the SSH public-key path as shown above.

## Commit, push, and create the PR

Begin with the intended work on a `codex/` branch based on synchronized `main`.
Preserve existing work, and complete the repository's required validation. The
commands below assume that branch is already prepared; replace the filenames and
message. Stage explicit files so unrelated reports or keys are not included.

```sh
git status --short
git branch --show-current
git add docs/example.md
git diff --cached --check
git diff --cached

git commit -S -m "docs: explain the intended change"
git show --no-patch --format=fuller HEAD

gh auth status
git push --set-upstream origin HEAD
gh pr create --repo AJHMH/developer-os --base main \
  --title "Describe the change" --body-file /absolute/path/to/pr-body.md
```

`-S` uses the selected SSH or OpenPGP backend. The current HTTPS remote uses the
configured HTTPS credential mechanism for pushing; it does not use the SSH
signing key for transport. `gh auth status` identifies the CLI account, but Git's
credential helper can use a different account. Confirm both are intended.

If you deliberately choose SSH transport, first register the public key for
GitHub authentication and test the account:

```sh
ssh -T git@github.com
# After confirming the account, change this repository's transport if desired:
git remote set-url origin git@github.com:AJHMH/developer-os.git
```

GitHub's successful SSH authentication message reports no shell access and can
return exit status 1. SSH push authentication still does not control which account
`gh pr create` uses.

## Verify the published commit

Use the exact commit SHA returned by `git rev-parse HEAD`:

```sh
git rev-parse HEAD
gh api repos/AJHMH/developer-os/commits/EXACT_COMMIT_SHA \
  --jq '{sha, author: .author.login, committer: .committer.login, verification: .commit.verification}'
gh pr checks PR_NUMBER --repo AJHMH/developer-os
```

Confirm the intended identities and a verified/valid signature, then monitor the
PR's exact-head checks and required review. Local SSH verification with
`git verify-commit HEAD` additionally needs a configured `gpg.ssh.allowedSignersFile`
that trusts the signer; absence of that local trust file is distinct from GitHub
verification. GPG verification needs the corresponding public key locally.

Personal terminal publication does not satisfy an independent human-review gate
or authorize bypassing branch protections. When the task requires the Software
Factory bot as commit author and PR creator, use the supported App publisher from
the terminal instead. That route uses an App RSA key for authentication and
GitHub platform signing, as explained in the linked guide.
