# macOS isolated worker qualification

## Scope and outcome

Ticket 04 now has an independently observed **synthetic offline** macOS path.
It does not complete ticket 04, ticket 25 or later full-controller ticket 16.
Production delivery stays disabled: `ready` and `liveReady` are false, and the
Podman adapter refuses production start. Real subscription authorization
mediation, endpoint/dependency enforcement, online inference and production
isolated validation remain blocked by tickets 21, 22 and 24. Windows results
were not promoted into this Mac's report.

## Observed host and pins

On 10 October 2026 this Apple-silicon Mac reported macOS 27.2 (build 26B5091g),
Darwin 27.2.0, Node 24.15.0 and npm 11.13.0. The dedicated
`aios-macos-noshare` VM uses explicit **AppleHV**, Podman client 6.1.1 and guest
engine 6.1.3. AppleHV is selectable through the documented
[provider option](https://docs.podman.io/en/v6.1.3/markdown/podman-machine-init.1.html).
Other providers and Intel Macs are refused; this observation does not qualify
other host or runtime revisions.

The ordinary external policy binds the host/architecture/Darwin/provider,
machine identity, immutable booted machine-os image digest, guest engine,
ARM64 Alpine template, worker and management policy. The host identity hash
also binds the native Podman executable SHA-256 and client version. Any
changed binding revokes admission. Guest observations verify Apple virtualization,
aarch64, locked image provenance, rootless cgroup v2 and no effective VM host
shares before checking the worker's actual process restrictions.

The ARM64 template is Alpine 3.22.2 at
`docker.io/library/alpine@sha256:24bb3511a0db7b5114a4aee033c65a8a4148f39b7b80a398e548546db967a36f`.
The Windows AMD64 digest remains separate. Management policy is now
`offline-native-v3-<digest>`; existing Windows v2 pins must be independently
re-enrolled before using the changed driver. This Mac run does not requalify
Windows after the driver change.

## Reproduce the explicit synthetic acceptance

Provisioning is a separate owner-controlled step. Use empty machine volumes,
`--provider applehv`, rootless execution, no Rosetta/USB passthrough, no host CA
import, no Ansible playbook and the expected machine-os 6.1 image. The
read-only/native admission commands never create, boot or silently repair a VM.
The official package installation is required at `/opt/podman/bin/podman`;
no PATH-selected or repository-provided runtime is accepted.

Use ordinary, non-aliased absolute paths outside the candidate and ledger for
the policy, and a separate controller state directory. The observed synthetic
setup is `/Users/aaronhoward/.developer-os/ticket4-macos/`: `input/` contains only
the fixed canary input, `state/` is the authority, and `pins-v3b.json` is external
to both. Keep this dedicated VM bound to that one authority. Never reuse it for
another delivery store. Enrollment refuses existing policy files.

```sh
npm ci --ignore-scripts
npm run build
node dist/cli.js pin-offline --repo /absolute/input --state-dir /absolute/state --podman-machine aios-macos-noshare --worker-policy /absolute/new-pins.json
node dist/cli.js start --repo /absolute/input --state-dir /absolute/state --request "Synthetic offline qualification"
node dist/cli.js qualify --id <returned-id> --state-dir /absolute/state --podman-machine aios-macos-noshare --worker-policy /absolute/new-pins.json
node dist/cli.js offline-canary --id <returned-id> --state-dir /absolute/state --podman-machine aios-macos-noshare --worker-policy /absolute/new-pins.json
```

The input is exactly `AIOS offline canary input` followed by a newline. The
fixed worker receives bytes through management copy, not host mounts. Its root
filesystem is read-only, network is none, UID/GID is 65534, capabilities are
empty and seccomp/no-new-privileges are observed on its actual process. Result
collection occurs only after revocation and independent cgroup/PID shutdown.
No guest-selected paths or archives are imported.

Run the three retained `macos-*-acceptance.mjs` scripts through the serial runner:

```sh
npm run acceptance:macos -- <delivery-id> /absolute/external-pins.json
```

The runner executes round-trip, fencing and isolation in that order, stopping
on the first failure. It acquires `.native-acceptance.lock` in the canonical
`$HOME/.developer-os/ticket4-macos/state` directory before launching any step.
A second runner against that state refuses, including through path aliases.
The state directory must already exist. Normal completion or a step's ordinary
nonzero exit releases the lock; interruption retains it. After interruption or
an abruptly killed runner, inspect delivery status/recovery and confirm prior
runner processes and workers have stopped before manually removing the empty
lock directory. The runner never clears an existing lock or provisions a VM.

Direct invocation of an individual acceptance script bypasses this runner lock;
use the runner for shared-state acceptance and avoid other controller mutations
during the run. These scripts explicitly use the observed `ticket4-macos/state`
and machine.
The round-trip runner checks changed pins, metadata, linked and credential-like
input, uncertain shutdown/recovery and a fresh result. The fencing runner checks
queueing, pause, stale dispatch rejection, controller crash and exact-session
recovery. The isolation runner verifies six synthetic denial controls with
reachable positive controls before/after denial plus four bounded escape
attempts. These are explicit host acceptance scripts, not automatic tests.

## Authentication capability

The official `@openai/codex@0.161.0-darwin-arm64` package was downloaded without
lifecycle scripts and verified against its published SHA-512 integrity. Only
its native binary was materialized outside both candidate and state; the app's
existing CLI was preserved. SHA-256:
`12ac11d2c7eee27cfae34393986d7b7c9ed0dea537cb749831cdd7033893e6de`.
The capability inspector accepts this exact platform/digest, verifies version
and unchanged bytes, uses an empty temporary home with file-only auth, and
requests only initialization and unauthenticated account observation. The
protocol and bounded synthetic loopback relay passed. It performs no login,
inference, keychain access, owner credential copying or billing changes.

These host capabilities cannot establish a model-only VM authorization broker.
Credential isolation, endpoint enforcement and subscription inference remain
`not-run`. Unknown/low subscription usage still requires the existing owner
approval gate, and exhaustion cannot be overridden or trigger paid fallback.

## Retained evidence and limits

The local tracker retains `ticket4-macos-roundtrip.json`,
`ticket4-macos-fencing.json` and `ticket4-macos-isolation.json`, plus capability
before/after reports and refused attempts under `macos/`. All four lifecycle
censuses observed eight processes and zero remaining. Stopped synthetic
containers and guest revocation records remain available for inspection.

The six passed access probes cover disposable host files, synthetic authority
and peer files, HTTP/MCP IPv4 services and a rootless management socket. They do
not assert real owner-credential/keychain/signing/GitHub isolation, production
MCP support, general output collection, exhaustive escape resistance, online
network policy or browser/database validation. Unobserved qualification probes
stay `not-run`; authentication/online/production prerequisites keep parent 04
open. Follow the public status/recover commands with the same machine and policy
if an observation becomes uncertain.

After final combined public-CLI qualification, management confirmed no running
workers and stopped `aios-macos-noshare`. The retained
`macos/final-machine-state.json` records this stopped state. Start that dedicated
VM explicitly before repeating probes; boot/image/runtime drift still requires
fresh matching observations. All state, stopped synthetic containers and revoked
worker records are preserved.
