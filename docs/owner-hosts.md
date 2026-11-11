# Owner hosts

Native runs are the owner's, on the owner host: the owner's Mac
([ADR 0007](adr/0007-macos-only-owner-host.md)). Commands written for the owner
use these values; each is private to the Mac and outside every repository
unless noted.

| Fact                        | macOS (Terminal, zsh)                                        |
| --------------------------- | ------------------------------------------------------------ |
| Checkout                    | `~/Repos/developer-os` (keeps `main` checked out)            |
| VM                          | `aios-macos-noshare`                                         |
| Coding admission record     | `$HOME/.developer-os/admission/claude-coding-admission.json` |
| Validation admission record | `$HOME/.developer-os/admission/validation-admission.json`    |
| Acceptance state            | `$HOME/.developer-os/ticket4-macos/state`                    |
| Auth directory              | `$HOME/.developer-os-auth` (outside the delivery state)      |

## Anthropic API key

Metered model access (ADR 0006) reads the owner's Anthropic API key from the
macOS Keychain, never from a file or the environment. Prepare the host
registration first (`prepare-auth`), then paste the key at the hidden prompt:

```bash
node dist/cli.js store-anthropic-key --auth-directory "${AUTH_DIR:?}"
```

One free request (listing a single model) verifies the key and names its
organization before anything is stored. Only the account record
`anthropic-account.json` (organization, key fingerprint, host) is written to
the auth directory. Add `--replace` to store a new key. Replacing a key leaves
the old one in the Keychain, unused. Revoke it in the Anthropic Console.

## Spend budget

Each delivery's metered model access is bounded by its spend budget (ADR 0008):
$10 unless `start` names `--budget-dollars` (whole cents up to $1000). Before
each model request the gateway reserves that request's worst case at the
pinned model's prices (`claude-opus-5-5`: $4 input, $20 output, $5 or $8
cache writes, $0.20 cache reads per million tokens). A request that doesn't
fit is a budget interruption, and the work is kept. Add to the budget to
continue:

```bash
node dist/cli.js extend-budget --id "${DELIVERY_ID:?}" --dollars 5
```

`status` shows the ledger under `spend` (amounts in picodollars).

## Admitted guest programs

Each owner admission record pins its guest program's digest as
`policySha256`. These are the digests the records on the Mac admit. The coding
guest is Claude Code's (`claude-coding-admission.json`, ADR 0008):

| Guest      | `policySha256`                                                     |
| ---------- | ------------------------------------------------------------------ |
| Coding     | `c5a7a034ecb603461c99846f68a5b0d5d7c3c75c5b8389a5ac617ba5280b4d8d` |
| Validation | `8f1db1c860bf505fd6320542e2b8b7da1c4592b511ec9ce1f2a7d01403fa7b03` |

`tests/zzz-docs-commands.test.mjs` fails when a guest program
(`src/podman-coding.ts`, `src/podman-validation.ts`) no longer matches this
table. That change needs the owner to rewrite the matching record on the
Mac before the next native run. Say so in the PR's "Pin impact", and update
this table once the owner has re-pinned.

Before changing a guest program to deal with what is in a VM, ask the owner for
the [coding container census](worker-qualification.md#coding-container-census),
so the change is sized against the real counts.

## Next coding guest change

Each coding guest change costs a re-pin on the Mac, so changes that can wait
are listed here and land with the next one that has to happen anyway. The
list is empty: the last held changes landed with the final Codex removal
(#222). That change:

- records each session's `operationId`, `fence` and `intent` in the clear, and
  the abandoned-session sweep names every kept lineage by them;
- bounds a sweep batch by time (20 s of removals) as well as by count (8);
- sets `CLAUDE_CODE_MAX_OUTPUT_TOKENS=32000` (`claudeCodeMaxOutputTokens`), so
  a request reserves about $0.64 of the spend budget instead of $2.56;
- drops the guest program's Codex text and the `codex/` branch prefix.
