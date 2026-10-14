// Exact exported host helper with fixed fake children; no worker or provider traffic.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { podmanMachine } from "../../dist/podman-platform.js";
import { windowsCodexCrashFixture } from "../../dist/windows-codex-crash.js";
const host = podmanMachine("aios-macos-noshare");
assert.equal(host.platform, "darwin");
const source = `
import os,sys,pathlib,json,subprocess,base64
helper=base64.b64decode('${Buffer.from(windowsCodexCrashFixture).toString("base64")}').decode()
p=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'])
peer=subprocess.Popen([sys.executable,'-c','import time;time.sleep(60)'])
try:
 pid=str(p.pid)
 start=pathlib.Path('/proc/'+pid+'/stat').read_text().rsplit(')',1)[1].split()[19]
 group=next(line[3:] for line in pathlib.Path('/proc/'+pid+'/cgroup').read_text().splitlines() if line.startswith('0::/'))
 for binding in [dict(cgroup=group,pids={pid:str(int(start)+1)}),dict(cgroup='/unrelated-cgroup',pids={pid:start}),dict(cgroup=group,pids={})]:
  result=subprocess.run([sys.executable,'-c',helper,json.dumps(binding)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=3)
  assert result.returncode!=0
  assert p.poll() is None
 result=subprocess.run([sys.executable,'-c',helper,json.dumps(dict(cgroup=group,pids={pid:start,str(peer.pid):'0'}))],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=3)
 assert result.returncode!=0 and p.poll() is None and peer.poll() is None
 denied="import os;os.pidfd_open=lambda *args: (_ for _ in ()).throw(PermissionError());"
 result=subprocess.run([sys.executable,'-c',denied+helper,json.dumps(dict(cgroup=group,pids={pid:start}))],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=3)
 assert result.returncode!=0 and p.poll() is None
 result=subprocess.run([sys.executable,'-c',helper,json.dumps(dict(cgroup=group,pids={pid:start}))],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=3)
 assert result.returncode==0
 assert p.wait(timeout=2)==-9
 print(json.dumps(dict(changedIdentity='refused',unrelatedCgroup='refused',emptyTargets='refused',allTargetsBeforeSignal='passed',permissionFailure='refused',exactHandle='killed')),flush=True)
finally:
 if p.poll() is None: p.kill();p.wait(timeout=2)
 if peer.poll() is None: peer.kill();peer.wait(timeout=2)
`;
const result = spawnSync(
  host.executable,
  ["machine", "ssh", host.config.Name, "python3"],
  {
    input: source,
    cwd: host.cwd,
    env: host.env,
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 65536,
    shell: false,
    windowsHide: true,
  },
);
console.log(result.stdout);
assert.equal(result.status, 0, "Exact crash-handle regression failed");
