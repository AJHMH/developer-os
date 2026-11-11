# #265: native browser acceptance on macOS

11 November 2026. macOS 27.3.0 arm64, VM `aios-macos-noshare`. No inference,
no credentials, no usage spent. Run by the owner from a clean, freshly built
`main` at `8e78ff5` (#285) (`buildFresh: true`, `sourceDirty: false`).

This proves #284's browser checks natively. Each local E2E check of a
contract that declares `browser: true` runs in the owner-admitted Playwright
image. It gets more room for Chromium, and the container acts as Chromium's
sandbox. Every other check stays on the node image.

## Image and pins

The owner pulled `mcr.microsoft.com/playwright:v1.64.1-noble` into the VM:
digest
`mcr.microsoft.com/playwright@sha256:2f05f8a734509a7b3f26a912639488ee08f58a7b292d14d62271bcff9038768f`,
image ID `2dee255e66f9985e1623c12a6f77535bb7487e7bd00a0b0ad82f98688ae60f4d`,
`linux/arm64`. v1.64.1 is the newest tag the Playwright Docker docs name.

The owner re-approved `validation-admission.json` twice. The record before
each change is kept as `validation-admission.before-browser.json` and
`validation-admission.before-labels.json`. The final pins are:

- `imageSha256` `9419aebdf4ccbf7bd0096475d0db76ca83f0db496a23592a2bfc3b769894473c` (node, unchanged);
- `policySha256` `53c75c74b0372b6d297969f441a1070865b54a096c6e72e98d806d1f5d3e8fa7`;
- `bindingSha256` `5dfb7fc33335965dc1245097923a9f03e25cdc7be0e39a0a6005beaba70ab4cd`
  (new: the binding now names the browser image);
- `databaseImageSha256` `e29b5f75230807dfc40a4c8ff9e486b87a30df01cfcab04a4e99d5077d77ddfb` (unchanged);
- `browserImageSha256` `2dee255e66f9985e1623c12a6f77535bb7487e7bd00a0b0ad82f98688ae60f4d`.

## One failed run and its fix

**Report `issue04-browser-acceptance-20261111-135408.json`.** Every stage
passed up to the browser attempt, which ended uncertain after its five probes.
Owner diagnostics showed:

- The first browser container was created exactly as the guest asks: the
  image, user 65534, 1024 processes, 2 GiB of memory, a 256 MiB `/dev/shm`
  (which Podman reports in bytes, as the guest expects), the environment and
  the mounts.
- It was never started, and no deadline timer was made for it.
- Its create took 3.7 s, well within the guest's 15 s command limit.

Podman's journal showed the cause. The container carried a third label,
`org.opencontainers.image.version=24.04`, which it inherits from the
Playwright image's Ubuntu base. The guest trusted only containers whose labels
were exactly its two `aios.validation.*` labels. So it refused the container
straight after creating it, and again when the stop tried to remove it.

Fixed in #285. A container's labels must be exactly its image's own labels plus
ours, with ours replacing any label of the same name. The image doesn't have
to be admitted by the current record, so an attempt from an earlier record can
still be cleaned up. The owner then removed the refused container.

## Passing run

`--with-npm-dependencies --with-database e29b5f75… --with-browser 2dee255e… 1.64.1`:
`observed-offline-validation-admission-acceptance`. Report
`~/.developer-os/issue04-browser-acceptance-20261111-152224.json`, SHA-256
`6819b5bfbe3936ba18bf771f8563558dd89078ece8bde264ac7e7e901429c5e4`.

All eleven stages passed. The baseline, dependency and database stages
repeated the earlier receipts. Their dependency plan, layer and tree digests
are the same as in the
[install-script receipt](ticket04-macos-install-scripts-acceptance-receipt.md).
For the browser:

- `controller-browser-validation`: the host pinned `playwright-core@1.64.1`
  by its registry integrity, and the guest installed it offline. All nine
  checks succeeded:
  - the five probes, on the node image;
  - `browser`: Chromium, run as user 65534 under the validation seccomp
    profile with its own sandbox off, rendered a page;
  - `browser-offline`: Chromium could not reach the outside network;
  - `dependencies` and `install-scripts`.
- `controller-recorded-browser-checks`: the attempt stopped and passed, and
  exactly the two E2E checks carry the `browser-image` artifact naming
  `2dee255e…`.

The browser attempt's tree is
`f930a47cb9328bf4267c44127a0300dfa6bea371b0034b516c683705fc41cbf3`, and its
environment is
`ba64afb3831c4575b140f251850c5f8b7a3bc57a8ad9fb7c1a5c316125315fef`.

## Worker qualification

Rerun for the new validation guest: `observed-offline-worker-qualification`,
all 11 stages. Report
`~/.developer-os/issue04-worker-qualification-20261111-152729.json`, SHA-256
`ed79fdc56ee5c38d8134add36dd12853d747a09b3892389ff1a84cc10f086ad5`, at
`8e78ff5`. Its validation pins are the five above. Its coding pins are
unchanged: Claude Code `2.1.311`, policy `c5a7a034…`, binding `8e2cfe1c…`.

## Not covered

- A browser check that also gets a database, natively. Tests cover it against
  the same guest.
- An owner repository's own Playwright suite. This run used synthetic checks.
- The CLI path with a contract declaring `browser: true`, natively. Tests
  cover it against the same runtime.

Production remains disabled. There is no production admission record yet.
