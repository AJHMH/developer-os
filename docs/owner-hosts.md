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
| Coding     | `0ca38542675e08a9723a0aecc3a9a9f7d4bd949d45645bbb9830aa6f1181dd6b` |
| Validation | `585cd02cc6a9eff07e8e4f1f16d96719b3f24f40f0f7f57b349a7c0d1927448f` |

`tests/zzz-docs-commands.test.mjs` fails when a guest program
(`src/podman-coding.ts`, `src/podman-validation.ts`) no longer matches this
table. That change needs the owner to rewrite the matching record on the
Mac before the next native run. Say so in the PR's "Pin impact", and update
this table once the owner has re-pinned.

Before changing a guest program to deal with what is in a VM, ask the owner for
the [coding container census](worker-qualification.md#coding-container-census),
so the change is sized against the real counts.

## Next coding guest change

Each coding guest change costs a re-pin on the Mac, so these wait for one
that has to happen anyway, and land with it:

- Add `operationId` and `fence` to the session record. Records hold only a hash
  of the identity, so lineage cleanup can't be pointed at a session from the
  guest's own records.
- Bound the `cleanup-abandoned` batch by time as well as by count. A batch of
  slow failures can pass the host's 45-second limit, and a re-run starts in the
  same order.
- Lower Claude Code's output limit in the guest environment (for example
  `CLAUDE_CODE_MAX_OUTPUT_TOKENS=32000`). Each request asks for 128,000 output
  tokens, so its worst case reserves $2.56 of the spend budget before it is
  sent, and a delivery's first request needs at least about $2.66 of budget.
- Drop the Codex text the guest program still carries (its comments, the
  `codex/` branch prefix for old deliveries, and the Codex entries in the
  boundary probe).
