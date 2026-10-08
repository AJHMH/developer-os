# THROWAWAY: synthetic guest-file, network, peer and process-stop probes.
# Run in Administrator PowerShell with aios-podman-noshare running.
$ErrorActionPreference = 'Stop'
$env:Path = 'C:\Program Files\Git\usr\bin;' + $env:Path
$guestProbe = @'
set -eu
image=docker.io/library/alpine@sha256:3e9b4b680bfc9fb5269227cffbd6d42be39fbf7c0b908123913864aa4447e764
suffix=$(date +%s)
peer=aios-peer-$suffix
worker=aios-denial-$suffix
life=aios-stop-$suffix
scratch=$(mktemp -d /tmp/aios-prototype.XXXXXX)
printf 'SYNTHETIC-NOT-A-CREDENTIAL\n' > "$scratch/authority-canary"
printf 'PEER-SYNTHETIC\n' > "$scratch/peer-canary"
podman run -d --name "$peer" --pull=never --network=none --read-only --cap-drop=ALL --security-opt=no-new-privileges --user=65534:65534 -v "$scratch/peer-canary:/peer-canary:ro,Z" "$image" sleep 600 >/dev/null
echo "WORKER=$worker PEER=$peer"
podman run -i --name "$worker" --pull=never --network=none --read-only --cap-drop=ALL --security-opt=no-new-privileges --user=65534:65534 "$image" sh -s -- "$scratch/authority-canary" <<'PROBE'
id
for path in "$1" /peer-canary /run/user/1000/podman/podman.sock /var/run/docker.sock /mnt/c /Users/mraar; do
 if cat "$path" >/dev/null 2>&1; then echo "FAIL readable:$path"; else echo "DENIED read:$path"; fi
done
if wget -T 3 -O /dev/null http://192.168.127.1:80 >/dev/null 2>&1; then echo 'FAIL gateway-connect'; else echo 'FAILED-ATTEMPT gateway-connect (service availability unverified)'; fi
if wget -T 3 -O /dev/null http://1.1.1.1:80 >/dev/null 2>&1; then echo 'FAIL external-connect'; else echo 'FAILED-ATTEMPT external-connect (service availability unverified)'; fi
if touch /etc/aios-write-canary 2>/dev/null; then echo 'FAIL rootfs-write'; else echo 'DENIED rootfs-write'; fi
ip address
ip route
PROBE
podman run -d --name "$life" --pull=never --network=none --read-only --cap-drop=ALL --security-opt=no-new-privileges --user=65534:65534 "$image" sh -c 'sleep 600 & wait' >/dev/null
sleep 1
podman top "$life" hpid > "$scratch/pids"
cat "$scratch/pids"
awk 'NR>1 {print $1}' "$scratch/pids" > "$scratch/pid-list"
while read -r pid; do cat "/proc/$pid/stat" > "$scratch/stat-$pid"; done < "$scratch/pid-list"
podman stop --time 2 "$life"
while read -r pid; do
 if test ! -e "/proc/$pid/stat"; then echo "GONE pid:$pid";
 else
  before=$(awk '{print $22}' "$scratch/stat-$pid")
  after=$(awk '{print $22}' "/proc/$pid/stat")
  if test "$before" != "$after"; then echo "GONE original-pid:$pid reused"; else echo "UNPROVEN process-still-present:$pid"; fi
 fi
done < "$scratch/pid-list"
podman stop --time 2 "$peer"
echo "RETAINED synthetic scratch:$scratch containers:$worker,$peer,$life"
'@
$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($guestProbe.Replace("`r",'')))
podman machine ssh aios-podman-noshare "printf '%s' '$encoded' | base64 -d | sh"
if ($LASTEXITCODE -ne 0) { Write-Warning 'Probe incomplete. Retain output and inspect running named canaries; partial output is not a pass.' }
