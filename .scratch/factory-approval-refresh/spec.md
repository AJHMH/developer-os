# Automatic Factory consumer approval refresh

Developer OS reruns its two existing Factory human-approval jobs after the owner
submits, edits or dismisses a review. The refresh requests a fresh evaluation;
it never approves a PR, grants approval, replaces a check, merges or alters rules.

A read-only review observer records PR/head/base/action in its server run title.
A default-branch workflow_run resolver verifies live workflow/PR identity and the
explicit human callers from the independently approved immutable Factory policy.
An Actions-write worker executes only trusted base code, revalidates before each
write, and reruns only `validation / Enforce Factory human approval` and
`validation / Enforce Factory trusted human approval` inside the exact current
`factory-adoption.yml` pull_request run. The Factory distribution/evaluator/policy
pin and all native merge protections remain unchanged.

Bound original runs by exact PR/head/base/branch and executing workflow path/ID.
Reject forks, stale bases/heads, unauthorized/bot/self callers, missing or changed
permission, incomplete/ambiguous inventory, changed adoption workflow source,
missing approved distribution and unavailable APIs. Never execute candidate
content, observer artifacts or review bodies with Actions write. Serialize
refreshes per PR without cancelling prior requests within GitHub's bounded
100-job pending queue; overflow requires inspection/manual recovery. Recheck current review
metadata and permission before every request; bound job settling waits. Replays
skip jobs that began after the event; timestamp ties request fresh evaluation.
Preserve partial request evidence on failures. Redact tokens/review bodies.

Tests exercise the public refresh command and its GitHub REST boundary with
isolated trusted Git fixtures. Verify exact permitted writes, zero writes on
invalid authority, revocation, replay, changed head/base/reviews/permissions,
ambiguous inventories and API/partial failures. Controlled tests cannot prove
hosted event delivery. After bootstrap, an App-authored probe needs a genuine
owner review and observed automatic refresh, followed by revocation/head
invalidation and cleanup. The bootstrap PR can require one final manual refresh.
