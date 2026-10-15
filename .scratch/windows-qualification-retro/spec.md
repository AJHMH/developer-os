# Windows qualification retrospective improvements

Status: completed — all six approved improvements are implemented, as recorded in [review and validation](review.md) and merged PR #11. Later fresh Windows acceptance is recorded in [ticket 24 completion evidence](../aios-v1-implementation/ticket24-windows-main-repair.md). Production delivery remains disabled.

Implement the six retrospective candidates approved by the owner on 12 October
2026, after ticket 24 commit `1c0f614`.

1. Run the existing credential-free checks on Windows CI alongside Linux/macOS.
2. Emit bounded, redacted native probe timing, exit classification and process
   disappearance diagnostics. Diagnose future refusals without changing gates.
3. Provide one phased Windows operator runner with per-step arguments, pinned
   scripts, fail-fast sequencing, shared state locking and explicit independent
   inference/synthetic approval boundaries. Planning performs no host execution.
4. Provide separate trusted-host auth freshness inspection before requesting
   inference approval; expose eligibility metadata only. No refresh or approval.
5. Document canonical entry points, historical fixture provenance, manifest
   preparation, ordering, binding invalidation and completion assertions.
6. Emit bounded phase progress and use 30–60 second output waits to reduce empty
   polling. Preserve locks on interruption and require operator reconciliation.

The owner approved tests through public CLI/script entry points and exported host
interfaces using synthetic accounts/fake child scripts. Automatic tests and CI
must perform no owner credential access, native VM traffic or real inference.
Keep production disabled, original receipts intact, and one-shot safety gates.
This work changes native bindings; it does not requalify the host or authorize a
new live run. Review and commit the implementation on the current branch.
