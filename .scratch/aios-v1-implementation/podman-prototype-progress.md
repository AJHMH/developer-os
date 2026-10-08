# Podman Hyper-V prototype progress — 7 October 2026

Question: can a dedicated Podman Hyper-V VM meet ticket #4 host-authority isolation without Docker's automatic MCP gateway?

Actual progress: Podman 6.0.2 located at the user's LocalAppData Programs/Podman/podman.exe; persistent PATH in this Codex session was stale. Local machine-init help revealed default mounts for the user home, C: drive, and host containers configuration. Task-local CONTAINERS_CONF sets [machine] volumes=[]; no persistent configuration was edited. Existing Git OpenSSH binaries supplied only on the task process PATH, because Windows OpenSSH ssh-keygen was unavailable.

Invoked: machine init --provider hyperv --cpus 2 --memory 2048 --disk-size 10 --update-connection=false aios-podman-prototype. Official machine-os:6.0 image downloaded; reported blob sha256:da93bca1729d37a57411f8987edb69f5ef6f7a8c036ecebc3772126d84358630. This blob is not claimed to be a verified VM image/manifest pin. Podman returned Machine init complete.

Next command, machine inspect, failed with: account added to Hyper-V Administrators, active session requires log out/log in or Administrator execution. This group modification was performed by Podman initialization, not an explicit group-edit command. No VM start was issued. Effective absence of mounts is not yet observed, so no isolation acceptance criterion passes on this evidence.

Blocked pending refreshed Windows login session (and restart of Codex so its token refreshes). Then inspect named VM before start; verify Hyper-V provider and empty effective host shares; only afterward perform credential-free guest canaries. No owner keys read, model credentials imported, model inference or repository mounting performed. Lifecycle, network, MCP, file and cross-delivery denial tests remain unrun.

Prototype files: podman-hyperv-prototype.ps1, podman-prototype-containers.conf. These are deliberately throwaway live probes, rather than an HTML simulation, because the user's question requires external-system evidence. Initialization script is not idempotent: do not rerun after successful creation; resume by inspecting the existing named VM.
