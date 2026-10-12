import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { DeliveryController, type Delivery } from "./controller.js";
import { NativePodmanDriver } from "./podman-native.js";
import { PodmanHostAdapter } from "./podman-host.js";
import { podmanMachine } from "./podman-platform.js";
import {
  sha256,
  type CanaryPins,
  type OfflineCanaryRuntime,
} from "./offline-canary.js";

export const windowsControlsVersion = sha256(
  Buffer.concat([
    readFileSync(new URL(import.meta.url)),
    readFileSync(new URL("./controller.js", import.meta.url)),
    readFileSync(new URL("./podman-host.js", import.meta.url)),
  ]),
);
export const windowsControlNames = [
  "ssh-gpg",
  "github-binding",
  "effective-mounts",
  "descendant-stop",
  "repository-fencing",
  "orphan-resume",
] as const;
export interface WindowsControlsEvidence extends CanaryPins {
  version: string;
  nativeVersion: string;
  mode: "live" | "controlled";
  operationId: string;
  outcome: "passed";
  checks: {
    name: (typeof windowsControlNames)[number];
    evidenceSha256: string;
  }[];
  censuses: {
    observedProcesses: number;
    remainingProcesses: number;
    censusSha256: string;
  }[];
  productionEnabled: false;
}
export interface WindowsControlsRuntime {
  readonly version: string;
  readonly mode: "live" | "controlled";
  qualify(delivery: Delivery): Promise<WindowsControlsEvidence>;
}
const guest = String.raw`
import sys,os,json,pathlib,fcntl,stat,socket,uuid,hashlib,subprocess
stage='authority'
r=json.loads(sys.stdin.readline());s=r['session']
root=pathlib.Path.home()/'.local/state/aios-offline-v1'
def private(p,d=False):
 t=os.lstat(p);assert t.st_uid==os.getuid() and not t.st_mode&0o077 and not stat.S_ISLNK(t.st_mode) and (stat.S_ISDIR(t.st_mode) if d else stat.S_ISREG(t.st_mode) and t.st_nlink==1 and t.st_size<65536)
stage='root';private(root,True);stage='lock';private(root/'lock')
with open(root/'lock','r+') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX)
 stage='journal';p=root/(s['sandboxId']+'.json');private(p);j=json.loads(p.read_text())
 stage='registry';p=root/'authority.json';private(p);a=json.loads(p.read_text())
 stage='pins';assert j['pins']==r['pins']
 stage='session';assert j['session']==s and not j.get('revoked')
 stage='fence';assert a['fences'][hashlib.sha256(s['repositoryKey'].encode()).hexdigest()]==s['fence']
 name='aios-offline-'+s['sandboxId']
 def pod(*args):return subprocess.run(['podman',*args],check=True,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=10).stdout
 stage='frame';c=json.loads(pod('inspect',name))[0]
 stage='effective-frame';assert c['State']['Running'] and c['Config']['Labels']['aios.session']==s['workerSessionId'] and not c.get('Mounts') and c['HostConfig']['NetworkMode']=='none'
 stage='fixtures';directory=root/('boundary-'+r['challenge']);directory.mkdir(mode=0o700);private(directory,True)
 token=uuid.uuid4().hex
 files=[directory/n for n in ['synthetic-ssh-key','synthetic-gpg-key','synthetic-github-token']]
 sockets=[directory/n for n in ['ssh.sock','gpg.sock']]
 servers=[]
 try:
  for p in files:
   fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
   with os.fdopen(fd,'w') as f:f.write(token)
  for p in sockets:
   server=socket.socket(socket.AF_UNIX);server.bind(str(p));server.listen(1);os.chmod(p,0o600);servers.append(server)
  def positive():
   assert all(p.read_text()==token for p in files)
   for p,server in zip(sockets,servers):
    client=socket.socket(socket.AF_UNIX);client.settimeout(1);client.connect(str(p));peer,_=server.accept();peer.sendall(token.encode());assert client.recv(64)==token.encode();peer.close();client.close()
  stage='positive';positive()
  stage='denial'
  for user in ['65534:65534','0:0']:
   script='''set -eu
if env | grep -Eq '^(SSH_AUTH_SOCK|GPG_AGENT_INFO|GH_TOKEN|GITHUB_TOKEN)='; then exit 1; fi
for p; do if test -e "$p" || cat "$p" >/dev/null 2>&1 || cat /proc/1/root"$p" >/dev/null 2>&1; then exit 1; fi; done
test ! -d /root/.ssh; test ! -d /root/.gnupg; test ! -d /root/.config/gh
'''
   pod('exec','--user='+user,name,'/bin/sh','-c',script,'--',*[str(p) for p in files+sockets])
   stage='mounts';mounts=pod('exec','--user='+user,name,'cat','/proc/self/mountinfo').decode()
   assert str(root) not in mounts and '/mnt/c/' not in mounts and '/mnt/d/' not in mounts and not c['Mounts']
  stage='post-positive';positive()
  print(json.dumps(dict(challenge=r['challenge'],operationId=s['operationId'],names=['ssh-gpg','github-binding','effective-mounts'],positiveControls=True,privilegedDenial=True)))
 finally:
  for server in servers:server.close()
  for p in files+sockets:
   if p.exists():p.unlink()
  directory.rmdir()
`;
const crash = String.raw`
let text='';for await(const chunk of process.stdin)text+=chunk;
const r=JSON.parse(text);
const {DeliveryController}=await import(r.controller);
const {NativePodmanDriver}=await import(r.native);
const {PodmanHostAdapter}=await import(r.host);
const n=new NativePodmanDriver(r.machine,r.state,r.policy);
const w=new PodmanHostAdapter({machine:r.machine,policyPath:r.policy,native:n});
const o={mode:'live',execute:async request=>{await n.execute(request);console.log('AIOS_ACCEPTED');await new Promise(()=>setInterval(()=>{},1000));},stop:(s,p)=>n.stop(s,p),collect:(s,p)=>n.collect(s,p)};
await new DeliveryController(r.state,{}, {worker:w,offline:o}).offlineCanary(r.id);
`;
/** Exercises actual public controller lifecycle against a dedicated native VM.
 * All fixtures contain generated tokens, never owner signing/publication keys. */
export class NativeWindowsControls implements WindowsControlsRuntime {
  readonly version = windowsControlsVersion;
  readonly mode = "live" as const;
  constructor(private readonly native: NativePodmanDriver) {}
  async qualify(delivery: Delivery): Promise<WindowsControlsEvidence> {
    const n = this.native,
      id = delivery.id;
    const worker = new PodmanHostAdapter({
      machine: n.machine,
      policyPath: n.policyPath,
      native: n,
    });
    const controller = (offline: OfflineCanaryRuntime = n) =>
      new DeliveryController(n.authorityDirectory, {}, { worker, offline });
    const c = controller(),
      checks: WindowsControlsEvidence["checks"] = [],
      censuses: WindowsControlsEvidence["censuses"] = [];
    const record = (d: Delivery) => {
      const census = d.offlineCanary?.shutdownProof;
      if (
        d.execution?.state !== "stopped" ||
        !census ||
        census.observedProcesses < 8 ||
        census.remainingProcesses !== 0 ||
        !/^[a-f0-9]{64}$/.test(census.censusSha256)
      )
        throw Error("Unverified Windows shutdown");
      censuses.push(census);
    };
    let request: Parameters<OfflineCanaryRuntime["execute"]>[0] | undefined;
    let boundary: any;
    const probe: OfflineCanaryRuntime = {
      mode: "live",
      execute: async (r) => {
        request = r;
        const result = await n.execute(r);
        if (!r.mayDispatch()) throw Error("Boundary authority changed");
        const host = podmanMachine(n.machine),
          challenge = randomUUID();
        const response = spawnSync(
          host.executable,
          [
            "machine",
            "ssh",
            n.machine,
            "python3",
            "-u",
            "-c",
            "'import sys,base64;exec(base64.b64decode(sys.stdin.readline()))'",
          ],
          {
            input:
              Buffer.from(
                "stage='authority'\ntry:\n" +
                  guest
                    .split("\n")
                    .map((line) => " " + line)
                    .join("\n") +
                  "\nexcept BaseException:\n print(stage,file=__import__('sys').stderr);raise SystemExit(1)\n",
              ).toString("base64") +
              "\n" +
              JSON.stringify({
                challenge,
                session: r.session,
                pins: {
                  bindingSha256: r.bindingSha256,
                  policySha256: r.policySha256,
                },
              }) +
              "\n",
            env: host.env,
            cwd: host.cwd,
            shell: false,
            windowsHide: true,
            timeout: 30000,
            maxBuffer: 8192,
            encoding: "utf8",
          },
        );
        if (response.status !== 0) {
          const stage = response.stderr.trim();
          if (
            [
              "authority",
              "root",
              "lock",
              "journal",
              "registry",
              "pins",
              "session",
              "fence",
              "frame",
              "effective-frame",
              "fixtures",
              "positive",
              "denial",
              "mounts",
              "post-positive",
            ].includes(stage)
          )
            process.stderr.write(
              JSON.stringify({ windowsBoundaryRefusal: stage }) + "\n",
            );
          throw Error("Windows boundary probe refused");
        }
        boundary = JSON.parse(response.stdout);
        if (
          boundary.challenge !== challenge ||
          boundary.operationId !== r.session.operationId ||
          boundary.positiveControls !== true ||
          boundary.privilegedDenial !== true ||
          JSON.stringify(boundary.names) !==
            JSON.stringify(windowsControlNames.slice(0, 3))
        )
          throw Error("Unverified boundary observation");
        return result;
      },
      stop: (s, p) => n.stop(s, p),
      collect: (s, p) => n.collect(s, p),
    };
    const first = await controller(probe).offlineCanary(id);
    record(first);
    if (first.offlineCanary?.outcome !== "completed" || !boundary || !request)
      throw Error("Boundary task refused");
    for (const name of windowsControlNames.slice(0, 3))
      checks.push({
        name,
        evidenceSha256: sha256(
          JSON.stringify({ name, boundary, census: censuses[0] }),
        ),
      });
    const contender = c.start({
      repository: delivery.repository,
      request: "Fixed Windows competing-owner probe",
    });
    if (
      contender.ownership.held ||
      contender.phase !== "queued" ||
      contender.execution
    )
      throw Error("Competing owner dispatched");
    await c.cancel(contender.id);
    let denied = false;
    try {
      await n.execute({ ...request, mayDispatch: () => true });
    } catch {
      denied = true;
    }
    if (!denied) throw Error("Revoked sender admitted");
    checks.push({
      name: "repository-fencing",
      evidenceSha256: sha256(
        JSON.stringify({
          contender: contender.id,
          session: first.execution,
          revokedSenderDenied: denied,
        }),
      ),
    });
    const usage = JSON.stringify(c.status(id).usage);
    const child = spawn(
      process.execPath,
      ["--input-type=module", "-e", crash],
      {
        cwd: podmanMachine(n.machine).cwd,
        windowsHide: true,
        stdio: ["pipe", "pipe", "ignore"],
        env: {
          SystemRoot: process.env.SystemRoot,
          PATH: process.env.SystemRoot
            ? process.env.SystemRoot + "/System32"
            : "/usr/bin:/bin",
        },
      },
    );
    const closed = new Promise<void>((resolve) =>
      child.once("close", () => resolve()),
    );
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("Crash fixture timed out")),
          60000,
        );
        let output = "";
        child.once("error", () => {
          clearTimeout(timer);
          reject(Error("Crash fixture unavailable"));
        });
        child.once("exit", () => {
          clearTimeout(timer);
          reject(Error("Crash fixture exited early"));
        });
        child.stdout.on("data", (chunk) => {
          output += chunk.toString();
          if (output.length > 8192) {
            clearTimeout(timer);
            reject(Error("Unbounded crash fixture"));
          } else if (output.includes("AIOS_ACCEPTED")) {
            clearTimeout(timer);
            resolve();
          }
        });
        child.stdin.end(
          JSON.stringify({
            id,
            state: n.authorityDirectory,
            policy: n.policyPath,
            machine: n.machine,
            controller: new URL("./controller.js", import.meta.url).href,
            native: new URL("./podman-native.js", import.meta.url).href,
            host: new URL("./podman-host.js", import.meta.url).href,
          }),
        );
      });
      child.kill();
      await closed;
      const orphan = c.status(id);
      if (orphan.execution?.state !== "dispatched")
        throw Error("Missing orphan intent");
      let releaseDenied = false;
      try {
        c.release(id);
      } catch {
        releaseDenied = true;
      }
      if (!releaseDenied) throw Error("Orphan ownership released");
      const recovered = await c.recover(id);
      record(recovered);
      if (
        recovered.execution?.operationId !== orphan.execution.operationId ||
        !recovered.ownership.held ||
        JSON.stringify(recovered.usage) !== usage
      )
        throw Error("Orphan recovery changed authority or work");
      checks.push({
        name: "orphan-resume",
        evidenceSha256: sha256(
          JSON.stringify({
            orphan: orphan.execution,
            recovered: recovered.execution,
            shutdown: censuses[1],
            releaseDenied,
          }),
        ),
      });
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill();
        await closed;
      }
      const current = c.status(id);
      if (current.execution && current.execution.state !== "stopped")
        await c.recover(id);
    }
    checks.push({
      name: "descendant-stop",
      evidenceSha256: sha256(JSON.stringify(censuses)),
    });
    const final = c.status(id);
    return {
      version: this.version,
      nativeVersion: sha256(
        readFileSync(new URL("./podman-native.js", import.meta.url)),
      ),
      mode: this.mode,
      operationId: final.execution!.operationId,
      outcome: "passed",
      bindingSha256: delivery.qualification!.bindingSha256!,
      policySha256: delivery.qualification!.policySha256!,
      checks,
      censuses,
      productionEnabled: false,
    };
  }
}
