# Windows native qualification observation — 2026-10-07

> Historical/design artifact: statements below apply to the recorded investigation, proposal or revision. For implemented capabilities, later completion evidence and remaining production gates, see [implementation status](../../docs/implementation-status.md).


Owner approved and initialized `sbx policy init deny-all`. Docker Sandboxes 0.47.0 created `aios-ticket4-qualification` using `shell`, no workspace arguments, `--skills off`, and `--deny-network '**'`.

Observed daemon inspection:
- Sandbox ID: 848fdf03-d5b7-4948-b2c8-5316b1d42659.
- Image: docker/sandbox-templates:shell-docker.
- Image digest: sha256:1560168ac5fb9ce23d413c878349334c5845c07e264cd675d7867f0c78ad1761.
- runtime_mounts: [] ; kits: [] ; sessions: 0.
- mcp_gateway: true; uploaded secret name mcpgateway (value never accessed).
- Network authorization for example.com:443: allowed false, explicit local denial.
- Actual guest curl received HTTP 403 Forbidden through the forward proxy.
- `sbx stop` succeeded; subsequent daemon inspection showed state stopped.

This is partial evidence, not full adversarial qualification or proof of descendant fencing. The disposable sandbox remains stopped, with state preserved. No model inference, owner credential import, repository mount, or global MCP changes occurred.

New blocker: the installed CLI automatically provisions an MCP gateway even for the mountless shell sandbox. Docker documentation says every sandbox starts a gateway; default dynamic mode exposes discovery/attachment of host-registered servers. The current creation flags and documented settings provide no verified gateway-disable control. Static mode requires registered servers and is not proof of an empty, disabled gateway. The approved requirement excluding host MCP remains unmet; native launch must remain blocked pending a supported isolation mechanism or an explicitly revised and tested contract.

Sources:
- https://docs.docker.com/ai/sandboxes/mcp-gateway/
- https://docs.docker.com/ai/sandboxes/configuration/settings/

Subscription-auth mediation and independent Windows/macOS qualification remain incomplete. The usage approval gate does not itself prove model-only credentials or eliminate gateway authority.
