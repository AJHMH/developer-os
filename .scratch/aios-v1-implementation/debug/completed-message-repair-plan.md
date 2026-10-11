# Completed-message consistency: proposed repair

## Observed diagnosis

Latest exact approved run and safe receipt: `../ticket21-gateway-inference-observation.json`. Approval consumed; one provider attempt; usage may have been consumed. No retries, refresh or paid fallback. The receipt contains event types and fixed-marker comparison flags only, not provider content.

Deltas and output_text.done match the 34-character expected result. Completed response has zero message items and zero text parts, while its output shape passes the existing reasoning/message allowlist. Thus the observed mismatch is absence of a text echo in the terminal envelope, rather than different completed message text. Whether terminal output is empty or reasoning-only, and whether output_item.done has a matching full message, remain unknown.

Offline red command (after build):

```sh
node .scratch/aios-v1-implementation/debug/completed-message-loop.mjs observed
```

Runs in under a second; exit 1, `Gateway withheld synthetic completed-message discrepancy`. Three synthetic events reproduce the known pattern: matching delta, matching text-done, completed output with no message. These are a structural reconstruction, not retained original bytes. The unchanged matching control passes. No production fix has been applied.

## Remaining hypotheses and predictions

1. Completed envelope omits messages while item-done retains the final assistant message. Prediction: an item-done consistency check succeeds while terminal message count remains zero.
2. Completed output contains only reasoning metadata. Prediction: its reasoning count is positive and message count zero; reasoning metadata must still be discarded.
3. Final item-done is incomplete or inconsistent despite correct text-done. Prediction: strict item/text linkage or final item text validation fails. Such a stream must remain refused.

No inference about omitted content beyond the recorded flags is justified. Existing diagnostics do not distinguish these possibilities fully.

## Proposed contract change, awaiting operator decision

Support terminal metadata without a message echo only when all of these hold:

- Successful response.completed exists; errors, incomplete/interrupted streams, duplicate terminal events and post-terminal content refuse.
- Exactly one assistant message is established by the linked output-item events; IDs and output/content indexes agree throughout. Any tool, refusal or unrecognized output type refuses; reasoning is discarded.
- Accumulated text deltas, output_text.done, content_part.done and completed output_item.done all contain exactly the fixed expected result. Missing, duplicate, mismatched or malformed finalization events refuse.
- If response.completed includes a message, its content must match too; conflicting final output is never ignored.
- Existing host-only credentials, fixed request, one-shot consumption, deadline/size limits, cancellation and canonical VM response remain enforced.

This preserves content consistency through finalization events rather than trusting deltas alone. It changes where final content can be established, so it should be an explicit operator choice. Controlled public-status adapter tests must demonstrate red/green acceptance and refusal cases before live qualification. The latest live receipt does not yet prove every required finalization field is present. A future reviewed exact plan and separate approval would still be necessary for live verification.

Primary sources:

- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference — subscription sample consumes streamed deltas and requires response.completed; no mandatory final envelope text-echo check in the sample.
- https://developers.openai.com/api/reference/resources/responses/streaming-events — text/content/item finalization events and completed-response semantics.
