import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { podmanMachine } from "../../dist/podman-platform.js";
const host = podmanMachine("aios-podman-noshare");
assert.equal(host.platform, "win32");
const source = `import json,subprocess
rootless=json.loads(subprocess.check_output(['podman','ps','--format','json']))
rootful=json.loads(subprocess.check_output(['sudo','-n','podman','ps','--format','json']))
print(json.dumps(dict(runningRootless=len(rootless),runningRootful=len(rootful))))
`;
const result = spawnSync(host.executable, ["machine", "ssh", host.config.Name, "python3"], {
  input: source, cwd: host.cwd, env: host.env, encoding: "utf8", timeout: 10000,
  maxBuffer: 4096, shell: false, windowsHide: true,
});
assert.equal(result.status, 0, "Read-only VM census refused");
const counts = JSON.parse(result.stdout);
writeFileSync(new URL("ticket24-windows-relay-headroom-final-stopped-census.json", import.meta.url),
  JSON.stringify({ observedAt: new Date().toISOString(), ...counts }, null, 2) + "\n", { flag: "wx" });
assert.equal(counts.runningRootless, 0);
assert.equal(counts.runningRootful, 0);
console.log(JSON.stringify(counts));


