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
  no outbound connection.
- **Hardening:** the root mount is read-only by its own mount options, and the
  user is 65534.
- **Escapes:** `unshare`, `chroot` and cgroup escapes are refused.

Adding the probe changed the coding guest program, so its `policySha256`
changed. Each host's owner coding admission therefore needs one re-approval
before this runs.

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
