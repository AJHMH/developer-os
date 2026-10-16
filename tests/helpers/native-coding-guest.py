"""External Linux/Podman simulator; executes the transported Python program.
No VM, provider, owner credentials or real qualification is involved.
"""
import sys, os, json, pathlib, subprocess, hashlib, types, fcntl
root = pathlib.Path(sys.argv[1])
os.environ['HOME'] = str(root)
state_path = root / 'engine.json'
state = json.loads(state_path.read_text()) if state_path.exists() else {'commands': [], 'container': None, 'alive': False}
real_read = pathlib.Path.read_text
real_exists = pathlib.Path.exists
real_rglob = pathlib.Path.rglob
source = sys.stdin.read()
namespace = {}
exec(source.split('\n', 2)[0] + '\n' + source.split('\n', 2)[1], namespace)
request = namespace['R']
artifact = root / '.local/state/aios-offline-v1/codex-0.161.0'
artifact.parent.mkdir(parents=True, exist_ok=True)
artifact.parent.chmod(0o700)
artifact.write_bytes(b'synthetic-pinned-artifact')
artifact.chmod(0o700)
# Substitute a fixture artifact pin in the external guest request/observation.
# The management program still performs the real SHA-256 checks itself.
official_pin = request['cliSha256']
request['cliSha256'] = hashlib.sha256(b'synthetic-pinned-artifact').hexdigest()

def read_text(path, *args, **kwargs):
    p = str(path)
    if p.endswith('/sys_vendor'): return 'Apple Inc.'
    if p.endswith('/product_name'): return 'Apple Virtualization Generic Platform'
    if p == '/usr/share/containers/seccomp.json':
        return json.dumps({'defaultAction': 'SCMP_ACT_ERRNO', 'syscalls': [{'names': ['read','unshare','setns'], 'action': 'SCMP_ACT_ALLOW'}]})
    if p == '/proc/42/status': return 'NoNewPrivs:\t1\nSeccomp:\t2\nCapEff:\t00000000\n'
    if p == '/proc/42/cgroup': return '0::/machine.slice/libpod-test.scope\n'
    if p == '/proc/42/stat':
        if not state['alive']: raise FileNotFoundError(p)
        return '42 (worker) ' + ' '.join(['0'] * 19 + ['12345'])
    if p.endswith('/libpod-test.scope/cgroup.procs'): return '42\n' if state['alive'] else ''
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
    elif args[:3] == ['sudo','-n','cat']: output = b'synthetic-vm-uuid'
    elif args[0] == 'systemd-run':
        if state.get('leaseUnavailable'): code = 1
    elif args[0] == 'systemctl':
        if args[2] == 'is-active': output = b'active'
    elif args[0] == 'podman':
        action = args[1]
        c = state['container']
        if action == 'info': output = json.dumps({'host': {'security': {'rootless': True}, 'cgroupVersion': 'v2'}, 'version': {'Version': '6.1.1'}}).encode()
        elif action == 'ps': output = json.dumps([{'Names': [request['name']]}] if c and c['State']['Running'] else []).encode()
        elif action == 'image': output = json.dumps([{'RepoDigests': [request['template']], 'Architecture': request['guestArch'], 'Config': {'Env': ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin']}}]).encode()
        elif action == 'create':
            mounts = []; env = []; labels = {}
            for i, value in enumerate(args):
                if value == '--volume':
                    src, dest, opts = args[i+1].split(':')
                    mounts.append({'Type': 'bind', 'Source': src, 'Destination': dest, 'RW': 'rw' in opts.split(','), 'Propagation': 'rprivate'})
                elif value == '--env': env.append(args[i+1])
                elif value == '--label':
                    key, val = args[i+1].split('=',1); labels[key] = val
            env.append('HOSTNAME=aios-coding')
            state['container'] = {'Config': {'Cmd': args[args.index(request['template'])+1:], 'Entrypoint': None, 'User': '65534:65534', 'Env': env, 'Labels': labels}, 'HostConfig': {'NetworkMode': 'none', 'PidMode': 'private', 'IpcMode': 'private', 'ReadonlyRootfs': True, 'PidsLimit': 64, 'Memory': 536870912, 'SecurityOpt': [v.split('=',1)[1] for v in args if v.startswith('--security-opt=')], 'RestartPolicy': {'Name': 'no'}}, 'Mounts': mounts, 'State': {'Running': False, 'Pid': 0, 'Status': 'created', 'ExitCode': 0}}
            if state.get('unsafeNetwork'): state['container']['HostConfig']['NetworkMode'] = 'bridge'
        elif action == 'inspect':
            if not c: code = 1
            else: output = json.dumps([c]).encode()
        elif action == 'start': c['State'].update(Running=True, Pid=42, Status='running');state['alive'] = True
        elif action == 'exec':
            # Simulate Codex finishing after the trusted launch marker is released.
            if not state.get('keepRunning'):
                c['State'].update(Running=False, Pid=0, Status='exited', ExitCode=1)
                state['alive'] = False
            workspace = next(m['Source'] for m in c['Mounts'] if m['Destination'] == '/workspace')
            (pathlib.Path(workspace) / 'index.html').write_bytes(b'after\n')
        elif action == 'logs': output = b'{"type":"turn.failed"}\n'
        elif action == 'stop': c['State'].update(Running=False, Pid=0, Status='exited');state['alive'] = bool(state.get('orphan'))
        elif action == 'container': code = 0 if c else 1
        else: raise RuntimeError('Unexpected external command: ' + repr(args))
    else: raise RuntimeError('Unexpected external command: ' + repr(args))
    state_path.write_text(json.dumps(state))
    if hasattr(kwargs.get('stdout'), 'write'):
        kwargs['stdout'].write(output)
        output = None
    return types.SimpleNamespace(returncode=code, stdout=output, stderr=b'')
subprocess.run = run
import io, contextlib
output = io.StringIO()
with contextlib.redirect_stdout(output):
    exec(source.split('\n', 2)[2], {'R': request})
observed = json.loads(output.getvalue())
observed['cliSha256'] = official_pin
print(json.dumps(observed))
