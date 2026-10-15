# Support request: supported MCP isolation for local Docker Sandboxes

> Historical/design artifact: statements below apply to the recorded investigation, proposal or revision. For implemented capabilities, later completion evidence and remaining production gates, see [implementation status](../../docs/implementation-status.md).


**Subject:** Docker Sandboxes 0.47.0 on Windows: disable automatic MCP gateway or enforce an immutable empty capability set

Hello Docker Support,

We are qualifying local Docker Sandboxes as the isolation boundary for an autonomous coding worker. The worker must not discover, attach to, or invoke host-registered MCP servers, access their credentials, or execute host-side MCP commands. This must be enforced outside the guest, where the worker can have elevated privileges.

We found that a mountless shell sandbox with shared skills disabled and deny-all networking still exposes the built-in MCP gateway. Passing an explicitly empty `--static-mcp=` did not remove dynamic discovery and attachment tools. We are looking for a supported local configuration, not asserting that a vulnerability or unauthorized server access has been demonstrated.

## Environment

- Host: Windows, x64; Windows Hypervisor Platform enabled.
- Local Docker Sandboxes CLI and daemon: 0.47.0.
- `sbx diagnose --json`: all 13 checks passed, including virtualization, daemon health, and authentication.
- Local sandbox, not Docker Cloud Sandboxes.
- Agent: shell; no workspace paths, kits, or host MCP registrations added for this test.
- Template: `docker/sandbox-templates:shell-docker@sha256:1560168ac5fb9ce23d413c878349334c5845c07e264cd675d7867f0c78ad1761`.

## Reproduction

Our global network policy had been initialized with `sbx policy init deny-all`. This is a host-wide setting; reproduce on a disposable host or an appropriately configured test installation.

We created the sandbox with this PowerShell command. The pinned template was already cached, hence `--pull never`:

```powershell
sbx create --name aios-ticket4-static-empty --cpus 2 --memory 1g --skills off --deny-network '**' --static-mcp= --template docker/sandbox-templates:shell-docker@sha256:1560168ac5fb9ce23d413c878349334c5845c07e264cd675d7867f0c78ad1761 --pull never shell
sbx inspect aios-ticket4-static-empty --json
```

Selected inspection fields:

```json
{
  "agent": "shell",
  "kits": [],
  "runtime_mounts": [],
  "mcp_gateway": true,
  "secrets": [{ "name": "mcpgateway", "source": "uploaded" }],
  "daemon_version": "v0.47.0"
}
```

From Node.js inside the guest, we sent the following MCP requests to its `MCP_GATEWAY_URL`, without printing that URL, credentials, or session identifiers:

1. `initialize`, protocol version `2025-03-26`, empty client capabilities.
2. `notifications/initialized`.
3. `tools/list`.

The probe retained any `Mcp-Session-Id` returned by initialization and sent `MCP-Protocol-Version: 2025-03-26`. Requests accepted JSON and SSE responses. Observed normalized result:

```json
{
  "initializeHttp": 200,
  "toolsHttp": 200,
  "toolNames": ["code-mode", "mcp-add", "mcp-config-set", "mcp-exec", "mcp-find"]
}
```

A separate mountless sandbox using the same template and deny-all policy returned `allowed: false` for `example.com:443`, and an actual guest HTTPS request received HTTP 403 Forbidden. Thus external network denial was observed, but it did not establish isolation from the internal MCP gateway.

No MCP tools were invoked, no servers were registered or attached, and no owner credential contents were accessed. We did not run model inference. Both disposable sandboxes were stopped afterward, and daemon inspection confirmed their stopped state.

## Questions

1. Is there a supported local CLI option, daemon setting, or API to prevent gateway provisioning or detach/disable it for a single sandbox?
2. If disabling is unavailable, can a local sandbox enforce an immutable empty MCP capability set that prevents host server discovery, attachment, invocation, resource access, and prompts? How is an explicitly empty static set expressed? Is `--static-mcp=` intentionally equivalent to dynamic mode?
3. Can this boundary be enforced without paid organization governance? If governance is required, which actions and listings are covered, and can discovery metadata also be suppressed?
4. Does local network policy govern access to the built-in gateway? If so, what supported rule blocks it while preserving independently allowlisted model/dependency endpoints?
5. Are there supported daemon-observed fields that prove the effective gateway mode, server set, and enforcement policy? Does the control survive sandbox stop/start and daemon restart without being restored by the agent integration?
6. An indexed API reference mentioned `POST /v1/sandboxes/{sandbox}/mcp-gateway/stop`, but its page returned 404 during our investigation. Is this operation supported for local 0.47.0 sandboxes? If so, please provide the current documentation and supported local transport.
7. If the current local product cannot enforce this boundary, is a supported version or planned capability available? Our intended platforms are Windows x64 and macOS Apple silicon; only Windows was tested here.

A concrete supported command/configuration and a way to verify its effective enforcement would let us repeat direct MCP protocol probes, test synthetic canary access, and validate restart behavior before enabling the coding worker.

Relevant documentation consulted:

- https://docs.docker.com/ai/sandboxes/mcp-gateway/
- https://docs.docker.com/ai/sandboxes/configuration/settings/
- https://docs.docker.com/ai/sandboxes/governance/access-controls/mcp/
- https://docs.docker.com/ai/sandboxes/governance/reference/mcp-policy/

Thank you.

## Submission record

Submitted through the signed-in Docker support contact form on 7 October 2026, after explicit owner approval of the Gordon AI preliminary step and human ticket submission. Namespace: aaronhowardtx. Topic: Sandboxes (sbx). Subtopic: General inquiry. Severity: S4 - Low.

The page confirmed: "Your message was sent successfully." It also stated a confirmation email would follow with support follow-up details. No case number was displayed. Screenshot: docker-support-confirmation.png.

Gordon's preliminary automated answer claimed no supported local disable or immutable empty capability-set control. This is an AI response, not a human support determination; await the support team's reply before treating it as authoritative.
