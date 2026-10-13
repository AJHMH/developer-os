// Fixed fake-child framing regression in the selected Windows VM; no network,
// credentials, worker dispatch, or provider requests.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { podmanMachine } from "../../dist/podman-platform.js";
const host = podmanMachine("aios-podman-noshare");
assert.equal(host.platform, "win32");
const unbuffered = process.argv.includes("--unbuffered");
const source = `
import subprocess,sys,select,json,time
p=subprocess.Popen([sys.executable,'-c',"import os,time;os.write(1,bytes([102,105,114,115,116,10,115,101,99,111,110,100,10]));time.sleep(2)"],stdout=subprocess.PIPE)
if ${unbuffered ? "True" : "False"}: p.stdout=p.stdout.detach()
try:
 assert select.select([p.stdout],[],[],1)[0]
 time.sleep(0.05)
 assert p.stdout.readline(4097)==b'first\\n'
 ready=bool(select.select([p.stdout],[],[],0.1)[0])
 print(json.dumps(dict(secondFrameReady=ready)),flush=True)
 assert ready, 'Second frame stranded by buffered read'
 assert p.stdout.readline(4097)==b'second\\n'
finally:
 p.kill();p.wait(timeout=2);p.stdout.close()
`;
const result = spawnSync(
  host.executable,
  ["machine", "ssh", host.config.Name, "python3"],
  {
    input: source,
    cwd: host.cwd,
    env: host.env,
    encoding: "utf8",
    timeout: 10000,
    maxBuffer: 65536,
    shell: false,
    windowsHide: true,
  },
);
console.log(result.stdout);
assert.equal(result.status, 0, "Fixed fake-child framing regression failed");
