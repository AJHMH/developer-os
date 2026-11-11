# Issue 04 / #265: native install-script acceptance on macOS

11 November 2026. macOS 27.3.0 arm64, VM `aios-macos-noshare`. No inference,
no credentials, no usage spent. Run by the owner from a clean, freshly built
`main` at `be4bdca` (#278) (`buildFresh: true`, `sourceDirty: false`).

This repeats the 30 October dependency acceptance
([receipt](ticket04-macos-dependency-acceptance-receipt.md)) with the
synthetic project's own `postinstall` script. That run left one gap: the
package had no install scripts, so script isolation wasn't exercised natively.

## Pins

The same owner validation record as 30 October, with no re-approval:

- image `docker.io/library/node@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85`,
  image ID `9419aebdf4ccbf7bd0096475d0db76ca83f0db496a23592a2bfc3b769894473c`;
- `policySha256` `585cd02cc6a9eff07e8e4f1f16d96719b3f24f40f0f7f57b349a7c0d1927448f`;
- `bindingSha256` `f52ba76f39e8ffbd18922011c8fd8280b0419f5edea77ef68dd530edf70bfb94`.

## Run

`--with-npm-dependencies`: `observed-offline-validation-admission-acceptance`.
Report `~/.developer-os/issue04-dependency-acceptance-20261111-082735.json`,
SHA-256 `a17c05d9900ca8dc0b314490e4a23496913d38d7e763dbb3ae22f50f45615ba1`.

All seven stages passed:

- `controller-baseline-validation` (28 s): the five checks passed on the node
  image.
- `controller-dependency-validation` (49 s): the host planned the lockfile,
  fetched `is-number@7.0.0` and verified its sha512. The guest installed it
  offline in its own container and ran the project's `postinstall`. All seven
  checks passed on the installed layer: format, lint, type, coverage, build,
  `dependencies` and `install-scripts`.
- `controller-recorded-installed-dependencies`: plan
  `b9db00c318def346254d83131dd7554efad48eae64a5be2318995a93a6723c3b` (the
  same as 30 October), layer
  `6267dae0165eb92db91acd5736a1c05d41a570713a6770edecfe257824a0e33f`, tree
  `62189d715280763d770960bd8deab6d613c718d5040cd89dcdeea9bf6046bc7a`,
  environment `1670f21fb192e58bbbeb386535eecb6a92016d022847aec6a3a8aa6aab238134`.

The `install-scripts` pass means the `postinstall` script ran inside the
install container, found no network, a read-only `/etc`, no Podman or Docker
socket and user 65534, and its marker file in `node_modules` reached the
checks. So the guest accepts a project's own install script, and the install
runs as the unprivileged user.

## Not covered

- Packages whose own dependencies have install scripts. The isolation is the
  same container, but no such package was installed natively.
- The CLI path (`validate-baseline` and `validate-candidate` with a contract
  declaring `prepared-npm`) natively. It is covered by tests against the same
  runtime.

Production remains disabled.
