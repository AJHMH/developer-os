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

Any image with `/bin/sh` works. The pinned Alpine image already in each VM is
enough, so nothing needs to be loaded. If the record is missing or names other
pins, the run stops before any check and prints the fresh pins.

macOS (Terminal):

```sh
cd ~/Repos/developer-os
npm ci --ignore-scripts && npm run build
IMAGE="$(/opt/podman/bin/podman --connection aios-macos-noshare image inspect --format '{{.Id}}' docker.io/library/alpine@sha256:24bb3511a0db7b5114a4aee033c65a8a4148f39b7b80a398e548546db967a36f)"
echo "$IMAGE"
mkdir -m 700 -p "$HOME/.developer-os/admission"
node scripts/run-native-acceptance.mjs "$HOME/.developer-os/ticket4-macos/state" scripts/run-native-validation-admission-acceptance.mjs -- aios-macos-noshare "$HOME/.developer-os/admission/validation-admission.json" "$IMAGE" "$HOME/.developer-os/issue04-validation-acceptance-$(date +%Y%m%d-%H%M%S).json" --approve-offline-native-run
```

Windows (PowerShell, not elevated), from the checkout. Command Prompt does not
split commands on `;`, so there it never runs the build:

```powershell
npm ci --ignore-scripts; npm run build; $image = podman --connection aios-podman-noshare image inspect --format "{{.Id}}" docker.io/library/alpine@sha256:3e9b4b680bfc9fb5269227cffbd6d42be39fbf7c0b908123913864aa4447e764; $image; node scripts/run-native-acceptance.mjs "C:/Users/mraar/.developer-os/ticket19-native/state" scripts/run-native-validation-admission-acceptance.mjs -- aios-podman-noshare "C:/Users/mraar/.developer-os/admission/validation-admission.json" $image "C:/Users/mraar/.developer-os/issue04-validation-acceptance-$(Get-Date -Format yyyyMMdd-HHmmss).json" --approve-offline-native-run
```

Write `validation-admission.json` yourself from the printed pins, with the same
private permissions as the coding record. It needs no credentials, sends no
inference and never starts the VM.

### Remaining

The following remain open:
- dependency installs through declared registries, and caches;
- disposable browser and database fixtures;
- hosted checks;
- native qualification of this executor on both hosts.

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

Nothing installs or runs yet: transferring the cache into the validation VM
and installing offline, with dependency scripts inside isolation, is the next
slice, and the offline validation environment is unchanged until then.
