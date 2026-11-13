# The first real delivery, on macOS

12 November 2026. macOS 27.3.0 arm64, VM `aios-macos-noshare`. The owner
ran it from a freshly built, clean `main` at `82da95f` (#305), with
`scripts/run-native-cli-delivery-acceptance.mjs --through-review`.

This was one real delivery, end to end up to merge:
- the real CLI, one process per step;
- the owner's admitted Claude Code and validation runtimes;
- the owner's production admission, publication record and `gh` login;
- the owner's disposable repository `AJHMH/aios-publication-acceptance`.

It reached `ready-to-merge` and stopped there, because merge is #270. Only
the feature criteria file was synthetic. It wrote one signed branch and one
App PR to that repository. It merged nothing and submitted no review.

## Owner setup

- **The page:** `index.html` (`<h1>Contact</h1>`) on `main`, commit
  `55ac2d51…`, unsigned. The signed-commit rule applies to later pushes.
- **Ruleset `aios-delivery` (27168003)**, active on the default branch:
  - deletion and force pushes blocked;
  - signed commits required;
  - `pr-ci` required from GitHub Actions (App 15368);
  - no required reviews, because the change gate decides (ADR 0005).
- **Production admission:** `~/.developer-os/admission/production-admission.json`,
  `productionSha256` `eb4f607a…`. It names the passing worker qualification
  `issue04-worker-qualification-20261111-152729.json` and its pins: Claude
  Code 2.1.311 and validation binding `e9bdb2df…`.

## Runs

1. **`issue04-real-delivery-20261112-181124.json`** (`aceefc3`). Every stage
   through `cli-publish-feature` passed, opening
   [AJHMH/aios-publication-acceptance#9](https://github.com/AJHMH/aios-publication-acceptance/pull/9).
   Then `monitor-pr-checks` refused. It re-checks the publication's
   validation evidence, which needs the validation runtime, and the CLI gave
   it only `--owner-policy`. So did `rerun-pr-check`, `monitor-review` and
   `resolve-review-thread`. Fixed in #304.
2. **`issue04-real-delivery-20261112-185852.json`** (`a20b7f8`). Through
   publication again, opening
   [AJHMH/aios-publication-acceptance#10](https://github.com/AJHMH/aios-publication-acceptance/pull/10).
   The monitor's first look, two seconds after the push, found no `pr-ci`
   run yet and rightly reported `incomplete`. The script took that as final.
   Fixed in #305: it now waits through `pending`, `incomplete` and
   `unavailable` until the deadline. That PR's `pr-ci` then passed.
3. **`issue04-real-delivery-20261112-192308.json`** (`82da95f`):
   `observed-native-delivery-through-review`, SHA-256
   `57a5accaa200392c719449fcf24584aaab4b0e1e6bdee22bd9a1ad2886c0263d`.

## Passing run

Delivery `487436d5-bfac-4b2d-8e5a-3e617c2d917f`. All 13 stages passed, in
about 2.5 minutes:

- **`owner-records-name-fresh-pins` (2 s):** the coding and validation
  records name the VM's fresh pins.
- **`repository-facts` (3 s), read live:**
  - the ruleset's rules;
  - the owner as the only person who can push;
  - the App's PR 10, whose head `c29b3ada…` is owner-signed, Verified by
    GitHub and verified locally against the owner's key;
  - the production admission naming exactly the coding pins.
- **`owner-inputs` (2 s):** a clone of `main` at `55ac2d51…`, through the
  owner's `gh` credentials, and the policy and attestation of those facts.
- **`cli-start`, `cli-plan-feature`:** onboarding ready, from the owner's
  attestation.
- **`cli-validate-baseline` (29 s):** 5 of 5 checks passed, binding
  `e9bdb2df…`.
- **`cli-code-feature` (25 s):**
  - one Claude Code turn, stopped exactly and routed by the delivery's spend
    budget;
  - 4 requests, $0.060 of $5;
  - it admitted a candidate adding `<p class="contact-hint">Questions? Send
    us a message and we'll get back to you.</p>`.
- **`cli-validate-candidate` (35 s):** 6 of 6 checks passed.
- **`cli-publish-feature` (20 s):**
  - the owner's key signed commit
    `88ae49003b5770d6941ee7c180773bb857595502` through ssh-agent, with
    parent `main`;
  - the owner's `gh` login pushed it to
    `aios/feature-487436d5-bfac-4b2d-8e5a-3e617c2d917f`, and GitHub reports
    it Verified (`valid`), committed by `aaron-howard`;
  - the App opened
    [AJHMH/aios-publication-acceptance#11](https://github.com/AJHMH/aios-publication-acceptance/pull/11)
    as `ajhmh-software-factory[bot]`;
  - the publication records the production admission `eb4f607a…`.
- **`cli-monitor-pr-checks` (25 s, 2 polls):** `pr-ci` run `43344769193`,
  attempt 1, succeeded. It came from `github-actions`, workflow
  `.github/workflows/ci.yml@main`, on exactly that head. The outcome is
  `passed`.
- **`cli-monitor-review` (8 s):**
  - the change gate classified the one-line change ungated;
  - it is authorized as `ungated` for exactly `88ae4900…`, with no review;
  - the phase is `ready-to-merge`.
- **`host-checkout-unchanged`:** the clone stayed on unchanged `main`, with
  the feature branch at the baseline.
- **`coding-session-cleanup` (1 s):** the coding session was removed by its
  exact identity.

The delivery state stays in the run's printed `state` directory.

## Not covered

- **Merge, main verification, main sync and cleanup** (#270 to #273).
- **A gated delivery** waiting for the owner's approval, and a review repair.
  The review acceptance covers both adapters natively, but not on a delivery.
- **A failing PR check on a delivery**, and its rerun or repair.
- **Production stays disabled.** The run still reports
  `DELIVERY_NOT_ENABLED`; the pilot (#275) remains.

PRs 9 to 11 and their branches are left open in the disposable repository.
They are harmless.
