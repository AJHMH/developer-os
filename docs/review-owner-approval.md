# Review findings and owner approval

Ticket 10 adds the public `monitorReview`, `repairReview` and
`resolveReviewThread` commands. CLI equivalents are `monitor-review`,
`repair-review` and `resolve-review-thread --thread-id <id>`, each with `--id`.
The CLI installs no native review adapter. Controlled integrations exercise the
controller contract; they do not establish live GitHub readiness.

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

## Qualification still required

Native Windows and macOS GitHub ports must prove complete pagination, review order
and dismissal semantics, effective owner permissions/protection policy, trusted
scope assessment, thread fingerprints and conditional resolution, clock behavior,
credential isolation, dispatch fencing and uncertain-effect reconciliation. The
native worker/signing/publication and hosted-check requirements from earlier
slices remain open. Production delivery remains disabled until applicable host,
repository and pilot qualification passes.
