# Bounded candidate repair

Implementation reference: [current scope and qualification gates](implementation-status.md). Controlled delivery contracts below are implemented; native production acceptance remains separate from the fixed-worker evidence.

Ticket 07 adds repairFeature(id, reviewFindings?) and extendRepair(id, cycles,
minutes) to the public controller. The CLI exposes repair-feature --id ID and
extend-repair --id ID --cycles N --minutes N. Omitted extension amounts default to
zero; at least one must be positive. Only the explicit owner control can extend
a stopped, exhausted allowance.

A cycle starts with a stopped candidate validation attempt, an admitted artifact
and a bounded batch of findings. Failed check identities are derived from retained
validation evidence. Optional review findings are untrusted text, not authority
to change scope, policy, gates or credentials. Baseline failures and unvalidated
candidates cannot enter repair. Production delivery remains disabled.

Each cycle sends the current candidate, criteria and findings to the same trusted
controlled coding integration in a fresh explicit session. The existing baseline,
source, environment and runtime pin checks still apply. Collection requires verified
descendant shutdown. Candidate changes outside the owner's mutable application
paths are refused before replacing the retained artifact.

Every successfully admitted result receives local candidate verification, including
an unchanged result. The existing one-diagnostic-rerun and flake policy still applies:
a pass on an unchanged tree cannot silently erase an earlier failure. New tree
identity invalidates old evidence. Successful local repair does not satisfy hosted
checks or authorize publication/merge.

## Durable accounting and controls

The allowance defaults to three cycles or 3,600,000 active milliseconds, whichever
is exhausted first. Starting a batch consumes one cycle, including failed and
interrupted attempts. The final permitted cycle may succeed; reaching the time
limit prevents success even if a late check returns green.

Diagnosis/editing inside the coding runtime and local verification consume repair
time. Initial coding has a separate counter. CI/approval waits, paused time and
controller downtime do not consume active repair time. Runtime checkpoints,
controller heartbeats, command deadlines and shutdown observations persist usage;
a different controller runner never charges the elapsed restart interval.

Each attempt retains findings, input/candidate identities, coding session,
verification operation (when dispatched), outcome and remaining allowance.
Interrupted or failed attempts remain in the ledger. New comments and restarts
never reset allowances. Repair extensions add explicit durable records.

Pause/cancel fence further effects and reconcile descendants. Unknown shutdown
blocks overlap, resume and ownership release. Recover the exact runtime binding
before another cycle. An interrupted stopped verification awaiting final inspection
is marked incomplete; its late callback cannot overwrite a later cycle's evidence.

Once repair starts, direct codeFeature/validateCandidate calls cannot bypass repair
accounting. Further local repair/revalidation goes through repairFeature. A batch
that cannot dispatch or verify retains failure and the available evidence.

## Qualification still required

Only controlled adapters are accepted. No native repair executor, provider call,
host validation script or publication authority is added. Qualify real Windows/macOS
coding and validation runtimes, process-tree shutdown under interruption/deadline,
clock/checkpoint persistence across controller crashes, dependency/script isolation,
protected validation inputs and disposable E2E fixtures before live use.
Hosted review/check integration and complete delivery qualification remain later
slices. Public tests demonstrate controller behavior, not native readiness.
