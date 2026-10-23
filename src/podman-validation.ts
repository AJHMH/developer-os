import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import {
  managementBindingSha256,
  managementHost,
  runManagement,
  validGuestBinding,
} from "./native-management.js";
import {
  validCheckBounds,
  type IsolatedValidationTransport,
  type ValidationPins,
  type ValidationRunRequest,
  type ValidationRunResult,
} from "./native-validation.js";
import { admittedPath } from "./workspace.js";

const digest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const sha256 = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

/** Each management action observes the VM; only stop may report no binding. */
type ValidationAction = "inspect" | "prepare" | "start" | "poll" | "stop";

/** Trusted VM management source for offline validation. Requests are JSON
 * data, never generated commands. Each check runs in a fresh container from
 * the owner-loaded image, by ID, with no network and only the attempt's
 * workspace mounted. A guest timer kills a check at its timeout even if the
 * controller is gone. Each check starts from a fresh copy of the pristine,
 * never-mounted input and is measured after it exits. Stop fences the
 * attempt, removes every check container and reports the tested tree only when
 * every check left its copy unchanged. Shared helpers mirror the coding guest
 * program in podman-coding.ts; each program stays separate because its digest
 * is its own owner-admitted policy pin, so fix both when fixing either. */
const management = String.raw`
import os,json,subprocess,hashlib,pathlib,stat,selectors,signal,time,fcntl,uuid,base64,re

def fail(): raise RuntimeError('Native validation observation unavailable')
def h(b): return hashlib.sha256(b).hexdigest()
def command(args):
 args=[args[0] if args[0].startswith('/') else '/usr/bin/'+args[0],*args[1:]]
 deadline=time.monotonic()+15
 p=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
 output=bytearray();errors=bytearray();completed=False
 try:
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
def exists(name):
 # Absence is an independently observed result, never a swallowed error.
 r=subprocess.run(['/usr/bin/podman','container','exists',name],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
 if r.returncode==1: return False
 if r.returncode!=0: fail()
 return True

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
 # Only this attempt's own check containers may be running.
 for c in obj('ps','--format','json'):
  names=c.get('Names') or []
  if not R.get('name') or len(names)!=1 or not names[0].startswith(R['name']+'-c'): fail()
 if not re.fullmatch('[a-f0-9]{64}',R['imageSha256']): fail()
 checked=obj('image','inspect',R['imageSha256'])[0]
 if checked.get('Id')!=R['imageSha256'] or checked.get('Architecture')!=R['guestArch']: fail()
 machine_id=pathlib.Path('/etc/machine-id').read_text().strip()
 if not re.fullmatch('[a-f0-9]{32}',machine_id): fail()
 return dict(engineVersion=info['version']['Version'],vmImageSha256=image[7:],image=R['imageSha256'],hostId=h(machine_id.encode()))

def directory(path):
 os.makedirs(path,mode=0o700,exist_ok=True)
 p=pathlib.Path(path)
 for parent in [p,*p.parents]:
  if parent.is_symlink(): fail()
 s=os.lstat(path)
 if not stat.S_ISDIR(s.st_mode) or s.st_uid!=os.getuid() or s.st_mode&0o077: fail()
def save(path,value):
 temp=path+'.new-'+uuid.uuid4().hex
 fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'w') as f: json.dump(value,f);f.flush();os.fsync(f.fileno())
 os.replace(temp,path)
 fd=os.open(os.path.dirname(path),os.O_RDONLY|os.O_DIRECTORY)
 try: os.fsync(fd)
 finally: os.close(fd)
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
def gone(entry):
 if entry['group'] and census(entry['group']): return False
 for pid,start in entry['pids'].items():
  try:
   if pathlib.Path('/proc/'+pid+'/stat').read_text().rsplit(')',1)[1].split()[19]==start: return False
  except FileNotFoundError: pass
 return True
def timer_state(unit):
 lines=command(['systemctl','--user','show',unit,'--property=LoadState,ActiveState,Job']).decode('ascii').splitlines()
 if len(lines)!=3: fail()
 state=dict(line.split('=',1) for line in lines)
 if set(state)!=set(['LoadState','ActiveState','Job']) or state['Job']!='': fail()
 if state['LoadState']=='not-found':
  if state['ActiveState']!='inactive': fail()
 elif state['LoadState']!='loaded' or state['ActiveState'] not in ['active','inactive','failed']: fail()
 return state
def stop_deadline(name):
 for suffix in ['-deadline.timer','-deadline.service']:
  unit=name+suffix
  if timer_state(unit)['LoadState']=='loaded': command(['systemctl','--user','stop',unit])
  if timer_state(unit)['ActiveState'] not in ['inactive','failed']: fail()
def path_ok(path):
 parts=path.split('/')
 return bool(path) and '\\' not in path and ':' not in path and all(p and p not in ['.','..'] and not re.search(r'[\x00-\x1f\x7f]',p) and not re.search(r'[. ]$',p) and not re.match(r'^(\.git|\.env(\..*)?|\.ssh|\.gnupg|\.aws|\.codex|\.agents|\.claude|\.npmrc|\.mcp\.json|sbxenv\.ya?ml)$',p,re.I) and not re.search(r'\.(pem|key|p12|pfx)$',p,re.I) and not re.match(r'^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)',p,re.I) for p in parts)
def manifest_digest(entries): return h(json.dumps(entries,ensure_ascii=False,separators=(',',':')).encode())
CHANGED=h(b'changed-workspace')
def measure(folder,order):
 # A workspace as the same manifest the input was bound to. Links, special
 # files, unreadable entries, odd names and oversized trees are changes,
 # never failures: a check must not be able to wedge its own shutdown.
 try:
  found={};count=0;total=0
  pending=[(folder,'')]
  while pending:
   current,prefix=pending.pop()
   with os.scandir(current) as entries:
    for entry in entries:
     count+=1
     if count>100000: return CHANGED
     name=prefix+entry.name
     s=entry.stat(follow_symlinks=False)
     if stat.S_ISDIR(s.st_mode): pending.append((entry.path,name+'/'));continue
     if not stat.S_ISREG(s.st_mode) or s.st_nlink!=1 or s.st_size>67108864: return CHANGED
     total+=s.st_size
     if total>268435456: return CHANGED
     fd=os.open(entry.path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
     with os.fdopen(fd,'rb') as f: found[name]=dict(path=name,sha256=h(f.read()),executable=bool(s.st_mode&0o111))
  names=order if sorted(found)==sorted(order) else sorted(found)
  return manifest_digest([found[n] for n in names])
 except (OSError,UnicodeEncodeError,ValueError): return CHANGED
def discard(path):
 # Inside the user namespace the guest user is root over its own files, so
 # unreadable, deep or long-named trees a check left behind still go.
 if os.path.lexists(path): command(['podman','unshare','rm','-rf','--one-file-system','--',path])
 if os.path.lexists(path): fail()
def fresh_workspace(path):
 # Each check starts from the pristine, never-mounted input.
 directory(path)
 for name in record['order']:
  source=operation+'/input/'+name;s=ordinary(source)
  target=path+'/'+name
  os.makedirs(os.path.dirname(target),mode=0o700,exist_ok=True)
  fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o700 if s.st_mode&0o111 else 0o600)
  with os.fdopen(fd,'wb') as f: f.write(pathlib.Path(source).read_bytes())
def kill_check(entry):
 if exists(entry['container']):
  check_container(entry['container'])
  subprocess.run(['/usr/bin/podman','kill','--signal','KILL',entry['container']],stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=15)
  pod('rm','--force',entry['container'])
  if exists(entry['container']): fail()
 stop_deadline(entry['container'])
 if not gone(entry): fail()
def effective(c,argv,work):
 if c.get('Image')!=R['imageSha256'] or c['Config'].get('Entrypoint') not in [['/bin/sh'],'/bin/sh'] or c['Config'].get('Cmd')!=['-c','exec "$@"','--',*argv]: fail()
 hc=c['HostConfig'];env=dict(x.split('=',1) for x in c['Config']['Env'])
 expected={'PATH':'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/tmp','CI':'true','HOSTNAME':'aios-validation'}
 if hc.get('Privileged') or hc.get('VolumesFrom') or hc.get('PortBindings') or hc.get('Devices') or hc.get('CapAdd'): fail()
 if hc.get('NetworkMode')!='none' or hc.get('PidMode')!='private' or hc.get('IpcMode')!='private' or not hc.get('ReadonlyRootfs'): fail()
 if c['Config']['User']!='65534:65534' or env!=expected or hc.get('RestartPolicy',{}).get('Name')!='no' or c['Config'].get('WorkingDir')!='/workspace': fail()
 if hc.get('PidsLimit')!=256 or hc.get('Memory')!=1073741824 or 'no-new-privileges' not in hc.get('SecurityOpt',[]) or 'seccomp='+root+'/seccomp.json' not in hc.get('SecurityOpt',[]): fail()
 binds=[m for m in c.get('Mounts',[]) if m.get('Type')=='bind']
 if len(binds)!=1 or any(m.get('Type') not in ['bind','tmpfs'] or (m.get('Type')=='tmpfs' and m.get('Destination')!='/tmp') for m in c.get('Mounts',[])): fail()
 m=binds[0]
 if m.get('Destination')!='/workspace' or m.get('Source')!=work or m.get('RW') is not True or m.get('Propagation') not in ['rprivate','private']: fail()
def live(c):
 values={x.split(':',1)[0]:x.split(':',1)[1].strip() for x in pathlib.Path('/proc/'+str(c['State']['Pid'])+'/status').read_text().splitlines() if ':' in x}
 if values.get('NoNewPrivs')!='1' or values.get('Seccomp')!='2' or int(values.get('CapEff','f'),16)!=0: fail()
def check_container(name):
 c=obj('inspect',name)[0]
 if c['Config'].get('Labels',{})!={'aios.validation.authority':R['authority'],'aios.validation.attempt':identity}: fail()
 return c

root=os.path.expanduser('~/.local/state/aios-validation-v1')
result={}
if R['action']=='inspect':
 binding=snapshot()
else:
 attempt=R.get('attempt')
 if not isinstance(attempt,dict) or not isinstance(attempt.get('operationId'),str) or not re.fullmatch('[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}',attempt['operationId']) or type(attempt.get('fence')) is not int or attempt['fence']<1: fail()
 if R.get('name')!='aios-validation-'+h((R['authority']+attempt['operationId']).encode())[:32]: fail()
 directory(root)
 shared=os.path.expanduser('~/.local/state/aios-offline-v1')
 directory(shared)
 lockfd=os.open(shared+'/lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
 with os.fdopen(lockfd,'w') as lock:
  fcntl.flock(lock,fcntl.LOCK_EX)
  owner=root+'/authority.json'
  if os.path.exists(owner):
   if read(owner)!=R['authority']: fail()
  elif R['action'] in ['prepare','stop']: save(owner,R['authority'])
  else: fail()
  identity=h(json.dumps(dict(operationId=attempt['operationId'],fence=attempt['fence']),sort_keys=True).encode())
  recordPath=root+'/'+R['name']+'.json'
  record=read(recordPath) if os.path.lexists(recordPath) else None
  if record and record['identity']!=identity: fail()
  operation=root+'/'+R['name']
  if R['action'] in ['prepare','start','poll']:
   binding=snapshot()
   if binding!=R['expectedBinding']: fail()
  if R['action']=='prepare':
   if not re.fullmatch('[a-f0-9]{64}',R.get('treeSha256','')) or not re.fullmatch('[a-f0-9]{64}',R.get('manifestSha256','')): fail()
   if record:
    # Idempotent per attempt: the same tree, never a replacement.
    if record['phase']!='prepared' or record['treeSha256']!=R['treeSha256'] or record['manifestSha256']!=R['manifestSha256']: fail()
   else:
    total=0;names=set();inputs=[];manifest=[]
    if not isinstance(R.get('files'),list) or len(R['files'])>1000: fail()
    for file in R['files']:
     path=file['path'];data=base64.b64decode(file['bytes'],validate=True);total+=len(data)
     if not isinstance(path,str) or not path_ok(path) or path.lower() in names or len(data)>262144 or total>1048576 or type(file['executable']) is not bool: fail()
     names.add(path.lower());inputs.append((path,data,file['executable']))
     manifest.append(dict(path=path,sha256=h(data),executable=file['executable']))
    if manifest_digest(manifest)!=R['manifestSha256']: fail()
    record=dict(identity=identity,binding=binding,treeSha256=R['treeSha256'],manifestSha256=R['manifestSha256'],order=[m['path'] for m in manifest],phase='preparing',checks=[])
    save(recordPath,record)
    directory(operation);directory(operation+'/input')
    for path,data,executable in inputs:
     target=operation+'/input/'+path
     os.makedirs(os.path.dirname(target),mode=0o700,exist_ok=True)
     fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o700 if executable else 0o600)
     with os.fdopen(fd,'wb') as f: f.write(data)
    profile=json.loads(pathlib.Path('/usr/share/containers/seccomp.json').read_text())
    if profile.get('defaultAction')!='SCMP_ACT_ERRNO': fail()
    for rule in profile['syscalls']: rule['names']=[n for n in rule['names'] if n not in ['unshare','setns']]
    profile['syscalls']=[r for r in profile['syscalls'] if r['names']]
    save(root+'/seccomp.json',profile)
    record['phase']='prepared';save(recordPath,record)
  elif R['action']=='start':
   check=R.get('check')
   if not record or record['phase']!='prepared' or record['treeSha256']!=R.get('treeSha256'): fail()
   if not isinstance(check,dict) or set(check)!={'id','command','timeoutMs'}: fail()
   argv=check['command']
   if not isinstance(check['id'],str) or not 0<len(check['id'])<=2000 or not isinstance(argv,list) or not 1<=len(argv)<=32 or not all(isinstance(a,str) and 0<len(a)<=2000 and not re.search(r'[\x00-\x1f\x7f]',a) for a in argv): fail()
   if type(check['timeoutMs']) is not int or not 1<=check['timeoutMs']<=120000: fail()
   index=len(record['checks']);name=R['name']+'-c'+str(index);work=operation+'/check-'+str(index)
   entry=dict(checkId=check['id'],container=name,workspace=work,argv=argv,group='',pids={},exitCode=None,timedOut=False,treeSha256=None)
   record['checks'].append(entry);record['phase']='running';save(recordPath,record)
   fresh_workspace(work)
   pod('create','--name',name,'--hostname=aios-validation','--pull=never','--network=none','--read-only','--tmpfs=/tmp:rw,nosuid,nodev,size=268435456','--cap-drop=ALL','--security-opt=no-new-privileges','--security-opt=seccomp='+root+'/seccomp.json','--userns=keep-id:uid=65534,gid=65534','--user=65534:65534','--pid=private','--ipc=private','--pids-limit=256','--memory=1024m','--http-proxy=false','--unsetenv-all','--env','PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','--env','HOME=/tmp','--env','CI=true','--workdir=/workspace','--entrypoint=/bin/sh','--log-driver=none','--restart=no','--label','aios.validation.authority='+R['authority'],'--label','aios.validation.attempt='+identity,'--volume',work+':/workspace:rw,Z,rprivate',R['imageSha256'],'-c','exec "$@"','--',*argv)
   effective(check_container(name),argv,work)
   # The guest deadline bounds the check even when the controller is gone.
   command(['systemd-run','--user','--unit='+name+'-deadline','--on-active='+str(check['timeoutMs']/1000)+'s','--timer-property=AccuracySec=100ms','--timer-property=RemainAfterElapse=yes','--property=RemainAfterExit=yes','/usr/bin/podman','kill','--signal','KILL',name])
   if timer_state(name+'-deadline.timer')['ActiveState']!='active': fail()
   pod('start',name)
   c=check_container(name)
   if c['State'].get('Running'):
    try:
     live(c)
     entry['group']=group(c['State']['Pid'])
     entry['pids']={str(c['State']['Pid']):pathlib.Path('/proc/'+str(c['State']['Pid'])+'/stat').read_text().rsplit(')',1)[1].split()[19]}
    except FileNotFoundError:
     # A check may finish before its process is observed; only then is a
     # missing process acceptable. The static configuration was verified.
     if check_container(name)['State'].get('Running'): fail()
   save(recordPath,record)
   result=dict(container=name)
  elif R['action']=='poll':
   if not record or record['phase']!='running' or not record['checks'] or record['checks'][-1]['checkId']!=R.get('checkId'): fail()
   entry=record['checks'][-1]
   c=check_container(entry['container'])
   if c['State'].get('Running'):
    result=dict(running=True)
   else:
    if not gone(entry): fail()
    code=c['State'].get('ExitCode')
    if type(code) is not int or not 0<=code<=255: fail()
    entry['exitCode']=code
    # Only the guest deadline's own kill is a timeout, never any exit 137.
    entry['timedOut']=timer_state(entry['container']+'-deadline.service')['ActiveState']!='inactive'
    stop_deadline(entry['container'])
    pod('rm',entry['container'])
    if exists(entry['container']): fail()
    entry['treeSha256']=measure(entry['workspace'],record['order'])
    discard(entry['workspace'])
    record['phase']='prepared';save(recordPath,record)
    result=dict(running=False,exitCode=code,timedOut=entry['timedOut'])
  elif R['action']=='stop':
   if record is None: record=dict(identity=identity,phase='revoked',checks=[],order=[],treeSha256='',manifestSha256='')
   if record['phase']!='stopped':
    # Fence when the disk allows; a full disk must never prevent shutdown.
    try: record['phase']='revoked';save(recordPath,record)
    except OSError: pass
    for entry in record['checks']:
     kill_check(entry)
     if entry.get('treeSha256') is None and os.path.lexists(entry.get('workspace','')): entry['treeSha256']=measure(entry['workspace'],record['order'])
    changed=[e['treeSha256'] for e in record['checks'] if e.get('treeSha256') not in [None,record['manifestSha256']]]
    final=changed[0] if changed else record['treeSha256'] if record['manifestSha256'] else h(b'never-prepared')
    discard(operation)
    record['finalTreeSha256']=final;record['phase']='stopped';save(recordPath,record)
   result=dict(stopped=True,remainingProcesses=0,treeSha256=record['finalTreeSha256'])
  else: fail()
print(json.dumps(dict(attempt=R.get('attempt'),binding=binding if 'binding' in globals() else None,**result)))
`;

/** Offline native validation groundwork; never a production qualification.
 * The pinned validation runtime rejects this live adapter unless an owner
 * validation admission record names its exact fresh pins. */
export class NativePodmanValidationTransport
  implements IsolatedValidationTransport
{
  readonly mode = "live" as const;
  readonly productionEnabled = false;
  private readonly pollMs: number;
  constructor(
    private readonly machine: string,
    private readonly authority: string,
    private readonly imageSha256: string,
    options: { pollMs?: number } = {},
  ) {
    if (
      !/^aios-[a-z0-9-]+$/.test(machine) ||
      !sha256(authority) ||
      !sha256(imageSha256)
    )
      throw Error("Invalid native validation authority");
    this.pollMs = options.pollMs ?? 1000;
    Object.freeze(this);
  }
  private async invoke(
    action: ValidationAction,
    attempt?: { operationId: string; fence: number },
    payload: Record<string, unknown> = {},
    permit?: () => boolean,
  ) {
    const managed = managementHost(this.machine);
    const { host } = managed;
    const identity = attempt
      ? { operationId: attempt.operationId, fence: attempt.fence }
      : null;
    const request = {
      action,
      attempt: identity,
      authority: this.authority,
      ...(identity
        ? {
            name: `aios-validation-${digest(this.authority + identity.operationId).slice(0, 32)}`,
          }
        : {}),
      provider: host.provider,
      guestArch: host.guestArch,
      imageReference: host.imageReference,
      imageSha256: this.imageSha256,
      ...payload,
    };
    const result: unknown = await runManagement(
      managed,
      request,
      management,
      "validation",
      action,
      permit,
    );
    if (
      !record(result) ||
      (result.binding !== null &&
        (!validGuestBinding(managed, result.binding) ||
          result.binding.image !== this.imageSha256)) ||
      (action !== "stop" && result.binding === null) ||
      JSON.stringify(result.attempt) !== JSON.stringify(identity)
    )
      throw Error("Native validation binding changed");
    const pins: ValidationPins = {
      imageSha256: this.imageSha256,
      policySha256: digest(management),
      bindingSha256: managementBindingSha256(
        managed,
        this.authority,
        result.binding,
      ),
    };
    return { result, pins };
  }
  async inspect(): Promise<ValidationPins> {
    return (await this.invoke("inspect")).pins;
  }
  async run(request: ValidationRunRequest): Promise<ValidationRunResult> {
    const { mayDispatch, check } = request;
    let total = 0;
    if (
      !uuid.test(String(request.operationId)) ||
      !Number.isSafeInteger(request.fence) ||
      request.fence < 1 ||
      !sha256(request.treeSha256) ||
      typeof mayDispatch !== "function" ||
      !Array.isArray(request.files) ||
      request.files.length > 1000 ||
      !request.files.every(
        (file) =>
          admittedPath(file.path) &&
          Buffer.isBuffer(file.bytes) &&
          file.bytes.length <= 262144 &&
          (total += file.bytes.length) <= 1048576 &&
          typeof file.executable === "boolean",
      ) ||
      !validCheckBounds(check)
    )
      throw Error("Unsupported native validation request");
    const attempt = { operationId: request.operationId, fence: request.fence };
    const inspected = await this.invoke("inspect", attempt);
    const expectedBinding = inspected.result.binding;
    const manifest = request.files.map((file) => ({
      path: file.path,
      sha256: digest(file.bytes),
      executable: file.executable,
    }));
    await this.invoke(
      "prepare",
      attempt,
      {
        expectedBinding,
        treeSha256: request.treeSha256,
        manifestSha256: digest(JSON.stringify(manifest)),
        files: request.files.map((file) => ({
          path: file.path,
          bytes: file.bytes.toString("base64"),
          executable: file.executable,
        })),
      },
      mayDispatch,
    );
    await this.invoke(
      "start",
      attempt,
      {
        expectedBinding,
        treeSha256: request.treeSha256,
        check: {
          id: check.id,
          command: [...check.command],
          timeoutMs: check.timeoutMs,
        },
      },
      mayDispatch,
    );
    // The guest timer ends the check at its timeout; polling ends a little
    // after that, so a lost guest timer can never keep this call waiting.
    const deadline = performance.now() + check.timeoutMs + 30000;
    for (;;) {
      await sleep(this.pollMs);
      const polled = await this.invoke(
        "poll",
        attempt,
        { expectedBinding, checkId: check.id },
        mayDispatch,
      );
      if (polled.result.running === false) {
        if (
          !Number.isSafeInteger(polled.result.exitCode) ||
          typeof polled.result.timedOut !== "boolean"
        )
          throw Error("Native validation binding changed");
        return {
          operationId: attempt.operationId,
          fence: attempt.fence,
          checkId: check.id,
          exitCode: polled.result.exitCode as number,
          timedOut: polled.result.timedOut as boolean,
          pins: polled.pins,
        };
      }
      if (polled.result.running !== true || performance.now() > deadline)
        throw Error("Native validation check outlived its deadline");
    }
  }
  async stop(attempt: { operationId: string; fence: number }) {
    if (
      !uuid.test(String(attempt?.operationId)) ||
      !Number.isSafeInteger(attempt?.fence) ||
      attempt.fence < 1
    )
      throw Error("Invalid native validation attempt");
    const { result } = await this.invoke("stop", attempt);
    if (
      result.stopped !== true ||
      result.remainingProcesses !== 0 ||
      !sha256(result.treeSha256)
    )
      throw Error("Native validation stop is uncertain");
    return {
      operationId: attempt.operationId,
      fence: attempt.fence,
      stopped: true,
      remainingProcesses: 0,
      treeSha256: result.treeSha256 as string,
    };
  }
}
