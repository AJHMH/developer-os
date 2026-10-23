# Ticket 04 receipt: native acceptance refuses a stale build

Date: 23 October 2026. Branch `codex/issue04-fresh-build-check`.

## What was observed

On 23 October the owner started a Windows coding acceptance from Command
Prompt. Command Prompt passed `npm ci --ignore-scripts; npm run build` to
`npm ci` as one command, so `dist/` was never rebuilt. The runner executed the
previous day's build, while its report named a clean current source
(`sourceRevision` `d73b1d8`, `sourceDirty: false`). It produced the old pins.
Those still matched the old Windows record, so it passed. The report is kept
as `windows/ticket04-admission-acceptance-20261023-stale-build.json`.

The evidence misrepresented what ran: nothing tied `dist/` to the source a
report named.

## What changed

The owner chose to close this gap first, ahead of the native qualification
runs that rely on such evidence.

- **New `scripts/fresh-build.mjs`.** It compiles `src/` with the checkout's
  own TypeScript, under the project's own settings, into a private temporary
  folder. Only the output folder moves. It then compares every emitted `.js`
  module byte for byte with `dist/`.
  - **It refuses** when a module is changed or missing, when `dist/` is
    absent, when `src/` does not compile, or when TypeScript cannot run.
  - **It never writes** to the checkout.
  - **Leftover `dist/` files** from deleted sources are ignored. A static
    import of a deleted module fails compilation, and no source loads `dist/`
    by computed path or folder walk.
  - **It returns** `buildFresh`, a `distSha256` over the emitted modules, and
    `freshBuildSha256`, the digest of the check itself. A report therefore
    pins the code that vouched for its build, as ADR 0001 asks.
- **The three native acceptance runners** call it first, right after their
  argument checks. That is before they import anything from `dist/`, read the
  owner record, create the report file or touch the VM. The runners are
  `run-native-coding-acceptance.mjs`,
  `run-native-coding-admission-acceptance.mjs` and
  `run-native-validation-admission-acceptance.mjs`. Their reports carry the
  three new fields.
- **Docs.** `docs/isolated-validation.md` and
  `docs/macos-worker-qualification.md` describe the refusal. The Windows
  command in `docs/isolated-validation.md` now notes that Command Prompt does
  not split commands on `;`.

## Evidence

- `tests/fresh-build.test.mjs` uses a small TypeScript project. It covers:
  - a fresh build, with a stable digest that ignores leftovers;
  - a changed source, a new source, an edited module, a missing module and a
    missing `dist/`;
  - a compile failure;
  - an untouched checkout;
  - each runner, copied beside a stale build, refusing with "run npm run
    build" and leaving no report file.

  Before the change, all three runner tests failed: each runner first imported
  `dist/`.
- An early version turned off source maps for the check. That dropped the
  `sourceMappingURL` line, so every real build was refused. The fresh-build
  test caught this, and the check now keeps the project's settings.
- On this repository, a fresh build passes in about 5 seconds. Appending one
  line to `dist/controller.js` makes it refuse and name that file.
- Mutants killed:
  - a check that never refuses (5 tests fail);
  - a runner that skips the check (its test fails).
- Checks on Node 24.22.1:
  - formatting and typecheck pass;
  - the full suite ran 1,026 tests: 1,022 passed, 4 skipped, 0 failed.
- Coverage: no `src/` file changed, so neither gate moves.
- Review: the Standards and Spec reviews ran in parallel.
  - **Fixed — the hard finding.** The helper's own digest was not pinned. It
    is now reported as `freshBuildSha256`.
  - **Fixed — smaller findings.** A clearer error when TypeScript cannot run;
    `emittedModules` as a name; a table of runner arguments; the repository's
    platform rule for junctions; a distinct test prefix; and doc wording that
    names the three runners.
  - **Left as is.** The check is called from each runner's `sourceEvidence`,
    a short repeated hoist in each self-contained runner.

## Open

- `scripts/run-windows-qualification.mjs` runs `dist/cli.js` from a manifest.
  Whether its evidence names a source revision, and so needs the same check,
  is not yet established.
- A native run on each host should show the new report fields. The next owner
  acceptance on each host will provide that.

Production remains disabled.
