# Issue 04 slice 5: the owner-run credentialed qualification, built

Base: `main` at `e0239ee`. 29 October 2026. Built and simulated; no
credential read, no provider request, no guest change. The live runs on
both hosts are owner-run and still to do.

## Decision

The owner chose on 29 October to drive the turns on the native transport
directly, as the routed acceptance does, rather than through the controller.
Nothing can yet write a real mediation decision for a new delivery except
the old fixed-request inference, which would be a third provider request per
host against decision B's two. The controller's decision handling is covered
offline by the usage canary.

## What changed

- **`scripts/run-native-credentialed-qualification.mjs`:**
  `credentialedQualification({ transport, admission, account, accountId,
  hostId, observeUsage, provider })` and its owner-run `main`, following the
  plan's slice 5 table:
  - Usage first: a fresh, measured, healthy observation before the approval
    is spent, so refused usage leaves it unspent. Low, unknown and exhausted
    usage refuse; low usage is not approved mid-run, since no one approves
    inside an unattended run (decision C, met strictly as H does).
  - Before any turn: fresh pins named by the coding record and an eligible
    vault account.
  - Launch with the real provider; the boundary probe runs in the live
    session while the first model request waits. The grant ends with the
    turn and refuses use after it; exact stop; workspace collected.
  - Resume of the thread with a fresh relay capability; its first request is
    live, and a synthetic exhaustion stand-in at the gate ends it at the
    next; exact stop; workspace collected as preserved evidence.
  - The access token is searched for in every byte the sessions sent to the
    host and every collected file, and redacted from any error. Every
    boundary probe (credential, endpoint and npm-registry checks among them)
    must have run and passed.
  - Restarting the lapsed thread under the spent approval is refused before
    any effect, though usage is healthy.
  - The pinned model (decision D) is reported; each turn allows at most 8
    model requests.
  - Usage before and after, request counts, refusals and provider statuses
    are reported; never the token, windows or email.
  - Every model request takes a fresh usage observation and reads the vault
    account again (decision E's freshness); a lapse or a different usage
    account ends the turn at once.
- **One-shot owner approval:** `prepare` writes a private plan naming a run
  ID, the machine, the account, the coding pins and exactly 2 turns, expiring
  after an hour. The run takes `--approve-run <run-id> --approve-turns 2`,
  checks the plan and spends it with an exclusive `consumed` marker before
  any credential is read.
- **The host registration** is read in the runner as
  `inspectSubscriptionAuth` reads it (private storage, valid record), from
  the exported checks; `src/` is unchanged.
- **Docs:** `docs/worker-qualification.md` gains "Credentialed
  qualification" with the prepare and run commands.

## Review

PR 137's Factory coverage gate failed: rewiring `inspectSubscriptionAuth`'s
private `registration()` to call the new export left 2 of 4 changed lines
uncovered, since that path only runs on macOS arm64 and Windows x64. The
runner now reads the registration itself and `src/` is unchanged.

Two-axis review. Applied: every boundary probe must be present, not only
none failed; usage is observed before the approval is spent; the restart
check resumes the lapsed thread rather than starting a third turn; errors
are redacted of the token; the model is reported. Left as is: low usage is
refused rather than approved mid-run (above); the resume doubles as the
exhaustion stand-in, since decision B allows only two turns; the runners
still repeat their stage and report scaffolding, as before.

## Testing

- `tests/zz-usage-simulated-credentialed.test.mjs` (sorts last; joins
  Windows shard 2, no other file changes shard) drives the runner through
  the real gateway against a simulated VM and model:
  - the full run passes with exactly two turns and three provider requests,
    only the host's token reaching the provider;
  - low, unknown and exhausted usage refuse before any turn;
  - an ineligible account and a record naming other pins refuse before any
    turn;
  - another usage account mid-launch ends it before the provider;
  - a provider refusal blocks with its status;
  - a resume answering in one request cannot show the stand-in;
  - a credential in the workspace blocks; a failed or missing probe fails;
    an error echoing the credential is redacted; a survivor leaves the run
    `uncertain`;
  - the approval names its plan's run and exactly two turns, expires, is
    refused when edited and is spent once.
- The runner was written before its test. To compensate, each control was
  removed in turn (credential search, stand-in, turn count, account drift,
  usage-before, turn count in the approval, single spend, redaction, probe
  presence) and the tests went red for every one.
- `tests/fresh-build.test.mjs`: the runner refuses a stale build before any
  effect. `tests/auth-setup.test.mjs`: the runner's registration read, against a
  real `prepare-auth` registration.

## Still to do

The owner's live runs on macOS and Windows. Production remains disabled.
