# Ticket 4: MCP gateway isolation research

Research date: 2026-10-07. Scope: local Docker Sandboxes 0.47.0, credential-free qualification. No host configuration, server registration, credentials, or sandbox lifecycle were changed by this research.

## Finding

The automatic gateway is a real boundary requiring qualification, but available evidence does not establish that isolation is impossible. The initial local candidate was an explicitly empty static MCP set combined with a sandbox-scoped deny-all network rule. The parent agent's live prototype rejected this candidate: properly initialized MCP `tools/list` returned HTTP 200 with `code-mode`, `mcp-add`, `mcp-config-set`, `mcp-exec`, and `mcp-find`. Thus the empty flag produces dynamic behavior, and deny-all egress does not block this internal gateway. See `mcp-boundary-prototype.mjs` for the credential-free probe.

Docker says every sandbox starts a gateway. Static mode excludes `mcp-find`, `mcp-add`, and `mcp-config-set`; dynamic mode lets agents discover and attach host registrations. Static server names must be registered. An empty static list is not described. Built-ins include `mcp-exec` and `code-mode`. Host-side `sbx mcp load` can attach another server even in static mode. Host stdio servers execute outside the VM; OAuth and header credentials are host-managed. [MCP gateway](https://docs.docker.com/ai/sandboxes/mcp-gateway/)

The installed `sbx create --help` exposes `--static-mcp strings`, `--deny-network strings`, and `--skills off`; `sbx mcp --help` has no gateway stop or disable verb. These help outputs were observed locally, not inferred from web documentation.

## Alternatives and limits

Organization MCP policies can govern registration, tool invocation, resource reads, prompts, and gateway built-ins. Without active organization enforcement, requests are permitted; there is no local MCP preset. Registration denial alone does not revoke loaded servers. In-protocol approval is unsuitable as a hard prohibition because an autonomous client can answer it. [MCP access policies](https://docs.docker.com/ai/sandboxes/governance/access-controls/mcp/)

An active Cedar `forbid (principal, action, resource);` is a candidate for denying all evaluated MCP actions. Tool/resource listings and subscriptions are not Cedar-gated, so this does not meet a requirement to hide host discovery information. [MCP policy reference](https://docs.docker.com/ai/sandboxes/governance/reference/mcp-policy/)

Organization governance requires a separate paid Docker subscription. It is therefore a documented alternative, not a locally available or approved solution. [Organization policies](https://docs.docker.com/ai/sandboxes/governance/access-controls/organization/)

Network policy controls outbound sandbox traffic and direct remote MCP connections. Its applicability to the built-in gateway endpoint is not proven. Denying external HTTPS alone cannot establish gateway isolation. [Network access policies](https://docs.docker.com/ai/sandboxes/governance/access-controls/network/)

An indexed experimental API operation advertises `POST /v1/sandboxes/{sandbox}/mcp-gateway/stop`. However, direct retrieval later failed, the parent received HTTP 404, the current API overview lists no stop operation, identifies a hosted/cloud surface, and the cookbook says no separate gateway stop exists. The overview mentions direct Unix-socket access under OS access control without giving a local transport address. Treat the stop route as inconsistent or obsolete indexed documentation, not a supported local 0.47 control. Do not probe cloud APIs or send credentials to resolve it. [Indexed stop operation](https://docs.docker.com/reference/api/sandboxes/latest/operations/stopMcpGateway/), [API overview](https://docs.docker.com/reference/api/sandboxes/latest/), [Gateway cookbook](https://docs.docker.com/ai/sandboxes-api/cookbook/give-a-sandbox-an-mcp-gateway/)

`SBX_MCP_URL=none` appears in Docker's CLI reference as a selector for the local MCP data plane. It is not documented as disabling the per-sandbox gateway. [sbx mcp add reference](https://docs.docker.com/reference/cli/sbx/mcp/add/)

## Proposed qualification procedure (partially performed; see verdict for actual checks)

1. Create a uniquely named mountless `shell` sandbox using `--skills off`, `--deny-network '**'`, and an explicitly present empty `--static-mcp=` argument. Pass arguments as an array to preserve the empty value. Do not register a dummy host server to satisfy the flag.
2. Inspect daemon-observed sandbox metadata for static mode and an empty server set. If the daemon cannot distinguish this from dynamic mode, qualification remains failed or unproven.
3. From trusted guest probe code, identify only the gateway endpoint configuration, without printing environment values or credentials. Send MCP initialize and tool/resource/prompt list requests; retain names and normalized outcomes only.
4. Attempt `mcp-find`, `mcp-add`, and `mcp-config-set` with a unique nonexistent synthetic server name. Attempt `mcp-exec` and `code-mode` referring only to that nonexistent name. No owner server or credential may be exercised. Require explicit unavailable/denied results, not merely an empty current catalog.
5. Test gateway connection with the scoped network deny active. If connection succeeds, deny-all network policy alone is insufficient. If blocked, independently verify the rule covers the actual endpoint rather than trusting absence from agent configuration.
6. Stop and restart only this qualification sandbox, repeat metadata and raw MCP checks, then stop it. Restart must preserve the isolation control.

A successful empty-static test is evidence about current behavior, not future catalog-change immunity. To prove immunity without touching owner registrations, a later disposable daemon profile or organization test account could expose a synthetic canary server. Removing the agent's MCP config, clearing today's catalog, killing the guest proxy, or guest firewall rules are insufficient: the agent has sudo inside the VM and can restore guest controls. [Isolation layers](https://docs.docker.com/ai/sandboxes/security/isolation/)

## Acceptance decision

Do not mark Ticket 4 live-ready merely because the gateway exists but today's catalog is empty. Accept only a host-enforced unavailable gateway or a verified immutable empty capability set, including direct protocol calls and restart behavior. If those tests fail, evaluate supported governance or an alternate isolation runtime; request a design change only after presenting the measured limitation.

