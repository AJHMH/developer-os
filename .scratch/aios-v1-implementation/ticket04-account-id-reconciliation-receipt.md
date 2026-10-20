# Issue 04: reconciling usage and mediation account IDs

Status: implemented on `codex/issue04-account-id-reconciliation` and reviewed
on both axes. Hosted checks and native qualification remain open. Production
remains disabled.

## The gap

Usage observations and mediation decisions identify accounts in different
identity spaces:
- The usage reader (`codex-usage.ts`) hashes the email of the owner's Codex
  login.
- The decision's `accountId` is `subscriptionAccountId(...)` of the vault
  credential: a hash of issuer, client, subject and host.

The Codex account read exposes only an email, so neither side can compute the
other's ID. With real readers, every comparison would have refused. That
affected the online canary, the inference plan, and coding.

## Behavior

The owner chose an endorsed binding:

- **The record carries both accounts.** The owner-endorsed decision record now
  also carries `usageAccountId`: the usage-reader account observed for the same
  subscription during the mediation run.
- **The projection requires it.** The projection requires a valid hash and
  exposes it on `mechanismDecision.usageAccountId`. A record without it no
  longer qualifies. That fails closed until the record is re-endorsed.
- **What compares against which account.** Every comparison against observed
  usage now uses `usageAccountId`. That covers the inference-plan check, the
  online-run permit, the online run's mid-run authorization and its recorded
  grant, coding, and the endorsement of unknown usage in `checkUsage`. Plans
  and dispatched runs still record the vault `accountId`, which the relay
  uses.
- **Online polling.** Foreground `pollUsage` for a dispatched online run now
  reads the decision through `status`, which re-verifies the protected record.
  If the decision no longer verifies, the run stops.
- **Run evidence.** Dispatched online evidence records the run's
  `usageAccountId`. The qualification report's usage-gate check and
  `onlineUsagePermits` compare usage against it. A run without it, such as
  older evidence, is not usage-gate proof.
- **Coding.** Coding treats unmeasured usage as unknown, even when attributed
  to the endorsed account. That keeps the rule that an unknown account is never
  coding authority, even after an owner approves the check.
- **Naming.** The feature's link field is renamed to
  `feature.mediationUsageAccountId`, because it holds a usage-reader account.
- **Glossary.** `CONTEXT.md` now defines the vault credential account and the
  endorsed usage account.

## Known limitations

- **The record writer is out of scope.** The decision record is still
  operator-written. Whatever produces it from a live mediation run must record
  the usage-reader account it observed. This change only consumes and enforces
  the endorsement.
- **Existing records stop qualifying.** Records without `usageAccountId` no
  longer qualify and need re-endorsement.

## Evidence

All tests go through public seams:
- `qualify` and `status` for the projection;
- `codeFeature` for coding;
- `onlineCanary`, `pollUsage` and `checkUsage` for the online paths.

The fixtures now use different vault and usage accounts, so a comparison
against the wrong one fails.

TDD notes:
- Changing the fixtures and adding tests made 18 tests red until the
  endorsement was implemented.
- My first mutation pass showed four comparisons were unpinned. Tests were
  added for:
  - qualifying with a record that has no endorsement;
  - endorsing unknown usage;
  - polling a healthy run;
  - a decision that stops verifying mid-run.

  The last one exposed a real gap: `pollUsage` read the decision without
  re-verification. It failed first, and it now reads through `status`.
- I simplified the polling check to "the decision is still present", because a
  dispatched run blocks re-qualification.

Review fixes. Each failing test was written first:
- **Spec review:**
  - the qualification report still compared usage with the vault account;
  - `onlineUsagePermits` did the same;
  - a missing observation, endorsed, could authorize mediated coding after
    approval.
- **Standards review:**
  - the misleading field name;
  - the missing glossary terms;
  - the duplicated held-run scaffolding, now a `heldRun()` helper.

Mutation checks: each guard was removed in turn, the code was rebuilt, and the
focused tests were rerun.
- **Pinned:**
  - the projection requirement;
  - the inference-plan comparison;
  - the online-run permit;
  - the mid-run authorization and its recorded grant;
  - the unknown-usage endorsement;
  - the polling account;
  - coding;
  - the recorded run usage account;
  - the report's account comparison;
  - unmeasured usage being unknown for coding.
- **Enforced by the type system and the unrecorded-account assertion:** the
  report's presence check.
- **Pinned by the failing-first test:** the decision-absence stop. A source
  mutation can't compile because of type narrowing.
- **Pre-existing, unchanged:** the mid-run check that the vault account still
  matches.
