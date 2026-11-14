# #275 slice 6: re-pin and complete requalification on macOS

14 November 2026, on the owner's Mac, VM `aios-macos-noshare`, from clean
`main` at `8e8df19` (#329). Slices 1 to 5 of the
[pilot plan](issue275-pilot-plan.md) moved both guest programs, so both owner
records were re-pinned and the whole controller requalified, in the order of
[macOS controller qualification](../../docs/macos-controller-qualification.md#running-it).

## The validation image

The worker qualification runs the boundary probe as validation checks, and the
probe needs busybox (`wget`, `chroot`, `unshare`). profile-page needs Node 22
on glibc. The owner chose an owner-built image over changing the probe or
admitting two images: `node:22-bookworm-slim` at
`sha256:e9f565d3…` plus Debian's `busybox-static` `1:1.35.0-4+deb12u1+b1`,
built in the VM as `localhost/aios-node22-validation:1`
([Containerfile](../../docs/isolated-validation.md#the-validation-image-275)).

| Pin                        | Before                       | After                                                              |
| -------------------------- | ---------------------------- | ------------------------------------------------------------------ |
| Validation `imageSha256`   | `9419aebd…` (Node 24 Alpine) | `6d7bed6a62d9768114cce3ecaff0ac534acbda40cf7368c3f9df74cb367fb143` |
| Validation `policySha256`  | `53c75c74…`                  | `c83e42e56cfeeff1b6ea569f3c7a2120aa8a9558d20062d5281acafc1851cab9` |
| Validation `bindingSha256` | `5dfb7fc3…`                  | `ab7eba7144742ed99662e26c0b7a2ecb7e7fef2bf8845f35f4e68011a85df85b` |
| Coding `policySha256`      | `c8efc6b2…`                  | `73947e4756f6a57bd2f3e6566bcb5b375a5005ae89d1d2bc5cc06547d4271c3f` |

Unchanged: Claude Code 2.1.311 (`cliSha256` `172150e3…`), coding
`bindingSha256` `8e2cfe1c…`, the database image `e29b5f75…` and the browser
image `2dee255e…`. Both records were backed up before the rewrite.

## Runs

| Step                                                                                                                           | Report                                                | Outcome                                            | SHA-256                                                            |
| ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------ |
| Worker qualification                                                                                                           | `issue04-worker-qualification-20261114-090334.json`   | `observed-offline-worker-qualification`            | `4a04ba83aad543b2907b9e730120d9ca45bc8dc77dd6d4913bd9a0ca3b51a66e` |
| Production record, worker level                                                                                                |                                                       | `check-production` `level` `worker`                |                                                                    |
| Session acceptance                                                                                                             | `issue04-session-acceptance-20261114-090818.json`     | `observed-offline-session-acceptance`              | `e5cdbd1a724f0836c04feb17f51303499bfa08387c75c79d83adeb584fe04de1` |
| Validation acceptance, dependencies, PostgreSQL and browser                                                                    | `issue16-validation-20261114-092601.json`             | `observed-offline-validation-admission-acceptance` | `0ba4bd51b60cb7403e8910889994342df4d468a44e10641271c26fd138abb6e9` |
| Lifecycle controls                                                                                                             | `issue16-lifecycle-20261114-093005.json`              | `observed-native-lifecycle-controls`               | `61ef5a838315c188fdcc8a66f58c53bf44b95695c6dcb6f6ff451c38a64f8dfd` |
| Delivery through cleanup, [AJHMH/aios-publication-acceptance#19](https://github.com/AJHMH/aios-publication-acceptance/pull/19) | `issue14-cleanup-delivery-20261114-093454.json`       | `observed-native-delivery-through-cleanup`         | `b25be1b98797ae04164e003797ce30c07b748ef067948ae72ad5ec1e087dd378` |
| Combination                                                                                                                    | `issue16-complete-qualification-20261114-094348.json` | `observed-native-complete-qualification`           | `acdcae3ba0e60c9de653a85a4defeabbb8b4720ea5930ffa679ba76f5cdc08f2` |

All ten boundaries passed, none rejected or missing. The production record now
names the combined report; `check-production` prints `level` `complete`,
validation binding `b52beebb…` and `productionSha256` `b98d4808…`.

This was the first native run of slices 4 and 5: the validation acceptance
installed packages on the Node 22 image and ran its checks, the browser check
included, on per-check copies of the installed layer under the new memory
limits.

## Not covered

- Validation on profile-page's own tree, with its outputs and Prisma tool
  files, is the pilot's first validation (slice 7).
