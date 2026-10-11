# 21: Qualify model-only subscription authentication mediation

**What to build:** Deliver a capability decision through qualification/status: a supported mediation mechanism must separate subscription inference from reusable owner credentials, host MCP/discovery and publication authority. Test credential-free protocol/capability canaries before any authorized live inference. Unsupported or unverifiable mediation reports an actionable blocker; do not copy owner authentication files, buy credits or substitute paid API access. A negative finding completes the investigation but leaves the production gate blocked and requires an owner tradeoff decision; it does not satisfy this ticket's positive qualification criteria.

**Blocked by:** 18.

**Status:** ready-for-agent

## Parent and governing contract

Supports open parent ticket [04](04-isolated-worker-gate.md), governed by the [canonical specification](../../aios-feature-delivery/spec.md) and owner-approved runtime/scope revision. Use the approved public-controller command/observation testing seam. Readiness describes specified work, not production qualification. No implicit weaker-runtime fallback or paid inference is authorized.

## Acceptance criteria

- [ ] A supported mechanism demonstrates model-only subscription mediation without reusable owner credentials, host MCP/discovery or publication authority entering the worker.
- [ ] Credential-free protocol/capability canaries precede any authorized live inference; owner authentication files, credit purchases and paid API substitutions are forbidden.
- [ ] Unsupported/unverifiable mediation returns an actionable blocker and owner tradeoff; a negative investigation does not satisfy positive qualification or unblock ticket 22.

## 10 October capability progress

The credential-free, digest-pinned official Codex 0.161.0 app-server initialization/account-read and host-loopback synthetic relay canaries passed through controller qualification; persisted status still reports qualified:false. The relay tests fixed Responses-only routing, stripped owner headers, and denied unrelated endpoints and capabilities. No real subscription credentials or inference were used. [Observation](../ticket21-protocol-observation.json).

Owner-approved preparation created only stable Developer OS registration metadata in separate external host storage. At that preparation milestone the browser authorization broker, ID-token verification and encrypted host credential store were unimplemented; the macOS progress below supersedes their implementation status. VM credential isolation, independently enforced model-only endpoint access and completed subscription inference remain unimplemented/unqualified. The preparation command cannot authorize delivery. Ticket 21 stays open and 22 remains blocked. See [separate setup plan](../chatgpt-setup.md).


## macOS broker implementation (10 October)

Separate `authorize-auth` setup now binds fresh PKCE/state/nonce to a loopback
callback, exchanges only the issued dynamic client ID, verifies RS256 ID tokens
against fixed OpenAI JWKS and checks issuer/audience/expiry/nonce. Returning
sign-in requires the selected verified identity; denial, invalid callbacks,
forged signatures and missing plan permission fail safely. macOS credentials are
intended for host-only Keychain storage with no token in process arguments,
browser hints, candidate files or command output.

Controlled tests cover the authorization broker and setup refusal. Native
Keychain persistence passed with a disposable 64 KiB synthetic payload. Owner
browser consent was attempted, but authorization failed before credential
storage; a fresh retry is pending with sanitized stage diagnostics. VM
relay/credential isolation, revocation and subscription inference remain
**not-run**. This is implementation progress, not
positive qualification; all acceptance boxes and ticket 22 remain blocked. See
[separate setup](../chatgpt-setup.md) for the concrete operator command.
