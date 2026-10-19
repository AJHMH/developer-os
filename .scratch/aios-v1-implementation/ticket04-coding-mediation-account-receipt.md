# Issue 04: linking coding usage to the qualified mediation account

Status: implemented on `codex/issue04-coding-mediation-account` and reviewed on
both axes. Hosted checks and native qualification remain open. Production
remains disabled.

## Behavior

The owner chose the rule "match when qualified":

- **With a decision.** When a delivery has an owner-endorsed model-only
  mediation decision, `codeFeature` first re-qualifies the delivery, as every
  other dispatch path does. The decision must still be qualified for the
  delivery's current offline admission binding, and coding usage must come
  from exactly that decision's account.
- **Linking.** The first mediated launch links the feature
  (`feature.mediationAccountId`). Once linked, coding refuses if the decision
  is withdrawn, its record changes, or the host evidence regresses, such as a
  failed gateway integration.
- **Without a decision.** A delivery with no decision keeps the current
  controlled behavior. Making the decision mandatory is deferred to production
  integration.

The mediation check (qualified, and scoped to the current binding) used to be
copied in the inference-plan, online-canary and synthetic-task paths. It is
now one helper, `qualifiedDecision`, which coding uses too.

## Known limitations and owner recovery

- **Recovering from a withdrawn or regressed decision.** The owner restores
  the same qualified decision, for the same account, and re-qualifies. Nothing
  unlinks a feature, and a decision for a different account never authorizes
  a linked feature.
- **A decision that arrives mid-feature.** A feature that coded unlinked under
  account X and then receives a decision for account Y is refused for good,
  because of the account pinned at first launch. That fails closed, and the
  feature needs a new delivery.
- **Account ID formats may never match (applies to the online path too).**
  - Usage observations derive `accountId` in `codex-usage.ts` by hashing the
    account email.
  - Decisions use `subscriptionAccountId(...)`.

  With real readers these may never be equal, so every mediated launch would
  refuse, failing closed. The online path already compares the same two
  values. Reconciling the formats belongs to production integration.
- **Withdrawal during a turn goes unseen.** A decision withdrawn while a turn
  runs isn't detected by the usage monitor or the final pre-collection check.
  Only the account pin is rechecked there. The next launch re-qualifies and
  refuses.

## Evidence

All tests go through the public `DeliveryController` methods (`codeFeature`
and `qualify`) with the controlled runtime, the subscription fixture, and a
worker probe. A new helper,
`tests/helpers/mediation-fixture.mjs`, qualifies a coding delivery with a
genuine protected decision record through the real projection path. It was
extracted from the existing decision test, which still has its own copy.

TDD notes:
- Every behavior test failed first:
  - an account mismatch with the decision;
  - refusal after the decision is withdrawn;
  - refusal after the probe regresses with the record unchanged.
- **Spec review finding:** coding read the persisted decision without
  re-qualifying. The regressed-evidence test failed first; coding now
  re-qualifies.

Mutation checks: each guard was removed in turn, the code was rebuilt, and the
focused tests were rerun.
- **Pinned:** the decision trigger, the link trigger, the account match, the
  link persistence, and the re-qualification.
- **Removed:** a redundant check of the linked account against the current
  account. The account pinned at first launch already enforces it.
- **Defense in depth:** the `qualified` and scope checks. The projection
  always writes `qualified: true` with a scope derived from the same binding.

Validation:
- Cloud Linux on Node 24: typecheck and Prettier pass.
- The related online-access, offline-canary, subscription and inference
  suites pass.
- The full-suite results and the coverage comparison are in the PR.
