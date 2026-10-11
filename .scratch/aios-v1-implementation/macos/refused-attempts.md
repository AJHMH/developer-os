# Retained setup and qualification refusals — 10 October 2026

The installed Podman default is libkrun; this effort explicitly selected AppleHV.
The initial VM setup generated an empty `/etc/containers/policy.json`; the first
image pull refused it. Provisioning restored the immutable vendor policy from
`/usr/share/containers/policy.json`. No policy bypass was used by the worker.

The historical Windows Alpine digest resolved to AMD64. No worker was launched
with it. The official Alpine 3.22.2 Linux/ARM64 manifest was resolved and pinned
separately before macOS enrollment. The initial terminal-scoped VM start did not
survive session cleanup; a detached restart restored this dedicated VM.

Initial adversarial qualification reached the host HTTP/MCP positive control,
then refused at `guest-engine-positive`: macOS's guest UID is 501 rather than
Windows's 1000. Original report: `initial-isolation.json`. The management driver
now derives and checks the actual rootless socket; new enrollment preserves the
prior pins rather than overwriting them.

A later isolation acceptance invocation mistakenly overlapped the fencing
acceptance run. It failed with `Delivery authority changed during qualification.`
and did not persist a successful qualification. The overlapping invocation is
an operator scheduling error, not a passed canary. Isolation was repeated
serially after the lifecycle runner finished.

`protocol-before.json` records credential-free Mac capability as `not-run` before
implementation. `protocol-after.json` records the independently verified native
package protocol and relay results after implementation. These reports retain
`qualified: false`, with actual credential mediation and inference `not-run`.
