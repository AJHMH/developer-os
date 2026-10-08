# THROWAWAY: initialize a no-share Hyper-V VM; inspect before any guest workload.
# Run from repo root in Administrator PowerShell:
# powershell -File .scratch/aios-v1-implementation/podman-hyperv-prototype.ps1
$ErrorActionPreference = 'Stop'
$prototypeRoot = $PSScriptRoot
$podmanExecutable = Join-Path $env:LOCALAPPDATA 'Programs\Podman\podman.exe'
$prototypeOldPath = $env:PATH
$prototypeOldConfig = $env:CONTAINERS_CONF
try {
  $env:PATH = 'C:\Program Files\Git\usr\bin;' + $env:PATH
  $env:CONTAINERS_CONF = Join-Path $prototypeRoot 'podman-prototype-containers.conf'
  & $podmanExecutable machine list
  & $podmanExecutable machine init --provider hyperv --cpus 2 --memory 2048 --disk-size 10 --update-connection=false aios-podman-prototype
  if ($LASTEXITCODE -ne 0) { throw 'VM creation failed; no guest tests performed.' }
  & $podmanExecutable machine inspect aios-podman-prototype
  Write-Output 'Do not start guest work until effective host mounts and provider are verified.'
} finally {
  $env:PATH = $prototypeOldPath
  $env:CONTAINERS_CONF = $prototypeOldConfig
}
