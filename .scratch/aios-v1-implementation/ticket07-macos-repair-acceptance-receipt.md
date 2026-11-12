# #266: native repair acceptance on macOS

11 November 2026. macOS 27.3.0 arm64, VM `aios-macos-noshare`. Run by the
owner from a clean, freshly built `main` at `984aafd` (#290)
(`buildFresh: true`, `sourceDirty: false`). The run sends paid model requests
through the owner's Anthropic key, bounded by the delivery's $5 spend budget.
It spent $0.089. Production stays disabled.

This proves `repair-feature` natively. A failing candidate is repaired by a
metered Claude Code turn on the owner-admitted runtimes and revalidated. The
cycle, active time and spend are recorded, and once the allowance is spent,
repair is refused until an owner extension.

## Pins

Both owner records were current, and the run checked them against the VM's
fresh pins before any CLI step:

- coding (Claude Code `2.1.311`): CLI `172150e3…`, policy `c5a7a034…`,
  binding `8e2cfe1c…`;
- validation: image `9419aebd…`, policy `53c75c74…`, binding `5dfb7fc3…`,
  with the admitted database and browser images.

## Runs

The run is `scripts/run-native-cli-delivery-acceptance.mjs --with-repair`
([bounded repair](../../docs/bounded-repair.md#native-repair-acceptance-266)).
Three runs blocked before the fourth passed. Each found a real problem.

1. **`issue07-repair-acceptance-20261111-170740.json`** (`bc3b588`). The coding
   turn failed with nothing charged. Claude Code's transcript in the VM showed
   `authentication_failed`, an empty 403 from the session relay. A free check
   of the stored key returned Anthropic's 401 `invalid x-api-key`: the owner's
   key had expired after one day. The owner stored a new 30-day key with
   `store-anthropic-key --replace`. (#288 had already fixed the run's own pin
   check, which named no database or browser image.)
2. **`issue07-repair-acceptance-20261111-172233.json`** (`bc3b588`). The coding
   turn passed ($0.067), and the candidate failed only the hidden check. The
   repair turn was refused before its session started, with nothing charged.
   The repair's input was named by its candidate artifact's digest, not by its
   files' manifest digest, which is what the native coding transport checks.
   So every native repair would have been refused. Fixed in #289. The guest's
   bare `stopped` record and the controller's thread-less session showed it.
3. **`issue07-repair-acceptance-20261111-175455.json`** (`928ceaf`). The repair
   ran natively: 3 requests charged, 59 s of active time, the cycle spent, and
   revalidation run. But the hidden check needed an arbitrary marker,
   `aios-repaired`. Claude Code found the page already met the criteria and
   declined to put a pipeline marker into visible content, rightly. Fixed in
   #290: the check now needs an E2E test hook.
4. **`issue07-repair-acceptance-20261111-181447.json`** (`984aafd`):
   `observed-metered-cli-repair-acceptance`, SHA-256
   `7e03b0d51da856895f3e2e65d99a78d58dc5d7acca2135267b3047df12797f5f`.

## Passing run

All twelve stages passed:

- `cli-start`: a $5 budget and `--repair-cycles 1`.
- `cli-validate-baseline` (29 s): the five checks passed.
- `cli-code-feature` (31 s): a stopped Claude Code session on the delivery's
  budget admitted a candidate, with 6 requests charged for $0.0646.
- `cli-validate-candidate` (39 s): the candidate failed exactly
  `page-has-data-testid-contact-hint` and passed every other check.
- `cli-repair-feature` (69 s): one cycle, given only
  `Candidate check page-has-data-testid-contact-hint: failure`.
  - The session was a stopped Claude Code session routed by the delivery's
    budget.
  - It recorded 62.6 s of active time, with 0 cycles and 3,537,391 ms
    remaining.
  - It charged 4 more requests, for a total of $0.0889 of $5, with no
    interruption and nothing left reserved.
  - The repaired candidate passed all seven checks on revalidation.
- `cli-repair-exhausted`: a second `repair-feature` was reported as
  `Repair allowance exhausted; record an explicit owner extension.`. No
  attempt was recorded and nothing was spent.
- `cli-extend-repair`: `extend-repair --cycles 1` was recorded, giving an
  allowance of 2 cycles with 1 attempt.
- `host-checkout-unchanged`, then `coding-session-cleanup`, which removed both
  turns' sessions.

## Left in the VM

The blocked runs' sessions stay stopped. A sweep count found nothing
abandoned. Their coding sessions recorded threads, so they're kept as
lineages; the repair session that never started recorded no admission. Both
kinds are harmless, and only per-session lineage cleanup removes the first.

## Not covered

- A repair interrupted mid-turn, natively, and a time-exhausted allowance.
  Tests cover both against the same controller.
- Repairs from review or PR-check findings (tickets 10 and 09).
