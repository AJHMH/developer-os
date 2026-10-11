# Ticket 21 diagnosis: evidence gap

Diagnosis skill Phase 1 is incomplete for the actual live discrepancy. No production code or consistency policy was changed. No network, Keychain, VM operation or subscription inference was used in this diagnosis.

## Existing evidence

See `../ticket21-gateway-inference-observation.json` and `../ticket21-gateway-review.md` for the consumed live run and safe flags. The live completed-message content was not retained. The receipt cannot be replayed as a provider response.

## Offline loop

After `npm run build`, run from the repository root:

```sh
node .scratch/aios-v1-implementation/debug/completed-message-loop.mjs matching
node .scratch/aios-v1-implementation/debug/completed-message-loop.mjs omitted
node .scratch/aios-v1-implementation/debug/completed-message-loop.mjs whitespace
node .scratch/aios-v1-implementation/debug/completed-message-loop.mjs different
```

The injected provider is purely local and uses synthetic credentials. The loop calls the real gateway's public respond interface. Matching output passes (exit 0); the other three variants intentionally fail the harness acceptance assertion (exit 1) because the real gateway correctly withholds them. Omitted was run twice with identical results. Each invocation takes under a second.

All three refused variants produce the same relevant flags as the live receipt: completed=true, failed=false, deltaMatches=true, completedOutputPresent=true, completedOutputAllowed=true, completedTextMatches=false. Counts differ because these are minimal two-event synthetic witnesses, not the original 14-event stream.

These failures are NOT confirmed reproductions of the live bug or regression tests demonstrating a defect. They show that the retained projection is insufficient to identify the discrepancy. Making these deliberately invalid responses pass would weaken the required check. No such fix is proposed.

## Required next evidence

A redacted replayable artifact from the actual response or separately authorized targeted live instrumentation is needed. Proposed instrumentation records only event order/types, item/content indexes and counts, text field types/lengths, and fixed comparison booleans for deltas/done/completed text. It must not retain raw text, reasoning metadata, claims, credentials, IDs or arbitrary provider errors. Every captured field should be allowlisted and bounded.

Instrumenting local code does not itself authorize a new provider request. A live capture requires a fresh concrete reviewed plan and exact owner run approval including unknown remaining subscription usage. All existing approvals are consumed. Preserve failure receipts, exact completion consistency, revocation, one-shot use and disabled production delivery.

Do not proceed to ranked causal hypotheses or a production fix until the actual discrepancy can be distinguished. A synthetic fixture compatible with the flags is not proof of the live cause.

## Authorized instrumentation preparation

The owner authorized temporary targeted diagnostics preparation, explicitly excluding live inference. The gateway now records at most 32 allowlisted event-type labels (unknown types become `other`), delta/done/completed text lengths, message/part counts and fixed-marker equality flags. A trim-match flag is diagnostic only; it does not change acceptance. The observation defensively copies its event list. No arbitrary response strings or identifiers are recorded.

The offline matching/omitted/whitespace probes were rerun. Matching still passes; omitted and whitespace still refuse. Their new lengths/counts distinguish those synthetic inputs. This does not identify the historical live discrepancy. All 123 existing tests, build and formatting pass. No fresh native VM qualification, new live plan or provider request was performed. Previous native evidence binds the previous gateway version and must not be treated as current source qualification.

Parallel code review: Standards zero hard violations and zero unresolved judgments after consolidating completed-message calculations; Spec zero corrective findings. The final calculation cleanup passed build and all nine public admission tests. Source diagnostics are temporary: remove them after the actual discrepancy is identified and a suitable regression is secured. Keep this marked debug harness as evidence of the current information gap until then.
