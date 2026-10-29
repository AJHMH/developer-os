# Issue 04: owner cleanup of a superseded lineage

Base: `main` at `5a0301e`. 29 October 2026. No inference, no credentials,
no native run. **Guest change:** the coding policy pin changes, so each
host's owner coding admission record must be re-approved before any native
coding run, including the usage canary and slice 5.

## The gap this closes

Slice 4c records a lineage left behind when coding restarts under another
route as superseded on the feature: never resumed again, its thread and
workspace kept. Its guest state stayed: session folders, stopped containers
and records. The guest's `cleanup-retired` accepts only a lineage the guest
itself retired, so 4c left this cleanup to a later guest slice.

## Behaviour

- **`DeliveryController.cleanupSupersededLineage(id, operationId)`.** The
  owner names a recorded superseded lineage by its head, the session coding
  left. It requires a recorded, not yet cleaned lineage, an owned quiescent
  delivery and the same trusted coding runtime with superseded cleanup. It
  records `cleanedAt` and the session count on the `supersededLineages`
  entry, once. A failed, empty or foreign receipt records nothing and can be
  retried.
- **`PinnedCodingRuntime.cleanupSuperseded`** checks the pins before and
  after and requires the exact operation, fence and a positive whole
  session count. It shares that check with the retired cleanup.
- **Guest `cleanup-superseded`**
  (`NativePodmanCodingTransport.cleanupSupersededLineage`, for a stopped
  start or resume session) shares `cleanup-retired`'s lineage walk and
  checks:
  - The head must have launched and recorded its own thread, be stopped and
    gone, never recovered or retired, and reserved by no successor. A head a
    resume reserved belongs to a live lineage; a retired head has its own
    cleanup; a stranded or unresolved resume has its own recovery.
  - Each recorded predecessor must be stopped, gone and reserved by the
    session after it; every unit must be quiet, every container stopped with
    exactly this authority and session label, and every folder a real
    directory owned by the guest user.
  - Only after every check, the head is marked `reconciled: superseded`, so
    prepare refuses to resume it, then each container and folder is removed
    and each record marked `cleaned`. A repeat is idempotent.
- **The retired cleanup is unchanged** in behaviour. The runtime's receipt
  check (error now "Lineage cleanup binding changed") and the controller's
  receipt verification are shared by both kinds.
- `docs/feature-candidate.md` describes the cleanup beside `supersededLineages`.
- `CONTEXT.md`: "Lineage cleanup" covers superseded lineages.

## Testing

Test-first at the agreed seams:
- `NativePodmanCodingTransport` against the external guest fixture
  (`tests/worker-native-resume.test.mjs`): a superseded single-session
  lineage and a superseded resumed lineage lose their folders and
  containers, keep tombstone records with the head marked superseded, clean
  idempotently and are never resumed. The guest refuses, removing and
  marking nothing, a session a resume reserved, a retired resume, a launched
  resume that never recorded its thread, a stranded resume that never
  launched, and a lineage with an active timer. The transport rejects a malformed or
  non-stopped session before guest effects and treats an unrecognized
  receipt as uncertain. Six tests, red before the change.
- The public `DeliveryController` and `PinnedCodingRuntime`
  (`tests/zz-usage-restart.test.mjs`): the owner cleans a superseded
  lineage once and the new lineage goes on; a foreign, empty or failed
  receipt records nothing and can be retried; an unknown or current
  operation, a runtime without cleanup and a released delivery are refused;
  the pinned adapter trusts only the exact session and pins. Six tests, red
  before the change.
- Mutation checks: the guest's reservation, retirement and marking guards,
  the transport's shape check and the controller's once guard were each
  removed and a test failed. A controller guard against the current session
  was dead (the current session is never superseded) and was removed.

## Review

Two-axis review. Spec: the guest accepted any stopped, unreserved head, so a
stranded resume awaiting recovery or an unresolved launched resume could be
cleaned or marked; the head must now have launched and recorded its thread,
never recovered (two refusal tests, red without the guard). Standards: the
controller's receipt verification is shared by both cleanups, and the doc
gained the cleanup. Left as is: the runtime's `cleanup` keeps its name for
the retired kind, as renaming it is churn; the transport's two cleanup
methods differ by action and intent.

Full suite before the review fixes: 1,336 tests, 1,332 passed, 0 failed, 4
skipped. After them, the three affected files (141 tests) pass, and
typecheck and format pass.

## Native follow-up

After merge, on each host: re-approve the owner coding admission record for
the new policy pin, then rerun the native coding acceptance. Folder removal
and engine `rm` on the real guest remain for native qualification, as for the
retired cleanup.

Production remains disabled.
