# Automatic Factory human-approval refresh

Implementation reference: [current scope and qualification gates](implementation-status.md). Controlled delivery contracts below are implemented; native production acceptance remains separate from the fixed-worker evidence.

Developer OS observes owner reviews submitted, edited or dismissed on an open
same-repository PR targeting main. After bootstrap, the trusted default-branch
worker reruns only the two original required Factory jobs:

- `validation / Enforce Factory human approval`
- `validation / Enforce Factory trusted human approval`

The original pinned Factory validators still decide whether approval passes.
Refresh never submits a review, changes a check verdict, merges, suppresses a gate
or changes branch protection. A new head still requires renewed owner approval.
Dismissal refreshes previously passing jobs so revocation is evaluated again.

## Trust boundary

`factory-review-event.yml` has a read-only token, executes only `true`, and binds
PR/head/base/action in its run title. It uploads no artifacts. The title is data,
not authority: the resolver checks live GitHub workflow ID/path, run metadata,
PR identity, repository, branch and current caller permissions.

`factory-review-refresh.yml` runs on workflow_run from the default branch. Its
resolver has only read permissions. The Actions-write job checks out only the
resolved trusted PR base; it never installs dependencies or executes candidate
code. It has no contents, PR, checks, statuses or ruleset write permission. All
runtime values enter scripts through quoted environment variables. Both actions
are pinned to immutable commits and persist no checkout credentials.

The public command `scripts/refresh-factory-approvals.mjs` validates the checkout,
consumer Factory lock, independently configured `FACTORY_DISTRIBUTION_REVISION`,
and the exact immutable Factory policy blob. The inline human-approvers array is
read only after its Git blob digest matches the approved policy. Updating the
Factory pin/policy requires a reviewed refresh-adapter update; mismatches block.
No candidate policy or review body can grant refresh authority.

The original Factory Adoption run title binds PR/head/base. The adapter verifies
that the candidate's caller workflow exactly matches the trusted base, including
the immutable reusable workflow pin. Changed adoption callers require manual
refresh until their reviewed workflow lands; candidate workflow code cannot
select a privileged rerun target. Fork refresh is unsupported and fails closed.

Before every write, the adapter rechecks PR head/base/branch, normalized review
metadata and owner repository permissions. It preflights both allowlisted jobs,
refuses incomplete or ambiguous inventories and bounds API calls. It waits at
most three minutes for the original shared workflow to finish and a separate
six-minute budget for sequential reruns. GitHub recreates sibling job IDs on
each run attempt; the worker waits for the new attempt and resolves fresh IDs
before another request. GitHub may briefly omit jobs while recreating them; only after its own successful request does the worker tolerate that gap within the existing wait budget. Both exact jobs must exist in the completed new attempt before another dispatch. Job head, run ID, name and attempt must agree. The
twelve-minute workflow limit bounds the complete privileged operation. Refresh workers serialize per PR
without replacing earlier pending requests, using `queue: max`. GitHub permits
100 pending refresh jobs per group; queue overflow cancels additional jobs and
requires inspection/manual recovery. [GitHub concurrency contract](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
Replayed events skip jobs started strictly
after the event; timestamp ties refresh conservatively. Failed/uncertain dispatch
is recorded as unconfirmed, never as an approval, and is not retried blindly.

## Operator interface

Run only from the trusted current PR base checkout, with a read-scoped GitHub token
in `FACTORY_GITHUB_TOKEN`; apply additionally needs Actions write:

```sh
node scripts/refresh-factory-approvals.mjs --mode inspect \
  --repository AJHMH/developer-os --trigger-run REVIEW_OBSERVER_RUN_ID \
  --trusted-revision EXACT_PR_BASE_SHA \
  --approved-factory-revision 3f64904a7a71985382fa5d5da29cc0e0610d5d2c
```

Change `inspect` to `apply` to request reruns after validated preflight. Inspect
emits only numeric PR and hexadecimal base revision workflow outputs. JSON reports
contain identifiers and a normalized review digest, never tokens or review bodies.
Blocked authority/API evidence leaves the original checks authoritative. Inspect
the current PR and rerun the genuine checks manually when recovery is needed.

## Bootstrap and verification

The implementation cannot refresh its own approval checks before its reviewed
worker lands on main. This bootstrap PR can need one final manual refresh after
the owner's actual current-head GitHub approval. Existing gates stay required.
Old runs without the new title binding remain unsupported.

Controlled CLI/REST fixtures verify authorization, precise allowed writes,
revocation, stale/replayed events, API errors and bounded/partial behavior. They
cannot prove that GitHub delivered review events. After merge, verify hosted
behavior with a disposable App-authored PR and genuine owner review, recording
observer/worker IDs and original refreshed job IDs without a manual rerun. Then
verify dismissal or head invalidation, close the unmerged probe and remove only
its temporary branch. GitHub scheduling is asynchronous; no immediate verdict is
promised.
