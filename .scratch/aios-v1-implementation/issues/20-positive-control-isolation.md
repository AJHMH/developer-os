# 20: Prove forbidden access with positive controls

**What to build:** Deliver reproducible qualification reports for synthetic Windows-host files, controller authority, MCP services, guest management sockets, peer-delivery files and live network services. Controls establish canary existence/reachability before worker denial and remain valid afterward. Include stronger cross-delivery/escape attempts and explicit failed/unknown/not-run results; version drift invalidates results. Do not claim exhaustive escape resistance or use real owner credentials. Demonstrate refusals through the public controller gate.

**Blocked by:** 19.

**Status:** completed

## Parent and governing contract

Supports open parent ticket [04](04-isolated-worker-gate.md), governed by the [canonical specification](../../aios-feature-delivery/spec.md) and owner-approved runtime/scope revision. Use the approved public-controller command/observation testing seam. Readiness describes specified work, not production qualification. No implicit weaker-runtime fallback or paid inference is authorized.

## Acceptance criteria

- [x] Reproducible synthetic host-file, authority, MCP-service, management-socket, peer-delivery and network canaries establish positive controls before and after worker denial.
- [x] Stronger cross-delivery and escape attempts report passed, failed, unknown or not-run honestly; invalid controls cannot establish denial.
- [x] The public gate rejects missing/failed evidence and version drift; probes use no real owner credentials and make no exhaustive escape-resistance claim.

## 10 October native Windows observation

The public controller recorded six passed synthetic access probes with management positive controls before and after; four bounded escape attempts passed. The first attempt used the wrong host address, and later attempts exposed a missing chroot command link and permitted user-namespace creation. Historical reports are retained. The corrected probe validates the BusyBox applet and the worker uses the VM default errno seccomp profile with unshare/setns removed from every allow rule; management verifies active seccomp filtering. Fresh version-bound enrollment invalidates earlier pins. [Final evidence](../ticket20-native-isolation.json) and [runner](../podman-isolation-acceptance.mjs) cover only these synthetic Windows controls. Production readiness remains false; this is no exhaustive escape-resistance claim.

The [live version-drift observation](../ticket20-native-policy-drift.json) confirms earlier policy pins cannot admit or dispatch the tightened worker through the public controller.
