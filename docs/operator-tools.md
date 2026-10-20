# Trusted operator tools

These manually invoked host tools support investigation accounting and verified
GitHub App publication. They are separate from the production delivery controller,
whose native publication and qualification gates remain unchanged. Use reviewed
tooling on a trusted host. Neither tool grants workers credentials or authority.

## Investigation ledger

Use one private external state directory per investigation. On POSIX it must be
owned by the operator and mode 0700; records are ordinary single-link mode-0600
files. State inside the source repository is refused. Native Windows state access refuses before creating files until ACL-backed
protection is implemented; use a qualified POSIX trusted host.

```sh
node scripts/investigation-ledger.mjs init --repo "$PWD" --state-dir "$LEDGER_DIR" --scope windows-git-timeout --minutes 60 --cycles 3
node scripts/investigation-ledger.mjs begin --repo "$PWD" --state-dir "$LEDGER_DIR" --scope windows-git-timeout --operation attempt-1 --repair true
node scripts/investigation-ledger.mjs checkpoint --repo "$PWD" --state-dir "$LEDGER_DIR" --operation attempt-1 --active-ms 60000
node scripts/investigation-ledger.mjs end --repo "$PWD" --state-dir "$LEDGER_DIR" --operation attempt-1 --active-ms 30000
node scripts/investigation-ledger.mjs status --repo "$PWD" --state-dir "$LEDGER_DIR"
```

Charges are incremental **operator-reported active milliseconds**, not elapsed
wall-clock time or independently measured model reasoning. End active work before
CI/review waits; status reads add no time. Include diagnosis, editing and local
revalidation in reported charges. A checkpoint that exhausts the allowance is
persisted, and subsequent work is refused. Beginning a repair consumes a cycle;
extensions never reset consumed amounts. The ledger is an accounting guardrail,
not an independent financial cap, process supervisor or authenticated owner gate.

An interrupted active operation blocks another begin. Reconcile its actual charge
explicitly with `recover --operation ID --active-ms N --approval REFERENCE`.
Extensions use `extend --minutes N --cycles N --approval REFERENCE`; additional
scope uses `scope --scope NAME --approval REFERENCE`. These references record an
already-authorized operator decision. They do not prove human authorization or
satisfy GitHub review. Workers must not control this state or invoke these tools.

Use `plan --scope NAME --question TEXT --reproduction TEXT --evidence REFERENCE`
to retain the current unresolved question and exact red-capable command. Plans
require an already-authorized scope, retain earlier plans, and never execute the
stored command or authorize a scope change. Use placeholders for credentials.

Record separate failures with `failure --failure-repository OWNER/REPO --revision
SHA --check NAME --symptom DESCRIPTION --evidence REFERENCE`. Fingerprints bind
repository/check/symptom, while each observation retains its exact revision and
evidence. A failure record does not authorize a scope pivot or erase earlier ones.
Keep sensitive text out of descriptions and references. The hash chain detects
accidental edits; an operator able to rewrite the entire state can rewrite history.

Concurrent mutation is refused. A crash may leave `.operator-lock`; verify that
the recorded operation/process has stopped and reconcile uncertain effects before
manually removing that lock. Automatic stale-lock stealing is intentionally absent.

## Supported App publisher

This route uses GitHub's platform signing: the configured App bot authors the
commit and PR; GitHub/web-flow is the verified committer. It does not claim a bot
committer or replace the product's separate local-signing/App-port contract.
POSIX host adoption is supported; native Windows publication refuses before key
loading. The pilot defaults to the existing Software Factory App and installation.
Explicit `--bot`, `--app-id` and `--installation-id` may select another authorized
installation, but every observed identity must match the prepared proposal.

Preparation uses read-only `gh api` observations and loads no App key. Start on an
explicit `codex/` branch whose HEAD matches its remote head (or current base for a
new branch), with only intended changes staged and no unstaged tracked changes.
Untracked owner reports remain untouched. The repository's origin must match the
explicit GitHub repository. Unsafe local/worktree includes, URL rewrites, HTTP credentials
and filters are refused. Git hooks, global/system config, external diff and
fsmonitor are disabled for the tool's fixed Git operations.

```sh
node scripts/publish-operator-proposal.mjs prepare --repo "$PWD" --state-dir "$PUBLISH_DIR" --repository OWNER/REPO --branch codex/my-change --base main --title "Describe the change" --body-file "$PR_BODY_FILE" --draft true
# Inspect the returned private proposal: exact bytes, tree, parent, base and digest.
node scripts/publish-operator-proposal.mjs publish --repo "$PWD" --state-dir "$PUBLISH_DIR" --digest "$PROPOSAL_DIGEST" --approve-digest "$PROPOSAL_DIGEST" --private-key-path "$APP_KEY_PATH"
```

Use the approved digest only for an owner-authorized proposal. It is a local
operator assertion, not a GitHub human review. App keys must be external ordinary
private RSA files; they never enter proposal state or Git. Tokens are scoped to
one repository with contents/PR write, plus workflow write only when required.
They are revoked in cleanup; a failed revocation is an incomplete operation, and
the GitHub token still expires according to its issued lifetime. Credentials are
never printed or stored in the temporary credential-free askpass helper. Network
Git fetch runs in a private disposable bare repository, without source Git config;
only verified objects enter the source through credential-free pack import.

The prepared proposal supports at most 100 changed ordinary non-executable files,
2 MiB per file and 8 MiB total. Linked files, executable-mode changes, credential-like
content and sensitive credential paths are refused. Broader proposals require a
separately reviewed extension. Proposal and receipt files can contain source bytes;
keep their state directory private and outside all untrusted checkouts.

The publisher rechecks local inputs and remote base before effects, uses GitHub's
expected-head compare-and-swap for commits, verifies exact tree/parent/bot/signature
and re-observes PR identity/head before adopting the local branch. Each write has
durable intent. Replay adopts a matching accepted commit or PR rather than creating
duplicates; an uncertain write without observed acceptance blocks. Resolve that
uncertainty explicitly rather than deleting receipts or selecting another digest
to evade it. Base drift requires a newly reviewed proposal, not a forced update.

Existing matching bot PRs are observed without changing their description or state.
A closed PR is not reopened, and ambiguous branch history requires a new branch.
After publication attach the PR to the chat and monitor its exact-head checks.
Current-head human approval, main verification and production qualification remain
independent. Neither tool approves, merges, reruns checks or supplies flake waivers.

## Usage-account endorsement

A protected mediation decision record must name the usage reader's account for
the same subscription (`usageAccountId`). Usage observations and the vault
credential identify accounts differently, so the owner endorses the link:

```sh
# Preview: prints the observed usage account hash and writes nothing.
node scripts/endorse-subscription-usage.mjs --state-dir <controller-state> \
  --delivery <delivery-id> --codex-executable <pinned-codex-executable>
# Write: requires the previewed hash.
node scripts/endorse-subscription-usage.mjs --state-dir <controller-state> \
  --delivery <delivery-id> --codex-executable <pinned-codex-executable> \
  --expect <usage-account-hash> --confirm true
```

The usage observation comes from your own Codex login, read through the pinned
executable. The command refuses:

- an observation that is missing, stale or unmeasured;
- an unexpected account;
- a record that isn't this delivery's decision or isn't private;
- a record already endorsed for another account.

On macOS and Linux it writes the endorsed record to a private temporary file in
the state directory and renames it over the original, so an interrupted write
leaves the original record and a re-run is safe. On Windows a new file would
take the shell's default owner (Administrators when elevated), so it rewrites
the record in place to keep its owner and access rules. An interrupted Windows
write leaves an unparsable record, which fails closed. Re-run `qualify`
afterwards.
