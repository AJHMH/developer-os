# Owner hosts

Native runs are the owner's. Commands written for the owner use these values;
each is private to its host and outside every repository unless noted.

| Fact                          | macOS (Terminal, zsh)                                     | Windows (PowerShell, not elevated)                                                                                                               |
| ----------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Checkout                      | `~/Repos/developer-os` (keeps `main` checked out)         | `D:/repos/developer-os`                                                                                                                          |
| VM                            | `aios-macos-noshare`                                      | `aios-podman-noshare`                                                                                                                            |
| Coding admission record       | `$HOME/.developer-os/admission/coding-admission.json`     | `C:/Users/mraar/.developer-os/admission/coding-admission.json`                                                                                   |
| Validation admission record   | `$HOME/.developer-os/admission/validation-admission.json` | `C:/Users/mraar/.developer-os/admission/validation-admission.json`                                                                               |
| Pinned native `codex` 0.161.0 | `$HOME/.developer-os/ticket4-macos/runtime/codex-0.161.0` | `D:/repos/developer-os/.scratch/codex-runtime/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe` (ignored by Git) |
| Acceptance state              | `$HOME/.developer-os/ticket4-macos/state`                 | `C:/Users/mraar/.developer-os/ticket19-native/state`; the CLI delivery acceptance uses `C:/Users/mraar/.developer-os/cli-delivery/state`         |

The pinned `codex` hashes are `nativeCodexSha256` in `src/host-target.ts`. A
usage read through any other `codex`, such as the Codex app's, is refused.

## Admitted guest programs

Each owner admission record pins its guest program's digest as
`policySha256`. These are the digests the records on both hosts admit:

| Guest      | `policySha256`                                                     |
| ---------- | ------------------------------------------------------------------ |
| Coding     | `5345ab2b34f662e221f58c033afaafb569155989c8c9d830ec2936d89fc4a038` |
| Validation | `585cd02cc6a9eff07e8e4f1f16d96719b3f24f40f0f7f57b349a7c0d1927448f` |

`tests/zzz-docs-commands.test.mjs` fails when a guest program
(`src/podman-coding.ts`, `src/podman-validation.ts`) no longer matches this
table. That change needs the owner to rewrite the matching record on both
hosts before the next native run. Say so in the PR's "Pin impact", and update
this table once the owner has re-pinned.
