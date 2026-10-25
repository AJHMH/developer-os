"""External Linux/Podman simulator; executes the transported Python program.
No VM, provider, owner credentials or real qualification is involved.
"""
import sys, os, json, pathlib, subprocess, hashlib, types, fcntl, threading, time, base64, re
root = pathlib.Path(sys.argv[1])
os.environ['HOME'] = str(root)
state_path = root / 'engine.json'
state = json.loads(state_path.read_text()) if state_path.exists() else {'commands': [], 'container': None, 'alive': False}
real_monotonic = time.monotonic
time.monotonic = lambda: real_monotonic() + state.get('timeOffset', 0)
real_popen = subprocess.Popen
real_read = pathlib.Path.read_text
real_exists = pathlib.Path.exists
real_rglob = pathlib.Path.rglob
source = sys.stdin.read()
namespace = {}
exec(source.split('\n', 2)[0] + '\n' + source.split('\n', 2)[1], namespace)
request = namespace['R']
if request['action'] == 'prepare' and state.get('transferredInputDrift'):
    request['files'][0]['bytes'] = base64.b64encode(b'foreign input\n').decode()
if request['action'] == 'prepare' and state.get('routeDropped'):
    request.pop('modelRoute', None)
if request['action'] == 'prepare' and state.get('promptOption'):
    request['argv'][-1] = '-cmodel="gpt-other"'
if request['action'] == 'prepare' and state.get('routeDrift'):
    request['modelRoute']['capability'] = 'x'
if request['action'] == 'launch' and state.get('launchProvenanceDrift'):
    request['admission'] = {'sourceRevision': 'f'*40, 'branch': 'codex/foreign', 'inputSha256': '0'*64}
artifact = root / '.local/state/aios-offline-v1/codex-0.161.0'
artifact.parent.mkdir(parents=True, exist_ok=True)
artifact.parent.chmod(0o700)
artifact.write_bytes(b'synthetic-pinned-artifact')
artifact.chmod(0o700)
# Substitute a fixture artifact pin in the external guest request/observation.
# The management program still performs the real SHA-256 checks itself.
official_pin = request['cliSha256']
request['cliSha256'] = hashlib.sha256(b'synthetic-pinned-artifact').hexdigest()
host_artifact = root / '.local/state/aios-offline-v1/codex-code-mode-host-0.161.0'
if state.get('hostArtifact') == 'missing':
    host_artifact.unlink(missing_ok=True)
else:
    host_artifact.write_bytes(b'foreign-code-mode-host' if state.get('hostArtifact') == 'foreign' else b'synthetic-code-mode-host')
    host_artifact.chmod(0o740 if state.get('hostArtifact') == 'group-readable' else 0o700)
request['codeModeHostSha256'] = hashlib.sha256(b'synthetic-code-mode-host').hexdigest()
if request['action'] == 'launch' and state.get('tamperHostCopy'):
    copy = root / '.local/state/aios-coding-v1' / request['name'] / 'codex-code-mode-host'
    copy.chmod(0o700)
    copy.write_bytes(b'foreign-code-mode-host')

def containers():
    result = dict(state.get('containers', {}))
    if state.get('containerName'): result[state['containerName']] = state['container']
    return result

def alive(c):
    return state['alive'] if c is state['container'] else c.get('FixtureAlive', False)

def set_alive(c, value):
    c['FixtureAlive'] = value
    if c is state['container']: state['alive'] = value

def read_text(path, *args, **kwargs):
    p = str(path)
    if p.endswith('/sys_vendor'): return 'Apple Inc.'
    if p.endswith('/product_name'): return 'Apple Virtualization Generic Platform'
    if p == '/etc/machine-id': return state.get('machineId', '0123456789abcdef0123456789abcdef') + '\n'
    if p == '/usr/share/containers/seccomp.json':
        return json.dumps({'defaultAction': 'SCMP_ACT_ERRNO', 'syscalls': [{'names': ['read','unshare','setns'], 'action': 'SCMP_ACT_ALLOW'}]})
    match = re.fullmatch(r'/proc/(\d+)/(status|cgroup|stat)', p)
    if match:
        c = next((c for c in containers().values() if c.get('FixturePid') == int(match[1]) or int(match[1]) in c.get('FixtureExtraPids', [])), None)
        if not c or not alive(c): raise FileNotFoundError(p)
        if match[2] == 'status': return 'NoNewPrivs:\t1\nSeccomp:\t2\nCapEff:\t00000000\n'
        if match[2] == 'cgroup': return '0::/machine.slice/'+c['FixtureGroup']+'\n'
        return match[1]+' (worker) ' + ' '.join(['0'] * 19 + ['12345'])
    if p.startswith('/sys/fs/cgroup/') and p.endswith('/cgroup.procs'):
        c = next((c for c in containers().values() if p.endswith('/'+c.get('FixtureGroup', '')+'/cgroup.procs')), None)
        return ''.join(str(pid)+'\n' for pid in [c['FixturePid'], *c.get('FixtureExtraPids', [])]) if c and alive(c) else ''
    return real_read(path, *args, **kwargs)
pathlib.Path.read_text = read_text
pathlib.Path.exists = lambda path: True if str(path).startswith('/sys/fs/cgroup/') else real_exists(path)
pathlib.Path.rglob = lambda path, pattern: [path / 'cgroup.procs'] if str(path).startswith('/sys/fs/cgroup/') else real_rglob(path, pattern)

real_flock = fcntl.flock
def flock(fd, mode):
    expected = artifact.parent / 'lock'
    observed = os.fstat(fd.fileno() if hasattr(fd, 'fileno') else fd)
    target = expected.stat() if expected.exists() else None
    state.setdefault('sharedManagementLocks', []).append(bool(target and (observed.st_dev, observed.st_ino) == (target.st_dev, target.st_ino)))
    return real_flock(fd, mode)
fcntl.flock = flock

def run(args, **kwargs):
    args=[os.path.basename(args[0]),*args[1:]]
    state['commands'].append(args)
    output = b''; code = 0
    if args[0] == 'findmnt': output = json.dumps({'filesystems': [{'fstype': 'ext4', 'target': '/'}]}).encode()
    elif args[0] == 'uname': output = b'aarch64'
    elif args[0] == 'systemd-detect-virt': output = b'apple'
    elif args[0] == 'rpm-ostree': output = json.dumps({'deployments': [{'booted': True, 'unlocked': 'none', 'container-image-reference': request['imageReference'], 'container-image-reference-digest': 'sha256:' + '1'*64}]}).encode()
    elif args[:3] == ['sudo','-n','podman']: output = b'[]'
    elif args[:3] == ['sudo','-n','cat']: output = state.get('productUuid', 'synthetic-vm-uuid').encode()
    elif args[0] == 'systemd-run':
        if state.get('leaseUnavailable'): code = 1
        else:
            unit = next(x.split('=',1)[1] for x in args if x.startswith('--unit=')) + '.timer'
            state.setdefault('timers', {})[unit] = {'active': 'active', 'sub': 'waiting', 'starts': [time.monotonic()]}
            state['timers'][unit.removesuffix('.timer')+'.service'] = {'active': 'inactive', 'starts': []}
    elif args[0] == 'busctl':
        if not state.get('executionEvidence'): code = 1
        elif args[-1] == 'LastTriggerUSecMonotonic': output = json.dumps({'type': 't', 'data': 0 if state.get('executionMode') == 'never-triggered' else 100}).encode()
        elif args[-1] == 'ExecStart':
            target = request['name'] + ('-foreign' if state.get('executionMode') == 'wrong-command' else '')
            ignored = state.get('executionMode') == 'ignored-failure'
            output = json.dumps({'type': 's' if state.get('executionMode') == 'malformed' else 'a(sasbttttuii)', 'data': [['/usr/bin/podman',['/usr/bin/podman','kill','--signal','KILL',target],ignored,1000,101,1001,102,99,1,0]]}).encode()
            if state.get('executionMode') == 'never-triggered':
                value=json.loads(output);value['data'][0][3:]=[0,0,0,0,0,0,0];output=json.dumps(value).encode()
        else: raise RuntimeError('Unexpected manager property')
        if state.get('executionMode') == 'wrapped-data' and output:
            value=json.loads(output);value['data']=[value['data']];output=json.dumps(value).encode()
    elif args[0] == 'systemctl':
        timers = state.setdefault('timers', {})
        verb = args[2]
        if verb == 'is-active':
            output = timers.get(args[3], {}).get('active', 'inactive').encode()
        elif verb == 'show':
            timer = timers.get(args[3])
            mode = state.get('timerObservation')
            if mode == 'unavailable': code = 1
            elif mode == 'malformed': output = b'ActiveState=inactive\nJob=\n'
            else: output = ('LoadState=' + ('loaded' if timer else 'not-found') + '\nActiveState=' + (timer['active'] if timer else 'inactive') + ('\nSubState=' + (timer.get('sub', 'waiting') if timer else 'dead') if 'SubState' in args[-1] else '') + '\nJob=' + ('42' if mode == 'pending-job' else '') + '\n').encode()
        elif verb == 'restart':
            timer = timers.get(args[3])
            if not timer: code = 5
            else:
                recent = [n for n in timer['starts'] if time.monotonic()-n < 10]
                if state.get('enforceTimerRate') and len(recent) >= 5:
                    timer['active'] = 'failed';code = 1
                else: timer.update(active='active', starts=recent+[time.monotonic()])
        elif verb == 'stop':
            for unit in args[3:]:
                if state.get('timerStopUnavailable'):
                    code = 1;continue
                if unit not in timers and state.get('strictTimers'): code = 5
                timers.pop(unit, None)
        else: raise RuntimeError('Unexpected systemctl action')
    elif args[0] == 'podman':
        action = args[1]
        c = containers().get(args[-1] if action == 'stop' else args[3] if args[2:3] == ['-d'] else args[2]) if action in ['inspect','start','exec','logs','stop'] else state['container']
        if action == 'info':
            info = {'host': {'security': {'rootless': True}, 'cgroupVersion': 'v2'}, 'version': {'Version': '6.1.1'}}
            if state.get('oversizedObservation') == 'stdout': info['padding'] = 'x' * (8*1024*1024)
            output = json.dumps(info).encode()
        elif action == 'ps': output = json.dumps([{'Names': [name]} for name, value in containers().items() if value['State']['Running']]).encode()
        elif action == 'image': output = json.dumps([{'RepoDigests': [request['template']], 'Architecture': request['guestArch'], 'Config': {'Env': ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin']}}]).encode()
        elif action == 'create' and state.get('createUnavailable'): code = 1  # external engine refuses creation
        elif action == 'create':
            if state.get('largeDatabase'):
                database = root / 'engine-private.db'
                program = 'import pathlib,sys; pathlib.Path(sys.argv[1]).write_bytes(b"x"*(9*1024*1024))'
                with real_popen([sys.executable, '-c', program, str(database)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, preexec_fn=kwargs.get('preexec_fn')) as probe:
                    out, err = probe.communicate(timeout=10)
                    if probe.returncode:
                        state_path.write_text(json.dumps(state))
                        if hasattr(kwargs.get('stderr'), 'write'): kwargs['stderr'].write(err)
                        return types.SimpleNamespace(returncode=probe.returncode, stdout=out, stderr=err)
            mounts = []; env = []; labels = {}
            for i, value in enumerate(args):
                if value == '--volume':
                    src, dest, opts = args[i+1].split(':')
                    mounts.append({'Type': 'bind', 'Source': src, 'Destination': dest, 'RW': 'rw' in opts.split(','), 'Propagation': 'rprivate'})
                elif value == '--env': env.append(args[i+1] + ('0' if state.get('routeEnvDrift') and args[i+1].startswith('AIOS_MODEL_ROUTE=') else ''))
                elif value == '--label':
                    key, val = args[i+1].split('=',1); labels[key] = val
            if state.get('dropHostMount'): mounts = [m for m in mounts if m['Destination'] != '/codex-code-mode-host']
            env.append('HOSTNAME=aios-coding')
            nextPid = 42 + len(containers())
            if state.get('containerName'): state.setdefault('containers', {})[state['containerName']] = state['container']
            state['containerName'] = request['name']
            state['container'] = {'Config': {'Cmd': args[args.index(request['template'])+1:], 'Entrypoint': None, 'User': '65534:65534', 'Env': env, 'Labels': labels}, 'HostConfig': {'NetworkMode': 'none', 'PidMode': 'private', 'IpcMode': 'private', 'ReadonlyRootfs': True, 'PidsLimit': 64, 'Memory': 536870912, 'SecurityOpt': [v.split('=',1)[1] for v in args if v.startswith('--security-opt=')], 'RestartPolicy': {'Name': 'no'}}, 'Mounts': mounts, 'State': {'Running': False, 'Pid': 0, 'Status': 'created', 'ExitCode': 0}}
            state['container'].update(FixturePid=nextPid, FixtureGroup='libpod-'+request['name']+'.scope', FixtureAlive=False)
            if state.get('unsafeNetwork'): state['container']['HostConfig']['NetworkMode'] = 'bridge'
            state.setdefault('containers', {})[request['name']] = state['container']
        elif action == 'inspect':
            if not c: code = 1
            else: output = json.dumps([c]).encode()
        elif action == 'start' and state.get('startUnavailable'): code = 1  # external engine fails to start
        elif action == 'start': c['State'].update(Running=True, Pid=c['FixturePid'], Status='running');set_alive(c, True)
        elif action == 'exec' and args[3:5] == ['/bin/sh', '-c'] and '--' in args:
            # The fixed boundary probe: echo a configured verdict, or run it.
            state.setdefault('probes', []).append(args[args.index('--')+1:])
            if 'probeOutput' in state: output = state['probeOutput'].encode()
            else:
                with real_popen(['/bin/sh', *args[4:]], stdout=subprocess.PIPE) as probe: output = probe.communicate(timeout=30)[0]
        elif action == 'exec' and args[2:3] == ['-d']:
            # A detached descendant joins the session's process census.
            if not state.get('descendantInvisible'):
                c.setdefault('FixtureExtraPids', []).append(900 + len(c.get('FixtureExtraPids', [])))
        elif action == 'exec':
            state['timeOffset'] = state.get('timeOffset', 0) + state.get('advanceAfterLaunch', 0)
            if state.get('loseTimerAfterLaunch'):
                unit = request['name'] + '-' + state['loseTimerAfterLaunch'] + '.timer'
                if state.get('timerLossState'):
                    state['timers'][unit]['active'] = state['timerLossState']
                else: state['timers'].pop(unit, None)
            # Simulate Codex finishing after the trusted launch marker is released.
            if not state.get('keepRunning'):
                c['State'].update(Running=False, Pid=0, Status='exited', ExitCode=1)
                set_alive(c, False)
            workspace = next(m['Source'] for m in c['Mounts'] if m['Destination'] == '/workspace')
            (pathlib.Path(workspace) / 'index.html').write_bytes(b'after\n')
        elif action == 'logs':
            output = ((json.dumps({'type':'thread.started','thread_id':state['threadId']})+'\n').encode() if state.get('threadId') else b'') + b'{"type":"turn.failed"}\n'
            state['polls'] = state.get('polls',0) + 1
            if state.get('stopAfterPolls') and state['polls'] >= state['stopAfterPolls']:
                c['State'].update(Running=False, Pid=0, Status='exited', ExitCode=1);set_alive(c, False)
        elif action == 'stop': c['State'].update(Running=False, Pid=0, Status='exited');set_alive(c, bool(state.get('orphan')))
        elif action == 'container': code = 0 if containers().get(args[-1]) else 1
        elif action == 'rm':
            name = args[-1]
            if not containers().get(name) or containers()[name]['State']['Running'] or state.get('rmRefused') == name: code = 1
            else:
                state.get('containers', {}).pop(name, None)
                if state.get('containerName') == name: state['containerName'] = None; state['container'] = None
        else: raise RuntimeError('Unexpected external command: ' + repr(args))
    else: raise RuntimeError('Unexpected external command: ' + repr(args))
    state_path.write_text(json.dumps(state))
    if hasattr(kwargs.get('stdout'), 'write'):
        kwargs['stdout'].write(output)
        output = None
    return types.SimpleNamespace(returncode=code, stdout=output, stderr=b'')
# Real pipes exercise the management stream reader. Engine behavior remains an
# external simulator; only the large-database case creates a real limited child.
class Process:
    def __init__(self, args, **kwargs):
        result = run(args, **kwargs)
        self.pid = 2147483647 # Synthetic identity, intercepted by the external kill adapter.
        self.returncode = None
        self.code = result.returncode
        self.threads = []
        streams = []
        for data in [result.stdout or b'', b'x' * (8*1024*1024+1) if state.get('oversizedObservation') == 'stderr' and len(args)>1 and args[1]=='info' else result.stderr or b'']:
            readfd, writefd = os.pipe()
            streams.append(os.fdopen(readfd, 'rb', buffering=0))
            def emit(fd=writefd, content=data):
                try:
                    view = memoryview(content)
                    while view:
                        count = os.write(fd, view)
                        view = view[count:]
                except BrokenPipeError: pass
                finally: os.close(fd)
            thread = threading.Thread(target=emit, daemon=True)
            thread.start(); self.threads.append(thread)
        self.stdout, self.stderr = streams
    def poll(self):
        if all(not t.is_alive() for t in self.threads): self.returncode = self.code
        return self.returncode
    def wait(self, timeout=None):
        deadline = time.monotonic() + (timeout if timeout is not None else 30)
        for thread in self.threads: thread.join(max(0, deadline-time.monotonic()))
        if any(t.is_alive() for t in self.threads): raise subprocess.TimeoutExpired('simulated engine', timeout)
        self.returncode = self.code
        return self.code

real_killpg = os.killpg
owned_groups = set()
def killpg(pid, sig):
    if pid == 2147483647: raise ProcessLookupError(pid)
    if pid not in owned_groups: raise AssertionError("Unowned process group")
    return real_killpg(pid, sig)
os.killpg = killpg

def popen(args, **kwargs):
    if state.get('hungObservation') and args[:2] == ['/usr/bin/podman', 'info']:
        child = real_popen([sys.executable, '-c', 'import time;time.sleep(30)'], **kwargs)
        owned_groups.add(child.pid)
        state['managementPid'] = child.pid
        state_path.write_text(json.dumps(state))
        monotonic = time.monotonic
        time.monotonic = lambda: monotonic() + 16
        return child
    return Process(args, **kwargs)

subprocess.Popen = popen
subprocess.run = run
import io, contextlib
output = io.StringIO()
with contextlib.redirect_stdout(output):
    exec(source.split('\n', 2)[2], {'R': request})
observed = json.loads(output.getvalue())
observed['cliSha256'] = official_pin
print(json.dumps(observed))
