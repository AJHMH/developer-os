// Credential-free public host diagnostic. One probe, no automatic retry.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { NativePodmanDriver } from "../../dist/podman-native.js";
const native = new NativePodmanDriver(
  "aios-podman-noshare",
  "C:/Users/mraar/.developer-os/ticket19-native/state",
  "C:/Users/mraar/.developer-os/ticket19-native/pins-windows-ticket24-resume-allocator-20261012.json",
);
const evidence = await native.probeIsolation(
  "C:/Users/mraar/.developer-os/ticket19-native/repo",
  "46f3cefb-57e3-48fa-be4f-24fae4b37505",
);
writeFileSync(
  new URL("ticket24-windows-main-1b5b545-probe-resume-allocator.json", import.meta.url),
  JSON.stringify({ observedAt: new Date().toISOString(), evidence }, null, 2) + "\n",
  { flag: "wx" },
);
console.log(JSON.stringify({ blockedStage: evidence.codex?.blockedStage, diagnostic: evidence.codex?.diagnostic, protocol: evidence.codex?.protocol }));
assert.equal(evidence.codex?.protocol, "passed");
