# Issue 04: fresh model-only authority for coding turns

Status: implemented on `codex/issue04-coding-model-authority` and reviewed on
both axes. Hosted checks and native qualification remain open. Production
remains disabled.

## Behavior

Before this slice, coding turns had no usage authority at all. Only worker
dispatch and the online canary used `UsageApprovalGate`. Now
`DeliveryController.codeFeature` takes a fresh subscription observation right
before its prepare transaction, for every launch, resume and repair. That
check must meet three conditions:

- **A known account.** The usage report must name a model-only account. An
  unknown account (no observation, an unusable observation, or one that isn't
  ChatGPT-mode) is never authority, even after an owner approves that check.
- **The same account every turn.** The first coding launch records the account
  in `feature.usageAccountId`. Every later turn of that feature must use the
  same account; a different account refuses before any transaction.
- **Fresh authority, bound to one operation.** Inside the prepare transaction
  the gate binds exactly that check to the new coding operation. Stale usage
  refuses. A low allowance needs an explicit owner approval, which is consumed
  by that one operation, so the next turn needs a new approval. Exhaustion is
  never overridden.

The runtime's `mayDispatch` recheck, after asynchronous pin inspection,
requires the stored authority to be still fresh and bound to this exact
operation.

## Known limitations

- **The dispatch recheck reuses the stored report.** `mayDispatch` is
  synchronous, so it rechecks the stored report within the gate's 60-second
  freshness window rather than taking a new observation. Exhaustion during pin
  inspection is caught only through freshness, or at the next turn.
- **No monitoring during a turn.** Coding doesn't poll usage while it runs.
  That belongs to the separate item covering general-session usage monitoring,
  exhaustion with work preservation, and restart authorization.
- **No link to the mediation account.** (Addressed by the
  [mediation account receipt](ticket04-coding-mediation-account-receipt.md).) The account isn't yet tied to the
  delivery's qualified model-only mediation account. Coding transports don't
  carry a mediated credential yet, so that binding belongs to production
  integration.
- **A `pollUsage` edge case predates this slice.** `pollUsage` assumes a
  worker execution whenever the phase is `implementing`, so it shouldn't be
  pointed at a delivery that is only coding.

## Evidence

All tests go through the public `DeliveryController` methods (`codeFeature`,
`approveUsage` and `status`) with the controlled runtime and a subscription
observation fixture. Coding fixtures now supply a fresh, healthy observation,
stamped with each controller's own clock.

TDD notes:
- Every new test failed first: missing observation, exhaustion, approval bound
  to one operation, stale authority at dispatch, and account drift.
- One test initially assumed an unknown account was approvable for coding. The
  Spec review showed any account could authorize coding, so the rule now
  refuses unknown accounts. That test failed first under the new rule.
- My first full-suite run had 20 failures. Some fixtures use a different clock
  (`f.time`) or real time, so their observations looked stale. Observations
  are now stamped with each controller's own clock. No product code changed
  for this.
- **Review fixes:**
  - Spec: account binding added.
  - Standards: a weak `assert.throws` message assertion became a regex.
  - Coverage: redundant in-transaction rechecks were removed, and the usage
    refusal was folded into the bind, so no new branch goes unexercised.

Mutation checks: each guard was removed in turn, the code was rebuilt, and the
focused tests were rerun.
- **Pinned:**
  - the known-account check (mutated in the compiled output, because
    TypeScript's type narrowing prevents a source mutation);
  - account drift;
  - the bind and its single-operation consumption;
  - the dispatch recheck.
- **Redundant by design:** the check-ID match, which only matters if a
  concurrent usage check races the transaction; worker dispatch uses the same
  guard.
