# MCP boundary live prototype verdict

> Historical/design artifact: statements below apply to the recorded investigation, proposal or revision. For implemented capabilities, later completion evidence and remaining production gates, see [implementation status](../../docs/implementation-status.md).


Question: does an empty static MCP set combined with global and per-sandbox deny-all prevent host MCP discovery and attachment?

Verdict: no, on the tested Windows Docker Sandboxes 0.47.0 configuration. `--static-mcp=` created a gateway; proper MCP initialization followed by tools/list returned HTTP 200 and these names: code-mode, mcp-add, mcp-config-set, mcp-exec, mcp-find. No tool calls were made. This demonstrates discovery/attachment capabilities remain exposed, not that any particular registered server or owner credential was used.

Sandbox: aios-ticket4-static-empty; 2 CPUs / 1 GiB; no workspace arguments; skills off; deny-network **; pull never; template docker/sandbox-templates:shell-docker@sha256:1560168ac5fb9ce23d413c878349334c5845c07e264cd675d7867f0c78ad1761. Daemon inspection: runtime_mounts [], MCP gateway true. Afterward stopped and daemon state verified stopped. No owner secrets read, model inference, server registration, network widening or global MCP mutation.

Reproduce against the retained disposable sandbox: `node .scratch/aios-v1-implementation/mcp-boundary-prototype.mjs`. This restarts that sandbox via sbx exec; stop afterward with `sbx stop aios-ticket4-static-empty`. Requires the same Windows install and previously created sandbox. Output deliberately includes only HTTP outcomes and tool names; it never prints endpoint URLs, session identifiers, credential values or raw responses.

This shell prototype is used instead of the skill's HTML logic demo because the user explicitly requested proof of a live external-system capability. A simulated browser demo cannot establish this boundary. No production source changes are justified by this negative result. Ticket #4 remains unqualified. Potential governance or gateway-stop solutions need local applicability and adversarial testing before implementation.
