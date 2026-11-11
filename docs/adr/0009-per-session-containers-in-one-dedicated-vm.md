# One dedicated VM, a container per session

Status: accepted (2026-11-10)

User story 51 asks for "a dedicated VM boundary for each delivery", so that
another delivery can't inherit its files, credentials or management authority.
The Mac runs one dedicated Podman VM, `aios-macos-noshare`, for every
delivery. Each coding session and each validation attempt runs in its own
container inside that VM. The owner decided that this meets story 51, rather
than creating and removing a VM per delivery.

What keeps deliveries apart:

- **Per-session folders.** A coding container mounts exactly three things:
  its own session's workspace and home, and the read-only Claude Code binary.
  The pinned guest program trusts a container only when it has exactly those
  mounts, at exactly those sources, and refuses a container that also mounts,
  or mounts instead, another session's folder.
- **No shared runtime.** Containers run with `--network=none`, private PID and
  IPC namespaces, no capabilities, `no-new-privileges`, a pinned seccomp
  profile, a read-only root and an unprivileged user. The boundary probe checks
  these from inside a live session.
- **No credentials in the VM.** The owner's Anthropic key stays in the Mac's
  Keychain and gateway. A routed session holds only its own relay
  capability.
- **One delivery per repository at a time,** under the controller's ownership
  fence.

## Consequences

- The VM's own management authority (the guest program and Podman) is shared
  by every delivery. That's why it's pinned by digest and admitted by the
  owner's records, and why qualification is rerun whenever it changes.
- A VM per delivery remains possible later. It would need its own provisioning,
  qualification and cleanup, and it would make every delivery slower to start.
