import { createHash } from "node:crypto";
import {
  lockedCodingArgv,
  modelRoutePort,
  modelRouteVariable,
  resumeReconciliations,
  validModelRoute,
  type CodingPins,
  type CodingCollection,
  type CodingRequest,
  type ModelRoute,
  type CodingSession,
  type IsolatedCodingTransport,
  type ResumeReconciliation,
} from "./feature-candidate.js";
import {
  managementBindingSha256,
  managementHost,
  openManagementChannel,
  runManagement,
  validGuestBinding,
} from "./native-management.js";
import { admittedPath } from "./workspace.js";
import { redact } from "./redaction.js";
import { codexWorkerSha256, offlineTemplate } from "./podman-native.js";
import { codeModeHostSha256 } from "./host-target.js";
import { gatewayModel } from "./inference-contract.js";
import {
  boundaryProbeOutcomes,
  codingBoundaryProbe,
  codingBoundaryProbeNames,
} from "./worker-probes.js";
import {
  openSessionRelay,
  sessionRelayLimits,
  sessionRelaySource,
  type SessionGateway,
  type SessionRelay,
} from "./session-relay.js";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
/** An explicit coding session identity: a UUID operation and a positive fence. */
const sessionIdentity = (value: CodingSession | undefined) =>
  !!value &&
  uuid(value.operationId) &&
  Number.isSafeInteger(value.fence) &&
  value.fence >= 1;
const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const armTemplate =
  "docker.io/library/alpine@sha256:24bb3511a0db7b5114a4aee033c65a8a4148f39b7b80a398e548546db967a36f";

/** Trusted VM management source. Requests are JSON data, never generated commands.
 * This separate offline scope cannot reuse fixed-worker credentials/qualification. */
const management = String.raw`
import os,json,subprocess,hashlib,pathlib,stat,selectors,signal,time,sys,threading,select

def fail(): raise RuntimeError('Native coding observation unavailable')
# The fixed coding boundary probe (src/worker-probes.ts), part of this program's pin.
PROBE=${JSON.stringify(codingBoundaryProbe)}
def h(b): return hashlib.sha256(b).hexdigest()
def command(args):
 args=[args[0] if args[0].startswith('/') else '/usr/bin/'+args[0],*args[1:]]
 deadline=time.monotonic()+15
 p=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
 output=bytearray();errors=bytearray();completed=False
 try:
  # Bound observation streams, not the engine's private database files.
  with selectors.DefaultSelector() as streams:
   streams.register(p.stdout,selectors.EVENT_READ,output)
   streams.register(p.stderr,selectors.EVENT_READ,errors)
   while streams.get_map():
    remaining=deadline-time.monotonic()
    if remaining<=0: fail()
    for key,_ in streams.select(remaining):
     chunk=os.read(key.fd,65536)
     if not chunk:
      streams.unregister(key.fileobj);key.fileobj.close()
     else:
      if len(key.data)+len(chunk)>8388608: fail()
      key.data.extend(chunk)
  remaining=deadline-time.monotonic()
  if remaining<=0 or p.wait(timeout=remaining)!=0: fail()
  completed=True
  return bytes(output)
 finally:
  if not completed:
   try: os.killpg(p.pid,signal.SIGKILL)
   except ProcessLookupError: pass
  p.stdout.close();p.stderr.close()
  p.wait(timeout=3)
def pod(*args): return command(['podman',*args])
def obj(*args): return json.loads(pod(*args))
def ordinary(path):
 s=os.lstat(path)
 if not stat.S_ISREG(s.st_mode) or s.st_nlink!=1 or s.st_uid!=os.getuid(): fail()
 return s

# The owner provisions the code-mode host beside the CLI, from the same package.
hostSource=os.path.expanduser('~/.local/state/aios-offline-v1/codex-code-mode-host-0.161.0')
def provisioned(path,digest):
 if ordinary(path).st_mode&0o077: fail()
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as f: data=f.read()
 if h(data)!=digest: fail()
 return data

def snapshot():
 def mounts(entries):
  for x in entries:
   if x.get('fstype') in ['9p','virtiofs','cifs','nfs','nfs4'] or x.get('target','').startswith('/mnt/'): fail()
   mounts(x.get('children',[]))
 mounts(json.loads(command(['findmnt','--json','-o','FSTYPE,TARGET']))['filesystems'])
 vendor=pathlib.Path('/sys/class/dmi/id/sys_vendor').read_text().strip()
 product=pathlib.Path('/sys/class/dmi/id/product_name').read_text().strip()
 if R['provider']=='hyperv':
  if vendor!='Microsoft Corporation' or product!='Virtual Machine' or command(['uname','-m']).strip()!=b'x86_64': fail()
 elif R['provider']=='applehv':
  if vendor!='Apple Inc.' or product!='Apple Virtualization Generic Platform' or command(['systemd-detect-virt']).strip()!=b'apple' or command(['uname','-m']).strip()!=b'aarch64': fail()
 else: fail()
 boot=json.loads(command(['rpm-ostree','status','--json']))
 d=next(x for x in boot['deployments'] if x.get('booted'))
 image=d.get('container-image-reference-digest','')
 if d.get('unlocked')!='none' or not image.startswith('sha256:') or len(image)!=71 or d.get('container-image-reference')!=R['imageReference']: fail()
 if any(d.get(k) for k in ['requested-packages','requested-local-packages','base-local-replacements','base-removals']): fail()
 info=obj('info','--format','json')
 if not info['host']['security']['rootless'] or info['host']['cgroupVersion']!='v2': fail()
 if json.loads(command(['sudo','-n','podman','ps','--format','json'])): fail()
 for c in obj('ps','--format','json'):
  if c.get('Names')!=[R['name']]: fail()
 imageInfo=obj('image','inspect',R['template'])[0]
 if R['template'] not in imageInfo.get('RepoDigests',[]) or imageInfo.get('Architecture')!=R['guestArch']: fail()
 if imageInfo['Config'].get('Env')!=['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin']: fail()
 binary=os.path.expanduser('~/.local/state/aios-offline-v1/codex-0.161.0')
 s=ordinary(binary)
 if s.st_mode&0o077: fail()
 fd=os.open(binary,os.O_RDONLY|os.O_NOFOLLOW)
 with os.fdopen(fd,'rb') as f:
  if h(f.read())!=R['cliSha256']: fail()
 provisioned(hostSource,R['codeModeHostSha256'])
 machine_id=pathlib.Path('/etc/machine-id').read_text().strip()
 if not re.fullmatch('[a-f0-9]{32}',machine_id): fail()
 return dict(engineVersion=info['version']['Version'],vmImageSha256=image[7:],template=R['template'],hostId=h(machine_id.encode()))

import fcntl,uuid,base64,re,time,shutil
# The session relay (src/session-relay.ts), part of this program's pin.
RELAY=base64.b64decode('${Buffer.from(sessionRelaySource).toString("base64")}').decode()

def directory(path):
 os.makedirs(path,mode=0o700,exist_ok=True)
 p=pathlib.Path(path)
 for parent in [p,*p.parents]:
  if parent.is_symlink(): fail()
 s=os.lstat(path)
 if not stat.S_ISDIR(s.st_mode) or s.st_uid!=os.getuid() or s.st_mode&0o077: fail()
def retained_home(path):
 # Require existing private state; never synthesize a missing session home.
 s=os.lstat(path)
 if not stat.S_ISDIR(s.st_mode): fail()
 directory(path)
 # Codex recreates these on every start; a prior turn's copies never carry
 # over. Everything else is checked before anything is removed.
 regenerated=['skills','tmp','.tmp']
 skills=path+'/skills'
 if os.path.lexists(skills):
  if not stat.S_ISDIR(os.lstat(skills).st_mode): fail()
  with os.scandir(skills) as entries:
   if [e.name for e in entries]!=['.system']: fail()
 # Codex loads these from CODEX_HOME; a prior turn must not configure the next.
 with os.scandir(path) as entries:
  if any(e.name not in regenerated and (e.name.lower() in ['hooks.json','agents.md','agents.override.md','skills','rules','prompts','.env'] or e.name.lower().endswith('.toml')) for e in entries): fail()
 pending=[path];count=0;total=0
 while pending:
  current=pending.pop()
  with os.scandir(current) as entries:
   for entry in entries:
    if current==path and entry.name in regenerated: continue
    count+=1
    if count>4096: fail()
    s=entry.stat(follow_symlinks=False)
    if s.st_uid!=os.getuid(): fail()
    if stat.S_ISDIR(s.st_mode): pending.append(entry.path)
    else:
     ordinary(entry.path)
     total+=s.st_size
     if s.st_size>4194304 or total>16777216: fail()
 for name in regenerated:
  if os.path.lexists(path+'/'+name): remove_tree(path+'/'+name)
def save(path,value):
 temp=path+'.new-'+uuid.uuid4().hex
 fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'w') as f: json.dump(value,f);f.flush();os.fsync(f.fileno())
 os.replace(temp,path)
 fd=os.open(os.path.dirname(path),os.O_RDONLY|os.O_DIRECTORY)
 try: os.fsync(fd)
 finally: os.close(fd)
def reserve(keep):
 # Disk headroom that only stop spends. Workspaces share this filesystem, so
 # a worker that fills it must not also block its own shutdown records.
 path=root+'/reserve'
 if not keep:
  if os.path.lexists(path): os.unlink(path)
  return
 if os.path.lexists(path): return ordinary(path)
 try:
  fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  with os.fdopen(fd,'wb') as f: f.write(bytes(8388608));f.flush();os.fsync(f.fileno())
 except OSError:
  if os.path.lexists(path): os.unlink(path)
  raise
def predecessor_of(previous):
 # The explicitly named predecessor's record, path, directory name and identity.
 name='aios-coding-'+h((R['authority']+previous['operationId']).encode())[:32]
 identity=h(json.dumps(dict(operationId=previous['operationId'],fence=previous['fence']),sort_keys=True).encode())
 return name,root+'/'+name+'.json',read(root+'/'+name+'.json'),identity
def units_quiet(name):
 for suffix in ['-lease.timer','-deadline.timer','-lease.service','-deadline.service']:
  if timer_state(name+suffix)['ActiveState'] not in ['inactive','failed']: fail()
def stopped_container(name,sessionIdentity):
 # The exact session's stopped container; False when the engine has none.
 exists=subprocess.run(['/usr/bin/podman','container','exists',name],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
 if exists.returncode==1: return False
 if exists.returncode!=0: fail()
 c=obj('inspect',name)[0]
 if c['Config'].get('Labels',{})!={'aios.coding.authority':R['authority'],'aios.coding.session':sessionIdentity} or c['State'].get('Running') is not False or c['State'].get('Pid')!=0: fail()
 return True
def remove_tree(path):
 # Never follows links; owned directories a worker made read-only are opened.
 # The whole tree is scanned within fixed bounds before anything is removed.
 order=[];pending=[(path,0)]
 while pending:
  current,depth=pending.pop()
  if len(order)>=65536 or depth>256: fail()
  info=os.lstat(current)
  order.append((current,stat.S_ISDIR(info.st_mode)))
  if stat.S_ISDIR(info.st_mode):
   if info.st_uid==os.getuid(): os.chmod(current,stat.S_IMODE(info.st_mode)|0o700)
   with os.scandir(current) as entries: pending.extend((e.path,depth+1) for e in entries)
 for current,folder in reversed(order):
  if folder: os.rmdir(current)
  else: os.unlink(current)
def read(path):
 ordinary(path)
 with open(path) as f: return json.load(f)
def census(group):
 root=pathlib.Path('/sys/fs/cgroup')/group.lstrip('/')
 result={}
 if root.exists():
  for file in root.rglob('cgroup.procs'):
   for pid in file.read_text().split():
    try: result[pid]=pathlib.Path('/proc/'+pid+'/stat').read_text().rsplit(')',1)[1].split()[19]
    except FileNotFoundError: pass
 return result
def group(pid):
 value=next(x[3:] for x in pathlib.Path('/proc/'+str(pid)+'/cgroup').read_text().splitlines() if x.startswith('0::/'))
 if not value.startswith('/') or '..' in value or 'libpod-' not in value: fail()
 return value
def gone(record):
 if record['group'] and census(record['group']): return False
 for pid,start in record['pids'].items():
  try:
   if pathlib.Path('/proc/'+pid+'/stat').read_text().rsplit(')',1)[1].split()[19]==start: return False
  except FileNotFoundError: pass
 return True
def container():
 c=obj('inspect',R['name'])[0]
 if c['Config'].get('Labels',{}).get('aios.coding.authority')!=R['authority'] or c['Config'].get('Labels',{}).get('aios.coding.session')!=identity: fail()
 return c
bootstrap='while test ! -f /tmp/launch; do sleep 0.1; done; cd /workspace; exec /codex "$@"'
# The locked argv before the prompt (lockedCodingArgv in src/feature-candidate.ts).
def locked(thread,route):
 sandbox='danger-full-access' if route else 'workspace-write'
 p='model_providers.aios.'
 values=['model_provider="aios"',p+'name="AIOS session relay"',p+'base_url="http://127.0.0.1:${modelRoutePort}/v1"',p+'env_key="${modelRouteVariable}"',p+'wire_api="responses"',p+'requires_openai_auth=false',p+'supports_websockets=false',p+'http_headers.X-AIOS-Delivery="'+route['deliveryId']+'"','model="${gatewayModel}"'] if route else []
 overrides=[x for v in values for x in ['-c',v]]
 return ['exec','resume','--json','--skip-git-repo-check','-c','sandbox_mode="'+sandbox+'"',*overrides,thread] if thread else ['exec','--json','--skip-git-repo-check','--sandbox',sandbox,*overrides]
def valid_route(route):
 return isinstance(route,dict) and sorted(route)==['capability','decisionSha256','deliveryId'] and all(isinstance(v,str) for v in route.values()) and re.fullmatch('[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}',route['deliveryId']) and re.fullmatch('[a-f0-9]{64}',route['capability']) and re.fullmatch('[a-f0-9]{64}',route['decisionSha256'])
def effective(c,live):
 if c['Config'].get('Entrypoint') not in [None,[]] or c['Config'].get('Cmd')!=['/bin/sh','-c',bootstrap,'--',*record['argv']]: fail()
 hc=c['HostConfig'];env=dict(x.split('=',1) for x in c['Config']['Env'])
 expected={'PATH':'/usr/bin:/bin','HOME':'/session','CODEX_HOME':'/session','HOSTNAME':'aios-coding'}
 # A routed session adds exactly its relay capability, checked by digest.
 route=record.get('admission',{}).get('modelRoute')
 if route:
  if h(env.get('${modelRouteVariable}','').encode())!=route['capabilitySha256']: fail()
  env={k:v for k,v in env.items() if k!='${modelRouteVariable}'}
 if hc.get('Privileged') or hc.get('VolumesFrom') or hc.get('PortBindings') or hc.get('Devices') or hc.get('CapAdd'): fail()
 if hc.get('NetworkMode')!='none' or hc.get('PidMode')!='private' or hc.get('IpcMode')!='private' or not hc.get('ReadonlyRootfs'): fail()
 if c['Config']['User']!='65534:65534' or env!=expected or hc.get('RestartPolicy',{}).get('Name')!='no': fail()
 if hc.get('PidsLimit')!=64 or hc.get('Memory')!=536870912 or 'no-new-privileges' not in hc.get('SecurityOpt',[]) or 'seccomp='+root+'/seccomp.json' not in hc.get('SecurityOpt',[]): fail()
 mounts=c.get('Mounts',[])
 wanted={'/workspace':(work,True),'/session':(home,True),'/codex':(binary,False),'/codex-code-mode-host':(codeModeHost,False)}
 if len(mounts)!=4: fail()
 for m in mounts:
  if m.get('Type')!='bind' or m.get('Destination') not in wanted or (m.get('Source'),m.get('RW'))!=wanted[m['Destination']]: fail()
  if m.get('Propagation') not in ['rprivate','private']: fail()
 if live:
  values={x.split(':',1)[0]:x.split(':',1)[1].strip() for x in pathlib.Path('/proc/'+str(c['State']['Pid'])+'/status').read_text().splitlines() if ':' in x}
  if values.get('NoNewPrivs')!='1' or values.get('Seccomp')!='2' or int(values.get('CapEff','f'),16)!=0: fail()

def started(pid):
 # A process's start time, or None once it has exited.
 fields=pathlib.Path('/proc/'+str(pid)+'/stat').read_text().rsplit(')',1)[1].split()
 return None if fields[0] in ['Z','X'] else fields[19]
def running(p):
 try: return started(p['pid'])==p['start']
 except FileNotFoundError: return False
def relay_processes(relay):
 # The process group's leader, and the listener it reported once ready.
 return [p for p in [relay,relay.get('listener')] if isinstance(p,dict)]
def relay_alive(relay):
 return isinstance(relay,dict) and not relay.get('stopped') and 'listener' in relay and all(running(p) for p in relay_processes(relay))
def kill_relay():
 relay=record.get('relay') if record else None
 if not isinstance(relay,dict) or relay.get('stopped'): return
 for p in relay_processes(relay):
  if running(p):
   try: (os.killpg if p is relay else os.kill)(p['pid'],signal.SIGKILL)
   except ProcessLookupError: pass
def stop_relay():
 relay=record.get('relay')
 if not isinstance(relay,dict) or relay.get('stopped'): return
 kill_relay()
 for _ in range(50):
  if not any(running(p) for p in relay_processes(relay)): break
  time.sleep(0.1)
 else: fail()
 relay['stopped']=True;save(recordPath,record)
def pump(relay):
 # Host frames in, relay frames out, each bounded; either end ending ends both.
 def end():
  try: os.killpg(relay.pid,signal.SIGKILL)
  except ProcessLookupError: pass
 def inbound():
  try:
   for line in sys.stdin:
    if len(line)>${sessionRelayLimits.frameChars}: break
    relay.stdin.write(line.encode('ascii'));relay.stdin.flush()
  except (OSError,ValueError): pass
  end()
 threading.Thread(target=inbound,daemon=True).start()
 try:
  while True:
   line=relay.stdout.readline(${sessionRelayLimits.frameChars}+1)
   if not line.endswith(b'\n') or len(line)>${sessionRelayLimits.frameChars}: break
   sys.stdout.write(line.decode('ascii'));sys.stdout.flush()
 finally:
  end();relay.wait()

def path_ok(path):
 parts=path.split('/')
 return bool(path) and '\\' not in path and ':' not in path and all(p and p not in ['.','..'] and not re.search(r'[\x00-\x1f\x7f]',p) and not re.search(r'[. ]$',p) and not re.match(r'^(\.git|\.env(\..*)?|\.ssh|\.gnupg|\.aws|\.codex|\.agents|\.claude|\.npmrc|\.mcp\.json|sbxenv\.ya?ml)$',p,re.I) and not re.search(r'\.(pem|key|p12|pfx)$',p,re.I) and not re.match(r'^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)',p,re.I) for p in parts)
def require_timers():
 for suffix in ['-lease.timer','-deadline.timer']:
  lines=command(['systemctl','--user','show',R['name']+suffix,'--property=LoadState,ActiveState,SubState,Job']).decode('ascii').splitlines()
  if len(lines)!=4: fail()
  state=dict(line.split('=',1) for line in lines)
  if state!={'LoadState':'loaded','ActiveState':'active','SubState':'waiting','Job':''}: fail()
def lease(start=False):
 unit=R['name']+'-lease'
 remaining=record['deadline']-time.monotonic()
 if remaining<=0: fail()
 if start:
  # A fixed deadline bounds the entire run; the shorter, renewed lease also
  # stops it when the controller disappears. Neither timer is worker-mounted.
  record['lease']=True;save(recordPath,record)
  for name,seconds in [(unit,min(remaining,30)),(R['name']+'-deadline',remaining)]:
   command(['systemd-run','--user','--unit='+name,'--on-active='+str(seconds)+'s','--timer-property=AccuracySec=100ms','--timer-property=RemainAfterElapse=yes','--property=RemainAfterExit=yes','/usr/bin/podman','kill','--signal','KILL',R['name']])
 else:
  # Never renew a missing/expired lease or continue without the fixed deadline.
  require_timers()
  # Avoid the manager's start-rate limit; do not weaken it or the 30s lease.
  renew=time.monotonic()-record['leaseRenewedAt']>=10
  if renew: command(['systemctl','--user','restart',unit+'.timer'])
 if start or renew:
  require_timers()
  record['leaseRenewedAt']=time.monotonic();save(recordPath,record)
def timer_state(unit):
 lines=command(['systemctl','--user','show',unit,'--property=LoadState,ActiveState,Job']).decode('ascii').splitlines()
 if len(lines)!=3: fail()
 state=dict(line.split('=',1) for line in lines)
 if set(state)!=set(['LoadState','ActiveState','Job']) or state['Job']!='': fail()
 if state['LoadState']=='not-found':
  if state['ActiveState']!='inactive': fail()
 elif state['LoadState']!='loaded' or state['ActiveState'] not in ['active','inactive','failed']: fail()
 return state
def stop_timers():
 for suffix in ['-lease.timer','-deadline.timer','-lease.service','-deadline.service']:
  unit=R['name']+suffix
  before=timer_state(unit)
  if before['LoadState']=='loaded': command(['systemctl','--user','stop',unit])
  if timer_state(unit)['ActiveState'] not in ['inactive','failed']: fail()
 record['lease']=False;save(recordPath,record)
def timer_execution():
 if R.get('timer') not in ['lease','deadline']: fail()
 unit=R['name']+'-'+R['timer']
 def prop(suffix,interface,name,signature):
  # Unit names are fixed from the validated session, never guest-provided paths.
  path='/org/freedesktop/systemd1/unit/'+''.join(c if c.isascii() and c.isalnum() else '_'+c.encode().hex() for c in unit+suffix)
  value=json.loads(command(['busctl','--user','--json=short','get-property','org.freedesktop.systemd1',path,'org.freedesktop.systemd1.'+interface,name]))
  if not isinstance(value,dict) or value.get('type')!=signature or 'data' not in value: fail()
  return value['data']
 triggered=prop('.timer','Timer','LastTriggerUSecMonotonic','t')
 entries=prop('.service','Service','ExecStart','a(sasbttttuii)')
 if not isinstance(entries,list) or len(entries)!=1 or not isinstance(entries[0],list) or len(entries[0])!=10: fail()
 row=entries[0]
 if row[:2]!=['/usr/bin/podman',['/usr/bin/podman','kill','--signal','KILL',R['name']]] or row[2] is not False: fail()
 values=[triggered,*row[3:]]
 if any(type(n) is not int or n<0 or n>9007199254740991 for n in values): fail()
 return dict(timer=R['timer'],lastTriggerUs=triggered,startedUs=row[4],finishedUs=row[6],code=row[8],status=row[9])
def collect_files():
 files=[];total=0;names=set()
 def visit(path,prefix):
  nonlocal total
  for entry in sorted(os.scandir(path),key=lambda e:e.name):
   name=prefix+entry.name;s=entry.stat(follow_symlinks=False)
   if not path_ok(name) or name.lower() in names: fail()
   names.add(name.lower())
   if stat.S_ISDIR(s.st_mode): visit(entry.path,name+'/');continue
   ordinary(entry.path)
   if s.st_size>262144 or len(files)>=1000: fail()
   fd=os.open(entry.path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
   with os.fdopen(fd,'rb') as f:
    opened=os.fstat(f.fileno())
    if (opened.st_dev,opened.st_ino,opened.st_nlink,opened.st_size)!=(s.st_dev,s.st_ino,1,s.st_size): fail()
    data=f.read(262145)
    after=os.fstat(f.fileno())
    if len(data)!=s.st_size or (after.st_mtime_ns,after.st_ctime_ns)!=(s.st_mtime_ns,s.st_ctime_ns): fail()
   total+=len(data)
   if total>1048576: fail()
   files.append(dict(path=name,bytes=base64.b64encode(data).decode(),executable=bool(s.st_mode&0o111)))
 visit(work,'')
 return files

root=os.path.expanduser('~/.local/state/aios-coding-v1')
if R['action']=='inspect':
 binding=snapshot()
else:
 directory(root)
 sharedManagement=os.path.expanduser('~/.local/state/aios-offline-v1')
 directory(sharedManagement)
 lockfd=os.open(sharedManagement+'/lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
 with os.fdopen(lockfd,'w') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX)
  owner=root+'/authority.json'
  if os.path.exists(owner):
   if read(owner)!=R['authority']: fail()
  elif R['action'] in ['prepare','stop']: save(owner,R['authority'])
  else: fail()
  identity=h(json.dumps(dict(operationId=R['session']['operationId'],fence=R['session']['fence']),sort_keys=True).encode())
  recordPath=root+'/'+R['name']+'.json'
  record=read(recordPath) if os.path.lexists(recordPath) else None
  if record and record['identity']!=identity: fail()
  operation=root+'/'+R['name']
  work=operation+'/workspace';home=operation+'/home';binary=operation+'/codex';codeModeHost=operation+'/codex-code-mode-host'
  if R['action']=='prepare':
   binding=snapshot()
   if binding!=R['expectedBinding'] or record: fail()
   branch=R.get('branch')
   if not isinstance(R.get('sourceRevision'),str) or not re.fullmatch('[a-f0-9]{40}',R['sourceRevision']) or not isinstance(R.get('inputSha256'),str) or not re.fullmatch('[a-f0-9]{64}',R['inputSha256']): fail()
   if not isinstance(branch,str) or len(branch)>240 or not re.fullmatch(r'codex/[A-Za-z0-9][A-Za-z0-9._/-]*',branch) or '..' in branch or any(not p or p.startswith('.') or p.endswith('.') or p.lower().endswith('.lock') for p in branch.split('/')): fail()
   resuming=R['session']['intent']=='resume'
   route=R.get('modelRoute')
   if route is not None and not valid_route(route): fail()
   expected=locked(R.get('threadId') if resuming else None,route)
   if R['argv'][:-1]!=expected or len(R['argv'])!=len(expected)+1 or not isinstance(R['argv'][-1],str) or len(R['argv'][-1])>65536 or R['argv'][-1].startswith('-'): fail()
   predecessor=None
   admission=dict(sourceRevision=R['sourceRevision'],branch=R['branch'],inputSha256=R['inputSha256'])
   if route: admission['modelRoute']=dict(deliveryId=route['deliveryId'],decisionSha256=route['decisionSha256'],capabilitySha256=h(route['capability'].encode()))
   if resuming:
    previous=R.get('resumeFrom');thread=R.get('threadId')
    if not isinstance(previous,dict) or not isinstance(thread,str) or not re.fullmatch('[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}',thread): fail()
    oldId=previous.get('operationId');oldFence=previous.get('fence')
    if not isinstance(oldId,str) or not re.fullmatch('[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}',oldId) or oldId==R['session']['operationId'] or type(oldFence) is not int or oldFence<1 or oldFence>R['session']['fence'] or previous.get('state')!='stopped': fail()
    oldName='aios-coding-'+h((R['authority']+oldId).encode())[:32]
    oldPath=root+'/'+oldName+'.json';predecessor=read(oldPath)
    oldIdentity=h(json.dumps(dict(operationId=oldId,fence=oldFence),sort_keys=True).encode())
    if predecessor['identity']!=oldIdentity or predecessor['phase']!='stopped' or predecessor.get('resumedBy') or predecessor.get('reconciled') or predecessor.get('threadId')!=thread or predecessor['binding']!=binding or predecessor.get('pins')!=R['pins'] or predecessor.get('lease') or not gone(predecessor): fail()
    oldAdmission=predecessor.get('admission',{})
    # A resume onto a moved main names exactly the predecessor's revision.
    base=R.get('baseMove')
    if base is not None and (not isinstance(base,dict) or set(base)!={'from','to'} or not all(isinstance(v,str) and re.fullmatch('[a-f0-9]{40}',v) for v in base.values()) or base['to']!=R['sourceRevision'] or base['from']==base['to']): fail()
    if oldAdmission.get('sourceRevision')!=(base['from'] if base else R['sourceRevision']) or oldAdmission.get('branch')!=branch: fail()
    # Route continuity: a resume keeps its predecessor's mode, delivery and
    # mediation decision. Only the relay capability is new.
    oldRoute=oldAdmission.get('modelRoute')
    if (oldRoute is None)!=(route is None) or (route and ((oldRoute['deliveryId'],oldRoute['decisionSha256'])!=(route['deliveryId'],route['decisionSha256']) or oldRoute['capabilitySha256']==h(route['capability'].encode()))): fail()
    if not stopped_container(oldName,oldIdentity): fail()
    units_quiet(oldName)
    oldHome=root+'/'+oldName+'/home';retained_home(oldHome)
    admission.update(threadId=thread,resumeFrom=previous,**({'baseMove':base} if base else {}))
   elif R['session']['intent']!='start' or R.get('threadId') is not None or R.get('resumeFrom') is not None or R.get('baseMove') is not None: fail()
   total=0;names=set();inputs=[];manifest=[]
   if not isinstance(R['files'],list) or len(R['files'])>1000: fail()
   for file in R['files']:
    path=file['path'];data=base64.b64decode(file['bytes'],validate=True);total+=len(data)
    if not path_ok(path) or path.lower() in names or len(data)>262144 or total>1048576 or type(file['executable']) is not bool: fail()
    names.add(path.lower());inputs.append((path,data,file['executable']))
    manifest.append(dict(path=path,sha256=h(data),executable=file['executable']))
   if h(json.dumps(manifest,ensure_ascii=False,separators=(',',':')).encode())!=R['inputSha256']: fail()
   record=dict(identity=identity,binding=binding,pins=R['pins'],admission=admission,argv=R['argv'],phase='preparing',group='',pids={},deadline=time.monotonic()+R['allowanceMs']/1000)
   save(recordPath,record)
   directory(operation);directory(work)
   if predecessor:
    # Reserve durably before moving retained state. Partial effects never retry.
    predecessor['resumedBy']=identity;save(oldPath,predecessor)
    os.rename(oldHome,home)
   directory(home)
   source=os.path.expanduser('~/.local/state/aios-offline-v1/codex-0.161.0')
   fd=os.open(binary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o500)
   with os.fdopen(fd,'wb') as f:
    data=pathlib.Path(source).read_bytes()
    if h(data)!=R['cliSha256']: fail()
    f.write(data);f.flush();os.fsync(f.fileno())
   fd=os.open(codeModeHost,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o500)
   with os.fdopen(fd,'wb') as f:
    f.write(provisioned(hostSource,R['codeModeHostSha256']));f.flush();os.fsync(f.fileno())
   for path,data,executable in inputs:
    target=work+'/'+path
    os.makedirs(os.path.dirname(target),mode=0o700,exist_ok=True)
    fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o700 if executable else 0o600)
    with os.fdopen(fd,'wb') as f: f.write(data)
   profile=json.loads(pathlib.Path('/usr/share/containers/seccomp.json').read_text())
   if profile.get('defaultAction')!='SCMP_ACT_ERRNO': fail()
   for rule in profile['syscalls']: rule['names']=[n for n in rule['names'] if n not in ['unshare','setns']]
   profile['syscalls']=[r for r in profile['syscalls'] if r['names']]
   save(root+'/seccomp.json',profile)
   reserve(True)
   # Bootstrap waits before any candidate-controlled Codex input is executed.
   pod('create','--name',R['name'],'--hostname=aios-coding','--pull=never','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--security-opt=seccomp='+root+'/seccomp.json','--userns=keep-id:uid=65534,gid=65534','--user=65534:65534','--pid=private','--ipc=private','--pids-limit=64','--memory=512m','--http-proxy=false','--unsetenv-all','--env','PATH=/usr/bin:/bin','--env','HOME=/session','--env','CODEX_HOME=/session',*(['--env','${modelRouteVariable}='+route['capability']] if route else []),'--log-driver=k8s-file','--restart=no','--label','aios.coding.authority='+R['authority'],'--label','aios.coding.session='+identity,'--volume',work+':/workspace:rw,Z,rprivate','--volume',home+':/session:rw,Z,rprivate','--volume',binary+':/codex:ro,Z,rprivate','--volume',codeModeHost+':/codex-code-mode-host:ro,Z,rprivate',R['template'],'/bin/sh','-c',bootstrap,'--',*R['argv'])
   effective(container(),False)
   record['phase']='prepared';save(recordPath,record)
  elif R['action']=='stop':
   # The relay goes first; its end is checked below.
   kill_relay()
   if record is None:
    record=dict(identity=identity,binding={},phase='revoked',group='',pids={})
   # Fence when the disk allows; a full disk must never prevent shutdown.
   try: record['phase']='revoked';save(recordPath,record)
   except OSError: pass
   # Absence is an independently observed result, not a swallowed inspect error.
   exists=subprocess.run(['/usr/bin/podman','container','exists',R['name']],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
   if exists.returncode==0:
    c=container()
    if c['State'].get('Running'):
     record['group']=group(c['State']['Pid']);record['pids'].update(census(record['group']))
     try: save(recordPath,record)
     except OSError: pass
     # Kill without writing first, so a worker still filling the disk cannot
     # consume the headroom released for the engine and the records below.
     try: pathlib.Path('/sys/fs/cgroup'+record['group']+'/cgroup.kill').write_text('1')
     except OSError: pass
     reserve(False)
     pod('stop','--time','2',R['name'])
    c=container()
    if c['State'].get('Running') or c['State'].get('Pid')!=0: fail()
    if not record['group'] and c['State'].get('Status') not in ['created','configured']: fail()
   elif exists.returncode!=1: fail()
   if not gone(record): fail()
   # A stopped session never runs again, so its private program copies go
   # with the worker; a resume copies its own. This also frees a full disk.
   for path in [binary,codeModeHost]:
    try: os.unlink(path)
    except FileNotFoundError: pass
   # The worker is gone, so the headroom now goes to these records. A worker
   # that exited before the disk filled never reached the early release above.
   reserve(False)
   stop_relay()
   if record.get('lease'): stop_timers()
   record['phase']='stopped';save(recordPath,record)
   # Restore headroom for the next session when collection leaves room.
   try: reserve(True)
   except OSError: pass
   binding=snapshot()
   if record['binding'] and record['binding']!=binding: fail()
  else:
   if not record: fail()
   binding=snapshot()
   # Only stop writes a record without preparing, and it has no binding.
   unprepared=R['action'] in ['recover-resume','observe-session'] and record['binding']=={} and 'admission' not in record
   if binding!=record['binding'] and not unprepared: fail()
   if R['action']=='launch':
    if record['phase']!='prepared' or not isinstance(record.get('admission'),dict) or record['admission']!=R.get('admission') or record.get('pins')!=R.get('pins'): fail()
    ordinary(binary)
    if h(pathlib.Path(binary).read_bytes())!=R['cliSha256']: fail()
    ordinary(codeModeHost)
    if h(pathlib.Path(codeModeHost).read_bytes())!=R['codeModeHostSha256']: fail()
    effective(container(),False)
    # Durable before start: stop rewrites the phase, and recovery must never
    # return a home that a started worker could have changed.
    record['phase']='launching';record['launchAttempted']=True;save(recordPath,record)
    pod('start',R['name'])
    c=container();record['group']=group(c['State']['Pid']);record['pids']=census(record['group']);save(recordPath,record)
    if not record['pids']: fail()
    effective(c,True)
    lease(True)
    # Running, but Codex still waits: release is a separate action.
    record['phase']='running';save(recordPath,record)
   elif R['action']=='relay':
    # One relay per routed session, started before Codex is released, inside
    # the worker's network namespace. It is recorded before it can listen.
    route=record['admission'].get('modelRoute')
    if record['phase']!='running' or record.get('released') or 'relay' in record or not route or not isinstance(R.get('capability'),str) or h(R['capability'].encode())!=route['capabilitySha256']: fail()
    c=container()
    if not c['State'].get('Running') or group(c['State']['Pid'])!=record['group']: fail()
    effective(c,True)
    relayProcess=subprocess.Popen(['/usr/bin/podman','unshare','nsenter','--net=/proc/'+str(c['State']['Pid'])+'/ns/net','/usr/bin/python3','-I','-u','-c',RELAY],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,start_new_session=True)
    try:
     record['relay']=dict(pid=relayProcess.pid,start=started(relayProcess.pid),capabilitySha256=route['capabilitySha256']);save(recordPath,record)
     if not record['relay']['start']: fail()
     relayProcess.stdin.write((json.dumps(dict(port=${modelRoutePort},netns='/proc/'+str(c['State']['Pid'])+'/ns/net',deliveryId=route['deliveryId'],capability=R['capability'],model='${gatewayModel}',requestBytes=${sessionRelayLimits.requestBytes},responseGapMs=${sessionRelayLimits.responseGapMs}))+'\n').encode());relayProcess.stdin.flush()
     if not select.select([relayProcess.stdout],[],[],15)[0]: fail()
     ready=json.loads(relayProcess.stdout.readline(4097))
     if not isinstance(ready,dict) or set(ready)!={'ready','port','pid'} or ready['ready'] is not True or ready['port']!=${modelRoutePort} or type(ready['pid']) is not int: fail()
     # The listener itself, which podman may run apart from the leader.
     record['relay']['listener']=dict(pid=ready['pid'],start=started(ready['pid']))
     if not record['relay']['listener']['start']: fail()
     save(recordPath,record)
    except BaseException:
     try: os.killpg(relayProcess.pid,signal.SIGKILL)
     except ProcessLookupError: pass
     raise
    result=dict(ready=True)
   elif R['action']=='release':
    # Codex starts only now. A routed session's relay must be the live one
    # this session started; an offline session has none.
    if record['phase']!='running' or record.get('released'): fail()
    c=container()
    if not c['State'].get('Running') or group(c['State']['Pid'])!=record['group']: fail()
    effective(c,True)
    route=record['admission'].get('modelRoute')
    if route and (not relay_alive(record.get('relay')) or record['relay'].get('capabilitySha256')!=route['capabilitySha256']): fail()
    if not route and 'relay' in record: fail()
    record['released']=True;save(recordPath,record)
    pod('exec',R['name'],'touch','/tmp/launch')
   elif R['action']=='poll':
    if record['phase']!='running': fail()
    # A released routed session needs its relay for as long as it runs.
    if record['admission'].get('modelRoute') and record.get('released') and not relay_alive(record.get('relay')): fail()
    c=container()
    if c['State'].get('Running'):
     if group(c['State']['Pid'])!=record['group']: fail()
     effective(c,True);record['pids'].update(census(record['group']));save(recordPath,record)
     lease()
    logs=pod('logs',R['name'])
    if len(logs)>65536: fail()
    # Bind a complete explicit CLI thread event to this durable session. A
    # partial final line is not evidence and cannot authorize later resume.
    threads=[]
    for line in logs.split(b'\n')[:-1]:
     try: event=json.loads(line)
     except (ValueError,UnicodeDecodeError): continue
     if isinstance(event,dict) and event.get('type')=='thread.started':
      thread=event.get('thread_id')
      if not isinstance(thread,str) or not re.fullmatch('[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}',thread): fail()
      threads.append(thread)
    if len(threads)>1: fail()
    if threads:
     if record.get('threadId',threads[0])!=threads[0] or record['admission'].get('threadId',threads[0])!=threads[0]: fail()
     record['threadId']=threads[0];save(recordPath,record)
    if not c['State']['Running'] and record['admission'].get('threadId') and not threads: fail()
    result=dict(running=c['State']['Running'],exitCode=c['State']['ExitCode'],output=base64.b64encode(logs).decode())
   elif R['action']=='probe-boundary':
    # Qualification only: the fixed probe in the exact live session, then a
    # detached descendant that only this session's exact stop may remove.
    if record['phase']!='running' or not isinstance(R.get('admittedPath'),str) or not path_ok(R['admittedPath']): fail()
    c=container()
    if not c['State'].get('Running') or group(c['State']['Pid'])!=record['group']: fail()
    effective(c,True)
    # Positive controls: both files exist, so only isolation can hide one.
    if not os.path.isfile(work+'/'+R['admittedPath']) or os.path.islink(work+'/'+R['admittedPath']) or not os.path.isfile(recordPath): fail()
    # The session's own record names its mode; the caller never chooses it.
    mode='routed' if record['admission'].get('modelRoute') else 'offline'
    probe=pod('exec',R['name'],'/bin/sh','-c',PROBE,'--','/workspace/'+R['admittedPath'],recordPath,mode).decode()
    before=set(census(record['group']))
    pod('exec','-d',R['name'],'setsid','sleep','3600')
    for _ in range(50):
     now=census(record['group'])
     if set(now)-before: break
     time.sleep(0.1)
    else: fail()
    record['pids'].update(now);save(recordPath,record)
    result=dict(probe=probe,processes=len(now))
   elif R['action']=='observe-timer-execution':
    container() # Verify current authority/session labels before reading units.
    result=timer_execution()
   elif R['action']=='observe-session':
    # Observe independently: no log consumption, lease renewal, stop or journal write.
    # A session stopped before it was prepared never had a container.
    exists=subprocess.run(['/usr/bin/podman','container','exists',R['name']],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
    if exists.returncode==0: c=container()
    elif exists.returncode==1 and unprepared and record['phase']=='stopped': c=dict(State=dict(Running=False,Pid=0))
    else: fail()
    running=c['State'].get('Running')
    if not isinstance(running,bool): fail()
    if running:
     if not record['group'] or group(c['State']['Pid'])!=record['group']: fail()
     effective(c,True)
    elif c['State'].get('Pid')!=0: fail()
    processes=census(record['group']) if record['group'] else {}
    timers={key:timer_state(R['name']+'-'+key+'.timer') for key in ['lease','deadline']}
    result=dict(phase=record['phase'],running=running,remainingProcesses=len(processes),processesGone=gone(record),timers={key:dict(loadState=value['LoadState'],activeState=value['ActiveState']) for key,value in timers.items()})
   elif R['action']=='collect':
    if record['phase']!='stopped' or not gone(record): fail()
    c=container()
    if c['State'].get('Running') or c['State'].get('Pid')!=0: fail()
    first=collect_files()
    if first!=collect_files() or not gone(record): fail()
    result=dict(files=first)
   elif R['action']=='recover-resume':
    # Return a home stranded by an interrupted, never-launched resume. Each step
    # is idempotent; ambiguous or foreign state refuses rather than guessing.
    previous=R.get('resumeFrom');admission=record.get('admission',{})
    if record['phase']!='stopped' or record.get('launchAttempted') or record['group'] or record['pids'] or record.get('recovered') or not isinstance(previous,dict) or (not unprepared and admission.get('resumeFrom')!=previous): fail()
    exists=subprocess.run(['/usr/bin/podman','container','exists',R['name']],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
    if exists.returncode==0:
     c=container()
     if c['State'].get('Running') or c['State'].get('Pid')!=0: fail()
    elif exists.returncode!=1: fail()
    oldName,oldPath,predecessor,oldIdentity=predecessor_of(previous)
    if predecessor['identity']!=oldIdentity or predecessor['phase']!='stopped' or predecessor.get('resumedBy') not in [None,identity]: fail()
    oldHome=root+'/'+oldName+'/home'
    if unprepared:
     # Preparation reserves and moves only after its record is saved.
     if os.path.lexists(home) or predecessor.get('resumedBy')==identity: fail()
    elif os.path.lexists(home):
     # Prepare reserves before moving, so a moved home must still be reserved.
     if os.path.lexists(oldHome) or predecessor.get('resumedBy')!=identity: fail()
     os.rename(home,oldHome)
    elif not os.path.lexists(oldHome): fail()
    if predecessor.get('resumedBy'):
     del predecessor['resumedBy'];save(oldPath,predecessor)
    record['recovered']=True;save(recordPath,record)
    result=dict(recovered=True)
   elif R['action']=='reconcile-resume':
    # Settle a launched resume whose thread never reached the controller. The
    # guest's own thread record decides; nothing is ever moved or reused.
    previous=R.get('resumeFrom');admission=record.get('admission',{});thread=admission.get('threadId')
    if record['phase']!='stopped' or not record.get('launchAttempted') or record.get('recovered') or not isinstance(previous,dict) or admission.get('resumeFrom')!=previous or not isinstance(thread,str) or type(R.get('retire')) is not bool or not gone(record): fail()
    exists=subprocess.run(['/usr/bin/podman','container','exists',R['name']],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
    if exists.returncode==0:
     c=container()
     if c['State'].get('Running') or c['State'].get('Pid')!=0: fail()
    elif exists.returncode!=1: fail()
    oldName,oldPath,predecessor,oldIdentity=predecessor_of(previous)
    if predecessor['identity']!=oldIdentity or predecessor['phase']!='stopped' or predecessor.get('resumedBy')!=identity: fail()
    # A launched resume holds the moved home; anything else is not this state.
    if os.path.lexists(root+'/'+oldName+'/home') or not os.path.lexists(home): fail()
    if record.get('threadId')==thread and not record.get('reconciled'): outcome='adopted'
    elif record.get('threadId') is not None: fail()
    elif R['retire'] or record.get('reconciled')=='retired':
     record['reconciled']='retired';save(recordPath,record);outcome='retired'
    else: outcome='unresolved'
    result=dict(outcome=outcome)
   elif R['action'] in ['cleanup-retired','cleanup-superseded']:
    # Remove a retired or superseded lineage's session folders and stopped
    # containers on the owner's decision. The head and each predecessor
    # reserved by the session after it must be stopped and gone; every check
    # runs before anything is removed. Records stay as tombstones and are
    # never resumed. A superseded head is an ordinary session the host left
    # when coding restarted under another route: launched with its thread
    # recorded, never recovered or retired, and reserved by no successor. A
    # stranded or unresolved resume has its own recovery. The head is marked,
    # so prepare never resumes it.
    superseded=R['action']=='cleanup-superseded'
    if superseded:
     if record.get('reconciled') not in [None,'superseded'] or record.get('resumedBy') or not record.get('launchAttempted') or record.get('recovered') or not isinstance(record.get('threadId'),str) or record['phase']!='stopped' or not gone(record): fail()
    elif record.get('reconciled')!='retired' or record['phase']!='stopped' or not gone(record): fail()
    lineage=[(R['name'],recordPath,record,identity)]
    while isinstance(lineage[-1][2].get('admission',{}).get('resumeFrom'),dict):
     if len(lineage)>=256: fail()
     oldName,oldPath,predecessor,oldIdentity=predecessor_of(lineage[-1][2]['admission']['resumeFrom'])
     if predecessor['identity']!=oldIdentity or predecessor['phase']!='stopped' or predecessor.get('resumedBy')!=lineage[-1][3] or not gone(predecessor): fail()
     lineage.append((oldName,oldPath,predecessor,oldIdentity))
    present=[]
    for name,_,_,sessionIdentity in lineage:
     units_quiet(name)
     if stopped_container(name,sessionIdentity): present.append(name)
     folder=root+'/'+name
     if os.path.lexists(folder):
      info=os.lstat(folder)
      if not stat.S_ISDIR(info.st_mode) or info.st_uid!=os.getuid(): fail()
    if superseded and record.get('reconciled')!='superseded':
     record['reconciled']='superseded';save(recordPath,record)
    for name,path,entry,_ in lineage:
     if name in present: pod('rm',name)
     if os.path.lexists(root+'/'+name): remove_tree(root+'/'+name)
     entry['cleaned']=True;save(path,entry)
    result=dict(cleaned=len(lineage))
   else: fail()
print(json.dumps(dict(session=R['session'],binding=binding,cliSha256=R['cliSha256'],**(result if 'result' in globals() else {}),**(dict(stopped=True,remainingProcesses=0) if R['action']=='stop' else {}))),flush=True)
if R['action']=='relay': pump(relayProcess)

`;

/** Native resume names its exact stopped predecessor through
 * `CodingRequest.resumeFrom`; there is no global session selection. */
export type NativeCodingRequest = CodingRequest;

export interface NativeTimerObservation {
  loadState: "loaded" | "not-found";
  activeState: "active" | "inactive" | "failed";
}
export interface NativeTimerExecution {
  operationId: string;
  fence: number;
  timer: "lease" | "deadline";
  lastTriggerUs: number;
  startedUs: number;
  finishedUs: number;
  code: number;
  status: number;
  pins: CodingPins;
}
export interface NativeSessionObservation {
  operationId: string;
  fence: number;
  phase:
    | "preparing"
    | "prepared"
    | "launching"
    | "running"
    | "revoked"
    | "stopped";
  running: boolean;
  remainingProcesses: number;
  processesGone: boolean;
  timers: { lease: NativeTimerObservation; deadline: NativeTimerObservation };
  pins: CodingPins;
}

/** Offline native transport groundwork; never a production qualification.
 * The pinned runtime rejects this live adapter unless an owner coding admission
 * record names its exact fresh pins; production stays disabled either way. */
export class NativePodmanCodingTransport implements IsolatedCodingTransport {
  readonly mode = "live" as const;
  readonly productionEnabled = false;
  constructor(
    private readonly machine: string,
    private readonly authority: string,
  ) {
    if (!/^aios-[a-z0-9-]+$/.test(machine) || !/^[a-f0-9]{64}$/.test(authority))
      throw Error("Invalid native coding authority");
    Object.freeze(this);
  }
  /** The guest request for `action`, bound to the host it will run on. */
  private request(
    action: string,
    session: CodingSession,
    payload: Record<string, unknown> = {},
  ) {
    if (
      !/^[a-f0-9-]{36}$/.test(session.operationId) ||
      !Number.isSafeInteger(session.fence) ||
      session.fence < 1
    )
      throw Error("Invalid native coding session");
    const managed = managementHost(this.machine);
    const { host } = managed;
    const cliSha256 = codexWorkerSha256(host.platform, host.arch)!;
    const hostSha256 = codeModeHostSha256(host.platform, host.arch)!;
    const request = {
      action,
      session,
      authority: this.authority,
      name: `aios-coding-${digest(this.authority + session.operationId).slice(0, 32)}`,
      provider: host.provider,
      guestArch: host.guestArch,
      imageReference: host.imageReference,
      template: host.guestArch === "arm64" ? armTemplate : offlineTemplate,
      cliSha256,
      codeModeHostSha256: hostSha256,
      ...payload,
    };
    return { managed, request, session, cliSha256, hostSha256 };
  }
  /** The pins a guest result binds, or a refusal if it names anything else. */
  private bind(
    {
      managed,
      session,
      cliSha256,
      hostSha256,
    }: ReturnType<NativePodmanCodingTransport["request"]>,
    result: unknown,
  ) {
    if (
      !record(result) ||
      !validGuestBinding(managed, result.binding) ||
      JSON.stringify(result.session) !== JSON.stringify(session) ||
      result.cliSha256 !== cliSha256
    )
      throw Error("Native coding binding changed");
    const pins: CodingPins = {
      cliVersion: "0.161.0",
      cliSha256,
      codeModeHostSha256: hostSha256,
      policySha256: digest(management),
      bindingSha256: managementBindingSha256(
        managed,
        this.authority,
        result.binding,
      ),
    };
    return { result, pins };
  }
  private async invoke(
    action: string,
    session: CodingSession,
    payload: Record<string, unknown> = {},
    permit?: () => boolean,
  ) {
    const bound = this.request(action, session, payload);
    const result: unknown = await runManagement(
      bound.managed,
      bound.request,
      management,
      "coding",
      action,
      permit,
    );
    return this.bind(bound, result);
  }
  /** Opens the session relay channel and bridges it to `gateway`. It is
   * ready, and bound to the same pins, before Codex may be released. */
  private async relay(
    session: CodingSession,
    route: ModelRoute,
    gateway: SessionGateway,
  ) {
    const bound = this.request("relay", session, {
      capability: route.capability,
    });
    const { ready, relay } = await openSessionRelay(
      openManagementChannel(bound.managed, bound.request, management),
      route.deliveryId,
      gateway,
    );
    try {
      const { result, pins } = this.bind(bound, ready);
      if (result.ready !== true) throw Error("Native coding relay unavailable");
      return { relay, pins };
    } catch (error) {
      relay.close();
      throw error;
    }
  }
  async inspect(session: CodingSession): Promise<CodingPins> {
    // Callers may pass a whole launch request; only its identity crosses.
    return (await this.invoke("inspect", this.session(session))).pins;
  }
  /** A routed turn needs the session's `gateway`, which stays on the host;
   * an offline turn has none. */
  async run(
    request: NativeCodingRequest,
    stdout: (bytes: Buffer) => void,
    gateway?: SessionGateway,
  ) {
    const resuming = request.intent === "resume";
    if (
      resuming
        ? !uuid(request.threadId) ||
          !sessionIdentity(request.resumeFrom) ||
          request.resumeFrom!.operationId === request.operationId ||
          request.resumeFrom!.fence > request.fence ||
          request.resumeFrom!.state !== "stopped" ||
          !["start", "resume"].includes(request.resumeFrom!.intent) ||
          // A base move names exactly the predecessor's and this turn's main.
          (request.baseMove !== undefined &&
            (!record(request.baseMove) ||
              JSON.stringify(Object.keys(request.baseMove).sort()) !==
                '["from","to"]' ||
              !/^[a-f0-9]{40}$/.test(String(request.baseMove.from)) ||
              request.baseMove.to !== request.sourceRevision ||
              request.baseMove.from === request.baseMove.to))
        : request.threadId !== undefined ||
          request.resumeFrom !== undefined ||
          request.baseMove !== undefined
    )
      throw Error("Unsupported native coding resume");
    const route = request.modelRoute;
    if (
      (route !== undefined && !validModelRoute(route)) ||
      (route === undefined) !== (gateway === undefined) ||
      (gateway !== undefined &&
        (typeof gateway.respond !== "function" ||
          typeof gateway.revoke !== "function" ||
          typeof gateway.capability !== "string" ||
          // The relay's capability is its own, never the gateway's.
          gateway.capability === route!.capability))
    )
      throw Error("Unsupported native coding launch");
    const prefix = lockedCodingArgv(
      resuming ? request.threadId : undefined,
      route,
    );
    const base = request.baseMove;
    if (
      request.baseRefresh ||
      !["start", "resume"].includes(request.intent) ||
      typeof request.sourceRevision !== "string" ||
      request.sourceRevision.length !== 40 ||
      !/^[a-f0-9]{40}$/.test(request.sourceRevision) ||
      typeof request.inputSha256 !== "string" ||
      request.inputSha256.length !== 64 ||
      !/^[a-f0-9]{64}$/.test(request.inputSha256) ||
      typeof request.branch !== "string" ||
      request.branch.length > 240 ||
      request.branch.trim() !== request.branch ||
      !/^codex\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(request.branch) ||
      request.branch.includes("..") ||
      request.branch
        .split("/")
        .some(
          (part) =>
            !part ||
            part.startsWith(".") ||
            part.endsWith(".") ||
            part.toLowerCase().endsWith(".lock"),
        ) ||
      request.state !== "running" ||
      !Array.isArray(request.argv) ||
      request.argv.length !== prefix.length + 1 ||
      JSON.stringify(request.argv.slice(0, -1)) !== JSON.stringify(prefix) ||
      typeof request.argv.at(-1) !== "string" ||
      request.argv.at(-1)!.length > 65536 ||
      // Codex would read a prompt starting with "-" as one of its options.
      request.argv.at(-1)!.startsWith("-") ||
      !Number.isSafeInteger(request.allowanceMs) ||
      request.allowanceMs < 1 ||
      request.allowanceMs > 7200000
    )
      throw Error("Unsupported native coding launch");
    const session = this.session(request);
    const payload = () => ({
      argv: [...request.argv],
      files: this.files(request.files),
      pins: { ...request.pins },
      sourceRevision: request.sourceRevision,
      branch: request.branch,
      inputSha256: request.inputSha256,
      allowanceMs: request.allowanceMs,
      ...(resuming
        ? {
            threadId: request.threadId,
            resumeFrom: this.session(request.resumeFrom!),
          }
        : {}),
      ...(base ? { baseMove: { from: base.from, to: base.to } } : {}),
      ...(request.modelRoute ? { modelRoute: { ...request.modelRoute } } : {}),
    });
    const prepared = payload(),
      binding = JSON.stringify(prepared);
    const manifest = prepared.files.map(({ path, bytes, executable }) => ({
      path,
      sha256: digest(Buffer.from(bytes, "base64")),
      executable,
    }));
    if (digest(JSON.stringify(manifest)) !== prepared.inputSha256)
      throw Error("Native coding input digest mismatch");
    const { mayDispatch, checkpoint, onEvent } = request;
    const unchanged = () =>
      JSON.stringify(this.session(request)) === JSON.stringify(session) &&
      JSON.stringify(payload()) === binding &&
      request.mayDispatch === mayDispatch &&
      request.checkpoint === checkpoint &&
      request.onEvent === onEvent;
    const permit = (gate: () => boolean) =>
      unchanged() && gate() && unchanged();
    const expected = JSON.stringify(prepared.pins);
    const deadline = performance.now() + request.allowanceMs;
    let touched = false,
      relay: SessionRelay | undefined,
      revoked = false;
    // The gateway is revoked once, by whichever ends the turn first.
    const revoke = () => {
      if (!revoked) gateway?.revoke("stopped");
      revoked = true;
    };
    const bridged: SessionGateway | undefined = gateway && {
      capability: gateway.capability,
      respond: (...request) => gateway.respond(...request),
      revoke,
    };
    try {
      const observed = await this.invoke("inspect", session);
      if (JSON.stringify(observed.pins) !== expected || !permit(mayDispatch))
        throw Error("Native coding authority changed");
      touched = true; // A failed create can still have effects; always fence/stop.
      const staged = await this.invoke(
        "prepare",
        session,
        { ...prepared, expectedBinding: observed.result.binding },
        () => permit(mayDispatch) && performance.now() < deadline,
      );
      if (
        JSON.stringify(staged.pins) !== expected ||
        performance.now() >= deadline ||
        !permit(mayDispatch)
      )
        throw Error("Native coding authority changed");
      const launched = await this.invoke(
        "launch",
        session,
        {
          pins: prepared.pins,
          admission: {
            sourceRevision: prepared.sourceRevision,
            branch: prepared.branch,
            inputSha256: prepared.inputSha256,
            ...(resuming
              ? { threadId: prepared.threadId, resumeFrom: prepared.resumeFrom }
              : {}),
            ...(prepared.baseMove ? { baseMove: prepared.baseMove } : {}),
            ...(prepared.modelRoute
              ? {
                  modelRoute: {
                    deliveryId: prepared.modelRoute.deliveryId,
                    decisionSha256: prepared.modelRoute.decisionSha256,
                    capabilitySha256: digest(prepared.modelRoute.capability),
                  },
                }
              : {}),
          },
        },
        () => permit(mayDispatch) && performance.now() < deadline,
      );
      if (JSON.stringify(launched.pins) !== expected)
        throw Error("Native coding binding changed");
      if (route) {
        if (performance.now() >= deadline || !permit(mayDispatch))
          throw Error("Native coding authority changed");
        const opened = await this.relay(session, route, bridged!);
        relay = opened.relay;
        if (JSON.stringify(opened.pins) !== expected)
          throw Error("Native coding binding changed");
      }
      const released = await this.invoke(
        "release",
        session,
        {},
        () =>
          permit(mayDispatch) && performance.now() < deadline && !relay?.lost,
      );
      if (JSON.stringify(released.pins) !== expected)
        throw Error("Native coding binding changed");
      let previous: Buffer = Buffer.alloc(0);
      for (;;) {
        if (relay?.lost) throw Error("Native coding relay lost");
        if (performance.now() >= deadline || !permit(checkpoint))
          throw Error("Native coding run stopped by its gate");
        const polled = await this.invoke("poll", session);
        if (JSON.stringify(polled.pins) !== expected)
          throw Error("Native coding binding changed");
        if (!permit(checkpoint))
          throw Error("Native coding run stopped by its gate");
        const { running, exitCode, output } = polled.result;
        if (
          typeof running !== "boolean" ||
          typeof exitCode !== "number" ||
          !Number.isSafeInteger(exitCode) ||
          typeof output !== "string"
        )
          throw Error("Invalid native coding output");
        const bytes = this.decode(output, 65536);
        if (!bytes.subarray(0, previous.length).equals(previous))
          throw Error("Native coding stream changed");
        if (bytes.length > previous.length)
          stdout(Buffer.from(bytes.subarray(previous.length)));
        previous = bytes;
        if (!running) return { ...session, exitCode, pins: prepared.pins };
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } finally {
      // The turn is over: nothing more reaches the provider.
      relay?.close();
      revoke();
      if (touched) {
        const stopped = await this.stop(session);
        if (
          !stopped.stopped ||
          stopped.remainingProcesses !== 0 ||
          JSON.stringify(await this.inspect(session)) !== expected
        )
          throw Error("Native coding shutdown is uncertain");
      }
    }
  }
  private session(session: CodingSession): CodingSession {
    return {
      operationId: session.operationId,
      fence: session.fence,
      state: session.state,
      intent: session.intent,
      ...(session.threadId ? { threadId: session.threadId } : {}),
    };
  }
  private files(files: CodingRequest["files"]) {
    if (!Array.isArray(files) || files.length > 1000)
      throw Error("Native coding file limit exceeded");
    const names = new Set<string>();
    let total = 0;
    return files.map((file) => {
      if (
        !admittedPath(file.path) ||
        names.has(file.path.toLowerCase()) ||
        !Buffer.isBuffer(file.bytes) ||
        file.bytes.length > 262144 ||
        (total += file.bytes.length) > 1048576 ||
        typeof file.executable !== "boolean" ||
        redact(file.bytes.toString("utf8")) !== file.bytes.toString("utf8")
      )
        throw Error("Unsafe native coding file");
      names.add(file.path.toLowerCase());
      return {
        path: file.path,
        bytes: file.bytes.toString("base64"),
        executable: file.executable,
      };
    });
  }
  private decode(value: string, limit: number): Buffer {
    const bytes = Buffer.from(value, "base64");
    if (bytes.length > limit || bytes.toString("base64") !== value)
      throw Error("Invalid native coding bytes");
    return bytes;
  }
  /** Independent qualification evidence only. Never renews, stops or reconciles
   * the session; collection still requires a separately verified explicit stop. */
  async observeSession(
    session: CodingSession,
  ): Promise<NativeSessionObservation> {
    const bound = this.session(session);
    const { result, pins } = await this.invoke("observe-session", bound);
    const timer = (value: unknown): value is NativeTimerObservation =>
      record(value) &&
      typeof value.loadState === "string" &&
      ["loaded", "not-found"].includes(value.loadState) &&
      typeof value.activeState === "string" &&
      ["active", "inactive", "failed"].includes(value.activeState) &&
      (value.loadState !== "not-found" || value.activeState === "inactive");
    if (
      typeof result.phase !== "string" ||
      ![
        "preparing",
        "prepared",
        "launching",
        "running",
        "revoked",
        "stopped",
      ].includes(result.phase) ||
      typeof result.running !== "boolean" ||
      !Number.isSafeInteger(result.remainingProcesses) ||
      (result.remainingProcesses as number) < 0 ||
      (result.remainingProcesses as number) > 4096 ||
      typeof result.processesGone !== "boolean" ||
      !record(result.timers) ||
      !timer(result.timers.lease) ||
      !timer(result.timers.deadline) ||
      (result.running && result.remainingProcesses === 0) ||
      (result.processesGone &&
        (result.running || result.remainingProcesses !== 0))
    )
      throw Error("Native coding session observation unavailable");
    return {
      operationId: bound.operationId,
      fence: bound.fence,
      phase: result.phase as NativeSessionObservation["phase"],
      running: result.running,
      remainingProcesses: result.remainingProcesses as number,
      processesGone: result.processesGone,
      timers: structuredClone(
        result.timers,
      ) as NativeSessionObservation["timers"],
      pins,
    };
  }
  /** Qualification evidence: runs the fixed boundary probe inside the exact
   * live session, with `admittedFile` as its positive control, then leaves a
   * detached descendant that the session's exact stop must remove. */
  async probeBoundary(session: CodingSession, admittedFile: string) {
    if (typeof admittedFile !== "string" || !admittedPath(admittedFile))
      throw Error("Invalid native boundary probe");
    const bound = this.session(session);
    const { result, pins } = await this.invoke("probe-boundary", bound, {
      admittedPath: admittedFile,
    });
    if (
      typeof result.probe !== "string" ||
      result.probe.length > 4096 ||
      !Number.isSafeInteger(result.processes) ||
      (result.processes as number) < 2 ||
      (result.processes as number) > 4096
    )
      throw Error("Native boundary probe unavailable");
    return {
      probes: boundaryProbeOutcomes(result.probe, codingBoundaryProbeNames),
      processes: result.processes as number,
      pins,
    };
  }
  /** Read retained manager execution evidence, without renewing or reconciling. */
  async observeTimerExecution(
    session: CodingSession,
    timer: "lease" | "deadline",
  ): Promise<NativeTimerExecution> {
    if (!["lease", "deadline"].includes(timer))
      throw Error("Native timer execution observation unavailable");
    const bound = this.session(session);
    const { result, pins } = await this.invoke(
      "observe-timer-execution",
      bound,
      {
        timer,
      },
    );
    const fields = [
      "lastTriggerUs",
      "startedUs",
      "finishedUs",
      "code",
      "status",
    ] as const;
    if (
      result.timer !== timer ||
      fields.some(
        (key) =>
          !Number.isSafeInteger(result[key]) || (result[key] as number) < 0,
      ) ||
      (result.code as number) > 3 ||
      (result.status as number) > 255 ||
      (result.startedUs !== 0 && result.lastTriggerUs === 0) ||
      (result.startedUs !== 0 &&
        (result.startedUs as number) < (result.lastTriggerUs as number)) ||
      (result.startedUs === 0 && result.finishedUs !== 0) ||
      (result.finishedUs !== 0 &&
        (result.finishedUs as number) < (result.startedUs as number)) ||
      (result.finishedUs === 0 && (result.code !== 0 || result.status !== 0)) ||
      (result.finishedUs !== 0 && result.code === 0)
    )
      throw Error("Native timer execution observation unavailable");
    return {
      operationId: bound.operationId,
      fence: bound.fence,
      timer,
      lastTriggerUs: result.lastTriggerUs as number,
      startedUs: result.startedUs as number,
      finishedUs: result.finishedUs as number,
      code: result.code as number,
      status: result.status as number,
      pins,
    };
  }
  /** Return the retained home of an interrupted, never-launched resume to its
   * explicitly named predecessor and release the one-use reservation. The
   * successor must already be independently stopped; it can never be reused. */
  async recoverInterruptedResume(
    session: CodingSession,
    resumeFrom: CodingSession,
  ): Promise<{
    operationId: string;
    fence: number;
    recovered: true;
    pins: CodingPins;
  }> {
    const bound = this.resumePair(session, resumeFrom);
    const { result, pins } = await this.invoke("recover-resume", bound, {
      resumeFrom: this.session(resumeFrom),
    });
    if (result.recovered !== true)
      throw Error("Native resume recovery is uncertain");
    return {
      operationId: bound.operationId,
      fence: bound.fence,
      recovered: true,
      pins,
    };
  }
  /** Settle a launched resume whose thread never reached the controller. The
   * guest adopts it when it recorded the expected thread; otherwise only an
   * explicit owner retirement quarantines the lineage. Nothing is moved. */
  async reconcileInterruptedResume(
    session: CodingSession,
    resumeFrom: CodingSession,
    retire: boolean,
  ): Promise<{
    operationId: string;
    fence: number;
    outcome: ResumeReconciliation;
    pins: CodingPins;
  }> {
    if (typeof retire !== "boolean")
      throw Error("Unsupported native resume reconciliation");
    const bound = this.resumePair(session, resumeFrom);
    const { result, pins } = await this.invoke("reconcile-resume", bound, {
      resumeFrom: this.session(resumeFrom),
      retire,
    });
    const outcome = result.outcome as ResumeReconciliation;
    if (!resumeReconciliations.includes(outcome))
      throw Error("Native resume reconciliation is uncertain");
    return {
      operationId: bound.operationId,
      fence: bound.fence,
      outcome,
      pins,
    };
  }
  /** Remove a retired lineage's session folders and stopped containers. The
   * guest walks the retired successor's recorded predecessors, each reserved
   * by the session after it, and refuses unless all are stopped and gone.
   * Records stay as tombstones, so the lineage is never resumed. */
  async cleanupRetiredLineage(session: CodingSession): Promise<{
    operationId: string;
    fence: number;
    cleaned: number;
    pins: CodingPins;
  }> {
    if (
      !sessionIdentity(session) ||
      session.state !== "stopped" ||
      session.intent !== "resume"
    )
      throw Error("Unsupported native lineage cleanup");
    const bound = this.session(session);
    const { result, pins } = await this.invoke("cleanup-retired", bound);
    if (!Number.isSafeInteger(result.cleaned) || (result.cleaned as number) < 1)
      throw Error("Native lineage cleanup is uncertain");
    return {
      operationId: bound.operationId,
      fence: bound.fence,
      cleaned: result.cleaned as number,
      pins,
    };
  }
  /** Remove a superseded lineage's session folders and stopped containers:
   * the head the host left when coding restarted under another route, and
   * its recorded predecessors. The guest refuses a head that was retired or
   * that a successor reserved, and marks the head so it is never resumed. */
  async cleanupSupersededLineage(session: CodingSession): Promise<{
    operationId: string;
    fence: number;
    cleaned: number;
    pins: CodingPins;
  }> {
    if (
      !sessionIdentity(session) ||
      session.state !== "stopped" ||
      !["start", "resume"].includes(session.intent)
    )
      throw Error("Unsupported native lineage cleanup");
    const bound = this.session(session);
    const { result, pins } = await this.invoke("cleanup-superseded", bound);
    if (!Number.isSafeInteger(result.cleaned) || (result.cleaned as number) < 1)
      throw Error("Native lineage cleanup is uncertain");
    return {
      operationId: bound.operationId,
      fence: bound.fence,
      cleaned: result.cleaned as number,
      pins,
    };
  }
  /** Validate an explicit successor/predecessor pair before guest effects. */
  private resumePair(
    session: CodingSession,
    resumeFrom: CodingSession,
  ): CodingSession {
    if (
      !sessionIdentity(session) ||
      !sessionIdentity(resumeFrom) ||
      resumeFrom.operationId === session.operationId ||
      resumeFrom.fence > session.fence ||
      resumeFrom.state !== "stopped" ||
      !["start", "resume"].includes(resumeFrom.intent)
    )
      throw Error("Unsupported native resume pair");
    return this.session(session);
  }
  async stop(session: CodingSession) {
    const { result } = await this.invoke("stop", this.session(session));
    if (result.stopped !== true || result.remainingProcesses !== 0)
      throw Error("Native coding shutdown is uncertain");
    return {
      operationId: session.operationId,
      fence: session.fence,
      stopped: true,
      remainingProcesses: 0,
    };
  }
  async collect(session: CodingSession): Promise<CodingCollection> {
    const binding = this.session(session);
    const before = await this.inspect(binding);
    const { result, pins } = await this.invoke("collect", binding);
    if (
      JSON.stringify(pins) !== JSON.stringify(before) ||
      !Array.isArray(result.files)
    )
      throw Error("Native coding collection changed");
    const files: CodingRequest["files"] = result.files.map((file: unknown) => {
      if (
        !record(file) ||
        typeof file.path !== "string" ||
        typeof file.bytes !== "string" ||
        typeof file.executable !== "boolean"
      )
        throw Error("Invalid native coding collection");
      return {
        path: file.path,
        bytes: this.decode(file.bytes, 262144),
        executable: file.executable,
      };
    });
    this.files(files);
    if (JSON.stringify(await this.inspect(binding)) !== JSON.stringify(before))
      throw Error("Native coding collection changed");
    return {
      complete: true,
      operationId: binding.operationId,
      fence: binding.fence,
      files: files.map((file) => ({
        ...file,
        ordinary: true,
        links: 1,
        beforeSha256: digest(file.bytes),
        afterSha256: digest(file.bytes),
      })),
    };
  }
}
