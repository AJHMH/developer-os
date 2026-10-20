# Issue 04: owner re-endorsement of a mediation decision's usage account

Status: implemented on `codex/issue04-decision-endorsement`. Hosted checks and
native qualification remain open. Production remains disabled.

## The gap this closes

The [reconciliation receipt](ticket04-account-id-reconciliation-receipt.md)
made `usageAccountId` mandatory in the protected decision record. Nothing in
the repository writes mediation decision records, so existing records stopped
qualifying with no way back. The owner chose an owner-run re-endorsement tool
over a decision-record writer.

## Behavior

`endorseUsageAccount` in `src/subscription-endorsement.ts` and the script
`scripts/endorse-subscription-usage.mjs`:
- read the protected record `<state>/subscription-decision-<deliveryId>.json`,
  requiring a valid delivery ID, a private state directory and a private record
  whose schema, delivery and vault `accountId` match;
- take a fresh observation from the usage reader (the pinned host Codex and the
  owner's login), and require it to be measured and to identify an account;
- preview by default: print the usage account hash and write nothing;
- write `usageAccountId` only with explicit confirmation (`--confirm true`) and
  the previewed hash (`--expect`), so a login switched between preview and
  write can't be endorsed;
- on macOS and Linux, write the new record to an exclusive `0600` temporary
  file in the private state directory, check its privacy and rename it over
  the record, so an interrupted write leaves the original record;
- on Windows, rewrite the record in place. A new file takes the shell's
  default owner (Administrators when elevated), which the privacy check
  rightly refuses; hosted Windows CI caught this. Rewriting in place keeps the
  owner and access rules, and an interrupted write leaves an unparsable record,
  which fails closed;
- never re-bind: re-endorsing the same account is a no-op reported as
  `alreadyEndorsed`, and a record already endorsed for another account refuses.

Every refusal is an `EndorsementRefusal` with an operator-safe message. The
script prints only those messages and the shared operator refusals, and a fixed
sentence otherwise. Its options follow the repository's `--state-dir` and
`--codex-executable` names. The decision module now exports the shared `hex`
and `uuid` checks and `subscriptionDecisionPath`, which both modules use.

The tool doesn't touch the consumed-inference marker, the vault account or any
other field, so `qualify()` still decides everything else.

## Evidence

Tests go through the agreed seam: the exported function, with the outcome
verified through `qualify()` on a mediated-coding fixture.
- A dry run reports the account and leaves the bytes unchanged. A confirmed
  endorsement makes the decision qualify with the endorsed account, and a
  repeat writes nothing.
- Each refusal leaves the bytes unchanged: no observation, an unmeasured or
  stale observation, an unexpected account, another delivery, a record that
  isn't this delivery's decision, and a record endorsed for another account.
- A record readable by others refuses (skipped on Windows).
- A write without the previewed account refuses, as do an invalid delivery
  ID, a failing reader and a record that can't be replaced. Each refusal
  asserts its reason, and no temporary file remains.
- The script refuses missing inputs, a non-`true` confirmation, a confirmation
  without `--expect` and unknown options, and prints the function's refusal for
  a missing record.

TDD: the qualify test failed first (no module), then each refusal case.
Review: the Standards review asked for safe script errors, the repository's
option names, shared validators and the repository's private-write pattern. The
Spec review asked for a recoverable write, a mandatory `--expect` when writing
and a distinct already-endorsed result. All are done.

Mutation checks: each guard was removed in turn and the focused tests rerun;
every guard has a failing test, except the temporary file's privacy check,
which only an inherited non-private ACL can reach. On Linux the module's
only uncovered lines are the Windows in-place write, which the hosted Windows
shard runs through the same tests. Windows ACL refusal is left to native
Windows acceptance.

No Codex binary, credentials, online inference or real VM was used.

## Still open

- Cleanup of retired resume lineages.
- Production restart authorization.
- Real Windows and macOS native acceptance.
- Production remains disabled, and the parent ticket stays partial.
