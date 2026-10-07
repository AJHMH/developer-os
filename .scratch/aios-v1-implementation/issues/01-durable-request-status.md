# 01: Submit a feature request and inspect durable delivery status

**What to build:** A TypeScript foreground CLI accepts a personal repository, written feature request and optional issue reference, assigns a durable delivery identity, and exposes status and evidence across process restarts. Unimplemented phases stop explicitly instead of dispatching effects.

**Blocked by:** None (can start immediately).

**Status:** completed

## Source and governing contract

Read the [approved canonical specification](../../aios-feature-delivery/spec.md) before implementation. User-story coverage: 1, 2, 33, 49, 50. Use the domain glossary and approved public-controller command/observation testing boundary; assert visible behavior and permitted/forbidden effects rather than implementation internals.

This is an implementation slice, separate from resolved wayfinder decisions. Unimplemented or unqualified phases remain blocked. Controlled adapters and temporary repositories demonstrate behavior before real host/repository qualification; they do not establish live readiness. Preserve existing user material, authority boundaries and credentials. Do not enable live pilot delivery before all qualification prerequisites pass.

## Acceptance criteria

- [x] Start and status operate through the public controller boundary and return an explicit delivery ID, phase, repository/request linkage and actionable blocker when progression is not enabled.
- [x] Real SQLite state and separate artifact references survive closing and reopening the controller; initialization and migrations preserve existing records.
- [x] Malformed input fails clearly without creating a partial runnable delivery or modifying the target repository.
- [x] Status and artifacts redact synthetic credential canaries while retaining useful outcome provenance.
- [x] The implementation provides reproducible TypeScript runtime/build/test commands, preserves existing user documents, and does not assume an initial Git commit already exists.
- [x] Behavior tests drive the CLI/controller, reopen the real ledger and verify no worker launch or remote write is dispatched by this incomplete slice.

## Completion evidence

Completed on 7 October 2026. The TypeScript CLI provides start, per-ID status and inventory with an intake-only blocker. Real SQLite WAL/full synchronization and flushed redacted request artifacts retain state across processes. Input validation, state/repository separation and linked-storage rejection preserve target content. There are no worker or remote-effect adapters in this slice.

- Formatting check, typecheck, build and full Node test suite passed: six public CLI behavior tests, including real temporary-directory junction protection on the Windows host.
- TDD recorded failing behaviors before implementation/fixes. Local review tightened artifact persistence and linked-path handling.
- Approved CodeRabbit source review completed over all three source files with one minor authorization-scheme redaction finding; it was reproduced, fixed and covered by a regression. Verification review completed with zero findings over the changed source.
- Redaction covers common labeled/token/key/authorization patterns and is not a detector for arbitrary secrets. Do not submit secrets. Node's SQLite API emits an experimental-feature warning on the pinned runtime line.
- Complete host isolation, macOS qualification, signing/publication adapters and live pilot readiness remain later tickets; these local tests do not establish them.
