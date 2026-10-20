# Issue 04: owner restart authorization after a usage interruption

Status: implemented on `codex/issue04-restart-authorization`. Hosted checks and
native qualification remain open. Production remains disabled.

## The gap this closes

Every coding turn already needed fresh usage authority bound to that one
operation, re-qualified the mediation decision and stopped on exhaustion. After
a usage interruption, though, the next `codeFeature` went through as soon as
usage looked fresh again, for example right after the usage window reset. The
owner chose an explicit restart approval for that case.

## Behavior

- **Blocked after an interruption.** Once a turn is recorded in
  `feature.usageInterruptions` (exhaustion, an account change or a lost
  observation, during the turn or before its output was collected), coding
  refuses until the owner approves a restart. Fresh usage alone never restarts
  it. The check runs before the usage observation, and again inside the prepare
  transaction.
- **Recorded before the stop.** The monitor records the interruption durably
  before it stops the worker, so a controller lost mid-stop still needs the
  owner's approval. The record is written once per operation.
- **`DeliveryController.approveCodingRestart(id)`.** It requires an owned,
  quiescent, non-cancelled delivery whose latest interruption has not been
  restarted past, and allows one approval per interruption. It records
  `feature.restartApprovals`: the interrupted operation, the feature's usage
  account and the approval time.
- **Spent by the re-dispatch that reaches dispatch.** The prepare transaction
  binds the approval to the new operation only after fresh usage authority is
  bound to it; a retry re-binds it, and the record keeps only the latest bound
  attempt. The approval is spent (`dispatched: true`) when that operation
  passes the controller's dispatch recheck (the runtime's first `mayDispatch`,
  before its pin re-inspection and launch), or when its thread or turn result
  is observed. A refusal before that recheck (still exhausted, a runtime
  refusal) leaves it usable for the next attempt. A refusal after it, such as a
  transport refusal or changed pins, still spends it, which only means the
  owner approves again. Exhaustion is never overridden, and each later
  interruption needs its own approval.
- **Account.** The approval records the feature's usage account as evidence.
  It is enforced by the existing rule that every turn of a feature uses the
  account of its first coding launch.
- If the early durable write of an interruption fails, the write after the stop
  still records it; only a controller lost in that window could miss it.
- Repair turns share the same dispatch path, so the rule applies to them too;
  no separate repair test covers it.
- Pause, cancel and recovery restarts are unchanged; the owner chose to gate
  only usage interruptions.
- `CONTEXT.md` defines "usage interruption" and "coding restart approval".

The CLI has no coding adapter, so it can't produce an interruption, and gets
no restart command yet.

## Evidence

Tests use the public `DeliveryController` (`codeFeature`,
`approveCodingRestart`, `status`, `release`, `cancel`, and a new controller on
the same state) with the controlled runtime and the monitored-turn fixture.
- For each interruption kind, fresh usage alone refuses, an approval restarts
  the preserved thread, and the approval records the re-dispatch that spent it.
- The interruption is visible while the worker is being stopped, and a new
  controller still refuses without an approval.
- A re-dispatch refused for exhaustion, or by the runtime before dispatch,
  leaves the approval usable; a turn that reaches dispatch and then fails
  spends it.
- A second interruption needs a second approval, and a second approval for the
  same interruption refuses.
- Approval refuses when nothing was interrupted, after release and after
  cancel.

TDD: all new behavior tests failed first, including those added for review
findings. Mutation checks: each guard was removed in turn and the focused tests
rerun.
- **Pinned:** recording the lapse before the stop, one approval per
  interruption, ownership, cancellation, spending at the dispatch recheck, and
  counting only spent approvals.
- **Redundant by design:** the transaction's re-check of a missing approval
  (the check before the usage observation refuses first, and the transaction
  check guards against a concurrent change), and the quiescence and
  launched-account guards on approval (an interruption implies a stopped,
  launched turn).

Review: the Spec review found that an approval was spent when the prepare
transaction committed, so a re-dispatch refused before dispatch used it up; and
that a lapse was written only after the stop. Both are fixed. The Standards
review's comment placement, binding, glossary and redundancy notes are done; the
redundant account check at spending was removed.

No Codex binary, credentials, online inference or real VM was used.

## Still open

- Restart authorization through a production coding adapter, and native
  qualification of usage controls for general sessions.
- Cleanup of retired resume lineages, and base-refresh resume.
- Production remains disabled, and the parent ticket stays partial.
