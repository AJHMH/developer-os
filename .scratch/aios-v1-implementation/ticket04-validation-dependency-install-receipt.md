# Issue 04: offline dependency install in the validation guest (D2b)

Base: `main` at `672fcb2`. 29 October 2026. No inference, credentials or
native run. **Guest change:** the validation policy pin changes, so each
host's owner validation record must be re-approved; a native run also needs
an owner-loaded validation image that contains `npm`.

## Decisions carried out

The owner's 29 October decisions: chunked transfer through management calls;
an installed dependency layer, once per attempt, mounted read-only at
`/workspace/node_modules` in each check, with the tested tree unchanged in
meaning; v1 bounds of 2048 tarballs and 128 MiB. The controller times each
check with its own bound, so the first check's install shares it.

## What changed

- **Guest (`src/podman-validation.ts`):** new actions `deps-status`,
  `cache-put`, `install-start` and `install-poll`; checks gain the read-only
  layer mount; stop ends a running install. Container creation, launch with
  its guest deadline and exit observation are shared by checks and the
  install; `effective` checks the exact set of bind mounts. The VM snapshot
  admits the attempt's own install container. The layer is measured with
  files by digest and links by target, within 300,000 entries and 1 GiB.
- **Transport:** `run()` uploads and installs before the first check of an
  attempt that carries dependencies, refuses malformed caches before any
  effect (each file named by its own sha512, within the bounds), never
  resumes a cut-short upload, and reports a failed install as the check's
  result with the install's exit and timeout. `deadlineGraceMs` (default
  30 s) is the host's wait past a guest deadline.
- **Runtime (`src/native-validation.ts`):** a registry reader option selects
  the prepared npm environment; each attempt's cache is planned and fetched
  once (refused lockfile: failure; fetch failure: cancelled); results must
  carry the install, and carry the plan and layer digests as artifacts.
- `CONTEXT.md` defines "Installed dependency layer";
  `docs/isolated-validation.md` describes the install.

## Review

Two-axis review. Spec found one serious defect: an install that exited 0 but
left a layer that could not be admitted (a special file, a hard link, no
`node_modules`) was correctly marked failed and the check left unrun, but the
runtime mapped exit 0 to `success`, so an unrun check could pass. A failed
install now fails the check whatever npm exited with, and a runtime test
covers the clean-exit case. Also applied: `npm-shrinkwrap.json`, which `npm
ci` prefers to the planned lockfile, is refused; duplicate cache files are
refused on the host before any effect; `deadlineGraceMs` must be a whole
number from 0 to 600,000; the layer is hashed in 1 MiB blocks with a 64 MiB
file bound, and running out of memory counts as a change instead of wedging
the attempt. Standards: the guest's transfer bounds are interpolated from
`dependencyTransfer`, one source; two doc comments my insertions had
detached are back on their declarations; the missing-lockfile case is
explicit; the new glossary term has its `_Avoid_` line. Left as is: disk use
of the install's workspace and npm cache is bounded only by the attempt's
discard at stop, as for checks; the shared helpers are not yet mirrored into
the coding guest program, which has no install.

## Testing

`tests/zz-validation-dependency-install.test.mjs`, 25 tests after review, through the real
guest program in the local Podman simulator (which gained an install
container) and through the runtime over a controlled transport. The name sorts
last, so it joins Windows shard 6 and no other file changes shard.
- Upload in chunks, one install, the read-only mount, reuse by a later check,
  cleanup to the layer and the input, an unchanged tree.
- Install script writes outside `node_modules` never reach a check.
- Failed, special-file, missing-`node_modules` and timed-out installs fail
  the check unrun; stop ends a running install; a lost guest deadline cannot
  keep the host waiting; a cut-short upload is never resumed.
- The guest refuses a missing lockfile, shipped `node_modules`, a shrinkwrap
  and a chunk altered in transit, installing nothing; malformed or duplicate
  caches and an invalid deadline grace are refused before any guest effect.
- The runtime: the declared environment, one fetch per attempt, the install
  bound, the artifacts, failure and timeout mapping (including a failed
  install that exited 0), unrun failure and
  cancellation, authority lost during the fetch, and untrusted results.
- Mutation checks of the guest: removing the sha512 check, the lockfile or
  shipped-`node_modules` refusals, the read-only mount, the layer-change
  refusal, the stop of a running install or the discard after install each
  fails a test. Two defensive guards (the chunk offset and a check started
  without its installed layer) have no forging test.
- The guest code was written before its tests, hence the mutation checks.
- Coverage: `native-validation.ts` 100% of lines and branches;
  `podman-validation.ts` 100% of lines, the new code missing only the
  malformed-observation refusal.
- The existing validation tests pass unchanged (44).
- Full suite before the review fixes: 1,405 tests, 1,401 passed, 0 failed,
  4 skipped. After them, the three validation files (69 tests) pass, with
  each review fix mutation-checked (removing the failed-install mapping, the
  shrinkwrap refusal or the duplicate refusal fails a test).

## Still to do

- Each host: re-approve the owner validation record and load a validation
  image with `npm`; then a native dependency acceptance run.
- The controller does not yet construct the runtime with a reader; that is
  production integration. Production remains disabled.
