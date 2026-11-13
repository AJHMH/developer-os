# Merged main verification

Implementation reference: [current scope and qualification gates](implementation-status.md). Controlled delivery contracts below are implemented; native production acceptance remains separate from the fixed-worker evidence.

`monitor-main-checks --id <delivery-id>` observes configured main checks after a
confirmed merge. With the owner policy, the CLI installs the native read-only
main observer (#271, below).

The observer independently establishes repository, PR number, approved head,
default branch, actual merge commit and reachability on current main. It returns
complete check history for that exact main revision, including trusted publisher
and workflow identities. It must re-read main before returning and mark raced
observations incomplete. Passing PR checks cannot satisfy this contract.

The controller retains check attempts per revision. Main advancement requires
new matching evidence; returning to an earlier revision retains its failures.
Missing, spoofed, partial, skipped or neutral required results cannot pass unless
an explicit owner-policy exception permits the status. A failed attempt followed
by success remains flaky unless the pinned policy explicitly permits diagnostic
passes. Main monitoring cannot initiate reruns, repairs, reverts or remote writes.

Monitoring starts one persisted wait window at the first main observation.
Configured check deadlines apply within that window, with the existing one-hour
default for hosted checks. Restart, revision changes and polling backoff cannot
reset it. Clock rollback or deadline expiry blocks. Foreground observation is
bounded; recovery replaces its observation token so an old response cannot
supersede a newer result. Pause/cancel retain evidence without authorizing
progression. Changes to the pinned policy or observer binding revoke verification.

`main-verified` means the observed revision passed main checks, not completed
delivery. `mainChecks.revision` identifies that revision, while `runs` retains
prior attempts and findings. Synchronization and cleanup are subsequent slices
and must freshly verify main before effects. Failed main checks preserve evidence
and identify an owner next action: investigate; any fix or revert requires a new
signed PR and approval. Direct-main repair, automatic revert and cleanup remain
unavailable.

## Native main observer (#271)

`src/native-main-checks.ts` is read-only and reads through your `gh` login.
Each observation:
1. confirms the PR merged with exactly the recorded head and merge commit;
2. reads main's current tip, and whether the merge commit is in its history;
3. reads every job of every attempt of the trusted main workflows' runs for
   exactly that tip. Only `push` runs on the default branch count: a PR's run
   on the same commit, which a fast-forward merge shares, never checks main;
4. re-reads main before answering. A main that moved meanwhile makes the
   observation incomplete.

It shares the PR check monitor's reading of GitHub Actions (#268): every page
and attempt, with the same status mapping. Main is the trusted branch, so its
own workflow file is the trusted one.

`monitor-main-checks` takes `--owner-policy`, which names the repository and
the workflows of its main-scoped checks declared with `publisher:
github-actions` and `workflow: <path>@<default branch>`. The check's `id` is
the workflow job's name.

### Native main acceptance

The real delivery run's `--through-main` continues after the merge (see
[the first real delivery](feature-candidate.md#the-first-real-delivery---through-review)):
`monitor-main-checks` must verify the merged main through `main-ci`, waiting
while the push run starts.

It needs the disposable repository's workflow to run on pushes to `main`,
with a `main-ci` job. Change `.github/workflows/ci.yml` on `main` through a
PR, since the branch rules require one, to:

```yaml
name: CI
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  pr-ci:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803
        with:
          persist-credentials: false
      - name: Fail when the PR asks to
        run: test ! -e acceptance/fail
  main-ci:
    if: github.event_name == 'push'
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803
        with:
          persist-credentials: false
      - name: The page is on main
        run: test -f index.html
```

Then run:

```sh
node scripts/run-native-acceptance.mjs "$HOME/.developer-os/ticket4-macos/state" scripts/run-native-cli-delivery-acceptance.mjs -- aios-macos-noshare "$HOME/.developer-os/admission/claude-coding-admission.json" "$HOME/.developer-os/admission/validation-admission.json" "$HOME/.developer-os-auth" "$HOME/.developer-os/issue12-main-delivery-$(date +%Y%m%d-%H%M%S).json" --approve-metered-native-run --through-main "$HOME/.developer-os/admission/publication-identity.json" "$HOME/.developer-os/admission/production-admission.json"
```

## Native qualification

Native macOS qualification must demonstrate trusted complete API
pagination/history, publisher/workflow identity, current-main race handling,
PR/head/merge linkage and reachability, bounded reads and credential separation.
Controlled tests do not qualify native operation or enable the profile-page pilot.
