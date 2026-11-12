# Signed candidate publication

Implementation reference: [current scope and qualification gates](implementation-status.md). Controlled delivery contracts below are implemented; native production acceptance remains separate from the fixed-worker evidence.

Ticket 08 adds publishFeature and reconcilePublication to the public controller.
The CLI exposes publish-feature and reconcile-publication with --id. With the
owner's publication record it installs the native publisher (#267, below).
Publication is a separate phase; it is not merge authorization or completion.

## Admission and identities

Publication requires a stopped, admitted candidate with passing local validation
for its exact manifest, source revision, policy and criteria. Repair, when used,
must have passed and stopped. The current main checkout, owner policy, declared
checks and measured validation environment must still match. Candidate artifacts
are re-admitted and protected validation inputs checked before publication.

The controller computes the Git SHA-1 tree from the admitted file bytes and modes
without a checkout, attributes, filters or executing scripts. A signed commit must
match that tree and the original main parent. Local signing evidence must identify
the configured publication login. Remote evidence must additionally identify the
onboarded repository, exact branch/commit, publication identity and GitHub verified
signature before PR creation can proceed.

The App identity must differ from the sole eligible owner approver. App scope is
limited to pull_requests:write on the onboarded repository (implicit metadata
reads are part of the transport). Signing and App key fingerprints must differ
and remain pinned across continuation. No secret material is accepted as evidence
or passed to the coding worker. No human-review submission method exists.

## Separate host ports

SplitPublicationAdapter composes GitPublicationPort and AppPullRequestPort.
It has no host-specific helper, fixed keystore/home path, token or PEM configuration.
Host integrations supply the separate ports and measured runtime binding.

The Git port signs through an isolated trusted metadata/configuration context:
candidate configuration, environment, hooks, includes, filters and attributes are
disabled. The App PEM is never a signing key. The adapter independently verifies
local signing before push and observes the remote signed head before PR creation.
Git publication uses the configured Git identity; App authority creates only PRs.

Before writes, the adapter observes an existing remote branch or PR. Found
resources are checked against expected identity instead of duplicated. A new branch
requires proven absence and expectedRemoteHead:null; the trusted transport must
atomically reject a concurrently created branch. No overwrite or force-update
fallback is permitted. The PR port must observe branch/base/repository matches and
conflicts, not hide an existing PR because its operation marker differs.

## Durable effects and reconciliation

The ledger records publication identity and dispatched operation intent before
sign, push or PR creation. Effects retain unique IDs, execution generation, fence,
timestamps and safe outcomes. Signing, remote signature and PR metadata are
projected to known fields; raw provider errors and extra response fields are omitted.

Missing responses/timeouts become uncertain, not permission to retry. An explicit
reconciliation queries the same binding and retained operation. It can recognize
the accepted commit/branch/PR without another write. An absent result is retryable
only with proof the old operation cannot later be accepted. Unknown or unverified
evidence blocks progression.

Pause/cancel retain in-flight outcomes and prohibit later dispatch. Uncertain
effects block resume and ownership release. Reconciliation is observational and
works while paused/cancelled; it never creates, deletes, pushes, approves or merges.
It revokes the old publisher generation before observing, so a late callback cannot
interrupt a newer publisher. Only explicit publication after eligible controls may
continue with a fresh generation.

Once publication begins, candidate coding/repair/revalidation cannot silently
replace its pinned evidence. Ticket 09 adds an explicit trusted-check repair path
that retains the prior publication, revalidates changed output and conditionally
updates the same branch and PR from the exact prior signed head. See
[trusted PR checks](trusted-pr-checks.md). Final status directs the owner/controller
to hosted checks and independent review; production delivery remains disabled.

## Native publisher (#267)

`src/native-publication.ts` and `src/native-app-pr.ts` are the native ports
for the Mac. The owner chose (#267):

- **Signing: the owner's own SSH key, through ssh-agent only.** Git gets the
  key as a literal public key (`key::…`), so it signs with `ssh-keygen -U`,
  which uses the agent and never reads or prompts for the key file. When the
  agent doesn't hold the key, `inspect` reports signing unavailable, and
  signing fails rather than publishing unsigned.
- **Push: the owner's `gh` login**, through `gh auth git-credential`. It is
  conditional: `--force-with-lease` expects a new branch to be absent, or an
  update to start from the exact previous head. There is never a plain force.
- **PR: the Software Factory App.** Every call takes an installation token for
  the one repository with `permissions: {pull_requests: write, contents:
  read}`. The port checks GitHub granted exactly that, plus implicit
  `metadata: read`, and revokes the token after use. It can only create and
  observe PRs. `contents: read` is read-only, and GitHub needs it: on a
  private repository, a token without it is refused with `not all refs are
  readable` (the first native run, 11 November). The owner chose to add it.

All Git work happens in the port's own bare metadata, with no system or
global configuration (`GIT_CONFIG_NOSYSTEM`, `GIT_CONFIG_GLOBAL=/dev/null`)
and no `GIT_*` environment. Hooks point at an empty folder, attributes at
`/dev/null`, and only one protocol is allowed. The tree is built from the
admitted bytes with `hash-object --no-filters` and `mktree`, and must equal
`publicationTree`. The commit's parent is fetched from the repository itself.

GitHub's own word decides the remote evidence. The branch head must carry
`verification.verified: true` with reason `valid`, and the repository's
activity record must name the owner as the pusher. A dispatched push or PR
creation is recorded first, so an unanswered one is reported absent only
after two minutes, when it can no longer land.

### The owner's publication record

The ports read identities and key paths from a private file (mode `0600`)
holding no secrets:

```json
{
  "scope": "aios-publication-identity-v1",
  "repository": "AJHMH/aios-publication-acceptance",
  "login": "aaron-howard",
  "name": "Aaron Howard",
  "email": "<an email GitHub has verified for you>",
  "signingKey": "/Users/aaronhoward/.ssh/id_ed25519.pub",
  "appId": "5180250",
  "installationId": "167664341",
  "botLogin": "ajhmh-software-factory[bot]",
  "appKeyPath": "<the App's PEM, outside every repository>",
  "approver": "aaron-howard"
}
```

`signingKey` must be the public key (`.pub`). The commit email must be one
GitHub has verified for the owner, or GitHub won't show the signature as
Verified. The key must be registered on GitHub as a **signing** key.

### Native publication acceptance

`scripts/run-native-publication-acceptance.mjs` publishes one acceptance
candidate to a disposable repository:

1. It reads `main` and adds one file under `acceptance/`.
2. Your key signs the exact tree through the agent.
3. Your `gh` login pushes a new `aios/feature-acceptance-<run>` branch.
4. GitHub must report the commit Verified, signed and pushed by you.
5. The App opens the PR.
6. Reconciling each step finds it again, and a repeated push or PR creation
   returns the same branch and PR.

It never writes `main`, approves or merges, and leaves its branch and PR open.
Before running it, unlock the key into the agent:

```sh
ssh-add --apple-use-keychain ~/.ssh/id_ed25519
node scripts/run-native-acceptance.mjs "$HOME/.developer-os/ticket4-macos/state" scripts/run-native-publication-acceptance.mjs -- "$HOME/.developer-os/admission/publication-identity.json" "$HOME/.developer-os/issue08-publication-acceptance-$(date +%Y%m%d-%H%M%S).json" --approve-native-publication
```

### From the CLI

`publish-feature` and `reconcile-publication` install this publisher from
`--publication-identity <owner-record>`, and the production gate from
`--production-admission <owner-record>`:

```sh
node dist/cli.js publish-feature --id "$DELIVERY" --owner-policy "$POLICY" --podman-machine aios-macos-noshare --validation-admission "$HOME/.developer-os/admission/validation-admission.json" --production-admission "$HOME/.developer-os/admission/production-admission.json" --publication-identity "$HOME/.developer-os/admission/publication-identity.json"
```

The record's repository must be the delivery's. Publication re-checks the
validation runtime, so it takes the same owner policy and validation
admission. It needs a production admission naming the pins the delivery's
coding and validation ran under. The publisher's Git metadata and dispatch
markers live in a private folder under the state directory, one per
repository, and its binding is the record's digest, so a changed record never
continues an earlier publication. `reconcile-publication` only observes.

### Native results (11 November 2026)

The Mac passed with outcome `observed-native-publication-acceptance`, from
`main` at `b9bcb1b`
([receipt](../.scratch/aios-v1-implementation/ticket08-macos-publication-acceptance-receipt.md)).

- **Sign and push:** your key signed commit `c73dcb9a…` through ssh-agent, and
  your `gh` login pushed it to a new branch. GitHub reported it Verified, with
  you as signer and pusher.
- **PR:** the App opened
  [AJHMH/aios-publication-acceptance#1](https://github.com/AJHMH/aios-publication-acceptance/pull/1).
- **Reconcile:** reconciling found every step again, without a second write.

Reaching this pass needed #293 (reading `main`'s tree), #294 (GitHub's
refusal reason) and #295 (`contents: read`).

## Validation and qualification limits

Public fixtures cover exact-tree/signature/identity refusal, durable dispatch,
lost acceptance, restart, permission denial, pause/cancel, timeout and late callback
fencing, existing-branch conflicts and credential-free CLI refusal. A separate
fixture generates an ephemeral SSH signing key, signs and verifies a real Git
commit in trusted temporary bare metadata, and conditionally pushes to a local
bare remote. It leaves the source checkout unchanged.

GitHub verified signatures, App authorization and PRs in these tests are controlled
observations. Native credential-bearing ports are not installed or qualified.
Implement and qualify the configured owner signer/push transport and scoped Factory
App transport on macOS, including secret handling, effective Git
configuration isolation, conditional branch creation, actual GitHub signature
verification, App installation scope, PR reconciliation and crash windows.
Full host/repository qualification and live pilot authorization remain required.
No live GitHub write, native production worker or provider inference was performed.
