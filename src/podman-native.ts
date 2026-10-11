import { spawnSync } from "node:child_process";
import { hostname, platform } from "node:os";
import { podmanMachine, podmanCommand } from "./podman-platform.js";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { WorkerSession } from "./controller.js";
import type { PodmanObservation } from "./podman-host.js";
import { hostCanaryVersion, withHostCanary } from "./host-canary.js";
import {
  canaryInput,
  canaryOutput,
  sha256,
  matchesCanary,
  type CanaryPins,
  type OfflineCanaryRuntime,
  type CanaryExecution,
  type CanaryStop,
  type CanaryCollection,
} from "./offline-canary.js";

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
setsid /bin/sh -c 'sleep 600 &'
sleep 0.1
cat /tmp/result.txt
wait
`;
export const offlineTemplate =
  "docker.io/library/alpine@sha256:3e9b4b680bfc9fb5269227cffbd6d42be39fbf7c0b908123913864aa4447e764";
const macosOfflineTemplate =
  "docker.io/library/alpine@sha256:24bb3511a0db7b5114a4aee033c65a8a4148f39b7b80a398e548546db967a36f";

/** Runs only in the VM's trusted management namespace, not in the worker.
 * A machine-wide flock serializes dispatch with durable revocation. A single
 * authority directory is bound during explicit enrollment. Worker containers
 * cannot mount/read this directory, its lock, engine sockets or the host.
 * Artifact transport is the bounded fixed stdout record, read twice only after
 * independent cgroup/PID shutdown. No tar extraction or guest paths are imported. */
const guest = String.raw`
import os,json,subprocess,hashlib,base64,fcntl,pathlib,uuid,time,io,tarfile
def fail(): raise RuntimeError('Native offline observation unavailable')
def command(args):
 p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
 if p.returncode: fail()
 if len(p.stdout)>1048576: fail()
 return p.stdout
def pod(*args): return command(['podman',*args])
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
def read(path):
 if os.path.islink(path): fail()
 with open(path) as f: return json.load(f)
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
 for p in ['/run/podman/podman.sock',engineSocket,'/var/run/docker.sock','/mnt/c','/Users']:
  if subprocess.run(['podman','exec',name,'test','-e',p],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0: fail()
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
if os.path.islink(root) or (os.stat(root).st_mode & 0o077): fail()
fd=os.open(root+'/lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
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
  binaryHash='0129f94f4f1197bd75f6c4265889061f386ed302bbc50c6e57e3e0660dfb28a7'
  if h(data)!=binaryHash: fail()
  private=root+'/credential-'+str(uuid.uuid4());secret=uuid.uuid4().hex
  pathlib.Path(private).write_text(secret);os.chmod(private,0o600)
  name='aios-codex-protocol-'+str(uuid.uuid4());record=dict(name=name,cgroup='',pids={},stopped=False)
  probePath=root+'/probe-'+str(uuid.uuid4())+'.json'; child=None
  try:
   stage='codex-create'
   create(name,'sleep 600',{'aios.authority':R['authority']},'512m')
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
   for path in [private,*R['challenge']['files']]:
    if subprocess.run(['podman','exec',name,'cat',path],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0: fail()
    if subprocess.run(['podman','exec',name,'cat','/proc/1/root'+path],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0: fail()
   stage='codex-credential-denials'
   pod('exec',name,'mkdir','-m','700','/tmp/empty-codex')
   cap=uuid.uuid4().hex+uuid.uuid4().hex
   args=['podman','exec','-i','--env','DELIVERY_CAPABILITY='+cap,'--env','CODEX_HOME=/tmp/empty-codex',name,'/codex','app-server','--listen','stdio://','-c','model_provider="qualification"','-c','model_providers.qualification.name="Synthetic only"','-c','model_providers.qualification.base_url="http://127.0.0.1:1/v1"','-c','model_providers.qualification.env_key="DELIVERY_CAPABILITY"','-c','model_providers.qualification.wire_api="responses"','-c','model_providers.qualification.requires_openai_auth=false','-c','model_providers.qualification.supports_websockets=false']
   stage='codex-initialize'
   child=subprocess.Popen(args,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
   def send(value): child.stdin.write((json.dumps(value)+'\n').encode());child.stdin.flush()
   send(dict(method='initialize',id=1,params=dict(clientInfo=dict(name='Developer_OS',version='0.1.0'),capabilities={})))
   selector=selectors.DefaultSelector()
   selector.register(child.stdout,selectors.EVENT_READ,'stdout');selector.register(child.stderr,selectors.EVENT_READ,'stderr')
   deadline=time.monotonic()+5;total=0;initialized=False;verified=False;pending=b''
   while time.monotonic()<deadline and not verified:
    for event,_ in selector.select(0.1):
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
      if message.get('error'): fail()
      if message.get('id')==1:
       if not message.get('result'): fail()
       initialized=True;stage='codex-account-read';send(dict(method='initialized'));send(dict(method='account/read',id=2,params=dict(refreshToken=False)))
      elif message.get('id')==2:
       value=message.get('result',{})
       if not initialized or value.get('account') is not None or value.get('requiresOpenaiAuth') is not False: fail()
       verified=True;break
   if not verified: fail()
   stage='codex-process-audit'
   # Observe actual Codex processes, not only the initial sleep process.
   pids=census(cg);codexPids=[]
   for pid in pids:
    cmd=pathlib.Path('/proc/'+pid+'/cmdline').read_bytes()
    if b'/codex' not in cmd: continue
    values={x.split(':',1)[0]:x.split(':',1)[1].strip() for x in pod('unshare','cat','/proc/'+pid+'/status').decode().splitlines() if ':' in x}
    if values.get('NoNewPrivs')!='1' or values.get('Seccomp')!='2' or int(values.get('CapEff','f'),16)!=0 or values.get('Uid','').split()!=['65534']*4: fail()
    env=dict(x.split(b'=',1) for x in pod('unshare','cat','/proc/'+pid+'/environ').split(b'\0') if b'=' in x)
    if env!={b'PATH':b'/usr/bin:/bin',b'HOME':b'/',b'HOSTNAME':b'aios-offline',b'DELIVERY_CAPABILITY':cap.encode(),b'CODEX_HOME':b'/tmp/empty-codex'}: fail()
    codexPids.append(pid)
   if not codexPids or pathlib.Path(private).read_text()!=secret: fail()
   record['pids'].update(pids);save(probePath,record)
   stop(name,record);record['stopped']=True;save(probePath,record)
   child.wait(timeout=5)
   if {**R['hostBinding'],**snapshot()}!=binding: fail()
   print(json.dumps(dict(binding=binding,protocol='passed',credentialIsolation='passed',binarySha256=binaryHash,effective=e,observedCodexProcesses=len(codexPids),shutdown=dict(remainingProcesses=0))))
  finally:
   if os.path.exists(probePath) and not record.get('stopped'):
    stop(name,record);record['stopped']=True;save(probePath,record)
   if child is not None and child.poll() is None: child.kill();child.wait(timeout=5)
   if os.path.exists(private): os.unlink(private)
 elif R['action']=='model-frame':
  binding={**R['hostBinding'],**snapshot()}
  if binding!=R['expected']: fail()
  mode=R['frameMode']
  data=base64.b64decode(R['frame'],validate=True)
  if mode=='request':
   value=json.loads(data)
   expected={'model':'gpt-6.1-sol','input':[{'role':'user','content':'Say exactly: AIOS model-only inference complete'}],'store':False,'stream':True}
   if value!=expected: fail()
  elif mode=='response':
   if data!=b'AIOS model-only inference complete': fail()
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
   exists=subprocess.run(['podman','container','exists',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0
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
function contains(root: string, path: string): boolean {
  const rel = relative(root, path);
  return (
    rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  );
}
export class NativePodmanDriver implements OfflineCanaryRuntime {
  readonly mode = "live" as const;
  constructor(
    readonly machine: string,
    readonly authorityDirectory: string,
    readonly policyPath: string,
  ) {
    if (
      !/^aios-[a-z0-9-]+$/.test(machine) ||
      !isAbsolute(authorityDirectory) ||
      !isAbsolute(policyPath)
    )
      throw Error("Invalid native driver options");
  }
  private invoke(action: string, payload: Record<string, unknown> = {}): any {
    if (existsSync(this.authorityDirectory))
      ordinary(this.authorityDirectory, true);
    const host = podmanMachine(this.machine);
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
      template:
        host.guestArch === "arm64" ? macosOfflineTemplate : offlineTemplate,
      worker,
      managementVersion: sha256(guest),
      hostCanaryVersion,
      ...payload,
    };
    // Send fixed management code on stdin: Windows SSH truncates long command
    // arguments. The request is base64 data, never interpolated shell source.
    const input =
      "import json,base64\n" +
      `R=json.loads(base64.b64decode('${Buffer.from(JSON.stringify(request)).toString("base64")}'))\n` +
      (["isolate", "codex-protocol"].includes(action)
        ? "stage='initialization'\ntry:\n" +
          guest
            .split("\n")
            .map((line) => " " + line)
            .join("\n") +
          "\nexcept BaseException:\n print(json.dumps(dict(blockedStage=stage,challengeId=R['challenge']['id'])))\n"
        : guest);
    const result = spawnSync(
      host.executable,
      ["machine", "ssh", this.machine, "python3"],
      {
        cwd: host.cwd,
        shell: false,
        windowsHide: true,
        encoding: "utf8",
        timeout: 25000,
        maxBuffer: 1048576,
        input,
        env: host.env,
      },
    );
    if (sha256(readFileSync(host.executable)) !== executableSha256)
      throw Error("Changed native executable");
    if (result.error || result.status !== 0)
      throw Error("Native offline operation unavailable");
    return JSON.parse(result.stdout);
  }
  private policy(repository?: string): Record<string, string> {
    if (
      repository &&
      (contains(realpathSync(repository), resolve(this.authorityDirectory)) ||
        contains(resolve(this.authorityDirectory), realpathSync(repository)))
    )
      throw Error("Keep native authority separate from candidate");
    ordinary(this.policyPath);
    if (
      lstatSync(this.policyPath).size > 65536 ||
      contains(
        resolve(this.authorityDirectory),
        realpathSync(this.policyPath),
      ) ||
      (repository &&
        contains(realpathSync(repository), realpathSync(this.policyPath)))
    )
      throw Error("Untrusted native pins");
    const policy = JSON.parse(readFileSync(this.policyPath, "utf8"));
    if (
      policy.schema !== 1 ||
      !policy.binding ||
      Object.keys(policy).some((k) => !["schema", "binding"].includes(k))
    )
      throw Error("Invalid native pins");
    return policy.binding;
  }
  pin(repository: string): PodmanObservation {
    const target = resolve(this.policyPath);
    if (
      contains(realpathSync(repository), resolve(this.authorityDirectory)) ||
      contains(resolve(this.authorityDirectory), realpathSync(repository)) ||
      contains(realpathSync(repository), target) ||
      contains(resolve(this.authorityDirectory), target)
    )
      throw Error("Keep native pins outside candidate and authority");
    mkdirSync(dirname(target), { recursive: true });
    ordinary(dirname(target), true);
    const observation = this.invoke("enroll");
    writeFileSync(
      target,
      JSON.stringify({ schema: 1, binding: observation.binding }, null, 2) +
        "\n",
      { flag: "wx", mode: 0o600, flush: true },
    );
    return observation;
  }
  observe(repository: string): PodmanObservation {
    return this.invoke("observe", { expected: this.policy(repository) });
  }
  async probeIsolation(repository: string): Promise<any> {
    const expected = this.policy(repository);
    const evidence = await withHostCanary((challenge) => {
      const observed = this.invoke("isolate", { expected, challenge });
      if (observed.challengeId !== challenge.id)
        throw Error("Unbound isolation evidence");
      if (observed.passed === true && expected.platform === "darwin") {
        const codex = this.invoke("codex-protocol", { expected, challenge });
        if (codex.blockedStage) {
          observed.codex = { blockedStage: codex.blockedStage };
        } else if (
          codex.protocol !== "passed" ||
          codex.credentialIsolation !== "passed" ||
          codex.shutdown?.remainingProcesses !== 0 ||
          codex.observedCodexProcesses < 1 ||
          JSON.stringify(codex.binding) !== JSON.stringify(expected)
        )
          throw Error("Unverified Codex worker");
        if (!codex.blockedStage) observed.codex = codex;
      }
      return { ...observed, probeVersion: sha256(guest + hostCanaryVersion) };
    });
    if (evidence.passed === true) {
      const body = JSON.stringify({
        model: "gpt-6.1-sol",
        input: [
          {
            role: "user",
            content: "Say exactly: AIOS model-only inference complete",
          },
        ],
        store: false,
        stream: true,
      });
      this.modelFrame(repository, "request", body);
      this.modelFrame(
        repository,
        "response",
        "AIOS model-only inference complete",
      );
      evidence.modelFrameTransport = "passed";
    }
    return evidence;
  }
  /** Fixed synthetic request/result transport only, not a production worker. */
  modelFrame(
    repository: string,
    frameMode: "request" | "response",
    frame: string,
  ): any {
    if (Buffer.byteLength(frame) > 4096) throw Error("Model frame too large");
    const expected = this.policy(repository);
    const observed = this.invoke("model-frame", {
      expected,
      frameMode,
      frame: Buffer.from(frame).toString("base64"),
    });
    if (
      JSON.stringify(observed.binding) !== JSON.stringify(expected) ||
      observed.frame !== Buffer.from(frame).toString("base64") ||
      observed.shutdown?.remainingProcesses !== 0
    )
      throw Error("Unverified model frame");
    return observed;
  }
  async execute(
    request: Parameters<OfflineCanaryRuntime["execute"]>[0],
  ): Promise<CanaryExecution> {
    this.session(request.session);
    if (
      !request.mayDispatch() ||
      request.files.length !== 1 ||
      request.files[0]?.path !== "canary.txt" ||
      !request.files[0].bytes.equals(Buffer.from(canaryInput))
    )
      throw Error("Native dispatch refused");
    const expected = this.policy();
    if (
      Object.keys(expected).length !== Object.keys(request.binding).length ||
      Object.entries(expected).some(
        ([key, value]) => request.binding[key] !== value,
      ) ||
      sha256(readFileSync(this.policyPath)) !== request.policySha256
    )
      throw Error("Changed native pins");
    return this.invoke("execute", {
      expected,
      session: request.session,
      pins: {
        bindingSha256: request.bindingSha256,
        policySha256: request.policySha256,
      },
      input: request.files[0].bytes.toString("base64"),
    });
  }
  async stop(session: WorkerSession, pins: CanaryPins): Promise<CanaryStop> {
    this.session(session);
    return this.invoke("stop", { session, pins });
  }
  async collect(
    session: WorkerSession,
    pins: CanaryPins,
  ): Promise<CanaryCollection> {
    this.session(session);
    const result = this.invoke("collect", { session, pins });
    if (!matchesCanary(result, session, pins) || result.status !== "stopped")
      throw Error("Mismatched native collection");
    const bytes = Buffer.from(result.content, "base64");
    if (!bytes.equals(Buffer.from(canaryOutput)))
      throw Error("Invalid native output");
    const spool = join(
      this.authorityDirectory,
      "artifacts",
      `${session.sandboxId}-native-result.txt`,
    );
    ordinary(dirname(spool), true);
    writeFileSync(spool, bytes, { flag: "wx", mode: 0o600, flush: true });
    ordinary(spool);
    const before = sha256(readFileSync(spool));
    const after = sha256(readFileSync(spool));
    if (before !== result.beforeSha256 || after !== result.afterSha256)
      throw Error("Changed native spool");
    return {
      ...result,
      files: [
        {
          path: "result.txt",
          bytes,
          ordinary: true,
          links: lstatSync(spool).nlink,
          beforeSha256: before,
          afterSha256: after,
        },
      ],
    };
  }
  private session(session: WorkerSession): void {
    for (const key of [
      "deliveryId",
      "operationId",
      "sandboxId",
      "workerSessionId",
      "runnerId",
    ] as const)
      if (
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
          session[key],
        )
      )
        throw Error("Invalid native identity");
    if (!Number.isSafeInteger(session.fence) || session.fence < 1)
      throw Error("Invalid native fence");
  }
}
