# Review: the native management program crosses stdin as piped `spawnSync` input

Status: ready-for-human

The owner must approve the prepared proposal's digest before it is published.

## Background

PR #131 found that on macOS with Node v24.15.0, `spawnSync(cmd, args, { input })`
with input of about 65,537 to 70,000 bytes sometimes never lets the child see
EOF. A child that reads all of stdin then blocks until the timeout. PR #131 fixed
only the Python harnesses in `tests/podman-platform.test.mjs`. This issue checks
the production native path.

## Production call sites

The only production call that sends a large `input` through `spawnSync` is
`VMManagementChannel.invoke` in `src/vm-management.ts`. It runs
`podman machine ssh <machine> python3` with the generated management program on
stdin. Every `NativePodmanDriver` action goes through it: enroll, observe,
isolate, execute, stop, collect, inspect, model-frame, boundary-probe and
task-execute/collect. Measured program sizes with a minimal payload:

| Action                                     | macOS bytes   | Windows bytes |
| ------------------------------------------ | ------------- | ------------- |
| enroll, observe, execute, collect, …       | 65,799        | 65,791        |
| boundary-probe, task-execute, task-collect | 66,734        | 66,726–66,730 |
| isolate, codex-protocol                    | 66,929–66,937 | 66,921–66,933 |

Real payloads add base64 request data, so production sizes sit in the reported
band. Timeout is `managementMs`: 90 s on macOS and 30 s on Windows. A hang would
end as a timeout and surface as the generic `Native offline operation
unavailable` refusal. It is bounded, but every macOS hang would cost 90 s and a
failed action.

None of the other paths is affected:

- `runManagement` and `openManagementChannel` in `src/native-management.ts`
  (coding and validation) and `openCodex` use async `spawn` with
  `child.stdin.write` or `end`, not `spawnSync` `input`.
- `keychain-store.ts` and `windows-auth-store.ts` send inputs of a few hundred
  bytes.
- `podmanCommand` sends no input.

## Reproduction

All runs were on macOS 27.2 (Darwin 27.2.0), Node v24.15.0, podman 6.1.1 and
OpenSSH 10.5p1, using a standalone script with no test runner.

| Child reading stdin                                           | Size (B) | `input`    | fd stdin |
| ------------------------------------------------------------- | -------- | ---------- | -------- |
| local `python3 -I -c sys.stdin.buffer.read()`                 | 66,929   | 6/300 hung | 0/300    |
| local Python relay (`os.read` 32 KiB chunks → child readall)  | 66,929   | 0/300      | 0/300    |
| local `os.read(0, 16 KiB)` loop                               | 66,929   | 0/300      | –        |
| local `os.read(0, 1 MiB)` loop                                | 66,929   | 0/300      | –        |
| local 50 ms sleep, then `os.read(0, 16 KiB)` loop             | 66,929   | 0/300      | –        |
| real `podman machine ssh aios-macos-noshare python3 …readall` | 66,929   | 0/500      | 0/500    |
| same                                                          | 65,911   | 0/300      | –        |
| same                                                          | 70,000   | 0/300      | –        |

`podman machine ssh` on macOS execs the system `ssh`, which inherits the pipe as
its stdin. So OpenSSH is the actual reader, not guest Python. The hang did
**not** reproduce through the production relay in 1,100 runs. The trigger
depends on how the reader drains the pipe: Python's readall hits it, while plain
chunked reads, `cat` (per PR #131) and OpenSSH did not. The likely mechanism is
on the parent side. Node/libuv stops writing the rest of the input when a
pipe-writable notification is missed for some drain patterns, so it never
closes the pipe. That is a hypothesis; it has not been traced in libuv.

## Decision

A fix is warranted as low-cost hardening, not as a fix for an observed
production failure. Reasons:

- Nothing in this repo controls the read pattern. It belongs to whichever
  podman and ssh build the host has, which changes with owner upgrades. On
  Windows it is Git's `ssh.exe`, and Hyper-V podman is a different binary.
- Delivering the program from a file descriptor removed the hang for every
  reader tested, including the one that does hang. It also takes Node's pipe
  writer out of the path entirely.
- The change is small and keeps every timeout, refusal and diagnostic.

Against it: the request (`R`) briefly exists on disk. It is written privately:
an `mkdtemp` directory (0700) under the OS temp directory, the file created
`wx` with mode 0600, the fd closed and the directory removed in `finally` on
every path. A failure while setting up the temp file surfaces only as the
existing generic refusal, so its path never reaches an error or log.

## Change

`VMManagementChannel.invoke` now gives the program to `spawnSync` as
`stdio: [fd, "pipe", "pipe"]` instead of `input`. Arguments, cwd, env,
`timeout: host.managementMs`, `maxBuffer`, the executable re-hash, the stage
diagnostics on stderr and the refusal text are all unchanged.

## Tests

- `hostFixture` in `tests/podman-platform.test.mjs` now reads the program from
  the stdin fd. It asserts that `input` is unset, that stdin is an fd, and on
  POSIX that the fd's file mode is 0600. This guard is deterministic. Every
  other assertion is unchanged.
- A new test at the end of `tests/podman-platform.test.mjs`: the real `invoke` runs 40 times
  against a local stand-in engine whose child reads all stdin with Python
  readall. The test checks that the over-64 KiB program arrives whole (SHA-256
  and length) and that a failing call still gives the generic refusal. It also
  checks that no temp entry remains. It is skipped on Windows (POSIX stand-in).
  With `input` patched back into `dist`, it failed 4 of 6 runs at 40 iterations
  and 4 of 6 at 100. So it is a probabilistic detector, and the fixture
  assertion is the hard guard.

## Comments

### 2026-10-28 local verification (macOS 27.2, Node v24.15.0)

- `npm run format:check` and `npm run typecheck`: pass.
- `NODE_V8_COVERAGE=<dir> AIOS_TEST_PYTHON=/usr/bin/python3 npm test`: 1,306
  tests, 1,300 pass, 4 skipped and 2 fail. Both failures are the PR #131
  harness hangs (`status null` at the 12 s and 5 s harness timeouts). Those
  harnesses still pipe `input: f.programs[0]`.
- `tests/podman-platform.test.mjs` with `tests/vm-management-stdin.test.mjs`,
  5 repeats: 2 clean, 3 with one or two harness hangs. With the PR #131 patch
  (963cfbb) applied on top: 6 of 6 clean, 35/35 each.
- Plain `npm test` without `AIOS_TEST_PYTHON` stalls indefinitely after test
  126, on this branch and on clean `origin/main` alike.
  `tests/codex-endpoint.test.mjs` spawns `python`, which is not on PATH here;
  null stderr reaches `t.diagnostic`, which throws, and the runner never exits.
  This is pre-existing and separate from this change.
- `npm run acceptance:macos` was not run: it uses the owner's real native
  state.
- Linux c8 coverage (the Factory gate PR #131 is failing) was not run locally.

### 2026-10-28 after rebasing onto main deae2fd (PR #131 merged)

- Format and typecheck pass.
- `NODE_V8_COVERAGE=<dir> AIOS_TEST_PYTHON=/usr/bin/python3 npm test`: 1,306
  tests, 1,302 pass, 0 fail, 4 skipped.
- `tests/podman-platform.test.mjs` with `tests/vm-management-stdin.test.mjs`,
  5 repeats: 5 of 5 clean, 35/35 each.

### 2026-10-29 PR #133 CI: guard test moved into an existing file

The first head, c6bee3d, put the guard in a new
`tests/vm-management-stdin.test.mjs`. Node's `--test-shard` splits the sorted
file list round-robin, so the extra file shifted every later file by one
position. `worker-native-coding` and `zz-usage-coding-session` moved from
Windows shard 7 into shard 8, alongside its existing files. Shard 7 dropped
from 8 to 3 minutes, and shard 8 hit its 10-minute job limit twice in a row.
The test now sits at the end of `tests/podman-platform.test.mjs`, so the test
file list and the shard split are exactly as on main.
