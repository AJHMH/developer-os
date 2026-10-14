# Signed candidate publication

Ticket 08 adds publishFeature and reconcilePublication to the public controller.
The CLI exposes publish-feature and reconcile-publication with --id, but installs
no native publisher. Only a trusted controlled PublicationRuntime is accepted.
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
It has no Windows helper, fixed keystore/home path, token or PEM configuration.
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
replace its pinned evidence. Updating an already proposed candidate requires a
later exact-head update/review protocol. Final status directs the owner/controller
to hosted checks and independent review; production delivery remains disabled.

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
App transport on both Windows and macOS, including secret handling, effective Git
configuration isolation, conditional branch creation, actual GitHub signature
verification, App installation scope, PR reconciliation and crash windows.
Full host/repository qualification and live pilot authorization remain required.
No live GitHub write, native production worker or provider inference was performed.
