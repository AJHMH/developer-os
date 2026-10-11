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


## Native storage correction and follow-up review

The first live setup attempt was stopped before exchange after a disposable
Keychain canary exposed `security -i` truncation and nonzero exit behavior. Commit
`f4f238f` replaces that transport with a stable native Security-framework helper.
The helper is deployed outside the candidate; credentials travel through pipes
and remain in Keychain. Source and binary digests pin its deployment.

The follow-up Spec review found insufficient ownership checks for existing
storage. Commit `bc03427` requires the effective owner, private mode bits and no
macOS extended ACLs for the directory and files, initially and before use.
Public setup tests refuse shared and ACL-bearing storage. Both reviewers confirm
that the security finding is resolved; Standards has no unresolved judgments.

Typecheck and formatting pass; all 114 tests pass on this Mac. The corrected
native helper stored a 64 KiB synthetic payload, read it back after reopening,
replaced it exactly and removed the synthetic entry. This is native persistence
evidence, not owner credential isolation or VM mediation qualification.

## Authorization diagnostics

Owner browser consent was attempted, but the broker returned an authorization
failure before credential storage. Commit `a28c4ec` adds fixed failure stages
and optional numeric HTTP status while discarding provider bodies and raw
exceptions. Both reviewers reported no findings for that change. Typecheck,
formatting and all 115 tests pass. A fresh owner consent retry is pending;
delivery remains disabled.
