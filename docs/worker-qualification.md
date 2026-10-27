# Offline general-worker qualification (Issue 04)

`scripts/run-native-worker-qualification.mjs` is an owner-run, offline,
adversarial check of both general workers on one host's dedicated VM. It runs
under the owner's coding and validation admission records. It opens no
credentials, authorizes no inference and never enables production. A passing
report is evidence for the owner to judge, not a qualification decision.

## What it checks

| Issue 04 criterion | Coding worker | Validation worker |
|---|---|---|
| 1. Changed pins refuse | Each changed pin is refused by the pinned runtime | Same |
| 2. Only admitted files enter | The boundary probe, run in a live session | The boundary probe, one check per probe |
| 3. No host shares, sockets, management or network | Same probe | Same probe |
| 5. Lifecycle controls | A detached descendant removed by the exact session stop | Descendants killed at the guest deadline; a stop mid-check; a late check fenced; a changed tree never reported as tested |
| 6. Retained results | Every stage and probe, failed ones included | Same |

The **boundary probe** (`src/worker-probes.ts`) is one fixed line of shell. It
uses only the busybox tools of the pinned Alpine images and first proves each
tool exists, so a missing tool fails instead of passing. It checks:
- **Positive control:** the admitted file is visible, and it is the
  workspace's only entry, so there is no `.git` or other content.
- **Excluded content:**
  - no owner home or guest-private management state;
  - no `.ssh`, `.gnupg`, `.gitconfig`, `gh` config, `.netrc` or `.aws` in the
    worker's home;
  - in the worker's home: no MCP servers in `config.toml`; no `hooks.json`,
    `rules` or `AGENTS.md`; and a `skills` folder only if its sole entry is
    `.system`, Codex's own bundled skills, which it regenerates on every
    start;
  - no engine or management sockets;
  - no credential variables.
- **Mounts and network:** no host-share mounts, loopback-only networking, and
  no outbound connection, the npm registry included. The registry check uses
  plain HTTP, so a missing TLS client can't make it pass.
- **Hardening:** the root mount is read-only by its own mount options, and the
  user is 65534.
- **Escapes:** `unshare`, `chroot` and cgroup escapes are refused.

Adding the probe changed the coding guest program, so its `policySha256`
changed. Each host's owner coding admission therefore needs one re-approval
before this runs.

The coding worker runs the **coding probe**: the shared probes, then five of
its own. Its third argument is the session's mode, `routed` or `offline`,
which the guest takes from the session's own record and the caller never
chooses.
- **`relay-listener`:** a routed worker has exactly one listening socket, the
  session relay on 127.0.0.1:18091. An offline worker has none. Neither has an
  IPv6 listener.
- **`relay-answers`:** a routed worker's GET to the relay gets the relay's
  empty 403. That shows the route is reachable, without reaching the gateway
  or counting a request. It is tried up to three times, five seconds each,
  because the relay serves one request at a time. An offline worker's
  connection must be refused, since any HTTP answer would mean something is
  listening.
- **`read-only-binaries`:** `/codex` and `/codex-code-mode-host` are mounted
  read-only, according to `/proc/self/mountinfo`, and refuse writes. The mount
  is the real check: a running executable refuses writes anyway, and the
  container user owns the files.
- **`hardened-process`:** the process has no effective capabilities, has
  `NoNewPrivs` set, and runs under a seccomp filter.
- **`writable-only-work`:** a file can be created, then removed, in
  `/workspace` and `/session`. Writes to `/`, `/etc`, `/usr`, `/bin`, `/lib`,
  `/root`, `/home`, `/opt`, `/var`, `/srv`, `/etc/hosts`, `/etc/hostname` and
  `/etc/resolv.conf` are refused.

  Podman's in-memory tmpfs mounts (`/tmp`, `/var/tmp`, `/run` and
  `/dev/shm`) stay writable. They are private to the container and gone when
  it stops, and bootstrap needs `/tmp/launch`. The guest separately pins the
  container's bind mounts to exactly four.

  Codex runs with `danger-full-access`, so these are the container's own
  limits, whatever Codex's sandbox would allow. The probe runs as the
  container user, the same identity Codex has.

The coding guest runs the probe inside the exact live session. It passes the
session's own management record as the private path, confirming first that the
record exists. The probe is part of the coding guest program, so it is covered
by the coding `policySha256`.

Validation runs the probe as checks, which return only an exit code. Each check
therefore passes only when its own probe's line reads `passed-`. Validation's
private path is the guest's validation state directory. The validation guest
cannot confirm that path to the check, so the owner-home probe is the stronger
evidence there.

## Provisioning the code-mode host

The coding worker needs the code-mode host beside its CLI (ADR 0002
amendment). It comes from the same official package as the pinned CLI. The
guest refuses to inspect, prepare or launch unless the file is in VM
management storage, private to the guest user, and matches its pin:

| Host | Package | `codex-code-mode-host` SHA-256 |
|---|---|---|
| macOS | `@openai/codex@0.161.0-linux-arm64` | `64efe2950af9d8ac9e9b94b0aac5e41f56307422e34e66a4217aaea0a221fed0` |
| Windows | `@openai/codex@0.161.0-linux-x64` | `e87096087c02aa6ab90a5a85031659665aa0bf3ee20c07ca0b8ab701c83fcd5b` |

Run each block in one terminal, in order. The copy uses a relative path from
the folder the first line moves into, so a drive letter is never read as a
machine name. The last command prints the guest's hash, which must match the
table.

macOS (zsh), with the VM running:

```sh
D=$(mktemp -d) && cd "$D" && npm pack --ignore-scripts @openai/codex@0.161.0-linux-arm64 && tar -xzf openai-codex-0.161.0-linux-arm64.tgz && shasum -a 256 package/vendor/aarch64-unknown-linux-musl/bin/codex-code-mode-host
/opt/podman/bin/podman machine cp package/vendor/aarch64-unknown-linux-musl/bin/codex-code-mode-host aios-macos-noshare:/var/home/core/.local/state/aios-offline-v1/codex-code-mode-host-0.161.0
/opt/podman/bin/podman machine ssh aios-macos-noshare 'chmod 600 ~/.local/state/aios-offline-v1/codex-code-mode-host-0.161.0 && sha256sum ~/.local/state/aios-offline-v1/codex-code-mode-host-0.161.0'
```

Windows (PowerShell, not elevated):

```powershell
$d = New-Item -ItemType Directory -Path (Join-Path $env:TEMP ("codex-host-" + [guid]::NewGuid())); Set-Location $d; npm pack --ignore-scripts "@openai/codex@0.161.0-linux-x64"; tar -xzf openai-codex-0.161.0-linux-x64.tgz; Get-FileHash -Algorithm SHA256 package/vendor/x86_64-unknown-linux-musl/bin/codex-code-mode-host
podman machine cp package/vendor/x86_64-unknown-linux-musl/bin/codex-code-mode-host aios-podman-noshare:/var/home/core/.local/state/aios-offline-v1/codex-code-mode-host-0.161.0
podman machine ssh aios-podman-noshare 'chmod 600 ~/.local/state/aios-offline-v1/codex-code-mode-host-0.161.0 && sha256sum ~/.local/state/aios-offline-v1/codex-code-mode-host-0.161.0'
```

Both owner coding admission records then need re-approval. The new pin
`codeModeHostSha256` is part of the record, and the coding guest program,
and with it `policySha256`, changed.

## Running it

Both owner records must name their workers' fresh pins. If either does not, the
run stops before any worker starts and prints `freshPins` for both. Like every
native runner, it first refuses unless `dist/` is exactly what `src/` compiles
to. It takes a few minutes.

macOS (zsh), from a clean, built checkout with the VM running:

```sh
node scripts/run-native-acceptance.mjs "$HOME/.developer-os/ticket4-macos/state" scripts/run-native-worker-qualification.mjs -- aios-macos-noshare "$HOME/.developer-os/admission/coding-admission.json" "$HOME/.developer-os/admission/validation-admission.json" 171e65262c8018f8f09a360006af2acbb2c0c494cb2be933025b466ea3d672dc "$HOME/.developer-os/issue04-worker-qualification-$(date +%Y%m%d-%H%M%S).json" --approve-offline-native-run
```

Windows (PowerShell, not elevated — Command Prompt never runs the `;` chain):

```powershell
npm ci --ignore-scripts; npm run build; $image = podman --connection aios-podman-noshare image inspect --format "{{.Id}}" docker.io/library/alpine@sha256:3e9b4b680bfc9fb5269227cffbd6d42be39fbf7c0b908123913864aa4447e764; node scripts/run-native-acceptance.mjs "C:/Users/mraar/.developer-os/ticket19-native/state" scripts/run-native-worker-qualification.mjs -- aios-podman-noshare "C:/Users/mraar/.developer-os/admission/coding-admission.json" "C:/Users/mraar/.developer-os/admission/validation-admission.json" $image "C:/Users/mraar/.developer-os/issue04-worker-qualification-$(Get-Date -Format yyyyMMdd-HHmmss).json" --approve-offline-native-run
```

## Limits

These are not covered here:
- recovery and safe import;
- coding fencing, beyond what the session acceptance already showed;
- the workers' full effective configuration, which is not kept in the report.
  The guests verify it at each effect.

Some results are weaker than they look:
- The validation private path cannot be confirmed by the validation guest.
- `escape-unshare` would pass if busybox `unshare` rejected the `-r` option
  rather than the namespace. The `tools` probe proves the applet exists, not
  the option.
- The coding `probe-boundary` action is not limited to qualification. It
  exists only on the live transport, and production stays disabled.

## Outcomes

- **`observed-offline-worker-qualification`:** every probe passed and every
  lifecycle control held.
- **`failed`:** every stage ran, but at least one probe failed. They are listed
  in `failedProbes` as `worker:probe`, and the full report is kept as
  evidence.
- **`blocked`:** a record, a pin or a lifecycle control refused, at the stage
  named in the report. Later stages are listed as `not-run`. Any coding session
  that was started is stopped.
- **`uncertain`:** the coding session could not be confirmed stopped. Recover
  it before any other run.

The report also records:
- the source revision and the build's digests;
- the probe's own digest;
- both workers' pins;
- every stage's timing.

Production delivery stays disabled either way.

## Routed session acceptance

`scripts/run-native-routed-acceptance.mjs` is the plan's slice 3 native
check of a routed coding session, offline and without inference. It runs one
lineage on the dedicated VM, a launch and then an explicit resume, under the
owner's coding admission record. The record must name the fresh pins, as for
the qualification above.

Each turn is routed, with the same route a credentialed turn will use:
- Codex reaches the model only through the session relay on 127.0.0.1:18091.
- The relay reaches only the real `GeneralSessionGateway` on the host.
- The gateway reaches only a **fake provider** on the host. It sends no
  network request and never uses the token it is given, which is synthetic.

The fake provider answers with fixed code-mode scripts, in this order:
- **Keep-alive scripts:** a five-second `sleep`, until the launch has been
  probed (at most 24). A resume has none.
- **Work script:** a script that adds `routed-<turn>.txt` through
  `apply_patch`, reads it back through `exec_command`, and reports a marker
  that only a successful read produces.
- **Final message:** then the turn ends, and Codex exits on its own.

During the launch, between model requests and before the turn's edit, the
coding boundary probe runs in the routed session:
- The routed `relay-listener` and `relay-answers` controls show exactly one
  listener, the relay, and that it answers.
- `only-admitted` still sees the workspace exactly as admitted. Codex's own
  edit comes after the probe, so it can't fail that control.

Every turn must:
- report one thread, the resume continuing the launch's;
- exit 0;
- show the marker, with no gateway refusal;
- end its grant with the turn, so a later use is refused as `revoked`;
- stop exactly;
- leave its edit in the collected workspace.

Each turn gets a fresh relay capability. The lineage keeps one delivery and
mediation decision. The report keeps counts and fixed labels only, never
request or response content.

No guest code changed, so existing coding records stay valid.

macOS (zsh), from a clean, built checkout with the VM running:

```sh
node scripts/run-native-acceptance.mjs "$HOME/.developer-os/ticket4-macos/state" scripts/run-native-routed-acceptance.mjs -- aios-macos-noshare "$HOME/.developer-os/admission/coding-admission.json" "$HOME/.developer-os/issue04-routed-acceptance-$(date +%Y%m%d-%H%M%S).json" --approve-offline-native-run
```

Windows (PowerShell, not elevated):

```powershell
npm ci --ignore-scripts; npm run build; node scripts/run-native-acceptance.mjs "C:/Users/mraar/.developer-os/ticket19-native/state" scripts/run-native-routed-acceptance.mjs -- aios-podman-noshare "C:/Users/mraar/.developer-os/admission/coding-admission.json" "C:/Users/mraar/.developer-os/issue04-routed-acceptance-$(Get-Date -Format yyyyMMdd-HHmmss).json" --approve-offline-native-run
```

Outcomes:
- **`observed-offline-routed-acceptance`:** every stage passed and every
  probe passed.
- **`failed`:** every stage ran, but a probe failed. The failed probes are
  listed in `failedProbes`.
- **`blocked`:** at the stage named in the report. Later stages are listed as
  `not-run`.
- **`uncertain`:** a session could not be confirmed stopped.

A record that doesn't match prints `freshPins`.

Limits:
- No real provider is involved. A real reply's size, timing and events are
  for slice 5.
- The fake provider's scripts assume code mode's `tools.apply_patch` and
  `tools.exec_command`, as captured. A Codex that yields a script back to the
  model, or calls tools differently, shows up as `unexpected` requests or a
  missing marker.
- The guest doesn't compare a predecessor's route with a resume's. Whether it
  must keep the same delivery and decision is still the owner's decision
  (route continuity, 3a receipt).
