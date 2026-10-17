# Trusted operator investigation and publication tools

The owner authorized these two retrospective improvements, bot publication, a PR
and check monitoring. These are manually invoked trusted-host tools, separate from
the unqualified production controller integrations. They grant no worker authority.

## Acceptance criteria

1. A private external investigation ledger retains scope, fingerprinted failures,
   revision-bound evidence, unresolved questions and reproduction commands as data, explicit extensions and interrupted operations. It
   refuses concurrent mutation, scope changes without an operator approval record,
   and new work after a time/cycle allowance is exhausted. Charges are operator
   reports, not independently measured reasoning time or cryptographic approval.
2. Active charges persist even when they exhaust an allowance. Waiting is excluded
   by ending the active operation first. Recovery preserves uncertainty and records
   explicit reconciliation; restarting never resets consumed allowances.
3. Publication prepares an immutable digest of exact staged bytes/tree, parent,
   repository, branch and base. Publish requires that exact digest and unchanged
   local inputs. Existing owner files and unrelated branches remain untouched.
4. App credentials remain outside Git and proposal state. Tokens are repository
   scoped, minimally permissioned and revoked. GitHub platform-signed commits must
   identify the configured bot author and accepted platform committer. This mode
   is distinct from the product's separate local-signing/App-port contract.
5. Intent is durable before remote writes. Replay observes matching remote commits
   and PRs; uncertain writes cannot be retried blindly. Changed heads/base/trees,
   wrong identities, invalid signatures or missing evidence fail closed.
6. Neither tool approves, merges, changes policy/qualification, reruns CI or treats
   chat/proposal approval as GitHub review. Existing baseline failures remain open.
7. Meaningful tests exercise real Git/filesystem preparation, ledger exhaustion,
   concurrency/recovery, and publication failures/reconciliation through the same
   exported interfaces used by the CLIs. Live publication uses the reviewed tool.

## Validation and scope

Baseline main is e68fa3d. Its known Windows shard 2 authentication initialization
and CLI ownership failures remain unresolved. Linux contract attempt 1 timed out;
its one diagnostic replay passed without explaining that failure. This scope
neither repairs nor waives those failures. PR checks are exact-candidate evidence,
not proof the historical failures or production qualification gates are resolved.

Use existing type/format/test/build checks, focused operator tests, then hosted
checks. Prepare the publisher proposal only after both review axes are clear.
Keep owner reports and the prior untracked continuation record intact. Deferred
retro recommendations are saved through the handoff skill outside the repository.
