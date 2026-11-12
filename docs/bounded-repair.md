# Bounded candidate repair

Implementation reference: [current scope and qualification gates](implementation-status.md). Controlled delivery contracts below are implemented; native production acceptance remains separate from the fixed-worker evidence.

Ticket 07 adds repairFeature(id, reviewFindings?) and extendRepair(id, cycles,
minutes) to the public controller. The CLI exposes repair-feature --id ID and
extend-repair --id ID --cycles N --minutes N. Omitted extension amounts default to
zero; at least one must be positive. Only the explicit owner control can extend
a stopped, exhausted allowance.

A repair needs the controlled coding and validation runtimes. Without them it
refuses before recording anything, and no cycle is spent. From the CLI,
`repair-feature` installs them from the same options as `code-feature`: the
owner policy, `--podman-machine` with `--coding-admission` and
`--validation-admission`, and `--auth-directory` for the owner's Anthropic
key. It takes no `--coding-minutes`; the repair allowance applies. The repair
turn is metered against the delivery's spend budget like any coding turn
(ADR 0008): a budget interruption refuses the repair before it records an
attempt, until `extend-budget`.

Coding's own refusals also come before a cycle is recorded: a changed source
or onboarding authority, a changed baseline environment, and usage that is
missing, unapproved or exhausted. Each leaves the candidate's validation as it
was; only the usage observation it made is recorded. An exhausted repair
allowance is reported before these checks run. A base refresh is the
exception: it moves the feature's revision inside the attempt, so its coding
checks still run there and a refusal spends the cycle.

A cycle starts with a stopped candidate validation attempt, an admitted artifact
and a bounded batch of findings. Failed check identities are derived from retained
validation evidence. Optional review findings are untrusted text, not authority
to change scope, policy, gates or credentials. Baseline failures and unvalidated
candidates cannot enter repair. Production delivery remains disabled.

Each cycle sends the current candidate, criteria and findings to the same trusted
controlled coding integration in a fresh explicit session. The existing baseline,
source, environment and runtime pin checks still apply. Collection requires verified
descendant shutdown. Candidate changes outside the owner's mutable application
paths are refused before replacing the retained artifact.

Every successfully admitted result receives local candidate verification, including
an unchanged result. The existing one-diagnostic-rerun and flake policy still applies:
a pass on an unchanged tree cannot silently erase an earlier failure. New tree
identity invalidates old evidence. Successful local repair does not satisfy hosted
checks or authorize publication/merge.

## Durable accounting and controls

The allowance defaults to three cycles or 3,600,000 active milliseconds, whichever
is exhausted first. The owner may set either at `start` with `--repair-cycles
<1..100>` and `--repair-minutes <1..1440>` (#266); the delivery records them
as `initialRepairAllowance`. A spent allowance is reported before anything
else, even when nothing is left to repair, and records nothing. Starting a batch consumes one cycle, including failed and
interrupted attempts. The final permitted cycle may succeed; reaching the time
limit prevents success even if a late check returns green.

Diagnosis/editing inside the coding runtime and local verification consume repair
time. Initial coding has a separate counter. CI/approval waits, paused time and
controller downtime do not consume active repair time. Runtime checkpoints,
controller heartbeats, command deadlines and shutdown observations persist usage;
a different controller runner never charges the elapsed restart interval.

Each attempt retains findings, input/candidate identities, coding session,
verification operation (when dispatched), outcome and remaining allowance.
Interrupted or failed attempts remain in the ledger. New comments and restarts
never reset allowances. Repair extensions add explicit durable records.

Pause/cancel fence further effects and reconcile descendants. Unknown shutdown
blocks overlap, resume and ownership release. Recover the exact runtime binding
before another cycle. An interrupted stopped verification awaiting final inspection
is marked incomplete; its late callback cannot overwrite a later cycle's evidence.

Once repair starts, direct codeFeature/validateCandidate calls cannot bypass repair
accounting. Further local repair/revalidation goes through repairFeature. A batch
that cannot dispatch or verify retains failure and the available evidence.

## Native repair acceptance (#266)

`scripts/run-native-cli-delivery-acceptance.mjs` with `--with-repair` runs the
metered delivery acceptance ([feature candidate](feature-candidate.md)) with a
repair:

1. `start` adds `--repair-cycles 1`, and the owner contract adds a
   candidate-only check, `page-has-data-testid-contact-hint`. It needs an E2E
   test hook, `data-testid="contact-hint"`, in `index.html`, which the coding
   turn is never told about. The first native run used an arbitrary marker
   instead, and the repair turn rightly refused to add text the criteria
   didn't ask for; a test hook is a requirement a careful agent accepts.
2. `validate-candidate` must fail exactly that check.
3. `repair-feature`, on the same owner-admitted runtimes and Anthropic key,
   must spend the one cycle: a stopped Claude Code turn on the delivery's
   budget, given the failed check, with active time and spend recorded. The
   repaired candidate must pass revalidation.
4. A second `repair-feature` must be reported as exhausted, with no attempt
   recorded and nothing spent.
5. `extend-repair --cycles 1` must be recorded.

Both turns' coding sessions are then cleaned up. The run spends at most the
$5 budget. Its passing outcome is `observed-metered-cli-repair-acceptance`.

In Terminal, from a clean, built `main` with the VM running and both
records current:

```sh
node scripts/run-native-acceptance.mjs "$HOME/.developer-os/ticket4-macos/state" scripts/run-native-cli-delivery-acceptance.mjs -- aios-macos-noshare "$HOME/.developer-os/admission/claude-coding-admission.json" "$HOME/.developer-os/admission/validation-admission.json" "$HOME/.developer-os-auth" "$HOME/.developer-os/issue07-repair-acceptance-$(date +%Y%m%d-%H%M%S).json" --approve-metered-native-run --with-repair
```

## Qualification still required

Only controlled adapters are accepted. No native repair executor, provider call,
host validation script or publication authority is added. Qualify real macOS
coding and validation runtimes, process-tree shutdown under interruption/deadline,
clock/checkpoint persistence across controller crashes, dependency/script isolation,
protected validation inputs and disposable E2E fixtures before live use.
Hosted review/check integration and complete delivery qualification remain later
slices. Public tests demonstrate controller behavior, not native readiness.
