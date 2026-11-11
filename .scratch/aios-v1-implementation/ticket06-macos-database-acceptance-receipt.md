# #265: native disposable-database acceptance on macOS

11 November 2026. macOS 27.3.0 arm64, VM `aios-macos-noshare`. No inference,
no credentials, no usage spent. Run by the owner from a clean, freshly built
`main` at `0e4d6f7` (`buildFresh: true`, `sourceDirty: false`).

This proves #280's disposable databases natively. Each local E2E check gets a
fresh PostgreSQL from the owner-admitted image, which is ready before the
check starts. The check reaches it only on the loopback the two share, and
the database is removed when the check ends.

## Image and pins

The owner pulled `docker.io/library/postgres:17-alpine` into the VM: digest
`docker.io/library/postgres@sha256:1108a8fe22dff4eab48870e081be046d549ddc1b6f5972e0a766eaf1e0b1003c`,
image ID `e29b5f75230807dfc40a4c8ff9e486b87a30df01cfcab04a4e99d5077d77ddfb`,
`arm64`, PostgreSQL 17.11.

The owner re-approved `validation-admission.json` (kept from before as
`validation-admission.before-database.json`) at:

- `imageSha256` `9419aebdf4ccbf7bd0096475d0db76ca83f0db496a23592a2bfc3b769894473c` (node, unchanged);
- `policySha256` `ea88e99a7753b5274c17692710d68dca54b81509f2e579d6037eca2aa1d98671`;
- `bindingSha256` `a317bde54628f626ed2cf45a4f4352a93765d9c8505485deb3e5c75678cd2158`
  (new: the binding now names the database image);
- `databaseImageSha256` `e29b5f75230807dfc40a4c8ff9e486b87a30df01cfcab04a4e99d5077d77ddfb`.

## Two failed runs and their fixes

1. **Report `issue04-database-acceptance-20261111-094502.json`.** The E2E
   checks got no result. The image declares `VOLUME /var/lib/postgresql/data`,
   so Podman attached an anonymous volume to the database container. The
   guest refuses any mount it didn't ask for, so it refused the container.
   Owner diagnostics with throwaway containers confirmed the volume. They
   also showed that PostgreSQL runs as user 65534 on a read-only root and is
   ready within a second, and that a `keep-id` check joining its network
   namespace reaches it. Fixed in #281: every validation container is created
   with `--image-volume=ignore`. The owner then removed the diagnostic
   containers, their volume and the volume the failed run left behind.
2. **Report `issue04-database-acceptance-20261111-105004.json`.** The database
   started and `database-offline` passed. The two querying checks failed
   because they asked for a database named `aios`, but `initdb` creates only
   `postgres`, `template0` and `template1`. Fixed in #282: checks use the
   `postgres` database, and the test stand-in now refuses databases `initdb`
   doesn't create.

## Passing run

`--with-npm-dependencies --with-database e29b5f75…`:
`observed-offline-validation-admission-acceptance`. Report
`~/.developer-os/issue04-database-acceptance-20261111-112127.json`, SHA-256
`3e81fb4a9d18c3beac4e0c6ff9d1e5902b8b212a636c8d06318b8d0f5a14b871`.

All nine stages passed:

- `controller-baseline-validation` (27 s): the five probes.
- `controller-dependency-validation` (51 s): seven checks, including
  `dependencies` and `install-scripts`, as in the
  [install-script receipt](ticket04-macos-install-scripts-acceptance-receipt.md).
- `controller-database-validation` (50 s): all eight checks succeeded.
  - The five probes ran without a database.
  - `database` created a table over the PostgreSQL wire protocol, from `node`.
  - `database-fresh` found a fresh database without that table.
  - `database-offline` still could not reach the outside network.
- `controller-recorded-database-checks`: exactly the three E2E checks carry
  the `postgres-image` artifact naming `e29b5f75…`.

## Worker qualification

Rerun for the new validation guest: `observed-offline-worker-qualification`,
all 11 stages. Report
`~/.developer-os/issue04-worker-qualification-20261111-112708.json`, SHA-256
`919ba45b30816766844ecb947b8f6c73ebeb619eddb39cd675d0f5b5cc937194`, at
`0e4d6f7`. Its validation pins are the four above, `databaseImageSha256`
included. Its coding pins are unchanged: Claude Code `2.1.311`, policy
`c5a7a034…`, binding `8e2cfe1c…`.

## Not covered

- Disposable browsers (story 19's other half): the Playwright image is still
  to do under #265.
- An owner repository's own E2E suite against the database; this run used
  synthetic checks.
- The CLI path with a contract declaring `database: true`, natively. It is
  covered by tests against the same runtime.

Production remains disabled. There is no production admission record yet.
