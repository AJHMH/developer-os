# Synthetic preparation blocked by host identity drift

The diagnostics were signed and committed in `e229d8a` after loading the existing SSH key using the saved macOS Keychain passphrase. No key/passphrase material was retained. No live inference was executed.

Fresh preparation refused in the native observe binding equality check. A bounded diagnostic reported only `hostId` differs from the v2 external policy; all other binding fields match. No running rootless/rootful containers were present. Engine and VM management connectivity worked. The current identity formula matches the native implementation; client version remains 6.1.1. Alternate configured Mac hostname variants did not reproduce the old hash with the current VM UUID.

Guest uptime places the latest boot at 2026-10-11T18:01:38Z (1:01 p.m. America/Chicago), after the previous successful receipt. Podman's machine LastUp metadata still reported an earlier time, so it was not reliable boot-continuity evidence. The installed vfkit is v0.6.4. Its [Linux platform implementation](https://github.com/crc-org/vfkit/blob/v0.6.4/pkg/vf/vm.go#L113) creates a new generic machine identifier when constructing a VM; the macOS guest path instead loads its persisted identifier. The native hostId includes the guest product UUID, along with hostname, executable hash and client version.

Inference: restarting this Linux VM regenerates the UUID input and invalidates the hostId pin. This explains the observed isolated hostId drift, but the previous raw UUID/hostname inputs were not retained, so a direct historical component comparison cannot be made. No restart was performed as part of this investigation.

Candidate policy is `ticket21-native-pin-candidate.json`, SHA-256 `8a33daa5fae7722ec7ad04d541f72cf3c713b87f37656b4224e633947849c594`. It is a review artifact only, not independent authority. Existing v2 external pins remain intact. Owner approval is required to adopt it in a new external v3 file and run synthetic qualification. Current admission remains refused. The earlier saved inference plan is consumed and stale; it must never be used again.

## Authorized v3 adoption and preparation

The owner authorized the exact candidate SHA above. It was written exclusively
with mode 0600 to the external `pins-ticket21-gateway-v3.json`; v2 was retained.
Fresh native synthetic qualification passed against the current identity and
diagnostics. Prepared run `208706f5-a6bd-49e1-9c33-5b6aa813d112` is unapproved
for live inference. See `ticket21-gateway-inference-plan.json` and
`ticket21-gateway-observation.json`. No Keychain reads or subscription requests
were performed during preparation. Production delivery remains disabled.
