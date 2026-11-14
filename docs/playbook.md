# Operations playbook

What to do when a native run, a delivery or the test suite stops. Each entry
gives the symptom, what to check, what to do and the runbook that owns the
detail. Native commands are the owner's, on the Mac, in `~/Repos/developer-os`
([owner hosts](owner-hosts.md)). This playbook links to the runbooks rather
than repeating them. If the two disagree, the runbook wins.

The commands below use these variables. Set them first:

```sh
STATE_DIR="$HOME/.developer-os"
DELIVERY_ID="the id start printed"
```

`STATE_DIR` is the delivery's `--state-dir`; the default is `~/.developer-os`.

## Before any native run

Run through this list first. Most failed runs come from one of these:

1. **Podman Desktop is closed.** While it's open it lists every container, and
   the VM can't keep up, so runs stop at varying stages
   ([why](macos-worker-qualification.md#close-podman-desktop-before-native-runs)).
2. **The VM is running:**

   ```sh
   podman machine list
   ```

   If `aios-macos-noshare` isn't running, start it:

   ```sh
   podman machine start aios-macos-noshare
   ```

3. **The checkout is current and built:**

   ```sh
   git switch main && git pull --ff-only && npm ci --ignore-scripts && npm run build
   ```

4. **The signing key is loaded**, if the run publishes. `ssh-add -l` must list
   it. If it doesn't, load it with
   `ssh-add --apple-use-keychain ~/.ssh/id_ed25519`
   ([signing key not loaded](signed-publication.md#signing-key-not-loaded)).
5. **No other run is using the VM.** The shared runner
   `scripts/run-native-acceptance.mjs` keeps owner runs from overlapping.

## Admission and pins

### A run stops with `"outcome": "blocked"` and prints `freshPins`

**Cause:** an owner admission record no longer matches what the run observed.
Either a merged PR moved a guest digest (its "Pin impact" says so), or the VM's
binding moved because Podman was upgraded, macOS updated, the hostname changed
or the VM was recreated. A plain VM restart doesn't move it.

**Check** whether anything was installed:

```sh
pkgutil --pkg-info com.redhat.podman
hostname
uname -r
```

**Do:** re-pin by following
[Re-pinning after a guest change](worker-qualification.md#re-pinning-after-a-guest-change)
step by step. Compare the printed `policySha256` with
[owner-hosts.md](owner-hosts.md#admitted-guest-programs) before writing it into
a record. **Reference:** [what moves the admission bindings](macos-worker-qualification.md#what-moves-the-admission-bindings).

### Publication or merge refuses on the production admission record

**Cause:** the record was rewritten or removed, or the qualification report it
names changed. Publication also refuses a delivery whose coding or validation
ran under pins other than the ones the record admits.

**Check:**

```sh
node dist/cli.js check-production --production-admission "$HOME/.developer-os/admission/production-admission.json"
```

It prints the admitted pins and the `level` (`worker` or `complete`).

**Do:** if the pins moved, re-qualify and write a new record
([admitting production](worker-qualification.md#admitting-production)). A
delivery coded under the old pins can't be published: start a new one.

## Deliveries

### Coding stops with a budget interruption

**Cause:** the next model request's worst case doesn't fit the delivery's spend
budget. The work is kept as `interrupted-turn` evidence, and coding and repair
refuse until the budget grows.

**Check:** `status` shows the ledger under `spend`:

```sh
node dist/cli.js status --id "${DELIVERY_ID:?}" --state-dir "${STATE_DIR:?}"
```

**Do:** add to the budget, then run `code-feature` again. It resumes the same
conversation:

```sh
node dist/cli.js extend-budget --id "${DELIVERY_ID:?}" --dollars 5 --state-dir "${STATE_DIR:?}"
```

**Reference:** [spend budget](owner-hosts.md#spend-budget).

### A session is uncertain, or the repository stays owned

**Symptom:** `release` or `resume` refuses, a queued delivery never starts, or
`status` shows a session that may still be running. Typically the CLI process
was killed, the Mac slept, or a stop couldn't be confirmed.

**Do:** recover with the same native options, so the controller can stop that
exact session or attempt and observe it stopped:

```sh
node dist/cli.js recover --id "${DELIVERY_ID:?}" --state-dir "${STATE_DIR:?}" --podman-machine aios-macos-noshare --coding-admission "$HOME/.developer-os/admission/claude-coding-admission.json" --validation-admission "$HOME/.developer-os/admission/validation-admission.json"
```

Without those options a running native session stays uncertain. Never remove
its container by hand: resume and recovery inspect it by exact identity.
**Reference:** [controls](../README.md#owner-policy-and-controls),
[coding and candidate evidence](feature-candidate.md#coding-and-candidate-evidence).

### `resume` is refused after a cancel

**Cause:** cancellation is final ("A cancelled delivery cannot be resumed.").
It keeps the work and evidence, and doesn't close the PR, delete branches or
undo effects.

**Do:** `release` the delivery so the repository can be owned again, then
`start` a new one.

### `publish-feature` blocks

| Message                                      | Do                                                                                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| "your signing key isn't loaded in ssh-agent" | Load the key (see [Before any native run](#before-any-native-run)), then publish again                                                                                   |
| "Nothing to publish"                         | The candidate equals main, so the request is already met. Cancel, or start a delivery main doesn't already satisfy ([details](signed-publication.md#nothing-to-publish)) |

### A command was interrupted during an external effect

**Cause:** the controller recorded intent, but didn't observe whether the push,
PR, merge, sync or deletion landed.

**Do:** run the stage's `reconcile-*` command (`reconcile-publication`,
`reconcile-merge`, `reconcile-main-sync`, `reconcile-cleanup`). It only
observes, and it adopts an effect that landed instead of repeating it. Don't
delete receipts or state to get past an uncertain write. **Reference:** each
stage's contract doc, linked from the [README stage table](../README.md#controlled-delivery-stages).

## The VM

### Container listings are slow, or the VM disk is filling

**Cause:** stopped coding sessions accumulate. A passing acceptance removes its
own, but blocked or failed runs and deliveries leave theirs.

**Do:**

1. Count them, read-only, with the
   [coding container census](worker-qualification.md#coding-container-census).
2. Preview the [abandoned-session sweep](worker-qualification.md#abandoned-coding-sessions),
   which removes nothing without `--approve-removal`. Run it only when no
   delivery is mid-turn.
3. Remove what it reports as `abandoned`. Sessions in a retired or superseded
   lineage go through lineage cleanup instead.

### A worker qualification ends `failed` or `uncertain`

- **`failed`:** a probe failed and is listed in `failedProbes`. Keep the report
  and the coding session for diagnosis, and don't admit production from it.
- **`blocked`:** see [admission and pins](#admission-and-pins), or the stage it
  names.
- **`uncertain`:** the coding session couldn't be confirmed stopped. Recover it
  before any other run.

**Reference:** [outcomes](worker-qualification.md#outcomes).

## Development and CI

### The test suite stops with no output

`scripts/run-tests.mjs` kills the suite after five minutes without output,
because the Node test runner can stall with no test running. Rerun the file it
was on by itself (`npm run build && node --test tests/delivery.test.mjs`, with
that file's name) to see whether one test hangs.

### `tests/zzz-docs-commands.test.mjs` fails

- **"the owner hosts table names the current guest program digests":** a change
  moved `src/podman-coding.ts` or `src/podman-validation.ts`. Put the new
  digest in [owner-hosts.md](owner-hosts.md#admitted-guest-programs), and add a
  `## Pin impact` section to the PR naming it. The owner must re-pin before the
  next native run.
- **"owner-facing shell commands name their inputs as variables":** a shell
  fence in `README.md` or `docs/` has an angle-bracket placeholder. Replace it
  with a checked variable such as `"${DELIVERY_ID:?}"`.

### The CI `pin-impact` job fails

The PR moves an admitted guest digest, but its body has no `## Pin impact`
section naming the new digest (`scripts/check-pin-impact.mjs`). Add the
section.

### A macOS CI job times out

macOS runners vary: the suite took 3 to 9.5 minutes there in November 2026, and
the job allows 20. Rerun once. If it repeats, find the slow file locally before
raising the limit.

## Escalation

The owner decides and runs everything native: re-pins, owner records, budget
extensions, production admission and any deletion. Report a blocked delivery
with its `status` output, the report or receipt path, and the stage that
refused. Use the delivery's GitHub issue for anything that needs a decision.
