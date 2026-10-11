# Ticket 21 broker review

Base: `5d99f1f0371bd55eb0cdc9be40d7f9eb4c463ccd`.
Implementation: `62df578`, with review corrections in the following commit.
Scope: separate macOS authentication setup, preceding live owner consent.

## Standards

No documented-standard breaches. One optional naming finding: the bounded JSON
transport helper was called `document`; renamed to `fetchBoundedJson`.
Credentials remain outside candidate files, process arguments and command output.
Native Keychain access and storage have not yet been observed.

## Spec

No corrective code findings in the broker preparation scope. One stale status
sentence was corrected to distinguish implemented broker code from unqualified
native behavior.

Three positive-qualification requirements remain partial: model-only VM
mediation/credential exclusion, independent endpoint enforcement and revocation,
and completed owner-authorized subscription inference. The real browser callback
and Keychain boundary also require native observation. Authentication alone
cannot close ticket 21 or unblock ticket 22.

## Validation

Typecheck and formatting passed. All 112 tests passed with localhost networking
permitted. An initial sandbox run had 109 passes and three existing synthetic
relay failures because loopback binding was unavailable; this limitation was
resolved by rerunning with that permission, without changing those tests.
Broker tests use synthetic signed identities and controlled external adapters.
No live sign-in, owner credentials, VM dispatch or subscription inference ran.

Standards: 1 optional finding resolved, 0 hard violations. Spec: 1 documentation
finding resolved, 3 positive-qualification requirements remain incomplete.
