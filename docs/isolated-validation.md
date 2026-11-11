# Isolated baseline and candidate validation

Implementation reference: [current scope and qualification gates](implementation-status.md). Controlled delivery contracts below are implemented; native production acceptance remains separate from the fixed-worker evidence.

Ticket 06 adds controlled validation through DeliveryController.validateBaseline,
validateCandidate and stopValidation. Plan criteria first, validate unchanged clean
main, then code and validate the admitted candidate. The CLI exposes
validate-baseline and validate-candidate, but refuses without a trusted integration.
No native executor is installed and production delivery remains disabled.

The external, pinned onboarding policy supplies validationContract version 1:
environment, checks and mutablePaths. Environment declares image and network-policy
SHA-256 measurements, HTTPS registries, cache assumptions, synthetic browser/database
availability. Each check declares its id, kind, local/pr/main scope, stages, argv,
trusted publisher and bounded timeout. Format, lint, type, coverage and build are
required for both local stages; candidate acceptance is required. Feature browser
or database requirements also require declared synthetic infrastructure and E2E.
PR/main declarations are retained; later delivery slices must observe hosted results.

mutablePaths is an exact owner-approved application-file allowlist (maximum 256
paths; no directory globs). Every other file must match validated main, including
presence, content and executable mode. New files outside the list are refused.
The owner must exclude the complete validation implementation, test, configuration,
threshold, dependency and script closure from this list. Changing that closure
requires owner policy review and a new delivery/baseline. This conservative slice
also blocks dependency updates unless the owner explicitly revises the contract.

The trusted ValidationRuntime receives inert file bytes and argv. It must run
dependency lifecycle hooks, checks and disposable fixtures only inside the declared
isolated environment, honor dispatch fences and timeouts, and stop all descendants
before measuring the final tree. No repository scripts execute on the controller
host. Controlled tests exercise this interface; they do not qualify a native runtime.

Attempts persist operation/fence, source revision, exact tree, policy, contract,
criteria, runtime binding and environment hashes plus projected results/artifact
hashes. Missing or untrusted evidence cannot pass. Explicit owner exceptions may
cover incomplete statuses, never failure or timeout. One diagnostic rerun per
unchanged stage/tree is allowed; a later pass remains flaky unless the original
explicit failure has an owner flake policy. All attempts remain in the ledger.

Pause/cancel fence dispatch and reconcile shutdown. Uncertain descendants block
overlap, resume and release until recovery with the same binding. Formatting or
other output changes invalidate the tested tree. Policy, source, environment and
candidate are rechecked after shutdown; stale evidence cannot mark the candidate
passed. A passing local candidate still requires hosted checks and later delivery
gates before signing, publishing or merging.

Native qualification remains required on supported hosts: measured runtime/image,
real dependency and script isolation, bounded process-tree shutdown, registry/cache
enforcement, browser/database disposal, formatting reconciliation, pinned CLI
compatibility, and real pilot baseline/acceptance evidence. No provider requests or
native worker execution are authorized by this controlled test receipt.

[Bounded repair](bounded-repair.md) now handles failed candidate batches. Once
repair begins, local revalidation runs through the repair cycle so it cannot bypass
the persisted allowance. Native and hosted qualification requirements remain open.

## Offline native validation executor (Issue 04)

`PinnedValidationRuntime` satisfies `ValidationRuntime` over the native
validation transport (`NativePodmanValidationTransport`). It offers one
environment only, the offline validation environment:

```json
{
  "imageSha256": "<the owner-loaded image ID>",
  "networkPolicySha256": "3f47dc245fe9636077d62d81fbd415d14acb3e5e33787b1d9cd515ef189585d3",
  "registries": [],
  "caches": [],
  "browser": false,
  "database": false,
  "synthetic": true
}
```

An owner contract must declare exactly that environment, or the controller
refuses validation before any check runs. The network policy digest is fixed:
it measures "no network, no registries, no caches".

How each check runs:

- Each local check runs in a fresh container from the owner-loaded image, by
  ID, with no network, a read-only root, a private `/tmp`, all capabilities
  dropped, no new privileges, the derived seccomp profile, user `65534`, and
  process (256) and memory (1 GiB) limits.
- Each check gets its own fresh copy of the transferred tree, so no check sees
  another's output. That copy is the only mount.
- The argv runs as inert data after `/bin/sh -c 'exec "$@"'`, so the image
  needs `/bin/sh`.
- A guest timer kills the check at its timeout, even if the controller is
  gone. Only that timer's own kill counts as a timeout; any other exit 137 is
  a failure.

How the tree is bound and measured:

- The transferred files must hash to the manifest the host computed from the
  controller's bytes. They are kept as a pristine input that is never mounted
  and never replaced.
- After each check exits, its copy is measured with the same manifest, then
  removed.
- Stop fences the attempt, kills and removes every check container, confirms
  no process remains, and removes the attempt's files. It reports the tested
  tree only if every check left its copy unchanged. Any new, changed, linked,
  re-moded, unreadable or oversized content reports a different tree, so the
  controller marks the attempt incomplete.
- A check cannot make stop fail. Unreadable or deeply nested trees are removed
  inside the user namespace, and a full disk cannot block shutdown.

Limits:

- **Transfer size:** the same as coding. At most 1,000 files, 256 KiB each and
  1 MiB in total; larger trees are refused before any VM effect.
- **One run at a time:** inspection refuses while any other container runs in
  the dedicated VM, so validation never overlaps coding or another attempt.

A live transport runs only under an owner validation admission record, which
is separate from the coding record. The record is a private file you write
yourself, outside any repository, readable only by you, in a folder only you
can change:

```json
{
  "scope": "aios-native-validation-admission-v1",
  "approvedAt": "2026-10-22T18:00:00.000Z",
  "pins": {
    "imageSha256": "<64 hex>",
    "policySha256": "<64 hex>",
    "bindingSha256": "<64 hex>"
  }
}
```

The runtime re-reads the record before each check, at every effect and poll of
a running check, on results, and when it trusts a stop. Removing or editing the
record stops further checks, and a stop is then never trusted. Any pin change
needs a new record: a different image, management program, Podman, VM or host.
As with coding, the VM is named by its `/etc/machine-id`, not its hardware
UUID, which Apple's hypervisor changes on every boot, and the binding leaves
out Podman's record of the last start. A restart keeps the record valid; a
recreated VM needs a new one.
Production delivery stays disabled either way.

### Owner acceptance

The native coding, coding admission and validation admission acceptance
runners first compile `src/` into a private temporary folder. Before
touching the record, the report or the VM, they refuse unless `dist/` is
exactly that build. A report therefore names both the source revision and the
build it ran: `buildFresh`, `distSha256`, and the check's own
`freshBuildSha256`. If a runner refuses, run `npm run build` and try again.

The offline acceptance validates unchanged main of a synthetic repository
through the real transport. Its five baseline checks are shell probes that pass
only when isolation holds:

- the tree is present;
- there is no network;
- the root filesystem is read-only;
- the user is unprivileged;
- no engine socket is visible.

Any image with `/bin/sh` works. The pinned Alpine image already in the VM is
enough, so nothing needs to be loaded. If the record is missing or names other
pins, the run stops before any check and prints the fresh pins.

In Terminal:

```sh
cd ~/Repos/developer-os
npm ci --ignore-scripts && npm run build
IMAGE="$(/opt/podman/bin/podman --connection aios-macos-noshare image inspect --format '{{.Id}}' docker.io/library/alpine@sha256:24bb3511a0db7b5114a4aee033c65a8a4148f39b7b80a398e548546db967a36f)"
echo "$IMAGE"
mkdir -m 700 -p "$HOME/.developer-os/admission"
node scripts/run-native-acceptance.mjs "$HOME/.developer-os/ticket4-macos/state" scripts/run-native-validation-admission-acceptance.mjs -- aios-macos-noshare "$HOME/.developer-os/admission/validation-admission.json" "$IMAGE" "$HOME/.developer-os/issue04-validation-acceptance-$(date +%Y%m%d-%H%M%S).json" --approve-offline-native-run
```

Write `validation-admission.json` yourself from the printed pins, with the same
private permissions as the coding record. It needs no credentials, sends no
inference and never starts the VM.

### Remaining

The following remain open:

- native acceptance of browser checks (#265, below);
- hosted checks;
- native qualification of this executor on the Mac.

Build or coverage output written into the tree currently invalidates the tested
tree by design. Real repositories need an owner contract whose checks leave the
tree unchanged, until a later slice defines declared output paths.

## Prepared dependency cache (Issue 04)

The controlled dependency phase starts on the host. `src/dependency-cache.ts`
reads the candidate's `package-lock.json` (version 2 or 3) as data, never
running anything from it:

- `npmCachePlan(lockfile)` lists every installed package's tarball. Each must
  resolve to an https tarball on `https://registry.npmjs.org` with sha512
  integrity; workspace links, git, file and other-registry sources are
  refused, and bundled packages arrive inside their parent. One tarball under
  two integrities is refused. The plan is sorted, bounded (16 MiB lockfile,
  2048 tarballs) and carries its own digest and the lockfile's.
- `fetchNpmCache(plan, { reader })` fetches exactly those tarballs, each
  within 64 MiB and 60 s and all within 128 MiB, without compression, and
  admits the cache only if every tarball matches its sha512. The reader gets
  the byte bound, and each read is raced against cancellation. A changed or
  unsafe plan is refused before any request; any refusal or cancellation
  admits nothing. Files are content-addressed as `<sha512>.tgz`, one per
  tarball.

`httpsRegistryReader()` is the host's reader: one https GET of a registry
tarball URL (anything else is refused before connecting), asking for identity
encoding, returning a redirect's or compressed response's status for the
fetch to refuse rather than following it, and giving up past the byte bound
(a declared length over it is refused before reading) or on cancellation. It
uses its own agent with certificate checking. Each read's bound is what is
left of the total, at most one tarball's.

### Offline install in the validation guest (D2b)

A `PinnedValidationRuntime` given a registry reader declares the prepared npm
environment instead of the offline one: still no network in any container,
with `https://registry.npmjs.org` named as the registry the host alone
reaches and `prepared-npm` as the cache. For each attempt it plans the cache
from the candidate's `package-lock.json` and fetches it once. A lockfile that
is missing or refused fails the check unrun; a cache that cannot be fetched
leaves it `cancelled`.

The transport then, before the attempt's first check:

- uploads the cache in chunks of at most 4 MiB (`cache-put`), each appended
  at its expected offset, each tarball kept only once its bytes match the
  sha512 it is named by, within 2048 tarballs, 64 MiB each and 128 MiB in
  all; an upload cut short is never resumed;
- installs it (`install-start`, `install-poll`) in its own hardened, offline
  container from the owner image, with a fixed command: `npm cache add` of
  each tarball into a private cache, then `npm ci --offline`. Dependency
  scripts run only there. A guest deadline bounds it at the check's own
  timeout. The attempt's input must carry `package-lock.json` and neither
  `npm-shrinkwrap.json` (which npm would prefer) nor `node_modules`;
- keeps only a clean install's `node_modules` as the installed dependency
  layer, measured with its links (`.bin`), and discards the install's
  workspace, the upload and npm's cache, so anything an install script wrote
  elsewhere never reaches a check.

Each check then sees the layer read-only at `/workspace/node_modules`, beside
its fresh copy of the candidate files; the tested tree is unchanged in
meaning. A failed or timed-out install ends the check unrun as a failure
or timeout, whatever npm exited with. The result carries the plan's and the layer's
digests as artifacts. Stop also ends an install still running.

The guest program changed, so the validation policy pin changed: the owner
validation record must be re-approved, and running it natively needs an
owner-loaded image that contains `npm`.

### Native dependency acceptance

`--with-npm-dependencies` adds two stages to the validation admission
acceptance. After the baseline, the controller validates a second synthetic
repository whose `package-lock.json` pins one small registry package,
`is-number@7.0.0` (no dependencies, no install scripts of its own). The
repository's own `postinstall` script probes the install's isolation (#265):
it writes a marker into `node_modules` only when it finds no network, a
read-only root, no engine socket and the unprivileged user.

- `controller-dependency-validation`: the host plans the lockfile, fetches the
  one tarball from `https://registry.npmjs.org` and verifies its sha512; the
  guest installs it offline, running the `postinstall` script in the install
  container; each probe check, a `dependencies` check running
  `node -e 'require("is-number")'` and an `install-scripts` check requiring the
  marker run on the installed layer.
- `controller-recorded-installed-dependencies`: every check passed, and every
  result names the same plan and layer digests. The report's `dependencies`
  section keeps them, with the tree and environment digests.

The host needs HTTPS access to the registry for the fetch; the VM and the
checks stay offline. The image must contain `node` and `npm`, for example an
official `node` Alpine image pinned by digest. The owner record pins the image,
so a new image needs a new validation record: run the acceptance once without
the flag to print the fresh pins, write the record, then run it with the flag.
The baseline probes also pass on such an image.

Set the owner-chosen image digest, without `sha256:`, as `NODE_DIGEST`. The
admitted image on this Mac is `node:24-alpine3.24` at the digest below.

In Terminal, after loading the owner-chosen image into the VM:

```sh
NODE_DIGEST=8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85
NODE_IMAGE="docker.io/library/node@sha256:${NODE_DIGEST:?}"
IMAGE="$(/opt/podman/bin/podman --connection aios-macos-noshare image inspect --format '{{.Id}}' "${NODE_IMAGE:?}")"
node scripts/run-native-acceptance.mjs "$HOME/.developer-os/ticket4-macos/state" scripts/run-native-validation-admission-acceptance.mjs -- aios-macos-noshare "$HOME/.developer-os/admission/validation-admission.json" "${IMAGE:?}" "$HOME/.developer-os/issue04-dependency-acceptance-$(date +%Y%m%d-%H%M%S).json" --approve-offline-native-run --with-npm-dependencies
```

## Disposable databases for E2E checks (#265)

An owner contract that declares `database: true` in its validation
environment must declare a local E2E check for the candidate, as before. Each
local `e2e` check then gets its own PostgreSQL:

- **The image.** The owner loads an official PostgreSQL Alpine image into the
  VM and admits its image ID in the validation record as
  `databaseImageSha256`, beside the other pins. The guest checks it is loaded
  for the VM's architecture whenever it observes the VM, and the pin is part
  of the validation binding. A record without it admits no database, and a
  runtime asked for one refuses. Records without it keep the binding they had.
- **One per check.** Before the check, the guest starts the database in its
  own container from that image: no network, a read-only root, its data on a
  512 MiB tmpfs, no capabilities, the derived seccomp profile and user
  `65534`. The image declares a data `VOLUME`; every validation container is
  created with `--image-volume=ignore`, so no image's volume is ever mounted
  and the guest still refuses any mount it didn't ask for. It runs a fixed command, `initdb` for a synthetic user `aios` with
  trust authentication, then `postgres` listening only on `127.0.0.1:5432`.
  Its own guest deadline is the check's timeout plus a minute.
- **Ready first.** The guest polls `pg_isready` inside the database for up to
  20 seconds. A database that never answers, or exits, is removed and the
  check never runs; it fails as `unready`.
- **Shared loopback only.** The check container joins the database's network
  namespace and nothing else, so it still has no outside network. It gets
  `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE` and `DATABASE_URL` naming that
  loopback server's `postgres` database, the only one `initdb` creates, and no
  password or production credential. The `aios` user is its superuser, so a
  test may create its own databases.
- **Removed with the check.** When the check ends, its database goes; stop
  ends both. The next check starts from an empty database.

Other checks get no database. Each E2E result carries the database image as a
`postgres-image` artifact. The guest program changed, so the validation policy
pin changed: the owner re-approves the validation record, reruns the worker
qualification and updates the production record to the new pins.

### Native database acceptance

`--with-database <postgres-image-id>` adds two stages to the validation
admission acceptance. The controller validates a third synthetic repository
whose contract declares a database, with three E2E checks besides the probes.
The node image needs no PostgreSQL client: the first two speak the wire
protocol from `node`.

- `controller-database-validation`: `database` creates a table; then
  `database-fresh` finds a fresh database without that table; then
  `database-offline` still can't reach the outside network.
- `controller-recorded-database-checks`: every check passed, and exactly the
  E2E checks carry the admitted database image.

The admitted image on this Mac is `postgres:17-alpine`, digest
`postgres@sha256:1108a8fe22dff4eab48870e081be046d549ddc1b6f5972e0a766eaf1e0b1003c`,
image ID `e29b5f75230807dfc40a4c8ff9e486b87a30df01cfcab04a4e99d5077d77ddfb`
([receipt](../.scratch/aios-v1-implementation/ticket06-macos-database-acceptance-receipt.md)).

In Terminal, load the image into the VM and read its ID:

```sh
/opt/podman/bin/podman --connection aios-macos-noshare pull docker.io/library/postgres:17-alpine
DATABASE_IMAGE="$(/opt/podman/bin/podman --connection aios-macos-noshare image inspect --format '{{.Id}}' docker.io/library/postgres:17-alpine)"
```

Then run the acceptance. The first run stops before any check and prints the
fresh pins, now with `databaseImageSha256`. Write them into
`validation-admission.json` with a new `approvedAt`, then run it again:

```sh
NODE_DIGEST=8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85
NODE_IMAGE="docker.io/library/node@sha256:${NODE_DIGEST:?}"
IMAGE="$(/opt/podman/bin/podman --connection aios-macos-noshare image inspect --format '{{.Id}}' "${NODE_IMAGE:?}")"
node scripts/run-native-acceptance.mjs "$HOME/.developer-os/ticket4-macos/state" scripts/run-native-validation-admission-acceptance.mjs -- aios-macos-noshare "$HOME/.developer-os/admission/validation-admission.json" "${IMAGE:?}" "$HOME/.developer-os/issue04-database-acceptance-$(date +%Y%m%d-%H%M%S).json" --approve-offline-native-run --with-npm-dependencies --with-database "${DATABASE_IMAGE:?}"
```

A pass prints `observed-offline-validation-admission-acceptance`.

## Browser checks for E2E (#265)

An owner contract that declares `browser: true` runs each local `e2e` check in
Microsoft's Playwright image instead of the check image:

- **The image.** The owner loads `mcr.microsoft.com/playwright:v<version>-noble`
  into the VM and admits its image ID in the validation record as
  `browserImageSha256`. It is checked like the database image and is part of
  the validation binding. A record without it admits no browser checks.
- **Room for Chromium.** A browser check gets 1024 processes and threads,
  2 GiB of memory, a 256 MiB `/dev/shm` and a 512 MiB `/tmp`. Every other
  check keeps 256, 1 GiB, the default `/dev/shm` and 256 MiB.
- **The container is the sandbox.** Chromium's own sandbox needs user
  namespaces, which the derived seccomp profile removes, so it runs with its
  sandbox off, as Playwright does by default in containers. The check keeps
  every other control: no network, no capabilities, `no-new-privileges`, the
  same seccomp profile, a read-only root and user `65534`.
- **Browsers from the image.** The check gets
  `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`, where the image keeps them. The
  repository's lockfile must pin `playwright` or `playwright-core` at the
  image's version, installed from the prepared cache like any dependency.

A browser E2E check may also get a disposable database when the contract
declares both. Each browser E2E result carries the image as a `browser-image`
artifact. The guest program changed, so the validation policy pin changed.

### Native browser acceptance

`--with-browser <playwright-image-id> <playwright-version>` adds two stages.
The host reads `playwright-core` at that version from the registry once, to
pin it by its own integrity, then validates a fourth synthetic repository
whose lockfile pins it:

- `controller-browser-validation`: the probes, the `dependencies` and
  `install-scripts` checks, then `browser` (Chromium renders a page) and
  `browser-offline` (Chromium cannot reach the outside network).
- `controller-recorded-browser-checks`: every check passed, and exactly the
  E2E checks ran in the admitted browser image.

The version must be the one the image's tag names, so Playwright finds the
browsers it ships.

A container inherits its image's own labels. Playwright's image carries
`org.opencontainers.image.version` from its Ubuntu base, so the guest trusts a
container whose labels are exactly its admitted image's own plus the two
`aios.validation.*` labels, ours replacing any of the same name. The first
native run on 11 November found this: the guest refused the first browser
container because of that label, and the attempt stopped as uncertain.

