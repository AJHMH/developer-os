import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { hostname, platform, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { codexEndpointFixture } from "./codex-endpoint.js";
import { hostCanaryVersion } from "./host-canary.js";
import { inferenceFixtureContract } from "./inference-contract.js";
import { persistenceErrorVocabulary } from "./native-diagnostics.js";
import { canaryInput, sha256 } from "./offline-canary.js";
import { podmanCommand, podmanMachine } from "./podman-platform.js";

export type VMAction =
  | "enroll"
  | "observe"
  | "execute"
  | "stop"
  | "collect"
  | "isolate"
  | "model-frame"
  | "codex-protocol"
  | "boundary-probe"
  | "task-execute"
  | "task-collect";
// Versioned fixed synthetic worker. Input never becomes shell/Python source.
const worker = `set -eu
test "$(id -u)" = 65534
test "$(sha256sum /canary.txt | cut -d ' ' -f 1)" = ${sha256(canaryInput)}
printf 'AIOS offline canary complete\\n' > /tmp/result.txt
test ! -L /tmp/result.txt
test "$(stat -c %h /tmp/result.txt)" = 1
sleep 600 &
/bin/sh -c 'sleep 600 & wait' &
setsid /bin/sh -c 'sleep 600 & wait' &
setsid /bin/sh -c 'sleep 600 & sleep 600 &'
sleep 0.1
cat /tmp/result.txt
wait
`;
/** Fixed trusted-management helper. Opens exact process handles before validating
 * identities; never signals a reused PID or falls back to name-based killing. */
const windowsCodexCrashFixture = String.raw`
import os,sys,json,pathlib,signal
expected=json.loads(sys.argv[1]);handles=[]
try:
 if not expected['pids'] or not expected['cgroup'].startswith('/') or '..' in expected['cgroup']: raise RuntimeError('Invalid crash binding')
 for pid,start in expected['pids'].items():
  fd=os.pidfd_open(int(pid),0);handles.append(fd)
  actual=pathlib.Path('/proc/'+pid+'/stat').read_text().rsplit(')',1)[1].split()[19]
  groups=pathlib.Path('/proc/'+pid+'/cgroup').read_text().splitlines()
  group=next(line[3:] for line in groups if line.startswith('0::/'))
  if actual!=start or (group!=expected['cgroup'] and not group.startswith(expected['cgroup']+'/')): raise RuntimeError('Crash identity changed')
 for fd in handles: signal.pidfd_send_signal(fd,signal.SIGKILL,None,0)
finally:
 for fd in handles: os.close(fd)
`;

const guest = String.raw`
import os,json,subprocess,hashlib,base64,fcntl,pathlib,uuid,time,io,tarfile,stat,socket
def fail():
 if 'diagnostic' in globals(): diagnostic['failed']=True
 raise RuntimeError('Native offline observation unavailable')
def freeze_failure(error):
 if diagnostic.get('failed'): return
 diagnostic['failed']=True
 if isinstance(error,subprocess.TimeoutExpired):
  diagnostic.update(failureKind='timeout',commandElapsedMs=round(error.timeout*1000))
 else:
  diagnostic.update(failureKind='check');diagnostic.pop('commandElapsedMs',None);diagnostic.pop('exitCode',None)
def command(args,**kw):
 started=time.monotonic()
 recording='diagnostic' in globals() and not diagnostic.get('failed')
 if recording: diagnostic.update(failureKind='check');diagnostic.pop('exitCode',None)
 try:
  p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=R['target']['guestCommandSeconds'],**kw)
 except subprocess.TimeoutExpired:
  if recording: diagnostic.update(failureKind='timeout',commandElapsedMs=round((time.monotonic()-started)*1000),failed=True)
  raise
 if recording: diagnostic.update(commandElapsedMs=round((time.monotonic()-started)*1000))
 if p.returncode:
  if recording: diagnostic.update(failureKind='exit',exitCode=p.returncode)
  fail()
 if len(p.stdout)>1048576:
  if recording: diagnostic.update(failureKind='output-limit')
  fail()
 return p.stdout
def pod(*args,**kw): return command(['podman',*args],**kw)
engineSocket='/run/user/'+str(os.getuid())+'/podman/podman.sock'
def obj(*args): return json.loads(pod(*args))
def h(b): return hashlib.sha256(b).hexdigest()
def save(path,value):
 temp=path+'.new-'+uuid.uuid4().hex
 fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 try:
  with os.fdopen(fd,'w') as f: json.dump(value,f); f.flush(); os.fsync(f.fileno())
  os.replace(temp,path)
  directory=os.open(os.path.dirname(path),os.O_RDONLY|os.O_DIRECTORY)
  try: os.fsync(directory)
  finally: os.close(directory)
 finally:
  if os.path.exists(temp): os.unlink(temp)
def private(path,directory=False):
 entry=os.lstat(path)
 if entry.st_uid!=os.getuid() or entry.st_mode&0o077 or stat.S_ISLNK(entry.st_mode): fail()
 if directory:
  if not stat.S_ISDIR(entry.st_mode): fail()
 elif not stat.S_ISREG(entry.st_mode) or entry.st_nlink!=1 or entry.st_size>=65536: fail()
def read(path):
 private(path)
 with open(path) as f: return json.load(f)
def session_record(request,allow_revoked=False):
 session=request['session'];record=read(root+'/'+session['sandboxId']+'.json')
 if record['pins']!=request['pins'] or record['session']!=session: fail()
 if authority['fences'].get(h(session['repositoryKey'].encode()))!=session['fence']: fail()
 if not allow_revoked and record.get('revoked'): fail()
 return record
def census(cgroup):
 root=pathlib.Path('/sys/fs/cgroup')/cgroup.lstrip('/')
 result={}
 if root.exists():
  for path in root.rglob('cgroup.procs'):
   for pid in path.read_text().split():
    try: result[pid]=pathlib.Path('/proc/'+pid+'/stat').read_text().rsplit(')',1)[1].split()[19]
    except FileNotFoundError: pass
 return result
def cgroup(pid):
 lines=pathlib.Path('/proc/'+str(pid)+'/cgroup').read_text().splitlines()
 value=next(x[3:] for x in lines if x.startswith('0::/'))
 if not value.startswith('/') or '..' in value or 'libpod-' not in value: fail()
 return value
def gone(record):
 if census(record['cgroup']): return False
 for pid,start in record['pids'].items():
  try:
   if pathlib.Path('/proc/'+pid+'/stat').read_text().rsplit(')',1)[1].split()[19]==start: return False
  except FileNotFoundError: pass
 return True
def inspect(name): return obj('inspect',name)[0]
def effective(name):
 c=inspect(name); config=c['HostConfig']; env=c['Config']['Env']
 # Inspect the original worker from management. podman exec starts a different
 # process and is not evidence of the worker's inherited privilege restriction.
 status=pathlib.Path('/proc/'+str(c['State']['Pid'])+'/status').read_text()
 values={x.split(':',1)[0]:x.split(':',1)[1].strip() for x in status.splitlines() if ':' in x}
 mounts=pod('exec',name,'cat','/proc/self/mountinfo').decode()
 if c.get('Mounts') or config.get('Binds') or config.get('VolumesFrom') or config.get('Privileged'): fail()
 if config.get('PidMode')!='private' or config.get('NetworkMode')!='none' or config.get('PortBindings'): fail()
 if dict(x.split('=',1) for x in env)!={'PATH':'/usr/bin:/bin','HOME':'/','HOSTNAME':'aios-offline'} or c['Config']['User']!='65534:65534': fail()
 if values.get('NoNewPrivs')!='1' or values.get('Seccomp')!='2' or int(values.get('CapEff','f'),16)!=0: fail()
 if not config.get('ReadonlyRootfs') or 'no-new-privileges' not in config.get('SecurityOpt',[]): fail()
 mounted=[line.split() for line in mounts.splitlines()]
 if not any(x[4]=='/' and 'ro' in x[5].split(',') for x in mounted): fail()
 if any(x[x.index('-')+1] in ['9p','virtiofs','cifs','nfs','nfs4'] or
        x[4].startswith(('/var/home/core','/mnt/','/Users')) or
        x[4].endswith(('podman.sock','docker.sock')) for x in mounted): fail()
 # One bounded exec proves every forbidden path absent. A transport error
 # must refuse the observation rather than masquerade as a missing path.
 pod('exec',name,'/bin/sh','-c','for p do test ! -e "$p" || exit 1; done','--','/run/podman/podman.sock',engineSocket,'/var/run/docker.sock','/mnt/c','/Users')
 return dict(hypervisor=True,dedicated=True,mounts=[],managementExposed=False,rootful=False,network='none',readOnly=True,user='65534:65534',capabilities=[],noNewPrivileges=True)
def create(name,script,labels,memory='64m'):
 profile=json.loads(pathlib.Path('/usr/share/containers/seccomp.json').read_text())
 if profile.get('defaultAction')!='SCMP_ACT_ERRNO': fail()
 for rule in profile['syscalls']:
  rule['names']=[n for n in rule['names'] if n not in ['unshare','setns']]
 profile['syscalls']=[r for r in profile['syscalls'] if r['names']]
 seccomp=root+'/worker-seccomp.json'
 save(seccomp,profile)
 args=['create','--name',name,'--hostname=aios-offline','--pull=never','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--security-opt=seccomp='+seccomp,'--user=65534:65534','--pid=private','--ipc=private','--pids-limit=32','--memory='+memory,'--http-proxy=false','--unsetenv-all','--env','PATH=/usr/bin:/bin','--env','HOME=/','--log-driver=k8s-file','--restart=no']
 for k,v in labels.items(): args += ['--label',k+'='+v]
 pod(*args,R['template'],'/bin/sh','-c',script)
def stop(name,record):
 state=inspect(name)['State']
 if state.get('Running'):
  cg=cgroup(state['Pid']); record['cgroup']=cg; record['pids'].update(census(cg))
  pod('stop','--time','2',name)
 after=inspect(name)['State']
 if after.get('Running') or after.get('Pid')!=0: fail()
 if record['cgroup']:
  if not gone(record): fail()
 elif after.get('Status') not in ['created','configured']: fail()
def discard_stopped_fixture(name,record,path):
 if name is None or not record.get('stopped') or record.get('removed'): return
 c=inspect(name)
 if c['State'].get('Running') or c['State'].get('Pid')!=0 or c['Config'].get('Labels',{}).get('aios.authority')!=R['authority']: fail()
 pod('rm',name);record['removed']=True;save(path,record)
def snapshot():
 mounts=json.loads(command(['findmnt','--json','-o','FSTYPE,TARGET']))
 def check(entries):
  for x in entries:
   if x.get('fstype') in ['9p','virtiofs','cifs','nfs','nfs4'] or x.get('target','').startswith('/mnt/'): fail()
   check(x.get('children',[]))
 check(mounts['filesystems'])
 vendor=pathlib.Path('/sys/class/dmi/id/sys_vendor').read_text().strip()
 product=pathlib.Path('/sys/class/dmi/id/product_name').read_text().strip()
 if R['hostBinding']['provider']=='hyperv':
  if vendor!='Microsoft Corporation' or product!='Virtual Machine' or command(['uname','-m']).strip()!=b'x86_64': fail()
 elif R['hostBinding']['provider']=='applehv':
  if vendor!='Apple Inc.' or product!='Apple Virtualization Generic Platform' or command(['systemd-detect-virt']).strip()!=b'apple' or command(['uname','-m']).strip()!=b'aarch64': fail()
 else: fail()
 boot=json.loads(command(['rpm-ostree','status','--json']))
 d=next(x for x in boot['deployments'] if x.get('booted'))
 image=d.get('container-image-reference-digest','')
 if d.get('unlocked')!='none' or not image.startswith('sha256:') or len(image)!=71: fail()
 if d.get('container-image-reference')!=R['imageReference']: fail()
 if any(d.get(k) for k in ['requested-packages','requested-local-packages','base-local-replacements','base-removals']): fail()
 info=json.loads(pod('info','--format','json'))
 if not info['host']['security']['rootless'] or info['host']['cgroupVersion']!='v2': fail()
 if json.loads(command(['sudo','-n','podman','ps','--format','json'])): fail()
 if obj('ps','--format','json'): fail()
 cached=obj('image','inspect',R['template'])[0]
 if R['template'] not in cached.get('RepoDigests',[]) or cached.get('Architecture')!=R['guestArch']: fail()
 if cached['Config'].get('Env')!=['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin']: fail()
 return dict(vmImageSha256=image[7:],engineVersion=info['version']['Version'],hostId=h((R['host']+command(['sudo','-n','cat','/sys/class/dmi/id/product_uuid']).decode().strip()).encode()),template=R['template'],workerVersion='1.1.0',policyVersion='offline-native-v3-'+h((R['authority']+R['worker']+R['managementVersion']+R['hostCanaryVersion']).encode()))
root=os.path.expanduser('~/.local/state/aios-offline-v1')
os.makedirs(root,mode=0o700,exist_ok=True)
private(root,True)
fd=os.open(root+'/lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
private(root+'/lock')
with os.fdopen(fd,'w') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX)
 registry=root+'/authority.json'
 if os.path.exists(registry):
  authority=read(registry)
  if authority['id']!=R['authority']: fail()
 elif R['action']=='enroll':
  authority=dict(id=R['authority'],fences={}); save(registry,authority)
 else: fail()
 if R['action'] in ['enroll','observe','execute','isolate']:
  for probe in pathlib.Path(root).glob('probe-*.json'):
   saved=read(str(probe))
   if not saved.get('stopped'):
    c=inspect(saved['name'])
    if c['Config'].get('Labels',{}).get('aios.authority')!=R['authority']: fail()
    stop(saved['name'],saved)
    saved['stopped']=True; save(str(probe),saved)
 if R['action'] in ['enroll','observe']:
  binding={**R['hostBinding'],**snapshot()}
  if R['action']=='enroll': print(json.dumps(dict(binding=binding,effective={})))
  else:
   if binding!=R['expected']: fail()
   name='aios-qualification-'+str(uuid.uuid4())
   record=dict(name=name,cgroup='',pids={},stopped=False)
   probePath=root+'/probe-'+str(uuid.uuid4())+'.json'
   try:
    create(name,'sleep 600',{'aios.authority':R['authority']})
    save(probePath,record)
    pod('start',name)
    pid=inspect(name)['State']['Pid']; cg=cgroup(pid)
    record.update(cgroup=cg,pids=census(cg)); save(probePath,record)
    e=effective(name)
    stop(name,record)
    record['stopped']=True; save(probePath,record)
    print(json.dumps(dict(binding=binding,effective=e)))
   finally:
    if os.path.exists(probePath) and not record.get('stopped'):
     stop(name,record); record['stopped']=True; save(probePath,record)
 elif R['action']=='isolate':
  import urllib.request,socket,shutil,ipaddress
  stage='binding'
  binding={**R['hostBinding'],**snapshot()}
  if binding!=R['expected']: fail()
  challenge=R['challenge']; nonce=challenge['id']
  gateway=socket.gethostbyname('host.containers.internal')
  if not ipaddress.ip_address(gateway).is_private: fail()
  url='http://'+gateway+':'+str(challenge['port'])+'/aios-synthetic/'+nonce
  def services():
   for data in [None,b'{"jsonrpc":"2.0","id":1,"method":"tools/list"}']:
    request=urllib.request.Request(url,data=data,headers={'Content-Type':'application/json'})
    value=json.loads(urllib.request.urlopen(request,timeout=2).read(4096))
    if value.get('canary')!=nonce or value.get('result')!={'tools':[]}: fail()
  def engine():
   s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);s.settimeout(2)
   try:
    s.connect(engineSocket);s.sendall(b'GET /_ping HTTP/1.0\r\n\r\n')
    value=s.recv(4096)
    if b'200 OK' not in value: fail()
   finally: s.close()
  stage='host-http-mcp-positive'
  services()
  stage='guest-engine-positive'
  engine()
  directory=root+'/isolation-'+nonce
  os.mkdir(directory,0o700)
  paths=[directory+'/synthetic-authority',directory+'/synthetic-peer',directory+'/synthetic-credential']
  credential=uuid.uuid4().hex
  for p in paths:
   f=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
   with os.fdopen(f,'w') as stream: stream.write(credential)
  def files():
   if any(pathlib.Path(p).read_text()!=credential for p in paths): fail()
  stage='guest-file-positive'
  files()
  name='aios-isolation-'+nonce; record=dict(name=name,cgroup='',pids={},stopped=False)
  probePath=root+'/probe-'+nonce+'.json'
  try:
   create(name,'sleep 600',{'aios.authority':R['authority']})
   save(probePath,record);pod('start',name)
   cg=cgroup(inspect(name)['State']['Pid']);record.update(cgroup=cg,pids=census(cg));save(probePath,record)
   effective(name)
   for tool in ['cat','wget','unshare']:
    stage='worker-tool-'+tool
    pod('exec',name,'/bin/sh','-c','command -v '+tool+' >/dev/null')
   stage='worker-tool-chroot'
   pod('exec',name,'/bin/sh','-c',"busybox --list | /bin/grep -x chroot >/dev/null")
   stage='worker-cgroup-interface'
   pod('exec',name,'/bin/sh','-c','test -f /sys/fs/cgroup/cgroup.procs')
   stage='worker-proc-interface'
   pod('exec',name,'/bin/sh','-c','test -d /proc/1/root')
   script='''set -eu
for p in "$1" "$2" "$3"; do if cat "$p" >/dev/null 2>&1; then echo failed-host-files; else echo passed-host-files; fi; done
if cat "$4" >/dev/null 2>&1; then echo failed-controller-ledger; else echo passed-controller-ledger; fi
if cat "$5" >/dev/null 2>&1; then echo failed-cross-delivery; else echo passed-cross-delivery; fi
if wget -T 1 -q -O /dev/null "$6" 2>/dev/null; then echo failed-network-bypass; else echo passed-network-bypass; fi
if wget -T 1 -q -O /dev/null --post-data='{"jsonrpc":"2.0","id":1,"method":"tools/list"}' "$6" 2>/dev/null; then echo failed-skills-mcp-hooks; else echo passed-skills-mcp-hooks; fi
if test -S "$7"; then echo failed-host-docker; else echo passed-host-docker; fi
if unshare -Ur true 2>/dev/null; then echo failed-escape-unshare; else echo passed-escape-unshare; fi
if busybox chroot / /bin/true 2>/dev/null; then echo failed-escape-chroot; else echo passed-escape-chroot; fi
if (echo $$ > /sys/fs/cgroup/cgroup.procs) 2>/dev/null; then echo failed-escape-cgroup; else echo passed-escape-cgroup; fi
if cat /proc/1/root"$4" >/dev/null 2>&1; then echo failed-escape-proc; else echo passed-escape-proc; fi
if cat "$8" >/dev/null 2>&1 || cat /proc/1/root"$8" >/dev/null 2>&1; then echo failed-owner-credentials; else echo passed-owner-credentials; fi

'''
   hostPaths=['/mnt/'+p[0].lower()+'/'+p[3:].replace('\\','/') for p in challenge['files']] if R['hostBinding']['platform']=='win32' else challenge['files']
   stage='worker-denials'
   observed=pod('exec',name,'/bin/sh','-c',script,'--',*hostPaths,*paths[:2],url,engineSocket,paths[2]).decode().splitlines()
   expected=['passed-host-files']*3+['passed-controller-ledger','passed-cross-delivery','passed-network-bypass','passed-skills-mcp-hooks','passed-host-docker','passed-escape-unshare','passed-escape-chroot','passed-escape-cgroup','passed-escape-proc','passed-owner-credentials']
   stage='post-host-http-mcp-positive'
   services()
   stage='post-guest-engine-positive'
   engine()
   stage='post-guest-file-positive'
   files()
   record['pids'].update(census(cg));stop(name,record);record['stopped']=True;save(probePath,record)
   if {**R['hostBinding'],**snapshot()}!=binding: fail()
   names=['host-files','controller-ledger','cross-delivery','network-bypass','skills-mcp-hooks','host-docker','owner-credentials']
   proof=h(json.dumps(dict(challenge=nonce,observed=observed,binding=binding,stopped=record['stopped']),sort_keys=True).encode())
   print(json.dumps(dict(binding=binding,challengeId=nonce,passed=observed==expected,probes=[dict(name=n,outcome='passed' if observed==expected else 'failed',evidenceSha256=proof) for n in names],escapeAttempts=observed[-5:-1],credentialExclusion=dict(hostFilesDenied=observed[:3]==['passed-host-files']*3,guestFileDenied=observed[-1]=='passed-owner-credentials',environmentScrubbed=True,mountsAbsent=True,networkAbsent=True,positiveControlsBeforeAfter=True),scope='Synthetic host/MCP IPv4, management and peer controls only; no exhaustive escape claim',shutdown=dict(observedProcesses=len(record['pids']),remainingProcesses=0))))
  except Exception as error:
   freeze_failure(error)
   raise
  finally:
   if os.path.exists(probePath) and not record.get('stopped'):
    stop(name,record);record['stopped']=True;save(probePath,record)
   shutil.rmtree(directory)
 elif R['action']=='codex-protocol':
  stage='codex-binding'
  import selectors
  binding={**R['hostBinding'],**snapshot()}
  if binding!=R['expected']: fail()
  stage='codex-binary'
  binary=root+'/codex-0.161.0'
  st=os.lstat(binary)
  if not __import__('stat').S_ISREG(st.st_mode) or st.st_nlink!=1 or st.st_uid!=os.getuid() or st.st_mode & 0o077: fail()
  data=pathlib.Path(binary).read_bytes()
  binaryHash=R['target']['codexWorkerSha256']
  if h(data)!=binaryHash: fail()
  private=root+'/credential-'+str(uuid.uuid4());secret=uuid.uuid4().hex
  pathlib.Path(private).write_text(secret);os.chmod(private,0o600)
  name='aios-codex-protocol-'+str(uuid.uuid4());record=dict(name=name,cgroup='',pids={},stopped=False)
  probePath=root+'/probe-'+str(uuid.uuid4())+'.json'; child=None; proxies=[];peer=None;peerPath=None;slow=None
  endpointSource=base64.b64decode('${Buffer.from(codexEndpointFixture).toString("base64")}').decode()
  try:
   stage='codex-create'
   create(name,'sleep 600 & wait',{'aios.authority':R['authority']},'512m')
   save(probePath,record)
   archive=io.BytesIO()
   with tarfile.open(fileobj=archive,mode='w') as tar:
    entry=tarfile.TarInfo('codex');entry.size=len(data);entry.mode=0o555;entry.uid=0;entry.gid=0
    tar.addfile(entry,io.BytesIO(data))
   stage='codex-copy'
   result=subprocess.run(['podman','cp','-',name+':/'],input=archive.getvalue(),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15)
   if result.returncode: fail()
   pod('start',name);cg=cgroup(inspect(name)['State']['Pid']);record.update(cgroup=cg,pids=census(cg));save(probePath,record)
   e=effective(name)
   stage='codex-version'
   if pod('exec',name,'/codex','--version').strip()!=b'codex-cli 0.161.0': fail()
   if pathlib.Path(private).read_text()!=secret: fail()
   stage='codex-host-credential-denials'
   pod('exec',name,'/bin/sh','-c','for p do if cat "$p" >/dev/null 2>&1 || cat /proc/1/root"$p" >/dev/null 2>&1; then exit 1; fi; done','--',private,*R['challenge']['files'])
   stage='codex-credential-denials'
   pod('exec',name,'mkdir','-m','700','/tmp/empty-codex')
   cap=R['gatewayCapability']
   delivery=R['deliveryId']
   if str(uuid.UUID(delivery))!=delivery: fail()
   stage='codex-relay-start'
   def relay(worker,port,identity,token,budget,ttl=20,armable=False):
    pid=str(inspect(worker)['State']['Pid'])
    p=subprocess.Popen(['podman','unshare','nsenter','--net=/proc/'+pid+'/ns/net','python3','-u','-c',endpointSource],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,start_new_session=True)
    # Readiness checks must observe every frame, including coalesced writes.
    # Detach only stdout: stdin retains complete buffered writes and explicit flush.
    p.stdout=p.stdout.detach()
    proxies.append(p)
    p.stdin.write((json.dumps(dict(port=port,deliveryId=identity,capability=token,budget=budget,ttl=ttl,gateway=identity==delivery,armable=armable,contract=R['inferenceContract']))+'\n').encode());p.stdin.flush()
    def event(timeout=15 if binding['platform']=='darwin' else 3):
     if not __import__('select').select([p.stdout],[],[],timeout)[0]: fail()
     line=p.stdout.readline(4097)
     if len(line)>4096 or not line.endswith(b'\n'): fail()
     return json.loads(line)
    if event()!=dict(ready=True,deliveryId=identity): fail()
    return p,event
   relayTtl=120 if binding['platform']=='darwin' else 60
   proxy,relayEvent=relay(name,18081,delivery,cap,2,relayTtl)
   peer='aios-relay-peer-'+str(uuid.uuid4());peerRecord=dict(name=peer,cgroup='',pids={},stopped=False)
   peerPath=root+'/probe-'+str(uuid.uuid4())+'.json'
   create(peer,'sleep 600',{'aios.authority':R['authority']})
   save(peerPath,peerRecord)
   pod('start',peer);peerRecord['cgroup']=cgroup(inspect(peer)['State']['Pid']);peerRecord['pids']=census(peerRecord['cgroup']);save(peerPath,peerRecord)
   peerId=str(uuid.uuid4());peerCap=uuid.uuid4().hex+uuid.uuid4().hex
   peerProxy,peerEvent=relay(peer,18082,peerId,peerCap,3,relayTtl)
   body=R['inferenceContract']['requestRaw'].encode()
   def request(worker,port,method='POST',path='/v1/responses',token=cap,identity=delivery,payload=body,extra=b''):
    global stage
    if worker==name and child is not None:
     requestedStage=stage;stage='codex-relay-task-budget'
     awaitTaskBudget()
     stage=requestedStage
    header=(method+' '+path+' HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer '+token+'\r\nX-AIOS-Delivery: '+identity+'\r\nContent-Type: application/json\r\nContent-Length: '+str(len(payload))+'\r\nConnection: close\r\n').encode()+extra+b'\r\n'+payload
    result=subprocess.run(['podman','exec','-i',worker,'nc','-w','2','127.0.0.1',str(port)],input=header,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=10 if binding['platform']=='darwin' else 4)
    if binding['platform']=='win32':
     status=result.stdout.split(b'\r\n',1)[0].split(b' ')
     diagnostic.update(responseBytes=len(result.stdout),responseStatus=int(status[1]) if len(status)>1 and status[1].isdigit() and len(status[1])==3 else 0,requestExitCode=result.returncode)
    if len(result.stdout)>65536: fail()
    return result.stdout
   def denied(output):
    if not output.startswith(b'HTTP/1.1 403 ') or output.split(b'\r\n\r\n',1)[-1]!=b'': fail()
   stage='codex-relay-denials'
   for denialIndex,(method,path,token,identity,payload,extra) in enumerate([('GET','/v1/responses',cap,delivery,body,b''),('POST','/v1/models',cap,delivery,body,b''),('POST','/v1/responses?other=1',cap,delivery,body,b''),('CONNECT','/v1/responses',cap,delivery,body,b''),('POST','/v1/responses',cap,delivery,body,b'Upgrade: websocket\r\n'),('POST','/v1/responses','0'*64,delivery,body,b''),('POST','/v1/responses',cap,peerId,body,b''),('POST','/v1/responses',peerCap,delivery,body,b''),('POST','/v1/responses',cap,delivery,b'{}',b'')]):
    stage='codex-relay-denial-'+str(denialIndex)
    denied(request(name,18081,method,path,token,identity,payload,extra))
   stage='codex-relay-peer-denial'
   denied(request(peer,18082,token=cap,identity=peerId))
   stage='codex-relay-cross-namespace'
   if request(peer,18081)!=b'' or request(name,18082,token=peerCap,identity=peerId)!=b'': fail()
   stage='codex-relay-peer-positive'
   if not request(peer,18082,token=peerCap,identity=peerId).startswith(b'HTTP/1.1 200 '): fail()
   if peerEvent().get('accepted')!=1: fail()
   args=['podman','exec','-i','--env','DELIVERY_CAPABILITY='+cap,'--env','CODEX_HOME=/tmp/empty-codex',name,'/codex','app-server','--listen','stdio://','-c','model_provider="qualification"','-c','model_providers.qualification.name="Synthetic only"','-c','model_providers.qualification.base_url="http://127.0.0.1:18081/v1"','-c','model_providers.qualification.env_key="DELIVERY_CAPABILITY"','-c','model_providers.qualification.wire_api="responses"','-c','model_providers.qualification.requires_openai_auth=false','-c','model_providers.qualification.supports_websockets=false','-c','model_providers.qualification.http_headers.X-AIOS-Delivery="'+delivery+'"']
   # Bound runtime parallelism within the unchanged 32-task worker budget.
   runtimeEnv={b'TOKIO_WORKER_THREADS':b'1',b'RAYON_NUM_THREADS':b'1'}
   for key,value in runtimeEnv.items(): args[3:3]=['--env',key.decode()+'='+value.decode()]
   stage='codex-initialize'
   child=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
   def send(value): child.stdin.write((json.dumps(value)+'\n').encode());child.stdin.flush()
   send(dict(method='initialize',id=1,params=dict(clientInfo=dict(name='Developer_OS',version='0.1.0'),capabilities={})))
   selector=selectors.DefaultSelector()
   selector.register(child.stdout,selectors.EVENT_READ,'stdout');selector.register(child.stderr,selectors.EVENT_READ,'stderr');selector.register(proxy.stdout,selectors.EVENT_READ,'gateway')
   gatewayAccepted=[];gatewayCompleted=False
   def observeTaskLimits():
    counts=dict(codexRuntimeTasks=0,codexSqliteTasks=0,codexAllocatorTasks=0,codexOtherTasks=0)
    for pid in census(cg):
     try:
      if b'/codex' not in pathlib.Path('/proc/'+pid+'/cmdline').read_bytes(): continue
     except FileNotFoundError: continue
     for task in pathlib.Path('/proc/'+pid+'/task').iterdir():
      try: title=(task/'comm').read_text().lower()
      except FileNotFoundError: continue
      key='codexSqliteTasks' if 'sqlite' in title else 'codexRuntimeTasks' if 'tokio' in title else 'codexAllocatorTasks' if 'jemalloc' in title else 'codexOtherTasks'
      counts[key]+=1
    diagnostic.update(counts)
    taskRoot=pathlib.Path('/sys/fs/cgroup')/cg.lstrip('/')
    if (taskRoot/'pids.events').exists(): diagnostic['processLimitHits']=int(dict(line.split() for line in (taskRoot/'pids.events').read_text().splitlines())['max'])
    for key,file in [('workerTaskCount','pids.current'),('workerTaskLimit','pids.max')]:
     if (taskRoot/file).exists() and (taskRoot/file).read_text().strip().isdigit(): diagnostic[key]=int((taskRoot/file).read_text().strip())
   def awaitTaskBudget():
    # Tokio's blocking pool expires idle threads after ten seconds. Reserve
    # six tasks for history connection/startup work rather than overlapping it
    # with the initial filesystem burst. Capacity is observed, never assumed.
    by=time.monotonic()+12
    while True:
     observeTaskLimits()
     if diagnostic.get('workerTaskLimit')!=32: fail()
     if diagnostic.get('workerTaskCount',33)<=26 and diagnostic.get('codexRuntimeTasks',33)<=4: return
     if time.monotonic()>=by: fail()
     time.sleep(0.05)
   deadline=time.monotonic()+(60 if binding['platform']=='darwin' else 35);total=0;initialized=False;verified=False;accountVerified=False;pending=b'';answer=''
   while time.monotonic()<deadline and not verified:
    for event,_ in selector.select(0.1):
     if event.data=='gateway':
      frame=json.loads(proxy.stdout.readline(131073))
      if frame.get('accepted') is not None: gatewayAccepted.append(frame);continue
      if set(frame)!= {'gatewayRequest','deliveryId','capability'} or frame['deliveryId']!=delivery or frame['capability']!=cap: fail()
      print(json.dumps(frame),flush=True)
      if not __import__('select').select([__import__('sys').stdin],[],[],32)[0]: fail()
      response=json.loads(__import__('sys').stdin.readline(131073))
      if set(response)!= {'gatewayResponse','deliveryId'} or response['deliveryId']!=delivery: fail()
      proxy.stdin.write((json.dumps(response)+'\n').encode());proxy.stdin.flush();gatewayCompleted=True;continue
     chunk=os.read(event.fileobj.fileno(),4096);total+=len(chunk)
     if total>65536: fail()
     if not chunk:
      selector.unregister(event.fileobj)
      if event.data=='stdout': stage='codex-process-exited';fail()
      continue
     if event.data=='stderr': continue
     pending+=chunk
     while b'\n' in pending:
      line,pending=pending.split(b'\n',1)
      message=json.loads(line)
      if message.get('error'):
       if message.get('id') in [5,6]:
        if message.get('id')==6: stage='codex-persistence-read-error'
        detail=json.dumps(message['error']).lower()
        observeTaskLimits()
        diagnostic['persistenceErrorFlags']=sum(1<<i for i,word in enumerate(${JSON.stringify(persistenceErrorVocabulary)}) if word in detail)
        reasons=[('closing-thread',['closing','closed']),('not-loaded',['not loaded']),('not-materialized',['materializ']),('permission',['permission','denied']),('not-found',['not found']),('rollout',['rollout']),('not-persisted',['persist']),('active-thread',['active']),('not-initialized',['initializ']),('history',['history']),('database',['sqlite','database']),('invalid-data',['json','invalid']),('file',['file','directory']),('read',['read']),('missing',['missing']),('internal',['internal'])]
        diagnostic['persistenceErrorReason']=next((reason for reason,words in reasons if any(word in detail for word in words)),'other')
        code=message['error'].get('code')
        if type(code)==int and -32768<=code<=32767: diagnostic['persistenceErrorCode']=code
       if message.get('id')==6 and time.monotonic()<persistenceBy:
        time.sleep(0.05);send(dict(method='thread/read',id=6,params=dict(threadId=thread,includeTurns=True)));continue
       if message.get('id')==5:
        detail=str(message['error'].get('message','')).lower()
        if 'rollout' in detail: stage='codex-resume-rollout'
        elif 'permission' in detail or 'denied' in detail: stage='codex-resume-permission'
        elif 'not found' in detail: stage='codex-resume-not-found'
       fail()
      if message.get('id')==1:
       if not message.get('result'): fail()
       initialized=True;stage='codex-account-read';send(dict(method='initialized'));send(dict(method='account/read',id=2,params=dict(refreshToken=False)))
      elif message.get('id')==2:
       value=message.get('result',{})
       if not initialized or value.get('account') is not None or value.get('requiresOpenaiAuth') is not False: fail()
       accountVerified=True;stage='codex-relay-turn'
       if binding['platform']=='win32': stage='codex-start-task-budget'
       awaitTaskBudget()
       stage='codex-relay-turn'
       send(dict(method='thread/start',id=3,params=dict(model=R['inferenceContract']['model'],cwd='/tmp/empty-codex',approvalPolicy='never',sandbox='read-only',ephemeral=False)))
      elif message.get('id')==3:
       thread=message.get('result',{}).get('thread',{}).get('id')
       if not accountVerified or not isinstance(thread,str): fail()
       send(dict(method='turn/start',id=4,params=dict(threadId=thread,input=[dict(type='text',text=R['inferenceContract']['prompt'])])))
      elif message.get('method')=='item/agentMessage/delta':
       answer+=message.get('params',{}).get('delta','')
      elif message.get('method')=='turn/completed':
       if message.get('params',{}).get('turn',{}).get('status')!='completed' or answer!=R['inferenceContract']['marker']: fail()
       stage='codex-resume-persistence'
       if binding['platform']=='darwin':
        stage='codex-persistence-task-budget';awaitTaskBudget()
        stage='codex-resume-persistence'
       persistenceBy=time.monotonic()+2
       send(dict(method='thread/read',id=6,params=dict(threadId=thread,includeTurns=True)))
      elif message.get('id')==6:
       saved=message.get('result',{}).get('thread',{})
       if saved.get('id')!=thread or R['inferenceContract']['marker'] not in json.dumps(saved.get('turns',[])):
        if binding['platform']=='win32': stage='codex-persistence-thread' if saved.get('id')!=thread else 'codex-persistence-history'
        if time.monotonic()>=persistenceBy: fail()
        time.sleep(0.05);send(dict(method='thread/read',id=6,params=dict(threadId=thread,includeTurns=True)));continue
       stage='codex-resume-exit'
       observeTaskLimits()
       diagnostic['originalCodexTasks']=diagnostic['workerTaskCount']
       previous=census(cg);previousCodex={pid:start for pid,start in previous.items() if b'/codex' in pathlib.Path('/proc/'+pid+'/cmdline').read_bytes()}
       if not previousCodex: fail()
       diagnostic['originalCodexProcesses']=len(previousCodex)
       record['pids'].update(previous);save(probePath,record)
       stage='codex-resume-kill'
       try:
        current=inspect(name)
        if current['Config'].get('Labels',{}).get('aios.authority')!=R['authority'] or cgroup(current['State']['Pid'])!=cg: fail()
        crashSource=base64.b64decode('${Buffer.from(windowsCodexCrashFixture).toString("base64")}').decode()
        pod('unshare','python3','-c',crashSource,json.dumps(dict(cgroup=cg,pids=previousCodex)))
       except Exception:
        observeTaskLimits()
        diagnostic['remainingOriginalCodexProcesses']=sum(census(cg).get(pid)==start for pid,start in previousCodex.items())
        raise
       stage='codex-resume-wait'
       child.stdin.close();child.wait(timeout=10)
       stage='codex-resume-status'
       if child.returncode not in [0,137,-9]: fail()
       stage='codex-resume-census'
       exitedBy=time.monotonic()+2
       while any(census(cg).get(pid)==start for pid,start in previousCodex.items()) and time.monotonic()<exitedBy: time.sleep(0.05)
       diagnostic['remainingOriginalCodexProcesses']=sum(census(cg).get(pid)==start for pid,start in previousCodex.items())
       if diagnostic['remainingOriginalCodexProcesses']: fail()
       observeTaskLimits()
       if binding['platform']=='win32': diagnostic['postCrashTasks']=diagnostic['workerTaskCount']
       selector.unregister(child.stdout);selector.unregister(child.stderr)
       child=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
       selector.register(child.stdout,selectors.EVENT_READ,'stdout');selector.register(child.stderr,selectors.EVENT_READ,'stderr')
       pending=b''
       stage='codex-resume-initialize'
       send(dict(method='initialize',id=11,params=dict(clientInfo=dict(name='Developer_OS',version='0.1.0'),capabilities={})))
      elif message.get('id')==11:
       if not message.get('result'): fail()
       stage='codex-resume-account'
       send(dict(method='initialized'));send(dict(method='account/read',id=12,params=dict(refreshToken=False)))
      elif message.get('id')==12:
       value=message.get('result',{})
       if value.get('account') is not None or value.get('requiresOpenaiAuth') is not False: fail()
       if binding['platform']=='win32': stage='codex-resume-task-budget'
       awaitTaskBudget()
       stage='codex-explicit-resume'
       send(dict(method='thread/resume',id=5,params=dict(threadId=thread)))
      elif message.get('id')==5:
       resumed=message.get('result',{}).get('thread',{})
       stage='codex-resume-history'
       if resumed.get('id')!=thread or not resumed.get('turns') or R['inferenceContract']['marker'] not in json.dumps(resumed['turns']): fail()
       observeTaskLimits()
       verified=True;break
   if not verified and time.monotonic()>=deadline:
    stage='codex-protocol-deadline';fail()
   if not verified or not gatewayCompleted or len(gatewayAccepted)!=1: fail()
   stage='codex-relay-revocation'
   event=gatewayAccepted[0]
   if event.get('accepted')!=1 or event.get('deliveryId')!=delivery or len(event.get('requestSha256',''))!=64: fail()
   proxy.stdin.write((json.dumps(dict(action='revoke',deliveryId=delivery))+'\n').encode());proxy.stdin.flush()
   if binding['platform']=='win32': stage='codex-relay-revoke-event'
   if relayEvent()!=dict(revoked=True,deliveryId=delivery): fail()
   if binding['platform']=='win32': stage='codex-relay-revoke-denial'
   denied(request(name,18081))
   if binding['platform']=='win32': stage='codex-relay-peer-response'
   stage='codex-relay-peer-positive'
   if not request(peer,18082,token=peerCap,identity=peerId).startswith(b'HTTP/1.1 200 '): fail()
   if binding['platform']=='win32': stage='codex-relay-peer-count'
   if peerEvent().get('accepted')!=2: fail()
   stage='codex-relay-expiry'
   expiryId=str(uuid.uuid4());expiryCap=uuid.uuid4().hex+uuid.uuid4().hex
   armable=binding['platform']=='darwin'
   expiryProxy,expiryEvent=relay(peer,18083,expiryId,expiryCap,2,60 if armable else 1.5,armable)
   if not request(peer,18083,token=expiryCap,identity=expiryId).startswith(b'HTTP/1.1 200 '): fail()
   if expiryEvent().get('accepted')!=1: fail()
   # Hold a valid request body incomplete: expiry must not wait for HTTP reads.
   slow=subprocess.Popen(['podman','exec','-i',peer,'nc','-w','3','127.0.0.1','18083'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
   header=('POST /v1/responses HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer '+expiryCap+'\r\nX-AIOS-Delivery: '+expiryId+'\r\nContent-Type: application/json\r\nContent-Length: '+str(len(body))+'\r\n\r\n').encode()
   slow.stdin.write(header+body[:-1]);slow.stdin.flush()
   if armable:
    if expiryEvent()!=dict(bodyReadPending=True,deliveryId=expiryId): fail()
    expiryProxy.stdin.write((json.dumps(dict(action='arm-expiry',deliveryId=expiryId))+'\n').encode());expiryProxy.stdin.flush()
    if expiryEvent()!=dict(expiryArmed=True,deliveryId=expiryId): fail()
   expiryProxy.wait(timeout=3)
   slow.stdin.close();slow.wait(timeout=4)
   if slow.stdout.read(65537)!=b'': fail()
   if expiryProxy.returncode!=0 or request(peer,18083,token=expiryCap,identity=expiryId)!=b'': fail()
   stage='codex-relay-peer-positive'
   if not request(peer,18082,token=peerCap,identity=peerId).startswith(b'HTTP/1.1 200 '): fail()
   if peerEvent().get('accepted')!=3: fail()
   denied(request(peer,18082,token=peerCap,identity=peerId))
   if __import__('select').select([proxy.stdout],[],[],0)[0]: fail()
   stage='codex-process-audit'
   # Observe actual Codex processes, not only the initial sleep process.
   pids=census(cg);codexPids=[]
   for pid in pids:
    cmd=pathlib.Path('/proc/'+pid+'/cmdline').read_bytes()
    if b'/codex' not in cmd: continue
    values={x.split(':',1)[0]:x.split(':',1)[1].strip() for x in pod('unshare','cat','/proc/'+pid+'/status').decode().splitlines() if ':' in x}
    stage='codex-process-privileges'
    if values.get('NoNewPrivs')!='1' or values.get('Seccomp')!='2' or int(values.get('CapEff','f'),16)!=0 or values.get('Uid','').split()!=['65534']*4: fail()
    stage='codex-process-environment'
    env=dict(x.split(b'=',1) for x in pod('unshare','cat','/proc/'+pid+'/environ').split(b'\0') if b'=' in x)
    if env!={b'PATH':b'/usr/bin:/bin',b'HOME':b'/',b'HOSTNAME':b'aios-offline',b'DELIVERY_CAPABILITY':cap.encode(),b'CODEX_HOME':b'/tmp/empty-codex',**runtimeEnv}: fail()
    codexPids.append(pid);stage='codex-process-audit'
   if not codexPids or pathlib.Path(private).read_text()!=secret: fail()
   record['pids'].update(pids);save(probePath,record)
   stage='codex-relay-shutdown'
   stop(name,record);record['stopped']=True;save(probePath,record)
   stop(peer,peerRecord);peerRecord['stopped']=True;save(peerPath,peerRecord)
   # Discard stopped public-binary fixtures so repeated qualification does not fill the Mac disk.
   for target,saved,path in [(name,record,probePath),(peer,peerRecord,peerPath)]:
    discard_stopped_fixture(target,saved,path)
   for p in proxies:
    p.stdin.close();p.wait(timeout=5)
   # Management relay processes also stop; worker cgroups do not contain them.
   for p in proxies:
    for item in pathlib.Path('/proc').iterdir():
     if not item.name.isdigit(): continue
     try:
      fields=(item/'stat').read_text().rsplit(')',1)[1].split()
      if fields[2]==str(p.pid): fail()
     except FileNotFoundError: pass
   child.wait(timeout=5)
   stage='codex-post-binding'
   if {**R['hostBinding'],**snapshot()}!=binding: fail()
   print(json.dumps(dict(binding=binding,protocol='passed',explicitResume='passed',resumeInferenceRequests=0,credentialIsolation='passed',binarySha256=binaryHash,effective=e,observedCodexProcesses=len(codexPids),shutdown=dict(remainingProcesses=0),endpointEnforcement='passed',deliveryCapabilities='passed',relayDeliveryId=delivery,relayScope='synthetic-codex-relay',relayShutdownRemaining=0,gatewayIntegration='passed',gatewayVersion=R['gatewayVersion'],capabilityChecks=['cross-delivery','namespace','revocation','quota','expiry'],**({'taskLimits':{key:diagnostic[key] for key in ['processLimitHits','workerTaskCount','workerTaskLimit','codexRuntimeTasks','codexSqliteTasks','codexOtherTasks','codexAllocatorTasks','originalCodexTasks','postCrashTasks'] if key in diagnostic}} if binding['platform']=='win32' else {}))))
  except Exception as error:
   freeze_failure(error)
   if 'observeTaskLimits' in locals():
    try: observeTaskLimits()
    except Exception: pass
   raise

  finally:
   if os.path.exists(probePath) and not record.get('stopped'):
    stop(name,record);record['stopped']=True;save(probePath,record)
   for p in proxies:
    if p.poll() is None:
     if not p.stdin.closed: p.stdin.close()
     p.wait(timeout=5)
   if peer is not None and not peerRecord.get('stopped'):
    stop(peer,peerRecord);peerRecord['stopped']=True
    if peerPath is not None: save(peerPath,peerRecord)
   for target,saved,path in [(name,record,probePath),(peer,peerRecord if peer else {},peerPath)]:
    discard_stopped_fixture(target,saved,path)
   if slow is not None and slow.poll() is None: slow.kill();slow.wait(timeout=5)
   if child is not None and child.poll() is None: child.kill();child.wait(timeout=5)
   if os.path.exists(private): os.unlink(private)
 elif R['action']=='boundary-probe':
  r=R;s=r['session'];j=session_record(r)
  name='aios-offline-'+s['sandboxId']
  stage='frame';c=json.loads(pod('inspect',name))[0]
  stage='effective-frame';assert c['State']['Running'] and c['Config']['Labels']['aios.session']==s['workerSessionId'] and not c.get('Mounts') and c['HostConfig']['NetworkMode']=='none'
  stage='fixtures';directory=pathlib.Path(root)/('boundary-'+r['challenge']);directory.mkdir(mode=0o700);private(directory,True)
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
 elif R['action'] in ['task-execute','task-collect']:
  r=R;s=r['session'];j=session_record(r,r['action']=='task-collect')
  name='aios-offline-'+s['sandboxId']
  c=json.loads(pod('inspect',name))[0]
  assert c['Config']['Labels']['aios.session']==s['workerSessionId']
  task=root+'/task-'+s['sandboxId']+'.json'
  if r['action']=='task-execute':
   stage='authority'
   assert not j.get('revoked') and c['State']['Running'] and j['session']['fence']==s['fence']
   assert c['Config']['User']=='65534:65534' and c['HostConfig']['NetworkMode']=='none' and c['HostConfig']['ReadonlyRootfs'] and not c.get('Mounts')
   pod('exec',name,'mkdir','-m','700','/tmp/site')
   archive=io.BytesIO()
   stage='input-transfer'
   with tarfile.open(fileobj=archive,mode='w') as tar:
    for f in r['files']:
     assert f['path'] in ['index.html','validate.sh']
     data=base64.b64decode(f['bytes'],validate=True)
     assert len(data)<4096
     info=tarfile.TarInfo(f['path']);info.size=len(data);info.mode=0o444;info.uid=65534;info.gid=65534
     tar.addfile(info,io.BytesIO(data))
   pod('cp','-',name+':/tmp/site/',input=archive.getvalue())
   script=r'''set -eu
  cd /tmp/site
  if /bin/sh validate.sh; then exit 1; fi
  sed 's/<h1>Before<\/h1>/<h1>Ready<\/h1>/' index.html > replacement.html
  mv replacement.html index.html
  /bin/sh validate.sh
  { printf 'HTTP/1.0 200 OK\r\nContent-Type: text/html\r\nContent-Length: %s\r\n\r\n' "$(wc -c < index.html)"; cat index.html; } | busybox nc -l -p 18921 -w 3 > /dev/null & server=$!
  trap 'kill "$server" 2>/dev/null || true; wait "$server" 2>/dev/null || true' EXIT
  sleep 0.1
  wget -T 2 -q -O fetched.html http://127.0.0.1:18921/index.html
  cmp index.html fetched.html
  cat index.html
  '''
   stage='isolated-validation'
   output=pod('exec',name,'/bin/sh','-c',script)
   assert output==base64.b64decode(r['expected'],validate=True)
   result=dict(operationId=s['operationId'],version=r['version'],inputSha256=h(base64.b64decode(r['files'][0]['bytes'])),outputSha256=h(output),output=output.decode(),validation='passed',negativeValidation='passed',httpValidation='passed')
   fd=os.open(task,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
   with os.fdopen(fd,'w') as f: json.dump(result,f);f.flush();os.fsync(f.fileno())
   print(json.dumps(dict(completed=True)))
  else:
   stage='collection'
   assert r['action']=='task-collect' and j.get('revoked') and j.get('stopped') and j['session']==s and not c['State']['Running']
   result=read(task);a=pathlib.Path(task).read_bytes();b=pathlib.Path(task).read_bytes();assert a==b
   assert result['operationId']==s['operationId'] and result['version']==r['version']
   result['collectionSha256']=h(a);print(json.dumps(result))
 elif R['action']=='model-frame':
  binding={**R['hostBinding'],**snapshot()}
  if binding!=R['expected']: fail()
  mode=R['frameMode']
  data=base64.b64decode(R['frame'],validate=True)
  if mode=='request':
   value=json.loads(data)
   expected=R['inferenceContract']['request']
   if value!=expected: fail()
  elif mode=='response':
   if data!=R['inferenceContract']['marker'].encode(): fail()
  else: fail()
  if len(data)>4096: fail()
  name='aios-model-frame-'+str(uuid.uuid4())
  record=dict(name=name,cgroup='',pids={},stopped=False)
  probePath=root+'/probe-'+str(uuid.uuid4())+'.json'
  try:
   create(name,'sleep 600',{'aios.authority':R['authority']})
   save(probePath,record);pod('start',name)
   cg=cgroup(inspect(name)['State']['Pid']);record.update(cgroup=cg,pids=census(cg));save(probePath,record)
   e=effective(name)
   result=subprocess.run(['podman','exec','-i',name,'cat'],input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=5)
   if result.returncode or result.stdout!=data: fail()
   record['pids'].update(census(cg));stop(name,record);record['stopped']=True;save(probePath,record)
   if {**R['hostBinding'],**snapshot()}!=binding: fail()
   print(json.dumps(dict(binding=binding,effective=e,frame=base64.b64encode(result.stdout).decode(),shutdown=dict(remainingProcesses=0,observedProcesses=len(record['pids'])))))
  finally:
   if os.path.exists(probePath) and not record.get('stopped'):
    stop(name,record);record['stopped']=True;save(probePath,record)
 elif R['action'] in ['execute','stop','collect']:
  s=R['session']; pins=R['pins']; name='aios-offline-'+s['sandboxId']
  path=root+'/'+s['sandboxId']+'.json'
  record=read(path) if os.path.exists(path) else None
  if record:
   for k in ['deliveryId','operationId','sandboxId','workerSessionId','repositoryKey']:
    if record['session'][k]!=s[k]: fail()
   if record['pins']!=pins: fail()
  key=h(s['repositoryKey'].encode()); fence=authority['fences'].get(key,0)
  if R['action']=='execute':
   if record or s['fence']<=fence: fail()
   binding={**R['hostBinding'],**snapshot()}
   if binding!=R['expected']: fail()
   authority['fences'][key]=s['fence']; save(registry,authority)
   record=dict(session=s,pins=pins,revoked=False,cgroup='',pids={})
   save(path,record)
   try:
    create(name,R['worker'],{'aios.authority':R['authority'],'aios.session':s['workerSessionId']})
    data=base64.b64decode(R['input'],validate=True)
    if data!=b'AIOS offline canary input\n': fail()
    archive=io.BytesIO()
    with tarfile.open(fileobj=archive,mode='w') as tar:
     entry=tarfile.TarInfo('canary.txt'); entry.size=len(data); entry.mode=0o444; entry.uid=65534; entry.gid=65534
     tar.addfile(entry,io.BytesIO(data))
    result=subprocess.run(['podman','cp','-',name+':/'],input=archive.getvalue(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
    if result.returncode: fail()
    pod('start',name)
    pid=inspect(name)['State']['Pid']; cg=cgroup(pid)
    record.update(cgroup=cg,pids=census(cg)); save(path,record)
    e=effective(name)
    for attempt in range(20):
     if pod('logs',name)==b'AIOS offline canary complete\n': break
     time.sleep(0.05)
    else: fail()
    record['pids'].update(census(cg)); save(path,record)
    print(json.dumps(dict(**s,**pins,status='running',fresh=True,binding=binding,effective=e)))
   except BaseException:
    try:
     stop(name,record); record['stopped']=True; save(path,record)
    except BaseException: pass
    raise
  elif R['action']=='stop':
   if s['fence']<fence: fail()
   authority['fences'][key]=s['fence']; save(registry,authority)
   if not record: record=dict(session=s,pins=pins,cgroup='',pids={})
   record.update(session=s,revoked=True); save(path,record)
   existence=subprocess.run(['podman','container','exists',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=R['target']['guestCommandSeconds'])
   if existence.returncode not in [0,1]: fail()
   exists=existence.returncode==0
   if exists:
    c=inspect(name)
    if c['Config'].get('Labels',{}).get('aios.session')!=s['workerSessionId']: fail()
    if c['State'].get('Running'):
     cg=cgroup(c['State']['Pid']); record['cgroup']=cg; record['pids'].update(census(cg)); save(path,record)
    if not record['cgroup'] and c['State'].get('Status') not in ['created','configured']: fail()
    stop(name,record)
   record['stopped']=True; record['session']={**s,'state':'stopped'}; save(path,record)
   print(json.dumps(dict(**s,**pins,status='stopped',revoked=True,descendantsStopped=True,
      evidence=dict(observedProcesses=len(record['pids']),remainingProcesses=0,censusSha256=h(json.dumps(record['pids'],sort_keys=True).encode())))))
  else:
   if not record or not record.get('revoked') or not record.get('stopped') or s['fence']!=fence: fail()
   if record['session']!=s or not gone(record) or inspect(name)['State'].get('Running'): fail()
   a=pod('logs',name); b=pod('logs',name)
   if a!=b or a!=b'AIOS offline canary complete\n': fail()
   print(json.dumps(dict(**s,**pins,status='stopped',content=base64.b64encode(a).decode(),beforeSha256=h(a),afterSha256=h(b))))
 else: fail()
`;

export const vmManagementVersion = sha256(
  guest + JSON.stringify(inferenceFixtureContract()),
);

export const codexProbeStages = [
  "codex-binding",
  "codex-binary",
  "codex-create",
  "codex-copy",
  "codex-version",
  "codex-credential-denials",
  "codex-initialize",
  "codex-account-read",
  "codex-start-task-budget",
  "codex-resume-task-budget",
  "codex-relay-task-budget",
  "codex-explicit-resume",
  "codex-resume-persistence",
  "codex-persistence-read-error",
  "codex-persistence-thread",
  "codex-persistence-history",
  "codex-resume-exit",
  "codex-resume-kill",
  "codex-resume-wait",
  "codex-resume-status",
  "codex-resume-census",
  "codex-resume-initialize",
  "codex-resume-account",
  "codex-resume-history",
  "codex-resume-rollout",
  "codex-resume-permission",
  "codex-resume-not-found",
  "codex-process-exited",
  "codex-process-audit",
  "codex-relay-shutdown",
  "codex-post-binding",
  "codex-process-privileges",
  "codex-process-environment",
  "codex-relay-start",
  "codex-relay-denials",
  "codex-relay-turn",
  "codex-relay-revocation",
  "codex-relay-revoke-event",
  "codex-relay-revoke-denial",
  "codex-relay-peer-response",
  "codex-relay-peer-count",
  "codex-relay-expiry",
] as const;
export const boundaryProbeStages = [
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
] as const;
export const taskProbeStages = [
  "authority",
  "input-transfer",
  "isolated-validation",
  "collection",
] as const;
function ordinary(path: string, directory = false): void {
  const entry = lstatSync(path);
  if (
    entry.isSymbolicLink() ||
    (platform() === "win32"
      ? realpathSync(path).toLowerCase() !== resolve(path).toLowerCase()
      : realpathSync(path) !== resolve(path)) ||
    (directory ? !entry.isDirectory() : !entry.isFile() || entry.nlink !== 1)
  )
    throw Error("Unsafe native path");
}
/** One trusted management program and transport for every native VM action. */
export class VMManagementChannel {
  constructor(
    readonly machine: string,
    readonly authorityDirectory: string,
    private readonly host: typeof podmanMachine = podmanMachine,
  ) {}
  prepare(action: VMAction, payload: Record<string, unknown> = {}) {
    if (existsSync(this.authorityDirectory))
      ordinary(this.authorityDirectory, true);
    const host = this.host(this.machine);
    const clientVersion = JSON.parse(
      podmanCommand(host, [
        "--connection",
        this.machine,
        "version",
        "--format",
        "json",
      ]),
    ).Client?.Version;
    if (!/^\d+\.\d+\.\d+$/.test(clientVersion ?? ""))
      throw Error("Unknown client version");
    const executableSha256 = sha256(readFileSync(host.executable));
    const authorityPath = resolve(this.authorityDirectory);
    const authority = sha256(
      host.platform === "win32" ? authorityPath.toLowerCase() : authorityPath,
    );
    const request = {
      ...payload,
      action,
      authority,
      host: hostname() + executableSha256 + clientVersion,
      guestArch: host.guestArch,
      imageReference: host.imageReference,
      hostBinding: {
        platform: host.platform,
        arch: host.arch,
        osVersion: host.osVersion,
        provider: host.provider,
        machine: this.machine,
      },
      template: host.offlineTemplate,
      worker,
      managementVersion: vmManagementVersion,
      hostCanaryVersion,
      inferenceContract: inferenceFixtureContract(),
      target: {
        guestCommandSeconds: host.guestCommandSeconds,
        codexWorkerSha256: host.codexWorkerSha256,
      },
    };
    // Send fixed management code on stdin: Windows SSH truncates long command
    // arguments. The request is base64 data, never interpolated shell source.
    const input =
      "import json,base64\n" +
      `R=json.loads(base64.b64decode('${Buffer.from(JSON.stringify(request)).toString("base64")}'))\n` +
      (["isolate", "codex-protocol"].includes(action)
        ? "stage='initialization'\ndiagnostic={'failureKind':'check'}\nprobeStarted=__import__('time').monotonic()\ntry:\n" +
          guest
            .split("\n")
            .map((line) => " " + line)
            .join("\n") +
          "\nexcept BaseException:\n diagnostic['elapsedMs']=round((__import__('time').monotonic()-probeStarted)*1000)\n print(json.dumps(dict(blockedStage=stage,challengeId=R['challenge']['id'],diagnostic=diagnostic)))\n"
        : ["boundary-probe", "task-execute", "task-collect"].includes(action)
          ? "stage='authority'\ntry:\n" +
            guest
              .split("\n")
              .map((line) => " " + line)
              .join("\n") +
            "\nexcept BaseException:\n print(stage,file=__import__('sys').stderr);raise SystemExit(1)\n"
          : guest);
    return { host, input, executableSha256 };
  }
  invoke(action: VMAction, payload: Record<string, unknown> = {}): any {
    const { host, input, executableSha256 } = this.prepare(action, payload);
    // The program is just over 64 KiB. Piped to spawnSync as `input`, macOS
    // sometimes never delivers EOF to its reader, so it crosses as a private
    // file opened as stdin instead, removed whatever the outcome.
    let directory: string | undefined, stdin: number | undefined;
    let result: SpawnSyncReturns<string>;
    try {
      try {
        directory = mkdtempSync(join(tmpdir(), "aios-management-"));
        const program = join(directory, "program.py");
        writeFileSync(program, input, { flag: "wx", mode: 0o600 });
        stdin = openSync(program, "r");
      } catch {
        throw Error("Native offline operation unavailable");
      }
      result = spawnSync(
        host.executable,
        ["machine", "ssh", this.machine, "python3"],
        {
          cwd: host.cwd,
          shell: false,
          windowsHide: true,
          encoding: "utf8",
          timeout: host.managementMs,
          maxBuffer: 1048576,
          stdio: [stdin, "pipe", "pipe"],
          env: host.env,
        },
      );
    } finally {
      if (stdin !== undefined) closeSync(stdin);
      if (directory) rmSync(directory, { recursive: true, force: true });
    }
    if (sha256(readFileSync(host.executable)) !== executableSha256)
      throw Error("Changed native executable");
    if (result.error || result.status !== 0) {
      const stages: readonly string[] =
        action === "boundary-probe"
          ? boundaryProbeStages
          : action.startsWith("task-")
            ? taskProbeStages
            : [];
      const stage = result.stderr?.trim();
      if (stage && stages.includes(stage))
        process.stderr.write(
          JSON.stringify(
            action === "boundary-probe"
              ? { hostBoundaryRefusal: stage }
              : { syntheticTaskRefusal: stage },
          ) + "\n",
        );
      throw Error("Native offline operation unavailable");
    }
    return JSON.parse(result.stdout);
  }
  openCodex(payload: Record<string, unknown>) {
    const { host, input, executableSha256 } = this.prepare(
      "codex-protocol",
      payload,
    );
    const child = spawn(
      host.executable,
      [
        "machine",
        "ssh",
        this.machine,
        "python3",
        "-u",
        "-c",
        "'import sys,base64;exec(base64.b64decode(sys.stdin.readline()))'",
      ],
      {
        cwd: host.cwd,
        shell: false,
        windowsHide: true,
        env: host.env,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    return {
      child,
      deadlineMs: host.platform === "darwin" ? 180000 : 55000,
      start: () =>
        child.stdin.write(Buffer.from(input).toString("base64") + "\n"),
      unchanged: () =>
        sha256(readFileSync(host.executable)) === executableSha256,
    };
  }
}
