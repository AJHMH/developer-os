# Merged main verification

Implementation reference: [current scope and qualification gates](implementation-status.md). Controlled delivery contracts below are implemented; native production acceptance remains separate from the fixed-worker evidence.

`monitor-main-checks --id <delivery-id>` observes configured main checks after a
confirmed merge. The controlled public-controller adapter is read-only; the CLI
has no native main observer and refuses unqualified monitoring.

The observer independently establishes repository, PR number, approved head,
default branch, actual merge commit and reachability on current main. It returns
complete check history for that exact main revision, including trusted publisher
and workflow identities. It must re-read main before returning and mark raced
observations incomplete. Passing PR checks cannot satisfy this contract.

The controller retains check attempts per revision. Main advancement requires
new matching evidence; returning to an earlier revision retains its failures.
Missing, spoofed, partial, skipped or neutral required results cannot pass unless
an explicit owner-policy exception permits the status. A failed attempt followed
by success remains flaky unless the pinned policy explicitly permits diagnostic
passes. Main monitoring cannot initiate reruns, repairs, reverts or remote writes.

Monitoring starts one persisted wait window at the first main observation.
Configured check deadlines apply within that window, with the existing one-hour
default for hosted checks. Restart, revision changes and polling backoff cannot
reset it. Clock rollback or deadline expiry blocks. Foreground observation is
bounded; recovery replaces its observation token so an old response cannot
supersede a newer result. Pause/cancel retain evidence without authorizing
progression. Changes to the pinned policy or observer binding revoke verification.

`main-verified` means the observed revision passed main checks, not completed
delivery. `mainChecks.revision` identifies that revision, while `runs` retains
prior attempts and findings. Synchronization and cleanup are subsequent slices
and must freshly verify main before effects. Failed main checks preserve evidence
and identify an owner next action: investigate; any fix or revert requires a new
signed PR and approval. Direct-main repair, automatic revert and cleanup remain
unavailable.

Native Windows/macOS qualification must demonstrate trusted complete API
pagination/history, publisher/workflow identity, current-main race handling,
PR/head/merge linkage and reachability, bounded reads and credential separation.
Controlled tests do not qualify native operation or enable the profile-page pilot.
