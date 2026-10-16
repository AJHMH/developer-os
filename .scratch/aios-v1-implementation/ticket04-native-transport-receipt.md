# Issue 04: offline native worker transport

Date: 16 October 2026. Branch: `codex/ticket04-native-worker-transport`.
Starting main: `18e3a9cf6b0acbc13eeb6b453cf9a880f2f4de4a` (merged PR #45).
All 24 active main checks passed before this work; conditional certification was
skipped. Owner snapshot files remain outside the change.

## Implemented scope

`NativePodmanCodingTransport` implements the existing isolated transport interface
with an immutable `live` identity and `productionEnabled: false`. The controlled
pinned runtime rejects it; no CLI/controller production adapter is installed.
There is no host/shared-runtime fallback, owner credential import, gateway
extension, provider request or reuse of historical inference approval.

The transport uses the existing supported native Podman executable/configuration
admission for Windows Hyper-V and macOS AppleHV. Each management observation binds
host executable/client/configuration, host/provider, dedicated VM image/identity,
rootless engine, cached architecture-specific image, official Linux Codex 0.161.0
artifact and management policy source. Guest shared mounts and unrelated running
containers refuse observation. Expected pins are checked around launch effects.

A first launch transfers JSON/base64 data over management SSH to a fixed Python
program. Candidate text never becomes host/guest command source. Only ordinary
admitted paths enter a fresh guest-private workspace: at most 1,000 files,
256 KiB each and 1 MiB total. The separate Codex home starts empty. The worker sees
only that workspace/home and a read-only copy of the pinned Codex binary; it sees
no management record, engine socket, owner home or host bind. These new,
guest-private mounts require their own native qualification.

The worker has deny-all networking, a read-only root, no capabilities, no new
privileges, private PID/IPC namespaces, a seccomp policy excluding `unshare` and
`setns`, and bounded memory/process count. A trusted bootstrap waits while
management checks effective configuration and original-process privileges.
Current controller authority is checked again before releasing the launch.
Management installs an independent fixed deadline and a shorter renewed systemd
lease before releasing Codex. Their actual native behavior remains unqualified;
missing timer support refuses release. Lock ownership is bounded to management
commands, not the whole coding run, so another manager can fence/stop the session.

Durable operation/fence revocation precedes shutdown and also fences a delayed
first dispatch. Shutdown inspects the authority-labelled container and independently
checks cgroup members plus retained PID/start identities. Any uncertainty refuses
collection. Recovery uses the same operation/fence even when caller state changes;
it never repeats execution or automatically imports output.

Collection reads only after shutdown, using no-follow descriptors, ordinary-file
and single-link checks, bounded bytes, safe names and repeated identical scans.
Pins are refreshed before/after collection. Unsafe/changed output is refused and
the private workspace remains for diagnosis. Output streaming is bounded to
64 KiB and refuses changed prefixes, malformed observations and authority drift.

## Verification

TDD began with missing native transport/inspection/launch tests, which failed
before their implementations. Public transport tests replace external OS,
filesystem and child-process observations. A POSIX Linux/Podman simulator also
executes the actual transported Python program against real temporary ordinary
files; it replaces external engine/process/systemd observations and the synthetic
artifact digest. It does not execute Codex or prove a real VM control.

The simulator checks first launch, retained work, stable collection, durable
pre-dispatch revocation, changed effective networking, missing lease support,
linked output and an independently observed orphan/recovery. Host/process tests
exercise both supported host descriptions, unsupported input, mutation/revocation,
pin drift, malformed output and uncertain shutdown. POSIX guest simulation is
explicitly skipped on Windows; Windows/macOS native qualification stays open.

Final validation and review results are recorded below before PR publication.

## Remaining production gates

Issue 04 remains `ready-for-agent`, not completed. Explicit native thread resume
and base refresh deliberately refuse. General model-only access and fresh usage
approval, exhaustion/preservation/restart authority, controlled dependency phases,
controller integration, bounded writable storage, and independent Windows/macOS
adversarial effective-mount/network/timer/descendant/crash qualification remain
unfinished. The new offline transport cannot broaden the fixed-worker gateway or
inherit fixed-worker receipts. Production dispatch remains disabled.

Implementation references: [transport](../../src/podman-coding.ts),
[public regressions](../../tests/worker-native-coding.test.mjs), and
[external guest simulator](../../tests/helpers/native-coding-guest.py).

The private guest workspace follows the approved ordinary-file/dedicated-VM
contract. Podman documents explicit bind mounts and user namespace mapping in
[its run reference](https://docs.podman.io/en/v6.1.3/markdown/podman-run.1.html).
The management timer design uses systemd's relative activation timers; see the
[upstream timer contract](https://github.com/systemd/systemd/blob/main/man/systemd.timer.xml).
These references establish intended mechanisms, not observed native qualification.
