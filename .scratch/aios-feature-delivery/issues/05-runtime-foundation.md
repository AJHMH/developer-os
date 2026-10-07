# Choose the v1 execution foundation and specification boundary

Type: grilling
Label: wayfinder:grilling
Status: resolved
Claimed by: current Codex chat
Parent: ../map.md
Blocked by: 01, 02, 03, 04, 06

## Question

Given the resolved delivery contracts, what execution foundation should v1 use, and what evidence will make its specification ready to implement?

Settle whether this wraps an existing coding-agent CLI or embeds a model SDK; language, local service/process shape, persistence and protected tool boundaries; supported host; and a representative acceptance scenario. Reuse existing Factory capabilities where they satisfy the contracts, and identify gaps explicitly.

## Evidence

- [AIOS research](../../../AIOS-RESEARCH.md).

## Resolution requirements

A justified implementation foundation, explicit supported scope and measurable end-to-end acceptance criteria. Hand off to `/to-spec` when no planning questions remain; do not start building here.

## Comments

### Owner decisions — 7 October 2026

- Implement the controller in TypeScript.
- Support Windows and macOS in v1. Do not assume Windows credential paths or process-control behavior apply to macOS; each host needs verified onboarding/signing/recovery behavior.
- Use a foreground CLI with durable state and explicit start/status/pause/resume/cancel commands. Closing the runner interrupts execution; restart reconciles and resumes eligible work under the lifecycle contract.
- Existing coding-agent CLI capabilities and credential isolation are under read-only investigation. No worker integration or runtime has been implemented.

### Owner decisions — worker and persistence

- Wrap a pinned/tested Codex CLI behind a replaceable adapter. AIOS owns delivery orchestration.
- Require enforced worker isolation on Windows and macOS. The worker edits code and runs permitted checks; the trusted controller alone holds signing/GitHub credentials and performs signing, pushes, PR creation, merge and cleanup. Block worker execution unless isolation is demonstrated on its host.
- Use a local SQLite ledger with separate artifacts/logs. Persist delivery state, revisions, operation outcomes, budget usage and explicit worker session IDs. Never use global last-session selection.
- Default initial implementation allowance: 120 active minutes, configurable. Exhaustion preserves progress and produces a blocker; continuation requires an owner extension. This is separate from the agreed repair allowance.
- Local CLI inspection found version 0.39.0 with noninteractive `exec`, JSONL output, working-root/sandbox options and explicit resume IDs. Help does not establish actual isolation, stable event schemas or resumed isolation. Pin and verify the adopted CLI rather than assume this installation is suitable.
- [Factory executable-adapter boundary](D:/repos/factory-template/docs/bounded-agent-proposals.md:48) requires separate isolation before arbitrary coding-agent executables. Existing fixture proposals do not supply a ready Codex worker.
- [Investigate worker isolation on Windows and macOS](06-worker-isolation.md) is a newly exposed prerequisite. Runtime resolution awaits its evidence and owner selection of a concrete boundary.

### Owner decisions — concrete isolation scope

- Accept Windows 11 Intel/AMD x64 with Windows Hypervisor Platform and macOS 14+ Apple silicon as the v1 host scope. Intel Macs and Windows ARM are outside the selected candidate's scope.
- Evaluate a pinned Docker Sandboxes (`sbx`) microVM with a pinned Codex CLI. Required isolation tests must pass before execution; never fall back to a host-executed worker.
- Use a dedicated model-only identity through the sandbox proxy, with spending limits and restricted provider endpoints, separate from signing/GitHub credentials.
- Validate this web-app pilot inside Linux isolation on both hosts. Windows/macOS support refers to the controller and its integrations, not proof of native application compatibility.
- [Completed isolation investigation](06-worker-isolation.md) provides the candidate's documented capabilities and acceptance matrix. No installed/tested version or host has yet been qualified.

## Answer

Owner confirmed the complete execution-foundation contract on 7 October 2026. This resolves the planning decision; version qualification, host acceptance, onboarding and pilot execution remain implementation/readiness work.

### Implementation foundation

Build a TypeScript foreground CLI controller with durable local SQLite state and separate artifact/log storage. Commands expose start, status, pause, resume and cancel. A running controller owns orchestration; there is no always-on daemon requirement. Closing the runner interrupts execution, and a restart reconciles state and orphaned workers before resuming eligible work under the lifecycle contract. Control commands must coordinate with the active runner rather than race for ownership.

Persist delivery/repository identity, phases, explicit worker/sandbox session IDs, trusted policy/version identifiers, revisions, operation outcomes, approvals, evidence pointers and both time/cycle allowances. Preserve state transactionally at effect boundaries; SQLite WAL alone does not establish lossless durability. Reconcile uncertain operations instead of promising exactly-once external effects. Do not use a global last-session selector.

The initial implementation allowance defaults to 120 active minutes and is configurable. The repair allowance remains three cycles or 60 active repair minutes. Preserve both across restart; exhaustion blocks the corresponding work until owner extension. Waits, cancellation and resume behavior follow the resolved lifecycle contract.

### Coding adapter and authority

Use a replaceable adapter around pinned/tested Codex CLI noninteractive execution with structured events and explicit resume IDs. Qualify actual event formats, exit/failure behavior, model proxy authentication, sandbox lifecycle and resumed execution before selecting supported versions. Local CLI 0.39.0 inspection is evidence of available help options, not the adopted runtime pin or a suitability guarantee.

The trusted controller manages Git metadata, policy, signing and publication credentials, App-authored PR creation, approval/check verification, merge, synchronization and cleanup. Reuse Factory components only within their established scope. Cross-platform App authentication cannot depend solely on the existing Windows PowerShell helper: the implementation specification must define and test an equivalent trusted adapter on both hosts.

The coding worker has only a materialized ordinary-file workspace and explicitly permitted model/dependency/test capabilities. Do not share original Git metadata, owner environment files, home/keystore mounts, signing or SSH sockets, controller state, GitHub bindings or host Docker sockets. Disable shared skills, host MCP and untrusted host lifecycle hooks. All repository-controlled dependency scripts, lint, formatting, tests and builds remain inside isolation. Never run worker-modified repository scripts on the credential-bearing controller host.

Stop the worker before importing its output. Treat output as untrusted file changes: reject escaping paths, links/reparse points and Git metadata, preserve only admitted changes, and use trusted Git configuration for signing/publication. A controller wrapper and environment-variable cleanup alone are not an isolation boundary.

### Host and validation scope

Selected candidate: Docker Sandboxes microVMs on Windows 11 x64/Hypervisor Platform and macOS 14+ Apple silicon, subject to version and host qualification. No host-execution or weaker-container fallback is enabled implicitly. Verify effective mounts, SSH/skills settings, credential proxy, network restrictions, descendant termination, orphan recovery and isolation on initial start and resume.

Model-only authentication uses a dedicated proxy identity with restricted endpoints and spend controls. Dependency access is a declared controlled phase/cache, not unrestricted network access. Database-backed E2E uses disposable synthetic test infrastructure in isolation; production database credentials and host database access are excluded.

Linux-isolated web-app validation is the v1 baseline on both hosts. Controller, signing, App/authentication and process-control behavior need host-specific tests. Native application validation is not implied; future workloads must declare their compatibility requirements.

### Acceptance and readiness boundary

The implementation specification must define exact adapters/interfaces, persisted state transitions, input/output admission, command and check declarations, identity/policy provenance, timeouts, conditional effects and measurable tests from the resolved map contracts. Do not reopen accepted policy choices as silently different implementation defaults.

Required evidence before enabling a host includes the [worker-isolation acceptance matrix](../worker-isolation-research.md), structured Codex adapter/resume tests, controller state recovery, concurrent ownership and quota behavior, conditional merge/deletion races, credential exclusion and cancellation of descendants. All checks are currently unperformed. If required evidence is unavailable or versions/policy change without requalification, launch remains blocked.

Demonstrate one owner-agreed small feature end to end in `AJHMH/profile-page`: onboarded identity and governance, signed push, App-authored PR, local/PR checks and feature acceptance, actual current-head owner approval, conditional merge, passing main checks, safe main synchronization and eligible cleanup with retention evidence. Repeat relevant host acceptance on Windows and macOS; a Windows demonstration alone does not establish macOS support. No secret material appears in evidence.

Exact version selection and live installation/signing/protection facts are qualification deliverables, not assumptions that require a new product decision. Failure to qualify the selected candidate is a blocker and a reason to revisit this decision, not permission to silently substitute a weaker boundary.

### Handoff

Once the owner confirms this contract, resolve this ticket and close the planning map. Hand off its named decisions and evidence to `/to-spec`, then `/to-tickets` and `/implement`. Onboarding setup, runtime implementation and pilot execution occur after planning, with reviewable artifacts and the agreed authority boundaries.

Resolution: accepted by the owner. No installation, sandbox/agent execution, key changes, pilot writes or remote effects were performed.
