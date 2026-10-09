# Owner setup for the Podman feasibility prototype

Scope: prepare this Windows PC for a dedicated Hyper-V prototype. Installation does not qualify Podman or replace the approved ticket #4 runtime. Docker support case 00239659 remains open.

1. Check Windows edition in Settings > System > About. Use Windows 11 Pro or Enterprise for the documented Hyper-V route. If this PC is Home, report that before continuing; do not switch to WSL or upgrade Windows just for this test.
2. Open PowerShell as Administrator. Inspect the full Hyper-V feature:

```powershell
Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All
```

If Disabled, enable it with the documented command, save open work, and restart when requested:

```powershell
Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All
```

After reboot, verify:

```powershell
Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All
Get-Service vmcompute
```

Windows Hypervisor Platform previously enabled for Docker is a different feature from full Hyper-V.

3. Install the Windows x64 Podman CLI from the official Podman installation page: https://podman.io/docs/installation . Select Hyper-V if the installer offers a provider choice. Podman Desktop is optional; if using its onboarding, install the engine and stop before automatic machine creation. Skip Kubernetes, Compose, Docker compatibility changes and extensions for this prototype. Leave Docker installed.
4. Open a fresh PowerShell window and run:

```powershell
podman --version
podman machine list
```

Send the version, Hyper-V feature state, vmcompute status, Windows edition, and whether any machines already exist. Report command errors as they appear. No credentials are needed.

Stop here: do not create a default Podman machine, mount a repository/home/keystore, or import Codex/Docker credentials. The controller-side prototype will create its own disposable VM with inspected host sharing, copied synthetic files, and explicit networking restrictions. The first pass uses no model inference. Any required elevation for VM creation will be handled when the concrete command is ready.

Agent work after setup: verify the selected provider/version; configure and inspect absence of host shares and authority sockets; test host-file/MCP/network/cross-delivery denial; verify stop/restart behavior; retain evidence. Model authentication mediation is a separate later test. macOS qualification is independent.

Sources checked 7 October 2026:
- https://podman-desktop.io/docs/installation/windows-install#use-hyper-v-as-machine-provider
- https://podman.io/docs/installation
- https://docs.podman.io/en/stable/markdown/podman-machine-init.1.html
