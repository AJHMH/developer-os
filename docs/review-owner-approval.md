# Review findings and owner approval

Implementation reference: [current scope and qualification gates](implementation-status.md). Controlled delivery contracts below are implemented; native production acceptance remains separate from the fixed-worker evidence.

Ticket 10 adds the public `monitorReview`, `repairReview` and
`resolveReviewThread` commands. CLI equivalents are `monitor-review`,
`repair-review` and `resolve-review-thread --thread-id <id>`, each with `--id`.
With the owner policy, the CLI installs the native review adapter (#269, below).

## Review authority

Each observation binds the published repository, PR, exact head, base branch,
App author and complete review/thread inventory. The pinned trusted port must
independently establish current permissions and the sole eligible owner. Review
bodies cannot supply those facts. Owner signing/publishing is compatible with
reviewing an App-authored PR when the effective repository policy permits it;
publication identity alone is not PR authorship or review eligibility.

Only the latest decisive owner GitHub review, made by a human on the exact head,
can establish approval. Dismissed, stale, bot and self reviews, outstanding required
changes, unresolved conversations, ambiguous history and unavailable authority
block the gate. Future timestamps are rejected. Comments and pending reviews do
not replace a submitted decisive review. Raw review bodies, extra provider fields
and errors are not retained; bounded identifiers and digests preserve provenance.

## Change gate (ADR 0005)

Owner approval is required only for a **gated change**. The trusted port also
reports the head's complete diff against its base revision (`changes`). The
controller classifies it with the repository's change gate contract (default
until onboarding declares one: 20 files, 600 lines, `.github/**` and
`**/CODEOWNERS` as controller authority). The run records the classification
as `gate`.

- **Ungated head:** authorized for merge as `approval.kind: "ungated"`, without
  any owner review, once trusted checks pass. Requested changes, an
  unresolved conversation, an owner `CHANGES_REQUESTED` review on the head, and
  any uncertain resolution still block it.
- **Gated head:** the destructive and wide-impact reasons appear in the next
  action, and only the owner's exact-head approval authorizes it, as above.
- **No diff from the port:** the head is gated. A malformed diff makes the
  observation unavailable. Neither is ever treated as ungated.
- **New head:** every observation classifies the current head afresh, so a
  push can turn an ungated head gated.

Every explicit review command refreshes checks and performs bounded foreground
observations. Status reads are passive; there is no background polling or reminder
loop. Approval waiting has no elapsed-time deadline and consumes no repair budget.
`ready-to-merge` records current observed authorization for the separate conditional
merge phase. It neither merges nor reports delivery completion, and needs no extra
chat approval. Ticket 11 must revalidate all gates immediately before merge.

## Scoped fixes and verified conversation resolution

The trusted review integration independently assesses unresolved conversations
against the pinned acceptance criteria. It provides a bounded safe finding and
criteria digest for straightforward fixes. Missing assessments, disputes and
conflicting scope remain open for owner resolution. Remote text cannot assign its
own classification, grant credentials, change policy or extend allowances.

`repairReview` admits an entire straightforward batch, retains publication and
thread fingerprints, and uses the existing cumulative isolated repair/revalidation
loop. Its attempt retains the review-run ID and explicit worker session. Restart
can recover the saved batch without resetting allowances or replaying a completed
repair. Changed verified output publishes through the existing signed conditional
update to the same PR. The new head requires new checks and owner approval.

`resolveReviewThread` requires the exact batch's successful local validation and
published candidate, current passing trusted checks, unchanged thread content,
current straightforward assessment and runtime binding. The fingerprint covers
all thread content and edits, excluding the mutable resolved flag. An edited or
reassessed conversation cannot reuse prior verification. The trusted port must
revalidate identity, head and thread fingerprint at dispatch and honor the
`mayDispatch` fence; unsupported native conditional guarantees remain blocked.

Resolution intent is saved before the external write. Unknown acknowledgment
blocks retries, repair, publication, resume and release until reconciled. A receipt
must match its operation ID; acceptance also requires observing the same thread
resolved, while absence must prove no late acceptance remains possible. Only
proven quiescent absence permits another explicit attempt. Read-only recovery is
allowed while paused/cancelled or after CI fails, without granting write or merge
authority. Observations use generation IDs so late responses cannot replace newer
review decisions. No port operation submits a human approval.

## Native adapter (#269)

`src/native-review.ts` is the review adapter for GitHub. It reads through the
owner's `gh` login, the same one that pushes and observes PR checks, and it
never submits a review. Each observation reads:
- the PR;
- every review, all pages;
- every review conversation, with every comment and the owner's reactions;
- who can push: the owner must be the only person with push access, and have
  write, maintain or admin;
- who pushed the head, from GitHub's activity record;
- the head's complete diff, for the change gate.

A missing page makes the observation incomplete. Without a complete diff, or
when the PR's recorded base isn't in the head's history, the head stays gated.
A pending review never counts. Anyone's latest change request, until they
approve or it is dismissed, is an outstanding required change.

**Assessment, by the owner's 👍.** A conversation is a straightforward fix
only when:
- the owner started it;
- the owner reacted 👍 to its first comment;
- no one else wrote in it.

Its finding is the owner's own words, with the file and line. A 👎 marks it
disputed, and both reactions mark it conflicting. Anyone else's conversation,
or one the owner didn't react to, has no assessment, so it stays open for the
owner. So does a finding that is too long or reads like a secret. A
conversation's fingerprint covers every comment, its edits and the owner's
reactions, but not whether it is resolved.

**Resolution.** `resolve-review-thread` first re-reads the PR's head and the
conversation, and refuses if either changed. It records the intent before
dispatch, then resolves the conversation through GitHub's API. Its receipt is
the conversation observed resolved; an unanswered one is reported absent only
after two minutes.

`monitor-review`, `repair-review` and `resolve-review-thread` take
`--owner-policy`, which installs this adapter for the policy's repository and
the PR check monitor (#268). Review markers live in a private folder under
the state directory. `repair-review` also takes `code-feature`'s options,
`--production-admission` and `--publication-identity`, to repair and
republish.

### Native review acceptance

`scripts/run-native-review-acceptance.mjs` opens two PRs in the disposable
repository through the native publisher:

1. **A small PR:** the change gate must classify it ungated, so it is
   authorized without a review.
2. **A PR that adds a file under `.github/`:** it must be gated, with no
   authorization.
3. **Your review, in GitHub.** The script prints the PR's link and waits up to
   30 minutes, printing each change it sees. On the gated PR's **Files
   changed**, comment on a line, react 👍 to your comment, and approve. A
   comment in the **Conversation** tab doesn't count, because it can't be
   resolved. Your comment must read as a straightforward finding, and the
   approval mustn't count while the comment is open.
4. **Resolution:** the adapter resolves your comment. Then your approval must
   authorize exactly that head.

With the signing key in ssh-agent:

```sh
node scripts/run-native-acceptance.mjs "$HOME/.developer-os/ticket4-macos/state" scripts/run-native-review-acceptance.mjs -- "$HOME/.developer-os/admission/publication-identity.json" "$HOME/.developer-os/issue10-review-acceptance-$(date +%Y%m%d-%H%M%S).json" --approve-native-review
```

### Native results (12 November 2026)

The Mac passed with outcome `observed-native-review-acceptance`, from `main`
at `f3ac9d5`
([receipt](../.scratch/aios-v1-implementation/ticket10-macos-review-acceptance-receipt.md)).

- **Ungated:**
  [AJHMH/aios-publication-acceptance#7](https://github.com/AJHMH/aios-publication-acceptance/pull/7)
  was authorized without a review.
- **Gated:**
  [AJHMH/aios-publication-acceptance#8](https://github.com/AJHMH/aios-publication-acceptance/pull/8)
  touches `.github/`. Your line comment, marked 👍, was read as a
  straightforward finding, and your approval didn't count while the comment
  was open.
- **Resolution:** the adapter resolved your comment. Your approval then
  authorized exactly that head.

Reaching this pass needed #301, which keeps the conversation query under
GitHub's 500,000-node limit.

## Qualification still required

Native macOS GitHub ports must prove complete pagination, review order
and dismissal semantics, effective owner permissions/protection policy, trusted
scope assessment, thread fingerprints and conditional resolution, clock behavior,
credential isolation, dispatch fencing and uncertain-effect reconciliation. The
native worker/signing/publication and hosted-check requirements from earlier
slices remain open. Production delivery remains disabled until applicable host,
repository and pilot qualification passes.
