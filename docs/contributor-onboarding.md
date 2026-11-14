# Contributor onboarding

For anyone, human or agent, about to change this repository. It covers setting
up, building and testing, the workflow from issue to merged PR, and the rules a
change has to meet. In [CONTEXT.md](../CONTEXT.md), an "onboarded repository"
is a target repository the controller delivers to; that's
[Factory onboarding](factory-onboarding.md), not this guide.

## Read first

In this order, for about an hour:

1. [README](../README.md): what the CLI does today and what stays disabled.
2. [Architecture](architecture.md): components, trust boundaries, the stage
   table and the module map.
3. [CONTEXT.md](../CONTEXT.md): the domain vocabulary. Use its terms in issues,
   code and tests, and avoid the synonyms it rejects.
4. [Implementation status](implementation-status.md): what is native, what is
   controlled only, and what remains open.
5. The [ADRs](adr/), at least 0005 to 0009, which changed the system most
   recently. Raise any proposal that contradicts an ADR explicitly. Don't
   silently override one.
6. [CODING_STANDARDS.md](../CODING_STANDARDS.md): the review judgement calls.

Root files such as `AIOS-RESEARCH.md` and the `*-explanation.md` files are
historical design material. `.scratch/` holds receipts and evidence, plus issues
from before 7 November 2026. Read it for evidence, not as the current state.

## Set up

You need:

- **Node 24.10 or later in the Node 24 line**, with npm. `.nvmrc` selects
  24.15.0. The controller uses Node's built-in SQLite, which prints an
  experimental warning; that's expected.
- **Python 3** as `python3`, for host test fixtures. Set `AIOS_TEST_PYTHON` to
  use another interpreter.
- **Git**, and **`gh`** signed in, for issues and PR inspection.

You don't need Podman, an Anthropic key or a Mac to build and test. Native runs
happen only on the owner's Mac, and the owner runs them
([owner hosts](owner-hosts.md)).

```sh
npm ci --ignore-scripts
npm run build
npm test
```

Off macOS, `npm test` sets `AIOS_TEST_HOST_PLATFORM=darwin`, so the suite's CLI
runs stand in for the Mac. The CLI itself still refuses to start off macOS.

## Build, check and test

| Command                | What it does                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `npm run build`        | Compiles `src/` to `dist/` with `tsc`                                                 |
| `npm run typecheck`    | Type-checks without emitting                                                          |
| `npm run format:check` | Prettier over `src`, `tests`, `scripts`, `package.json`, `tsconfig.json`, `README.md` |
| `npm run format`       | Rewrites those files                                                                  |
| `npm test`             | Builds, then runs the whole suite through `scripts/run-tests.mjs`                     |
| `npm run test:cli`     | Builds, then runs `tests/delivery.test.mjs`                                           |

Tests import the compiled `dist/*.js`, not `src/`, so build after every source
change. To run one file:

```sh
npm run build && node --test tests/delivery.test.mjs
```

`scripts/run-tests.mjs` kills the suite if it prints nothing for five minutes,
because the Node test runner can stall with no test running. Tests need
permission to create temporary Git repositories and local sockets. They make no
model requests.

CI runs typecheck, format check, the suite and the build on Linux and macOS
(`.github/workflows/ci.yml`). Run the same four locally before publishing.

## Repository layout

| Path                 | Holds                                                                            |
| -------------------- | -------------------------------------------------------------------------------- |
| `src/`               | The controller, flat; see the [module map](architecture.md#module-map)           |
| `tests/`             | `node:test` suites, plus `tests/helpers/` fixtures and `tests/fixtures/` data    |
| `scripts/`           | Owner-run native acceptances and qualifications, operator tools, the test runner |
| `docs/`              | Contracts per stage, owner runbooks, ADRs and agent conventions                  |
| `.github/workflows/` | CI and the pinned Software Factory workflows                                     |
| `.scratch/`          | Receipts, evidence and historical issues                                         |

## From issue to merged PR

1. **Find or file the issue.** Issues and specs live in GitHub Issues on
   `AJHMH/developer-os`, through `gh`
   ([issue tracker](agents/issue-tracker.md), [triage labels](agents/triage-labels.md)).
2. **Branch from synchronized main.** Fetch, fast-forward local `main`, then
   create a `codex/` branch. The prefix is historical, and the App publisher
   requires it.

   ```sh
   BRANCH_NAME="codex/describe-the-change"
   git switch main && git pull --ff-only && git switch -c "${BRANCH_NAME:?}"
   ```

3. **Change test-first where you can.** Each behavior needs a test that fails
   without it. Keep the change to one concern.
4. **Validate locally:** `npm run typecheck`, `npm run format:check`,
   `npm test`, `npm run build`.
5. **Publish as the Software Factory App**, not under a personal account.
   Agent-prepared changes go through the
   [App publisher](operator-tools.md#supported-app-publisher)
   ([full guide](factory-app-publication.md)). Personal terminal signing is
   only for commits you author yourself
   ([terminal guide](macos-terminal-signing-and-publication.md)).
6. **Watch the PR's checks** for its exact head. Fix failures rather than
   waiving them.
7. **After merge**, fast-forward local `main` and delete the merged branch
   ([merge handoff](../CLAUDE.md)).

## Rules a change must meet

- **Guest program changes need the owner.** Changing `src/podman-coding.ts` or
  `src/podman-validation.ts` moves an admitted digest. `tests/zzz-docs-commands.test.mjs`
  then fails until [owner-hosts.md](owner-hosts.md#admitted-guest-programs)
  names the new digest, and CI requires a `## Pin impact` section in the PR body
  that names it. The owner must re-pin the Mac before the next native run, so
  fix every review thread on such a PR before it merges. Ask for the
  [coding container census](worker-qualification.md#coding-container-census)
  before changing a guest to deal with what's in the VM, and check
  [Next coding guest change](owner-hosts.md#next-coding-guest-change) for
  changes waiting to ride along.
- **Owner-facing shell commands use variables.** In `sh`, `bash` or `zsh`
  fences under `README.md` and `docs/`, write each owner-supplied value as a
  checked variable (`"${DELIVERY_ID:?}"`), never as an angle-bracket
  placeholder. The docs test enforces it.
- **Keep messages fixed.** Public errors carry only fixed text, never input
  (`src/errors.ts`). A refusal names its reason.
- **Removals keep what a later step inspects.** Resume, recovery and collection
  still have to work afterwards
  ([coding standards](../CODING_STANDARDS.md)).
- **Bounded retries make progress**, and a digest-moving change is reviewed
  before it merges (also in the coding standards).
- **Docs follow the code.** If you change a command, option or contract, update
  the stage's contract doc in `docs/`, the README table if needed, and the help
  text in `src/cli.ts`. Record native results only from a real run, dated, with
  a receipt under `.scratch/`.

## Common tasks

**Add a CLI option.** Declare it in the option table at the top of
`src/cli-commands.ts`. Add it to each command's `required` or `optional` list
and pass it through in `invoke`. Describe it in the help text in `src/cli.ts`,
then add a test under `tests/` that runs the compiled CLI.

**Add or change a stage's native behavior.** The controlled contract lives in
the stage module (for example `src/main-sync.ts`) and the native adapter in its
`native-*.ts` partner. Test the contract with stand-ins, and add or extend the
owner-run acceptance under `scripts/run-native-*.mjs`. The owner runs it on the
Mac and records the result in the contract doc.

**Investigate a failing native run.** Start from the
[operations playbook](playbook.md). It maps symptoms to the runbook section
that resolves them.

## Who to ask

| Need                                                        | Ask                                               |
| ----------------------------------------------------------- | ------------------------------------------------- |
| A native run, a re-pin, an owner record, an approval, a key | The owner. Only the owner runs native commands    |
| Scope, priority or a decision that contradicts an ADR       | The owner, on the GitHub issue                    |
| What a stage guarantees                                     | That stage's contract doc in `docs/`              |
| Whether something is native, controlled or open             | [Implementation status](implementation-status.md) |
