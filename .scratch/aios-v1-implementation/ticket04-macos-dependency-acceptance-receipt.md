# Issue 04: native npm dependency acceptance on macOS

30 October 2026. macOS 27.2.0 arm64, VM `aios-macos-noshare`. No inference,
no credentials, no usage spent. From clean, freshly built `main` at `3f2f5d6`
(`buildFresh: true`, `sourceDirty: false`), run from a separate clean worktree
because the owner's main checkout holds uncommitted work.

## Image and re-approval

The owner pulled the official Node.js image into the VM,
`docker.io/library/node:24-alpine3.24`, and pinned it by its multi-arch index
digest `docker.io/library/node@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85`
(an OCI image index with `linux/amd64` and `linux/arm64`). On this Mac its image
ID is `9419aebdf4ccbf7bd0096475d0db76ca83f0db496a23592a2bfc3b769894473c`. Two
throwaway offline containers confirmed node v24.22.2, npm 11.19.1, `/bin/sh`,
`wget` and `id`, UID 65534 as the check user, and no engine socket.

A first run without the flag stopped before any check and printed the fresh
pins (report `issue04-validation-acceptance-20261030-185828.json`). The image
and binding pins changed; the policy pin did not:
- `imageSha256`: `171e6526…` (Alpine) → `9419aebd…`;
- `bindingSha256`: `ac8967ce…` → `81addbc0c5f6441a63f604947eb867dbfadc0dcceb2c7f28b5a523e378e0fda4`;
- `policySha256`: `585cd02c…`, unchanged.

The owner re-approved the validation record (`approvedAt`
`2026-10-31T00:01:18.000Z`). The Alpine image is no longer admitted for
validation on this Mac.

## Run

`--with-npm-dependencies`: `observed-offline-validation-admission-acceptance`.
Report `~/.developer-os/issue04-dependency-acceptance-20261030-190229.json`,
SHA-256 `cf1d7ed5c78a605e98506b71c585255c781a69d9cd1e5f7d30cf905983184be4`.

- The baseline's five isolation probes passed on the node image.
- `controller-dependency-validation` (52 s): the host planned the lockfile,
  fetched `is-number@7.0.0` from `registry.npmjs.org` and verified its sha512;
  the guest took the cache, installed it offline in its own container, and ran
  the five probes and `node -e 'require("is-number")'` on the read-only layer.
  All six passed.
- `controller-recorded-installed-dependencies`: every result names plan
  `b9db00c318def346254d83131dd7554efad48eae64a5be2318995a93a6723c3b` and layer
  `bf837d06d752257a0bb2935676934365d37992f77c6411d5b680b4cbd54e8868`; tree
  `d2ce5bbbd020283af025ece1d4472c2a56a8c213df4574d63c619ea2b286b471`,
  environment `1670f21fb192e58bbbeb386535eecb6a92016d022847aec6a3a8aa6aab238134`.

This is the first native run of the D2b offline install. The package has no
install scripts, so script isolation was not exercised natively.

## Not covered

- Windows: the same image by the same digest, a new validation record and
  this run.
- A package with install scripts, natively.

Production remains disabled.
