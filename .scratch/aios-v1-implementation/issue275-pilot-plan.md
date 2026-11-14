# #275: what the controller needs for the profile-page pilot

13 November 2026. The pilot repository, `AJHMH/profile-page`, was prepared in
[AJHMH/profile-page#122](https://github.com/AJHMH/profile-page/pull/122):
dependencies pass `npm audit`, Playwright is pinned to 1.64.1, E2E runs against
a disposable PostgreSQL, and the `main` ruleset requires `Lint, Type Check,
Test, Build`, `Semgrep Security Scan` and `e2e`. Its `main` is `a474aa3`.

A probe run on the VM (`~/.developer-os/notes/issue275-validation-probe.sh`)
showed that the whole repository validates offline: install, lint, type
check, tests with coverage, build, and 11 E2E tests against a disposable
PostgreSQL, with a peak of 1.57 GB. Reading the controller against that tree
showed what it must still learn. The owner decided each choice below on 13
November.

## Gaps

| Gap                              | profile-page                                                                              | Controller today                       |
| -------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------- |
| Input tree, both guests          | 211 files, 2.0 MiB, `package-lock.json` 374 KiB                                           | 1000 files, 256 KiB each, 1 MiB in all |
| Refused paths                    | 27: `.agents/`, `.claude/settings.local.json`, `.env.example`, `.gitattributes`, `.npmrc` | the whole repository is refused        |
| Credential gate on file contents | 14 false positives, such as `const apiKey = env.RESEND_API_KEY`                           | refuses the file                       |
| npm cache                        | 658 tarballs, 253 MiB for Linux arm64                                                     | every platform's tarballs, 128 MiB     |
| Installed layer                  | 950 MiB                                                                                   | 1 GiB                                  |
| Prisma                           | `postinstall` and `db push` need a 26 MiB schema engine per OpenSSL flavour               | no network, so the install fails       |
| Writes into `node_modules`       | Prisma's client and Vite's `.vite-temp`                                                   | the layer is read-only                 |
| Build and test output            | `.svelte-kit`, `coverage`, `.vercel`, `test-results`                                      | any write changes the tree             |
| Check memory                     | lint peaks at 1.13 GB                                                                     | 1 GiB, browser 2 GiB                   |
| Node                             | `.npmrc` enforces 22                                                                      | the admitted image is Node 24          |

## Slices

Each is its own PR. The guest changes move the coding and validation policy
pins, so native runs are refused between them, until the owner re-approves
both records at the end.

1. **Repository file rules.**
   - The owner policy may list `excludedPaths`: paths that never reach coding
     or validation. A candidate that adds, changes or deletes one is refused.
     Publication carries each one from the base commit by its blob, so the
     published tree keeps them unchanged.
   - Repository file contents are refused only for high-confidence
     credentials: private-key blocks, GitHub tokens, `sk-` keys and JWTs.
     Logs, reports and owner inputs keep the full redaction.
2. **Larger trees, both guests.** At most 1000 files, 1 MiB each, 4 MiB in
   all, in both directions. The response stays under the 8 MiB management
   output bound.
3. **npm cache for the guest's platform.** The host plan keeps only tarballs
   whose `os`, `cpu` and `libc` match the guest (Linux, arm64, glibc). The
   limits become 512 MiB of tarballs and a 2 GiB layer.
4. **Writable `node_modules` and declared outputs.** Each check gets its own
   copy of the installed layer (a reflink copy where the filesystem allows),
   discarded after it. The layer itself stays measured and unchanged. The
   contract may declare `outputPaths`, which a check may write and which the
   tree measurement skips. They may not cover any input file. Check memory
   becomes 2 GiB, and browser 3 GiB.
5. **Owner-pinned tool files.** The contract may declare `toolFiles`: an
   https URL on an allowed host, its SHA-256 after optional gunzip, and a
   path under `$HOME`. The host fetches and verifies each, the guest receives
   them like the npm cache, and copies them into each install and check
   container's writable home. This supplies Prisma's schema engines.
6. **Owner records and requalification.** A Node 22 image
   (`node:22-bookworm-slim`), new coding and validation records, a validation
   acceptance on profile-page's own tree, and the full run order of
   [macOS controller qualification](../../docs/macos-controller-qualification.md#running-it).
7. **The pilot.** Owner records for profile-page, a pilot runner that requires
   the `complete` admission level, the agreed feature, and the report.
