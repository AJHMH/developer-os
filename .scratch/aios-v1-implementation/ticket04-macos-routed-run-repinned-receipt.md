# Issue 04: macOS routed run on the re-pinned guests

7 to 8 November 2026; times weren't recorded. macOS arm64, AppleHV VM
`aios-macos-noshare`, checkout `~/Repos/developer-os` at `main` `af68d52`. The
owner ran every command and pasted its output. Production remains disabled.

## Why

Slice 1 of the [plan](plan-04-native-coding-integration.md) needs native
evidence of a routed repair turn, which `scripts/run-native-routed-delivery.mjs`
records after a routed candidate fails validation (PR 212). The run also
exercised the coding guest `89f2db60…` on a real VM for the first time since
the owner re-pinned both hosts to it (the
[Windows cleanup receipt](ticket04-windows-container-cleanup-receipt.md)).

## Setup

- `git pull --ff-only` left `main` at `af68d52`, with a clean tree.
  `npm ci --ignore-scripts` and `npm run build` passed.
- `podman machine list` showed `aios-macos-noshare` running.
- The only delivery holding a repository in the acceptance state was
  `29727630-9a13-4050-a217-7a554b04448e`, phase `blocked`, key
  `path:…/ticket4-macos/input`. Routed runs use another key,
  `github:ajhmh/acceptance-page`, so it was left alone.
- The fixed worker's pins were `pins-routed-20261104e.json`, SHA-256
  `b72332dc…`, the file the
  [restart proof](ticket04-stable-vm-identity-receipt.md) enrolled.

## Sign-in renewal

`auth-status` for the saved account (`397124…`) reported `sign-in-required` and
`expired: true`, with the scopes and plan usage still present.

| Attempt | Result                                                                                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| First   | Refused at token exchange: `HTTP 400, invalid_grant`. The command reported that the existing credentials stayed unchanged.           |
| Second  | `authorized`, the same account, `credentialsStored: true` in macOS Keychain, `planUsageAuthorized: true`, `deliveryEnabled: false`. |

`auth-status` then reported `eligible` and `validForInferenceWindow: true`. The
cause of the first refusal wasn't found.

## A refused prepare: stale offline pins

The first `prepare` was refused: "The fixed worker's gateway evidence has not
passed for this delivery". Its delivery, `299292ac-a081-4a85-b0df-b3063770bc57`,
recorded `offlineAdmission.allowed: false` with refusal `observation`, no
binding, `hostGateway: passed`, and `gatewayIntegration` and
`endpointEnforcement` both `not-run`. Offline admission refused before the
adversarial probe ran.

The cause: the offline pins' `policyVersion` hashes the VM management program,
through `vmManagementVersion` in `src/vm-management.ts`. PR 198, merged on 5
November after those pins were enrolled, changed that program, and said nothing
about the pins.

`pin-offline` into a new file, `pins-routed-20261107a.json`, and a `diff` of the
two bindings:

| Key             | `…20261104e.json`        | `…20261107a.json`        |
| --------------- | ------------------------ | ------------------------ |
| `policyVersion` | `offline-native-v3-c799…` | `offline-native-v3-d3bf…` |
| every other key | unchanged                | unchanged                |

`hostId` stayed `e3398757…`, `vmImageSha256` `8d2892de…`, and `engineVersion`
`6.1.3`, so the VM, Podman and the host were unchanged. The owner then released
`299292ac…`; the next `prepare` got past `plan-feature`, which it can't while
another delivery holds the repository.

## Routed run

Session folder `…/ticket4-macos/aios-routed-delivery-NQZNtO`, delivery
`83a45bd3-e9f2-40c2-bf9c-cb2004b2baa7`, with the new pins.

| Phase     | Result                                                                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `prepare` | `prepared`; decision run `6f85e218-ecd5-472d-92db-c3b987dbf434`. Nothing live sent.                                                            |
| `decide`  | `decided`; one live request. Usage account `6457347b…`, the account the earlier run `aios-routed-delivery-cksBEC` endorsed.                    |
| `route`   | `routed`; routed run `a696a4ec-44cb-44f9-87fc-9761069e8a4c`, 1 turn. Nothing live sent.                                                        |
| `code`    | `observed-routed-validated-candidate`: coding `admitted`, `stopped`, routed, thread started, a candidate on `codex/feature-83a45bd3-…`, blocker `DELIVERY_NOT_ENABLED`; candidate validation `passed`. |

The coding turn ran under the owner's coding record at `89f2db60…`, and
validation under `585cd02c…`. The owner then released `83a45bd3…`.

## What it shows

- A routed `code-feature` turn on the coding guest `89f2db60…` produced a
  candidate that passed validation on the Mac VM. This is that guest's first
  real-VM run.
- The fixed worker's offline pins re-pinned after PR 198 pass qualification,
  including the gateway evidence.
- A returning sign-in works on this host.

## Not covered

- **Slice 1's repair evidence.** The candidate passed, so there was nothing to
  repair, and `plan-repair` would refuse. It needs a routed candidate that fails
  validation.
- **Windows.** Its offline pins also predate PR 198, and the
  [restart proof](ticket04-stable-vm-identity-receipt.md) already said they need
  a new `pin-offline`.
- **The coding acceptances** (`scripts/run-native-coding-acceptance.mjs`) under
  the new coding pin weren't rerun on either host; only this routed turn ran.
- The number of model requests in the routed turn, and the usage it spent,
  weren't recorded.

Production remains disabled.
