# Architecture module boundaries

Date: 2026-10-17
Status: accepted

## Context

The architecture review identified duplicated authority checks, guest programs,
account clients and ownership transactions. The owner authorized all candidates,
including CLI and deletion decisions, separately from Issue #4 live qualification.

## Decisions

- `UsageApprovalGate` owns freshness, scope and single-operation binding. The
  controller invokes it inside durable transactions using an injected clock.
- `SessionLifecycle` owns stop evidence and retained-session quiescence;
  `RepositoryLedger` owns SQLite migrations, transactional documents, fence CAS
  and FIFO ownership. The controller composes these public interfaces.
- `VMManagementChannel` owns one guest program, journal/fence protocol, measured
  transport and host-target deadlines. Controls exercises live outside the pure
  evidence contracts and use the public controller interface.
- Host targets own platform facts. Named qualification rules consume stamped
  evidence. Explicit qualification performs private-storage inspection; status
  and list only verify retained pins and metadata, with no credential/ACL process.
  Dispatch still requires fresh qualification and independent authorization.
- Subscription account, credential vault, private storage and pinned app-server
  client are separate boundaries. Inference request and generated Python fixture
  configuration share one contract.
- CLI commands declare accepted options, runtime requirements and dispatch.
  Exact-plan preparation/approval remains a host API: exposing owner authority
  through an unqualified CLI would require a separate approval-input contract.
  Existing CLI production refusal is preserved.

## Deletion and placement

Remove `SandboxWorkerAdapter`, `SbxHostAdapter` and `materializeWorkspace`: there
was no production sandbox adapter, the diagnostic adapter never qualified, and
only its obsolete tests and CLI fallback called it. An absent configured adapter
now records unavailable qualification through the existing controller boundary.
Keep `admittedPath` and `admitFiles`, called by active native/feature admission;
direct tests cover digest drift, credential paths, links and duplicate entries.

Keep `RevocableModelGrant`: the active credential-free mediation canary and tests
exercise deadline, irreversible revocation and active I/O cancellation. It is a
small qualification transport seam with observed behavior. Move the crash helper
into its sole owner, the VM guest program. Move the fixed gateway adversarial
matrix into `gateway-canary.ts`; production request validation stays in the
subscription gateway and canonical inference contract.

## Consequences

Module fingerprints invalidate evidence when their actual dependencies change;
controller-only orchestration edits no longer change online routing policy.
Host controls retain the conservative controller fingerprint because their
integration exercise still observes its phase and ownership guards. Narrowing
that pin further requires extracting those remaining semantics first.
Retained native evidence must be regenerated before live use. Local green tests
exercise controlled adapters, local processes and sockets; they do not qualify
Windows/macOS workers or enable delivery. Runtime cycles through controller
construction are removed; controls exercises remain separate integration clients.

Graft is an ignored generated cache. CI regenerates it without an LLM/key using
pinned Graft 0.16.0 and checks freshness. Rebuild locally after source changes;
never treat old line ranges as current evidence.
