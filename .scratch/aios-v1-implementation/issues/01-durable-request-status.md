# 01: Submit a feature request and inspect durable delivery status

**What to build:** A TypeScript foreground CLI accepts a personal repository, written feature request and optional issue reference, assigns a durable delivery identity, and exposes status and evidence across process restarts. Unimplemented phases stop explicitly instead of dispatching effects.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

## Source and governing contract

Read the [approved canonical specification](../../aios-feature-delivery/spec.md) before implementation. User-story coverage: 1, 2, 33, 49, 50. Use the domain glossary and approved public-controller command/observation testing boundary; assert visible behavior and permitted/forbidden effects rather than implementation internals.

This is an implementation slice, separate from resolved wayfinder decisions. Unimplemented or unqualified phases remain blocked. Controlled adapters and temporary repositories demonstrate behavior before real host/repository qualification; they do not establish live readiness. Preserve existing user material, authority boundaries and credentials. Do not enable live pilot delivery before all qualification prerequisites pass.

## Acceptance criteria

- [ ] Start and status operate through the public controller boundary and return an explicit delivery ID, phase, repository/request linkage and actionable blocker when progression is not enabled.
- [ ] Real SQLite state and separate artifact references survive closing and reopening the controller; initialization and migrations preserve existing records.
- [ ] Malformed input fails clearly without creating a partial runnable delivery or modifying the target repository.
- [ ] Status and artifacts redact synthetic credential canaries while retaining useful outcome provenance.
- [ ] The implementation provides reproducible TypeScript runtime/build/test commands, preserves existing user documents, and does not assume an initial Git commit already exists.
- [ ] Behavior tests drive the CLI/controller, reopen the real ledger and verify no worker launch or remote write is dispatched by this incomplete slice.

