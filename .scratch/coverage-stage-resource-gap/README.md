# Coverage stage resource evidence gap

Status: PARTIAL. PR #61 remains blocked by coverage; its current head is approved.
The owner authorized a separate investigation using 20 active minutes and two
repair cycles. No deadline, assertion, coverage threshold or approval rule changes.

## Observed failure

PR #61 run 38996294286 terminated unit tests at 120.009 seconds and base
instrumentation at 120.013 seconds. Head instrumentation passed in 114.711 seconds.
Green main run 38994377357 completed those stages in 89.639, 100.469 and
97.040 seconds respectively. Normal production, tests, scripts, package manifest,
contract and required workflow files are identical between these revisions.
The last printed test does not identify a hang because Node buffers file output.
No cause-specific repair or reliable minimized runtime reproduction is established.
The stage comparison retains timing and termination evidence without raw output.

## Tested candidate

Factory execute() already collects bounded numeric resource counters, but
collectCoverage() projects them out of every returned stage. The candidate retains
that existing resourceDiagnostics field. It adds no sampling or execution work.
The public-command deadline regression failed before the change with an absent
resourceDiagnostics field; it passes afterwards with SIGKILL and the original
one-second fixture deadline retained. All coverage-file tests and type checking
pass; both specification and standards reviews report zero actionable findings.
The patch is against Factory b8fd860, not a Developer OS production change.

The candidate fixes missing diagnostic evidence only. It cannot recover counters
from the historical failed host or explain why that host exceeded its budget.
Future required runs must still pass every gate; a healthy retry is not a waiver.

## Publication boundary and allowance

Factory AGENTS.md requires the local-remediate public interface for remediation
PRs. Its documented adapter only formats JSON and refuses general code repairs;
this tested two-file MJS patch is outside that interface. No workaround or remote
write has been made. Publication through the established verified App commit/PR
route requires an explicit owner exception to that instruction.

Conservatively charge ten active minutes for evidence comparison, regression,
candidate verification and review. Ten active minutes and both repair cycles
remain; initial diagnostic coding did not consume a repair cycle. CI/approval
waiting is excluded. No unchanged-code hosted retry was requested.

## Authorized publication

The owner explicitly approved the verified App publication-route exception.
Software Factory PR #73 is open at f51c43181111d8ae3d0db0db86f5d5bbf5616495.
The PR and commit author are ajhmh-software-factory[bot]; the verified platform
signature uses GitHub/web-flow as committer, matching this approved publication
route. An initially stricter local identity check refused after remote commit
creation; read-only reconciliation verified the author, valid signature and exact
staged tree 94cca0e5324cd2413cded55597c6f9ce97c032d0 before local adoption.
No duplicate commit or retry publication occurred; the temporary token was revoked.
The PR is attached to this chat. Hosted checks and current-head review are pending.
No Developer OS pin has changed. Adoption requires a reviewed merged revision and
matching independent consumer selection through the existing pin controls.

Conservatively charge five further active minutes for publication and reconciliation:
five active minutes and two repair cycles remain. CI/review waits are excluded.

## Reviewed consumer adoption

Factory PR #73 merged as b9ddb90de815b68787e741bb2c8118e7b6a784d9. All six
merged-main workflows passed. The four consumer adoption files select that exact
revision, including both reusable workflow calls and the approval-refresh fixture.
All 55 refresh tests and both review axes pass. The independent selection/readback
and committed-tree inspection must match before hosted consumer evidence is accepted.

The final five active minutes are allocated to the reviewed consumer adoption,
publication and committed-tree inspection. No runtime repair was attempted. The
20-minute allowance is consumed after these steps; two repair cycles remain but
further active diagnosis/editing requires an explicit time extension. Hosted waits
and observing returned results are excluded. No historical timeout is declared fixed.
