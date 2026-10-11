import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { podmanMachine } from "./podman-platform.js";
import { NativePodmanDriver } from "./podman-native.js";
import {
  onlinePolicyVersion,
  type OnlineAccessRuntime,
  type OnlinePlan,
  type OnlineProof,
  type OnlineStop,
} from "./online-access.js";

// Management-owned relay enters only the worker network namespace. Its filesystem,
// credentials, process namespace and capabilities never enter the worker.
const relay = String.raw`
import sys,json,time,threading,http.server,base64
R=json.loads(sys.stdin.readline());revoked=False;used=set()
class Handler(http.server.BaseHTTPRequestHandler):
 protocol_version='HTTP/1.1'
 def log_message(self,*args): pass
 def do_GET(self): self.handle_request()
 def do_POST(self): self.handle_request()
 def do_CONNECT(self): self.reply(403,b'')
 def reply(self,status,body):
  self.send_response(status);self.send_header('Content-Length',str(len(body)));self.send_header('Connection','close');self.end_headers();self.wfile.write(body)
 def handle_request(self):
  global revoked
  try:
   kind='model' if self.path=='/v1/responses' and self.command=='POST' else 'dependency' if self.path=='/dependencies/fixture.txt' and self.command=='GET' else None
   token=R.get(kind) if kind else None
   size=int(self.headers.get('Content-Length','0'))
   if revoked or time.monotonic()>R['deadline'] or kind in used or kind is None or self.headers.get('Authorization')!='Bearer '+token or self.headers.get('X-AIOS-Run')!=R['runId'] or self.headers.get('Upgrade') or self.headers.get('Transfer-Encoding') or size<0 or size>1024: return self.reply(403,b'')
   body=self.rfile.read(size)
   if (kind=='model' and body!=b'{"model":"synthetic","input":"ticket22"}') or (kind=='dependency' and body): return self.reply(403,b'')
   print(json.dumps(dict(kind=kind,runId=R['runId'])),flush=True)
   result=json.loads(sys.stdin.readline())
   if result.get('allowed')!=True: revoked=True;return self.reply(403,b'')
   used.add(kind);self.reply(200,base64.b64decode(result['body']))
  except: revoked=True;self.reply(403,b'')
s=http.server.HTTPServer(('127.0.0.1',18084),Handler)
print(json.dumps(dict(ready=True)),flush=True)
s.serve_forever()
`;
const guest = String.raw`
import sys,os,json,subprocess,pathlib,fcntl,uuid,hashlib,base64,time,signal,threading,http.server,urllib.request,stat
R=json.loads(sys.stdin.readline())
def fail(): raise RuntimeError('Synthetic online qualification refused')
def cmd(args,input=None):
 p=subprocess.run(args,input=input,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=8)
 if p.returncode or len(p.stdout)>16*1024*1024: fail()
 return p.stdout
def pod(*args): return cmd(['podman',*args])
def inspect(name): return json.loads(pod('inspect',name))[0]
def ticks(pid):
 try: return pathlib.Path('/proc/'+str(pid)+'/stat').read_text().rsplit(')',1)[1].split()[19]
 except FileNotFoundError: return None
def census(cg):
 if not cg: return []
 root=pathlib.Path('/sys/fs/cgroup')/cg.lstrip('/')
 return [p for f in root.rglob('cgroup.procs') for p in f.read_text().split()]
def private(path,directory=False):
 st=os.lstat(path)
 if st.st_uid!=os.getuid() or st.st_mode&0o077 or (not stat.S_ISDIR(st.st_mode) if directory else not stat.S_ISREG(st.st_mode) or st.st_nlink!=1): fail()
root=pathlib.Path.home()/'.local/share/developer-os-online'/R['authority']
root.mkdir(parents=True,exist_ok=True,mode=0o700);private(root,True)
lock=os.open(root/'lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600);private(root/'lock')
path=root/(R['runId']+'.json')
def save(v):
 tmp=str(path)+'.'+uuid.uuid4().hex
 fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'w') as f: json.dump(v,f);f.flush();os.fsync(f.fileno())
 os.replace(tmp,path)
 fd=os.open(root,os.O_RDONLY|os.O_DIRECTORY);os.fsync(fd);os.close(fd)
def stop():
 fcntl.flock(lock,fcntl.LOCK_EX)
 try:
  if not path.exists(): save(dict(revoked=True,containers=[],proxy=None));return
  private(path);j=json.loads(path.read_text());j['revoked']=True;save(j)
  if j.get('boot') and j['boot']!=pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip(): fail()
  tag=j.get('relayTag')
  sessions=set()
  if tag:
   for proc in pathlib.Path('/proc').iterdir():
    if not proc.name.isdigit(): continue
    try:
     if proc.stat().st_uid==os.getuid() and tag.encode() in (proc/'cmdline').read_bytes().split(b'\0'):
      fields=(proc/'stat').read_text().rsplit(')',1)[1].split();sessions.add(int(fields[3]))
    except (FileNotFoundError,ProcessLookupError,PermissionError): pass
  if j.get('proxy'):
   pid,start=j['proxy']
   current=ticks(pid)
   if current is not None and current!=start: fail()
   if current==start: sessions.add(pid)
  def relay_members():
   result=[]
   for proc in pathlib.Path('/proc').iterdir():
    if not proc.name.isdigit(): continue
    try:
     fields=(proc/'stat').read_text().rsplit(')',1)[1].split()
     if int(fields[3]) in sessions and fields[0]!='Z': result.append(int(proc.name))
    except (FileNotFoundError,ProcessLookupError,PermissionError): pass
   return result
  if os.getsid(0) in sessions: fail()
  for pid in relay_members():
   try: os.kill(pid,signal.SIGKILL)
   except ProcessLookupError: pass
  for _ in range(100):
   if not relay_members(): break
   time.sleep(.01)
  if relay_members(): fail()
  for name,cg in j['containers']:
   exists=subprocess.run(['podman','container','exists',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=3).returncode
   if exists==1: continue
   if exists!=0: fail()
   c=inspect(name)
   if c['Config'].get('Labels',{}).get('aios.online-run')!=R['runId']: fail()
   if c['State']['Running']:
    pid=c['State']['Pid']
    cg=next(x[3:] for x in pathlib.Path('/proc/'+str(pid)+'/cgroup').read_text().splitlines() if x.startswith('0::/'))
    if 'libpod-' not in cg or '..' in cg: fail()
    pod('stop','--time','1',name)
   c=inspect(name)
   if c['State']['Running'] or c['State']['Pid']!=0 or census(cg): fail()
  j['stopped']=True;save(j)
 finally: fcntl.flock(lock,fcntl.LOCK_UN)
if R['action']=='stop':
 stop();print(json.dumps(dict(runId=R['runId'],revoked=True,remainingProcesses=0)),flush=True);sys.exit()
fcntl.flock(lock,fcntl.LOCK_EX)
if path.exists(): fail()
j=dict(revoked=False,containers=[],proxy=None,relayTag='aios-online-relay-'+R['runId'],boot=pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip());save(j)
servers=[];proxy=None;worker=None
try:
 profile=json.loads(pathlib.Path('/usr/share/containers/seccomp.json').read_text())
 if profile.get('defaultAction')!='SCMP_ACT_ERRNO': fail()
 for r in profile['syscalls']: r['names']=[n for n in r['names'] if n not in ['unshare','setns']]
 profile['syscalls']=[r for r in profile['syscalls'] if r['names']]
 sec=root/(R['runId']+'-seccomp.json');sec.write_text(json.dumps(profile));os.chmod(sec,0o600);private(sec)
 # Intent and names are durable before create. A crash never silently loses a fixture.
 worker='aios-online-'+R['runId'];j['containers'].append([worker,'']);save(j)
 if R.get('fault')=='before-create': os._exit(71)
 pod('create','--name',worker,'--label','aios.online-run='+R['runId'],'--pull=never','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--security-opt=seccomp='+str(sec),'--user=65534:65534','--pid=private','--ipc=private','--pids-limit=32','--memory=64m','--http-proxy=false','--unsetenv-all','--env','PATH=/usr/bin:/bin','--restart=no',R['template'],'sleep','600')
 pod('start',worker)
 if R.get('fault')=='after-worker-start': os._exit(72)
 c=inspect(worker);pid=c['State']['Pid']
 cg=next(x[3:] for x in pathlib.Path('/proc/'+str(pid)+'/cgroup').read_text().splitlines() if x.startswith('0::/'))
 if 'libpod-' not in cg or '..' in cg: fail()
 j['containers'][0][1]=cg;save(j)
 if c['HostConfig']['NetworkMode']!='none' or c['Mounts'] or not c['HostConfig']['ReadonlyRootfs'] or c['Config']['User']!='65534:65534' or c['EffectiveCaps'] or not c['HostConfig']['SecurityOpt']: fail()
 # Distinct management-only positive services. Each responds to a fixed path/body.
 class Upstream(http.server.BaseHTTPRequestHandler):
  def log_message(self,*args): pass
  def do_GET(self):
   body=base64.b64decode(R['dependencyArtifact']['bytes'],validate=True) if self.server.kind=='dependency' and R.get('dependencyArtifact') else b'AIOS synthetic dependency artifact\n' if self.server.kind=='dependency' else b'AIOS synthetic model response\n'
   self.send_response(200);self.end_headers();self.wfile.write(body)
 for kind in ['model','dependency']:
  server=http.server.HTTPServer(('127.0.0.1',0),Upstream);server.kind=kind
  threading.Thread(target=server.serve_forever,daemon=True).start();servers.append(server)
 def positive(kind):
  server=next(s for s in servers if s.kind==kind)
  return urllib.request.urlopen('http://127.0.0.1:'+str(server.server_port)+'/fixture',timeout=1).read()
 before={k:positive(k) for k in ['model','dependency']}
 if R.get('dependencyArtifact') and (len(before['dependency'])>8*1024*1024 or hashlib.sha256(before['dependency']).hexdigest()!=R['dependencyArtifact']['sha256']): fail()
 model=uuid.uuid4().hex+uuid.uuid4().hex;dependency=uuid.uuid4().hex+uuid.uuid4().hex
 proxy=subprocess.Popen(['podman','unshare','nsenter','--net=/proc/'+str(pid)+'/ns/net','python3','-u','-c',base64.b64decode(R['relay']).decode(),j['relayTag']],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,start_new_session=True)
 if R.get('fault')=='after-relay-spawn': os._exit(73)
 j['proxy']=[proxy.pid,ticks(proxy.pid)];save(j)
 proxy.stdin.write((json.dumps(dict(runId=R['runId'],model=model,dependency=dependency,deadline=time.monotonic()+20))+'\n').encode());proxy.stdin.flush()
 if json.loads(proxy.stdout.readline())!=dict(ready=True): fail()
 fcntl.flock(lock,fcntl.LOCK_UN)
 bridgeError=[]
 def bridge():
  try:
   for line in proxy.stdout:
    event=json.loads(line)
    if event not in [dict(kind=k,runId=R['runId']) for k in ['model','dependency']]: fail()
    print(json.dumps(dict(authorize=True,runId=R['runId'])),flush=True)
    allowed=json.loads(sys.stdin.readline()).get('allowed')==True
    private(path)
    if json.loads(path.read_text()).get('revoked'): allowed=False
    body=positive(event['kind']) if allowed else b''
    proxy.stdin.write((json.dumps(dict(allowed=allowed,body=base64.b64encode(body).decode()))+'\n').encode());proxy.stdin.flush()
  except: bridgeError.append(True)
 threading.Thread(target=bridge,daemon=True).start()
 def request(method,path,token,body=b'',extra='',user='65534:65534'):
  raw=(method+' '+path+' HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer '+token+'\r\nX-AIOS-Run: '+R['runId']+'\r\nContent-Length: '+str(len(body))+'\r\nConnection: close\r\n'+extra+'\r\n').encode()+body
  return cmd(['podman','exec','-i','--user='+user,worker,'nc','-w','2','127.0.0.1','18084'],raw)
 body=b'{"model":"synthetic","input":"ticket22"}'
 for method,url,token,payload,extra in [('POST','/mcp',model,body,''),('POST','http://other.invalid/v1/responses',model,body,''),('CONNECT','host.internal:443',model,b'', ''),('POST','/v1/responses?redirect=other',model,body,''),('POST','/v1/responses',dependency,body,''),('GET','/dependencies/fixture.txt',model,b'', ''),('POST','/v1/responses',model,body,'Upgrade: websocket\r\n'),('POST','/v1/responses',model,b'{}','')]:
  if not request(method,url,token,payload,extra).startswith(b'HTTP/1.1 403 '): fail()
 if not request('POST','/v1/responses',model,body).endswith(before['model']): fail()
 dependencyResponse=request('GET','/dependencies/fixture.txt',dependency)
 if not dependencyResponse.endswith(before['dependency']): fail()
 dependencyDigest=hashlib.sha256(dependencyResponse.split(b'\r\n\r\n',1)[1]).hexdigest()
 if not request('POST','/v1/responses',model,body).startswith(b'HTTP/1.1 403 '): fail()
 if not request('GET','/dependencies/fixture.txt',dependency).startswith(b'HTTP/1.1 403 '): fail()
 # Positive management services remain reachable before and after root/nonroot denial.
 for server in servers:
  for user in ['65534:65534','0:0']:
   if subprocess.run(['podman','exec','--user='+user,worker,'wget','-T','1','-q','-O','/dev/null','http://127.0.0.1:'+str(server.server_port)+'/fixture'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=3).returncode==0: fail()
   for command in [['unshare','-n','true'],['touch',str(path)],['test','-e','/run/podman/podman.sock']]:
    if subprocess.run(['podman','exec','--user='+user,worker,*command],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=3).returncode==0: fail()
 if any(positive(k)!=before[k] for k in before) or bridgeError: fail()
 print(json.dumps(dict(runId=R['runId'],policyVersion=R['policyVersion'],model='passed',dependency='passed',bypass='passed',dependencyArtifactSha256=dependencyDigest)),flush=True)
finally:
 fcntl.flock(lock,fcntl.LOCK_UN)
 if proxy:
  try: proxy.kill();proxy.wait(timeout=3)
  except ProcessLookupError: pass
 for server in servers: server.shutdown();server.server_close()
 stop()
`;

/** Uses the admitted share-free macOS VM; all traffic is synthetic and VM-local.
 * No owner credential, provider hostname, redirect or paid API is supported. */
export class NativeOnlineAccess implements OnlineAccessRuntime {
  readonly mode = "live" as const;
  readonly version = createHash("sha256")
    .update(readFileSync(new URL(import.meta.url)))
    .digest("hex");
  constructor(
    private readonly native: NativePodmanDriver,
    private readonly qualificationFault?:
      | "before-create"
      | "after-worker-start"
      | "after-relay-spawn",
  ) {}
  async execute(
    plan: OnlinePlan,
    authorize: () => Promise<boolean>,
    artifact?: { bytes: Buffer; sha256: string },
  ): Promise<OnlineProof> {
    const observation = this.native.observe(plan.repository);
    const hash = (value: string | Buffer) =>
      createHash("sha256").update(value).digest("hex");
    if (
      plan.runtimeVersion !== this.version ||
      plan.policyVersion !== onlinePolicyVersion ||
      hash(readFileSync(this.native.policyPath)) !== plan.hostPolicySha256 ||
      hash(
        JSON.stringify(
          [
            "platform",
            "arch",
            "osVersion",
            "provider",
            "machine",
            "hostId",
            "engineVersion",
            "vmImageSha256",
            "template",
            "workerVersion",
            "policyVersion",
          ].map((key) => [key, observation.binding[key]]),
        ),
      ) !== plan.bindingSha256 ||
      !(await authorize())
    )
      throw Error("Changed online admission");
    return this.invoke(
      "execute",
      plan.runId,
      {
        template: observation.binding.template,
        policyVersion: plan.policyVersion,
        ...(artifact
          ? {
              dependencyArtifact: {
                bytes: artifact.bytes.toString("base64"),
                sha256: artifact.sha256,
              },
            }
          : {}),
        ...(this.qualificationFault ? { fault: this.qualificationFault } : {}),
      },
      authorize,
    ) as Promise<OnlineProof>;
  }
  stop(runId: string): Promise<OnlineStop> {
    return this.invoke("stop", runId) as Promise<OnlineStop>;
  }
  private invoke(
    action: string,
    runId: string,
    extras: Record<string, unknown> = {},
    authorize?: () => Promise<boolean>,
  ): Promise<OnlineProof | OnlineStop> {
    if (!/^[a-f0-9-]{36}$/.test(runId)) throw Error("Invalid online run");
    const host = podmanMachine(this.native.machine);
    if (host.platform !== "darwin")
      throw Error("Online native canary is macOS-only");
    const authority = createHash("sha256")
      .update(this.native.authorityDirectory)
      .digest("hex");
    const source = Buffer.from(guest).toString("base64");
    return new Promise((resolve, reject) => {
      const child = spawn(
        host.executable,
        [
          "machine",
          "ssh",
          this.native.machine,
          "python3",
          "-u",
          "-c",
          `'exec(__import__("base64").b64decode("${source}"))'`,
        ],
        {
          cwd: host.cwd,
          env: host.env,
          stdio: ["pipe", "pipe", "ignore"],
          shell: false,
        },
      );
      // stdin remains open for host-owned request authorization.
      child.stdin.write(
        JSON.stringify({
          action,
          runId,
          authority,
          relay: Buffer.from(relay).toString("base64"),
          ...extras,
        }) + "\n",
      );
      let buffer = "",
        total = 0,
        result: OnlineProof | OnlineStop | undefined,
        failed = false;
      const timer = setTimeout(() => {
        failed = true;
        child.kill();
      }, 25000);
      child.stdin.on("error", () => {
        failed = true;
        child.kill();
      });
      child.on("error", () => {
        failed = true;
        child.kill();
      });
      child.stdout.on("data", (chunk: Buffer) => {
        total += chunk.length;
        buffer += chunk.toString();
        if (total > 65536) {
          failed = true;
          child.kill();
          return;
        }
        let end;
        while ((end = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          try {
            const value = JSON.parse(line);
            if (
              value.authorize === true &&
              value.runId === runId &&
              authorize
            ) {
              void authorize()
                .then((allowed) =>
                  child.stdin.write(JSON.stringify({ allowed }) + "\n"),
                )
                .catch(() => child.stdin.write('{"allowed":false}\n'));
            } else if (!result && value.runId === runId) result = value;
            else {
              failed = true;
              child.kill();
            }
          } catch {
            failed = true;
            child.kill();
          }
        }
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0 && !failed && result && !buffer) resolve(result);
        else
          reject(
            Error(
              "Synthetic online operation unavailable; recover retained run.",
            ),
          );
      });
    });
  }
}
