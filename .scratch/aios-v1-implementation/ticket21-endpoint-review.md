# Ticket 21: Codex relay endpoint and capability review

> Historical/design artifact: statements below apply to the recorded investigation, proposal or revision. For implemented capabilities, later completion evidence and remaining production gates, see [implementation status](../../docs/implementation-status.md).


Owner-selected fixed base: `5d99f1f`; this continues the same ticket. The parallel
reviews covered `git diff 5d99f1f...HEAD` plus this incremental working diff and
new fixture/acceptance files.

## Standards

0 hard violations, 0 unresolved judgments. The fixture retains separate process
and mount authority while joining only the worker network namespace. Checks and
failure labels are explicit; worker, peer and management relay shutdown precede
the final binding snapshot. No credentials or provider bodies are emitted.

## Spec

0 corrective security defects or scope creep. Independent controls qualify the
synthetic Codex route, delivery/capability binding, namespace separation,
revocation with unused quota, budget refusal and real-time expiry. The predicate
requires the expected prompt to appear but admits additional Codex context and
ordinary function declarations. It is a credential-free protocol fixture, not
an exclusive production input/tool policy. A host-only subscription gateway and
integrated inference remain unqualified. Ticket 21 stays open and 22 blocked.

## Validation

Native red: status lacked endpoint/capability proof, then lacked expiry evidence.
Native green: actual Codex completed a synthetic turn; all five capability checks
passed and durable status retained the delivery binding. The successful policy
is `pins-ticket21-endpoint-reviewed.json`, outside the candidate. Earlier policies are
retained; source/runtime drift requires fresh enrollment.

Initial failures remained blocked. The control delivery had to stop before the
post-run VM snapshot; management relay process shutdown is independently checked
as well as worker cgroups. No production gate was enabled.

The final run also terminated an incomplete authenticated request at the absolute
capability deadline. Both cleanup paths share the stopped-state and authority
guard; the optional duplication review finding is resolved.

Repeated earlier fixture layers exhausted host disk space and caused a blocked
run. Removing only verified stopped fixture containers and redundant public
runtime downloads, followed by guest filesystem trimming, recovered about 6 GiB.
The VM restarted and was enrolled against its fresh boot and final source pins
before the successful rerun. Automatic approval review rejected releasing an old
terminal hold because that could stop VM child processes; that hold was left
untouched and a new startup hold retained the recovered VM lifecycle.

Typecheck and formatting pass; all 123 automated tests pass with synthetic
loopback sockets enabled. The native qualification is separately observed on
this Mac's share-free AppleHV VM. No new subscription inference ran.

The Codex initialization/thread/turn protocol follows the [official app-server
contract](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server).
Its documented direct-token configuration is not used: the worker receives only
a synthetic delivery capability and the isolated synthetic endpoint.
