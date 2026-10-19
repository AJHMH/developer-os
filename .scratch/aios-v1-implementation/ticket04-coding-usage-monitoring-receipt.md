# Issue 04: usage monitoring during coding turns

Status: implemented on `codex/issue04-coding-usage-monitoring` and reviewed on
both axes. Hosted checks and native qualification remain open. Production
remains disabled.

## Behavior

The [authority receipt](ticket04-coding-model-authority-receipt.md) bound each
coding turn to fresh usage at launch, but nothing watched usage while the turn
ran. Now `DeliveryController.codeFeature` re-observes subscription usage
throughout the turn:

- **Polling.** The interval is `codingUsagePollMs`, which defaults to 30
  seconds and must be a whole number from 1 to 60,000 ms. Only one poll runs at
  a time.
- **What counts as a lapse.** Exhaustion, an account change, or a lost or
  unusable observation means the gate no longer permits the bound operation
  for the pinned account.
- **What a lapse does.** It interrupts the turn, which then goes through the
  normal exact-session stop.
  - The lapse is recorded in `feature.usageInterruptions` (operation ID and
    time), like other owner-evidence records.
  - A thread that started stays resumable.
  - Continuing needs fresh, newly bound authority: a new check, the same
    account, and an approval when the allowance is low.
- **Control changes.** A concurrent control change such as a pause also
  interrupts the turn, but it isn't recorded as a usage lapse.
- **Final check before collection.** Usage is checked once more before output
  is collected. A turn that completed while its authority lapsed is stopped
  and recorded, and it isn't admitted, because exhaustion is never overridden.
  Its work is still preserved through the resumable thread and retained home.
- **After the turn ends.** A poll that finishes after the turn ended changes
  nothing.

## Known limitations

- **One stray write.** A poll already in flight when the turn ends can still
  write one fresh observation into `delivery.usage`. It can't interrupt
  anything, and the next turn takes its own fresh check anyway.
- **Workers are unchanged.** Worker runs keep their own 30-second
  `monitorUsage`, which pauses the worker.
- **Not yet covered:** binding to the qualified mediation account, and
  restart and re-dispatch authorization for production adapters.

## Evidence

All tests go through the public `DeliveryController` methods
(`codeFeature`, `approveUsage`, `status`, and the constructor options) with
the controlled runtime and the subscription fixture. Lapse tests hold a turn
open until its worker is stopped.

TDD notes:
- Every behavior test failed first. Before the monitor existed, the held-open
  turns timed out.
- **Spec review finding:** a turn that completed in the same tick its
  authority lapsed could still be admitted. The deterministic
  completed-after-exhaustion test failed first. A final usage check and a gate
  before collection now prevent it.
- **Further review fixes:**
  - guards for an ended monitor and for overlapping polls;
  - the option renamed to `codingUsagePollMs`, with its boundary values tested;
  - the healthy-turn test now counts only polls made while the turn ran;
  - the worker monitor reverted to its fixed interval, keeping this change in
    scope.

Mutation checks: each guard was removed in turn, the code was rebuilt, and the
focused tests were rerun.
- **Pinned:** the interrupt, the interruption record, the account check, the
  option bounds, the final usage check, the collection gate, and the
  one-poll-at-a-time guard (a slow-observation test).
- **Only matters in a timing race, so documented rather than tested:** the
  ended-monitor flag.
- **Coverage:** a first local comparison showed branch coverage dipping from
  92.209% to 92.190%. I removed a redundant operation check on the record and
  a clock fallback no test reached, and added the slow-observation test.
