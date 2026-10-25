# Receipt: a test suite that fits the Factory's coverage limit

Date: 24 October 2026. Branch `codex/faster-test-suite`, from `main` at
`9028d59`.

## Why

PR #104's "Enforce Factory coverage" check failed twice. The cause was a time
limit, not low coverage. Running the Factory's own `measure-coverage` command
(trusted revision `f78ebdb`) locally on the same commits showed:

- The suite without coverage took 213 s, against the contract's 240 s limit
  per test stage.
- The coverage-measured run timed out at 240 s, so no verdict was written.

PR #104's 52 new tests take about 1 s. The suite had simply grown to the edge
of the limit.

## Where the time went

- **The candidate-source check.** It re-reads the checkout on every
  controller step, starting git 6 times each time. One typical controller
  test called it 42 times, and the suite called it about 8,000 times, which
  is about 48,000 of its 56,000 git starts. Each call also re-read every
  variable of `process.env`, which costs about as much as starting git (12%
  of a controller test's CPU).
- **The fresh-build test.** It ran the TypeScript compiler about 25 times
  (65 s), half of them only to build the same sample checkout again.
- **The native-guest fixtures.** They start Python once per guest request.

## What changed

- `src/feature-candidate.ts`:
  - `candidateMainSource` reads HEAD and the default branch in the **same
    `rev-parse` call**, with `--` so only revisions are accepted. This saves
    one git start per call, and the two commits are now read together.
  - The environment passed to git, without any `GIT_*` variable, is **built
    once per process and reused**. A variable set later never reaches git,
    so ambient `GIT_*` input stays excluded.
  - No check is removed or reordered relative to the working-tree
    observation. The configuration check still runs before `status`.
- `tests/fresh-build.test.mjs` compiles its sample checkout once per file and
  copies it to each case. Every case still runs the real fresh-build check,
  compiler included.
- The native coding and validation guest fixtures run `python3 -I -S`. `-I`
  matches the real guest's invocation, and `-S` skips the unused `site`
  module.

## Evidence

- **New tests, written first and passing on the old code:**
  - `a main baseline is the checked-out default branch, and nothing else`:
    a missing default branch, and HEAD and main on different commits in
    either direction, are refused.
  - `ambient Git variables never redirect a source observation`: a fresh
    process with `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE` and
    `GIT_CONFIG_PARAMETERS` set still observes the right repository.
  - The line-break-in-root test also covers `candidateMainSource`.
- **Mutants:** removing the `GIT_*` filter fails the ambient test, and
  skipping the main comparison fails the baseline test.
- **Timings,** on 2 cores with Node 24.22.1, measured with the Factory's
  exact command:

  | Stage | Before | After |
  |---|---|---|
  | Tests without coverage | 213 s | 174 s |
  | Tests with coverage (this branch) | timed out at 240 s | 197 s |
  | Suite CPU time | 396 s | 303 s |

  The fresh-build test went from 65 s to 16 s.

## Open

- **The comparison run still times out.** The Factory also measures the base
  revision (`main`) with the same limit, and today's `main` is the slow
  version. This PR's own coverage check therefore fails until a faster
  `main` exists. Getting past it is the owner's decision.
- **Headroom is about 18%** (197 s of 240 s). Further savings are possible,
  but they touch larger areas, such as reusing controller fixtures between
  tests.
