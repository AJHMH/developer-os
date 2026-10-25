# Issue 04 slice 3, step 1: the gateway admits Codex 0.161.0's real shape

Base: `main` at `62a63db`. 25 October 2026. No inference, no credentials.

## What changed

`GeneralSessionGateway` (`src/general-session-gateway.ts`) now admits the
request shape captured offline in `ticket04-request-shape-capture-receipt.md`:

- **The `additional_tools` input item.** It may carry only `type`, `id`,
  `role` and `tools`.
- **`reasoning.context`.** The only admitted value is `"all_turns"`.
- **`namespace` tool groups.** They are admitted one level deep, in
  `additional_tools` and in top-level `tools`. A group may hold only function
  and custom tools, and may carry only `type`, `name`, `description` and
  `tools`.
- **What is still refused:** hosted tools, nested groups and any extra
  field.
- **Tool definitions follow the tool rule.** They are no longer scanned as
  conversation content, so a worker tool may name a parameter such as
  `file_id`.

Two changes affect what is forwarded:

- **`client_metadata` is stripped (owner decision).** It is admitted only as
  an object and never reaches the provider. It carries Codex's installation,
  window, session, thread and turn identifiers.
- **The forwarded body is the inspected body, re-serialized.** The provider
  can no longer read a duplicate key that the gateway resolved differently.
  `requestBytes` now counts the forwarded bytes.

ADR 0002 and the slice 3 plan record both decisions and the rules.

## Evidence

- **Gateway tests: 77, all passing.** They include two trimmed fixtures from
  the real code-mode captures (`tests/fixtures/codex-0.161.0-*-request.json`).
  In the fixtures all free text is `"synthetic"` and every identifier is a
  placeholder.
- **Mutants: 10 tried, 10 killed.** The mutants:
  - forward the raw bytes;
  - keep `client_metadata`;
  - accept any `reasoning.context`;
  - skip the tools check in `additional_tools`;
  - accept a non-object `client_metadata`;
  - accept any namespace keys;
  - accept `local_shell` inside a namespace;
  - accept nested namespaces;
  - accept any item keys;
  - scan tool definitions as content.
- **Independent review: one medium finding, fixed before publication.**
  Namespace groups and the item could carry extra fields such as
  `server_url` to the provider.
- **Factory coverage gate:** passed (`f78ebdb`, base `62a63db`).

  | Measure | Head | Baseline | Changed code |
  |---|---|---|---|
  | Lines | 21721/22269 | 21681/22229 | 62/62 |
  | Branches | 5934/6382 | 5907/6355 | 44/44 |

  | Stage | Time |
  |---|---|
  | `unit-tests` | 206 s |
  | `head-instrumentation` | 216 s |
  | `base-instrumentation` | 211 s |

  The limit for each stage is 240 s.

## Local validation environment (Mac)

On this Mac, the gate needed three environment settings. CI needs none of
them.

- **Put `/Library/Developer/CommandLineTools/usr/bin` first on `PATH`.**
  - `/usr/bin/git` and `/usr/bin/python3` are `xcrun` shims. They cost about
    5 ms per call even with a current `xcrun_db` cache, and with either
    developer directory selected.
  - The suite makes thousands of Git calls. With the shims,
    `tests/review.test.mjs` took 23 s instead of 10 s, and the whole suite
    took 376 s instead of 227 s.
  - The test stages hit the 240 s limit on both head and `main`.
- **`AIOS_TEST_PYTHON=python3`.** The Mac has no `python`. Without it,
  `tests/codex-endpoint.test.mjs` fails with `ENOENT` and Node's test runner
  crashes and hangs.
- **`GIT_CONFIG_GLOBAL=/dev/null`.** Fixture commits otherwise inherit the
  owner's SSH commit signing and stop at the passphrase prompt.

```bash
PATH=/Library/Developer/CommandLineTools/usr/bin:$PATH AIOS_TEST_PYTHON=python3 GIT_CONFIG_GLOBAL=/dev/null node scripts/factory-validation.mjs measure-coverage --trusted-repo . --trusted-revision f78ebdbcfcde6138ec8f63c11c2e6a984a72dce9 --contract ~/Repos/developer-os/factory-contract.yaml --base-revision 62a63db67dbeb5503d38ba5cda2f42ee331eb8e0 --output ~/Repos/developer-os/tmp/gates/coverage-evidence.json
```

Headroom is thin even with these settings: each stage took 206–216 s of 240 s.
Under that load, tests with a 5-second Python spawn limit occasionally failed,
and each passes alone. Reusing controller test setups is the next lever, as
the faster-suite receipt says, and it needs owner approval first.

## Open

- **Slice 3, step 2:** the `codeModeHostSha256` pin.
- **Windows:** the `linux-x64` host digest has to be fetched on Windows.
- **Slice 5:** whether the provider needs `x-openai-internal-codex-responses-lite`.
