# The observed pilot (#275)

The pilot delivers one agreed feature on a real repository through the whole
native path: onboarding, planning, baseline and candidate validation, coding,
signed publication, the App's PR, its checks, review, merge, main checks, main
sync and branch cleanup. `scripts/run-native-pilot.mjs` runs it from the
owner's records. It refuses to start unless the production admission names a
passing [complete qualification](macos-controller-qualification.md) at
exactly the coding and validation records' pins.

The first pilot adds a "Skip to content" link to
[AJHMH/profile-page](https://github.com/AJHMH/profile-page). Its record is
[`pilot/profile-page-pilot.json`](pilot/profile-page-pilot.json).

## The pilot record

A private owner file (mode `600`) with scope `aios-pilot-v1`:

- **The feature:** `request`, `criteria` and `verification`, which become the
  delivery's request and the owner's feature criteria.
- **The repository:** `repository`, `requiredChecks` (the contexts its
  ruleset requires), `excludedPaths`, and `signedCommit`, a commit in it that
  the owner signed and GitHub verifies, which onboarding checks.
- **Validation:** `validationContract` without its environment, plus
  `database`, `browser` and `libc`. The runner adds the prepared npm
  environment for the validation record's image.
- **Limits:** `budgetDollars`, `codingMinutes`, `repairCycles`,
  `checksWaitMinutes` for the PR and main checks, and `reviewWaitMinutes`.
- **`requireOwnerApproval`:** when true, the pilot merges only after the
  owner approves the exact head on GitHub, even when the change gate would
  pass it (ADR 0005).

profile-page's contract runs its own checks offline: Prettier, ESLint,
`svelte-check`, Vitest with coverage, the build, and its Playwright E2E
against a disposable PostgreSQL. Two candidate checks prove the feature,
because a candidate may change only `src/routes/+layout.svelte`, and tests
stay as main has them:

- **`skip-link`** reads the layout: a skip link before the navigation, whose
  target is the main element's id.
- **`skip-link-browser`** writes a Playwright spec under `test-results` (an
  output path), then tabs to the link on `/`, `/about` and `/contact` in
  Chromium and follows it to `main`.

The record pins Prisma's schema engines for both OpenSSL flavours, with their
`.sha256` side files, as [tool files](isolated-validation.md#owner-pinned-tool-files-275).

## What the repository needs

The runner reads these live from GitHub and stops naming the first that
doesn't hold:

- The default branch refuses unsigned commits, force pushes and deletion.
- It requires exactly the record's checks, from GitHub Actions.
- It has **no pull request rule**. The controller merges by fast-forwarding
  main to the reviewed, signed head, which a pull request rule refuses; its
  own review stage decides instead (ADR 0005).
- The owner is the only person who can push.
- `signedCommit` is Verified and committed by the publication login.

The controller matches GitHub Actions jobs to checks by job name, so main
checks need their own job names. profile-page names its jobs `main: …` on
pushes to main
([AJHMH/profile-page#124](https://github.com/AJHMH/profile-page/pull/124)).

## Running it

On the Mac, from a clean, built checkout of `main`, with the VM running:

1. A publication record for the repository: a copy of
   `publication-identity.json` with `repository` set to `AJHMH/profile-page`,
   mode `600`.
2. A signed commit in the repository, on a branch of its own, for example an
   empty commit signed with the publication record's key and pushed with the
   owner's `gh` login. Cleanup keeps the branch, because it isn't merged.
3. The pilot record: a copy of the example with `signedCommit` set, mode
   `600`.
4. The run:

   ```sh
   node scripts/run-native-pilot.mjs aios-macos-noshare "$HOME/.developer-os/admission/claude-coding-admission.json" "$HOME/.developer-os/admission/validation-admission.json" "$HOME/.developer-os-auth" "$HOME/.developer-os/admission/publication-identity-profile-page.json" "$HOME/.developer-os/admission/production-admission.json" "$HOME/.developer-os/pilot/profile-page-pilot.json" "$HOME/.developer-os/issue275-pilot-$(date +%Y%m%d-%H%M%S).json" --approve-metered-native-run
   ```

While it waits for review it prints which PR to review and which head to
approve. A pass prints `"outcome": "observed-native-pilot-delivery"`.

A pilot that stops keeps the delivery's state, under
`~/.developer-os/aios-pilot-state-…`, and its clone, which the report names
as `checkout`, so the owner can continue the delivery with the CLI.

## The report

The report holds each stage, the baseline and candidate results, the coding
and repair outcomes, the spend, the PR and its checks, how the head was
approved, the merge, the main checks, the main sync and the cleanup. It
carries the owner's request and criteria and public repository facts, never
a credential.
