# Worker isolation on Windows and macOS

> Historical/design artifact: statements below apply to the recorded investigation, proposal or revision. For implemented capabilities, later completion evidence and remaining production gates, see [implementation status](../../docs/implementation-status.md).


Research date: 7 October 2026. Planning evidence for [ticket 06](issues/06-worker-isolation.md), supporting [runtime ticket 05](issues/05-runtime-foundation.md). No infrastructure was installed or executed, no secret contents were read, and no GitHub effects were performed. The repository has no initial commit; a research branch cannot be created from HEAD. Findings are preserved as this working-tree artifact.

## Recommendation

Evaluate **a pinned Docker Sandboxes (`sbx`) local microVM with a pinned Codex CLI**, sharing only a newly materialized, credential-free delivery workspace. Keep the TypeScript controller, SQLite ledger, Git metadata, signing material and publication credentials outside that workspace. This is a candidate requiring owner selection and host acceptance, not a demonstrated boundary.

This is preferable to immediately building a custom container plus credential proxy: Docker documents separate microVM kernels and a private Docker engine, with host-side model credential injection. Local Sandboxes are a standalone product; Docker Desktop is not a prerequisite. The documented hosts are **Windows 11 on Intel/AMD x64 with Windows Hypervisor Platform**, and **macOS 14+ on Apple silicon**. Intel Macs and Windows ARM are not covered by these prerequisites. Confirm the actual target machines before selecting this scope. [Installation](https://docs.docker.com/ai/sandboxes/install/), [architecture](https://docs.docker.com/ai/sandboxes/architecture/).

Docker describes local sandbox compute as free, including commercial use; model charges remain separate and organization governance is a paid option. These are current product terms, not a permanent pricing assumption. [Product overview](https://docs.docker.com/ai/sandboxes/).

## Evidence and important exceptions

Docker documents Codex integration and host-side OAuth/API-key authentication. It does not inherit the owner's `~/.codex` directory, but does read project configuration. Its default invocation bypasses Codex approvals and sandboxing: the external microVM is therefore the intended security boundary. Noninteractive `exec`, JSON events, explicit resume and custom pinned templates still need adapter testing; the integration page does not prove those combinations. [Codex integration](https://docs.docker.com/ai/sandboxes/agents/codex/).

**Do not launch with the defaults.** Docker documents SSH agent forwarding, which grants signing/authentication operations even without disclosing private keys. It also documents host lifecycle commands in sandbox environment files, hard links escaping a direct mount's path boundary, and raw secrets readable in clone-mode source mounts. Symlink restrictions are not sufficient for hard links. Never share the original credential-bearing checkout; use new ordinary file copies and reject linked/reparse entries. [Isolation layers](https://docs.docker.com/ai/sandboxes/security/isolation/).

Shared skills must be disabled with `--skills=off`. Defaults documentation says read-only, while a diagram in the security-model page says read-write; inspect the effective mounts instead of trusting either description. No host MCP servers or gateway capabilities belong in this worker contract. Docker warns that local MCP processes execute on the host and that broad default domain rules may permit more services than intended. [Defaults](https://docs.docker.com/ai/sandboxes/security/defaults/), [security model](https://docs.docker.com/ai/sandboxes/security/).

A hidden raw credential and a denied capability are different properties. Docker's proxy can inject credentials without showing their values, but then permits authenticated calls. Model-only authority requires **no GitHub service binding, no imported owner tokens, no SSH forwarding and no publication network access**. Use a dedicated provider identity with narrow service permissions and spending limits, preferably scoped to the delivery sandbox. Explicitly reject OAuth passthrough and custom bindings that expose tokens. [Credential management](https://docs.docker.com/ai/sandboxes/configuration/credentials/).

OpenAI recommends API keys for programmatic CLI automation and supports custom model-provider endpoints. Codex may cache credentials in files or the OS keyring. For this design, model authentication stays at the external proxy; never copy the owner's authentication cache into the worker. Whether the chosen pinned CLI and template work with proxy-managed placeholders, streaming and resumed sessions must be tested. A dedicated inference identity is still capable of spending money and sending source text to its provider. [Authentication](https://developers.openai.com/codex/auth/).

The existing [Factory evidence](factory-evidence.md) separates owner-signed pushes from App PR operations. Factory's [bounded executable boundary](D:/repos/factory-template/docs/bounded-agent-proposals.md:48) requires isolation before arbitrary agent execution. Existing fixture proposals do not implement this worker. No actual pilot permissions or unattended signing have been verified.

## Proposed fail-closed launch contract

The following requirements are design proposals derived from the above sources and approved delivery contracts; they are not vendor guarantees.

1. Onboard each Windows/macOS host separately. Record OS, CPU, hypervisor, sandbox runtime, CLI and image/template digests, network policy and acceptance evidence. A missing, unsupported, changed or unverifiable component blocks launch. Version pinning must include a reviewed security-update process, rather than indefinitely retaining known vulnerable software.
2. The controller creates the feature branch in its trusted Git checkout, then materializes an ordinary-file workspace from the selected revision. No `.git`, owner `.env`, credential helpers, home-directory mounts, keystore, signing socket, controller logs/ledger or Docker socket cross the boundary. Preserve necessary nonsecret configuration explicitly. Keep a separate read-only manifest of admitted inputs. Never run repository code while materializing them.
3. Use a trusted controller-owned launch manifest and sanitized environment. Disable SSH forwarding, shared skills, MCP integrations, clipboard image reads, host command hooks, unreviewed kits and credential resolvers. Ignore repository-provided host lifecycle declarations. The worker can alter its in-VM settings, but those changes cannot relax host policy or obtain controller credentials.
4. Allow only verified model-provider endpoints during coding. Dependency fetching is a separate controlled phase with declared registries or prepared caches; never grant unrestricted internet for install scripts. Stop if private dependencies need unapproved authority. Domains that host arbitrary user content, redirects, proxy tunnels and DNS behavior require adversarial tests. Even an allowed model endpoint is a data disclosure and billing channel; no claim of zero exfiltration is possible.
5. All lint, formatting, tests, builds and dependency lifecycle scripts execute inside isolation, including controller-requested revalidation. The controller cannot establish safety by later running worker-modified `package.json` scripts on its own privileged host. Declared commands and validation policy remain pinned outside the workspace, with results tied to exact admitted/output revisions.
6. Provision database-backed E2E with a disposable database and synthetic data inside the private VM. No production credentials or host database access. Use the private Docker engine if required, never the host engine. Browser/tool packages, image pulls, architecture compatibility, database migrations and outbound dependencies must be declared. Linux validation on either host does not prove native Windows/macOS application compatibility.
7. Treat worker output as untrusted file changes, not commands. Reject escaping paths, symlinks, junctions/reparse points, hard links and Git metadata. Stop the worker before importing output to prevent races. Import into a fresh trusted checkout using safe file operations; do not inherit worker Git hooks/configuration or execute output-supplied scripts. Controller signing/publication use sanitized trusted Git configuration and owner policy, never worker instructions.
8. Record explicit delivery, sandbox and Codex session IDs separately. Resume the same delivery only after checking the host boundary and current policy. Persisted sandbox state can contain malicious services, packages and settings; restart is not sanitization. Do not persist controller secrets with session artifacts. A changed policy/image invalidates old readiness evidence and requires requalification.
9. Enforce pause/cancel at the VM/container lifecycle boundary and verify descendants stop. Killing a foreground `sbx` or Docker client is not proof the daemon-managed workload stopped. Reconcile orphaned workers at controller restart; paused/cancelled deliveries must remain stopped. Never resume by global last-session lookup.

Docker documents persistence across stop/restart and deletion on removal; these lifecycle facts do not establish the controller's crash/cancel behavior. [Architecture](https://docs.docker.com/ai/sandboxes/architecture/).

## Alternative: Docker Desktop Linux container

A custom non-root Linux worker container is a practical fallback if `sbx` host requirements do not fit. Docker Desktop runs containers in a Linux VM on macOS; that does not make arbitrary host mounts safe. Bind mounts permit host writes by default. Use only an isolated ordinary-file workspace, read-only root filesystem, dropped capabilities, no-new-privileges, resource limits, default seccomp, no privileged/device/host-namespace access and no host daemon socket. [macOS permissions](https://docs.docker.com/desktop/setup/install/mac-permission-requirements/), [bind mounts](https://docs.docker.com/engine/storage/bind-mounts/), [run reference](https://docs.docker.com/reference/cli/docker/container/run/).

A trusted external inference proxy would have to hold model credentials and enforce destinations. A proxy environment variable alone is voluntary. A Docker internal network restricts external routing but **still permits communication with its gateway and appropriately configured host services**. Prove host, IPv6, DNS and alternate-routing denial; `--internal` alone does not satisfy the launch contract. [Network create](https://docs.docker.com/reference/cli/docker/network/create/).

Enhanced Container Isolation adds user namespaces and socket restrictions but requires Docker Business. Docker explicitly notes weaker WSL2 isolation than Hyper-V and recommends Hyper-V for maximum security. ECI does not prevent a controller from deliberately sharing sensitive host directories. These are additional defenses, not automatic acceptance. [ECI](https://docs.docker.com/enterprise/security/hardened-desktop/enhanced-container-isolation), [limitations](https://docs.docker.com/desktop/enterprise/hardened-desktop/enhanced-container-isolation/limitations/).

Docker documents SIGTERM followed by bounded SIGKILL for container stop. Verify termination of spawned descendants and private E2E resources on both hosts; do not translate native process-tree assumptions across operating systems. [Stop reference](https://docs.docker.com/reference/cli/docker/container/stop/).

## Acceptance matrix

Every row is required on both selected host configurations, on initial start and applicable resume paths. Use synthetic canaries rather than actual secrets. All tests remain **not run**.

| Boundary | Adversarial or functional probe | Required result / fail-closed action |
|---|---|---|
| Runtime identity | Missing hypervisor; wrong digest; changed runtime or policy | Launch refused; no fallback to host execution |
| Host files and controller state | Read/write canaries outside workspace: home, keystore, ledger, other repo; traversal and links | No contents/signatures/state mutations; escaping inputs rejected |
| Workspace admission | Secret-looking ignored file, `.git` pointer, junction, hard link outside root | Not shared; materialization blocks ambiguous input |
| Ambient authority | Credential helper, SSH agent signing request, GPG socket, env/proc inspection, host Docker API | No owner/GitHub/App/signing capability or controller secret |
| Model-only authentication | Real inference through proxy; token echo and alternate service requests | Inference works; raw credential unavailable; unauthorized authenticated effects denied |
| Network | Direct IP, IPv4/IPv6, host gateway/aliases, LAN, DNS tunnel, UDP, CONNECT, redirects, GitHub HTTPS/SSH | Only declared endpoints reachable; bypass denied; ambiguous behavior blocks launch |
| Repo-controlled configuration | Malicious AGENTS/config/environment file requests host hooks, MCP, skills, wider networking | No host action or policy change; malicious fixture remains contained |
| Dependency execution | Install script probes canaries/network and spawns background process | Same isolation; permitted dependency resolution works, unauthorized access fails |
| Validation | Pilot lint/format/type/test/coverage/build and relevant browser/DB tests | Complete exact-revision evidence; no credential-bearing host fallback |
| Output import | Escaping patch path, symlink, junction, modified Git hook and concurrent writes | Unsafe output rejected; trusted Git metadata remains intact |
| Restart/resume | Worker tampers with config; controller crashes; resume explicit session | Boundary rechecked, correct delivery only, budgets preserved, no duplicate remote effect |
| Pause/cancel | Detached child, hung worker, private DB/browser processes, killed client | Workloads verified stopped or delivery blocked; paused work never auto-restarted |
| Cross-delivery | Access other sandbox, artifacts, database, shared skills and model bindings | No cross-delivery authority or state contamination |

Store test outcomes, effective configuration, negative-probe evidence and exact version identifiers outside the workspace. Passing canary tests is necessary practical evidence, not mathematical proof against hypervisor/runtime vulnerabilities. No candidate is execution-ready until its host matrix passes; if a required check cannot be performed, delivery remains blocked.

## Remaining owner/specification decisions

- Confirm actual macOS CPU/OS and Windows CPU/OS, and accept required virtualization infrastructure; current documented `sbx` scope is narrower than an unrestricted Windows/macOS promise.
- Choose `sbx` microVM evaluation or custom Docker Desktop container evaluation. The latter entails building and verifying more network/authentication infrastructure.
- Choose model-only API identity/proxy binding and endpoint policy. Pin the actual worker version after testing; installed CLI 0.39.0 help is not proof of suitability.
- Define dependency manifests, disposable E2E tooling and safe output import precisely in the buildable specification.

Research resolves the candidate investigation only. It does not resolve ticket 05's owner selection or establish live readiness for the profile-page pilot.
