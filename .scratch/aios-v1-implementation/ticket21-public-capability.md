# Ticket 21 public capability decision

The successful approved run `55f1cce4-6ea9-484d-8433-51e5cf6ed98f` is endorsed
in private external controller state as
`subscription-decision-29727630-9a13-4050-a217-7a554b04448e.json`.
The operator endorsement used the successful receipt from signed commit
`7d99853`. There is no public candidate receipt import command. Repository files
are observations, not authority.

`qualification.subscriptionMediation.mechanismDecision` reports the historical
positive `macos-fixed-codex-subscription` capability. It is bound to repository,
run, account registration, fixed request, source versions, executable, policy and
VM identity. Protected evidence and its consumed marker must remain private,
owned by this user and free of ACL grants. The private policy file may have an
owner-controlled readable parent. Missing, unsafe or mismatched evidence removes
the decision. Registration hashes bind configuration, not current token validity.

Public status recomputes trust against current files and stored VM qualification.
It does not probe the VM; rerun synthetic qualification after runtime changes.
The base production mediation flag, readiness and live readiness stay false.
`inferenceAuthorized` is always false. A future run needs its own reviewed plan,
current credential checks and exact approval.

Inspect the scoped decision:

```sh
node dist/cli.js status --state-dir /Users/aaronhoward/.developer-os/ticket4-macos/state --id 29727630-9a13-4050-a217-7a554b04448e
```

The retained `ticket21-public-capability-observation.json` records a fresh
synthetic native qualification and successful CLI status comparison. This
verification performed no live inference. All 124 tests passed, including unsafe
storage, missing evidence, drift, failed admission and deleted-repository status.
Both final reviews report no unresolved findings.
