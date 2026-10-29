"""External Linux/Podman simulator for the validation management program.
No VM, provider, image or owner credential is involved. Scripted check
commands stand in for real processes:
  true | false | exit N | write PATH TEXT | chmod PATH | link PATH | hang
  absent PATH (exit 1 if PATH exists) | present PATH | lock PATH (mode 000) |
  deep LEVELS [NAME_LENGTH] (nested dirs)
The dependency install container (`npm ci` from the prepared cache) is
simulated: each cached tarball becomes node_modules/p-<digest>/package.json,
with a .bin link. installExit, installHang, installNoModules and
installWritesInput script it; cacheChunkDrift alters the first uploaded
chunk and laterChunkDrift one past a tarball's start.
"""
import sys, os, json, pathlib, subprocess, time, types, re, signal, errno

root = pathlib.Path(sys.argv[1])
os.environ['HOME'] = str(root)
state_path = root / 'engine.json'
state = json.loads(state_path.read_text())
state.setdefault('commands', [])
state.setdefault('containers', {})
state.setdefault('units', {})
state.setdefault('nextPid', 4000)
real_monotonic = time.monotonic
time.monotonic = lambda: real_monotonic() + state.get('timeOffset', 0)
real_read = pathlib.Path.read_text
real_exists = pathlib.Path.exists
real_rglob = pathlib.Path.rglob
real_open = os.open
source = sys.stdin.read()
namespace = {}
exec(source.split('\n', 2)[0] + '\n' + source.split('\n', 2)[1], namespace)
request = namespace['R']
if request['action'] == 'cache-put' and request.get('offset', 0) > 0 and state.pop('laterChunkDrift', None):
    import base64
    request['data'] = base64.b64encode(b'x' + base64.b64decode(request['data'])[1:]).decode()
if request['action'] == 'cache-put' and state.pop('cacheChunkDrift', None):
    import base64
    request['data'] = base64.b64encode(b'x' + base64.b64decode(request['data'])[1:]).decode()
if request['action'] == 'prepare' and state.get('transferredInputDrift') and request.get('files'):
    import base64
    request['files'][0]['bytes'] = base64.b64encode(b'foreign input\n').decode()

def save_state():
    state_path.write_text(json.dumps(state))

def fire_due_timers():
    # A guest deadline timer kills its check once its time has come, unless
    # deadlineLost stands for a timer that never fires.
    if state.get('deadlineLost'): return
    for unit, timer in state['units'].items():
        if unit.endswith('.timer') and timer['ActiveState'] == 'active' and time.monotonic() >= timer['due']:
            c = state['containers'].get(timer['target'])
            if c and c['State']['Running']:
                c['State'].update(Running=False, Pid=0, ExitCode=137)
            timer['ActiveState'] = 'inactive'
            # RemainAfterExit keeps the fired kill service visibly active.
            state['units'][unit[:-6] + '.service']['ActiveState'] = 'active'

def run_install(name, c):
    mounts = {m['Destination']: pathlib.Path(m['Source']) for m in c['Mounts']}
    work, cache = mounts['/workspace'], mounts['/cache']
    if state.get('installHang'):
        if state.get('expireAfterStart'): state['timeOffset'] = state.get('timeOffset', 0) + state.pop('expireAfterStart')
        state['nextPid'] += 1
        c['State'].update(Running=True, Pid=state['nextPid'], ExitCode=0)
        c['FixtureGroup'] = 'libpod-' + name
        return
    if state.get('installWritesInput'): (work / 'index.html').write_text('rewritten by an install script\n')
    if not state.get('installNoModules'):
        modules = work / 'node_modules'
        (modules / '.bin').mkdir(parents=True, exist_ok=True)
        for tgz in sorted(cache.glob('*.tgz')):
            package = modules / ('p-' + tgz.name[:12])
            package.mkdir()
            (package / 'package.json').write_bytes(tgz.read_bytes())
        (modules / '.bin' / 'tool').symlink_to('../tool/cli.js')
        if state.get('installSpecialFile'): os.mkfifo(str(modules / 'fifo'))
    c['State'].update(Running=False, Pid=0, ExitCode=state.get('installExit', 0))

def run_check(name, c):
    if 'npm ci' in c['Config']['Cmd'][1]: return run_install(name, c)
    argv = c['Config']['Cmd'][3:]
    work = pathlib.Path(c['Mounts'][0]['Source'])
    # Like the engine, a missing bind source fails the start.
    if not work.is_dir(): raise LookupError('bind source missing')
    verb = argv[0]
    if verb == 'hang':
        # Optionally advance the guest clock past the check's deadline.
        if state.get('expireAfterStart'): state['timeOffset'] = state.get('timeOffset', 0) + state.pop('expireAfterStart')
        state['nextPid'] += 1
        c['State'].update(Running=True, Pid=state['nextPid'], ExitCode=0)
        c['FixtureGroup'] = 'libpod-' + name
        return
    code = 0
    if verb == 'false': code = 1
    elif verb == 'exit': code = int(argv[1])
    elif verb == 'write':
        target = work / argv[1]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(argv[2])
    elif verb == 'chmod': (work / argv[1]).chmod(0o700)
    elif verb == 'link': (work / argv[1]).symlink_to('/etc/hostname')
    elif verb == 'absent': code = 1 if (work / argv[1]).exists() else 0
    elif verb == 'present': code = 0 if (work / argv[1]).is_file() else 1
    elif verb == 'lock': (work / argv[1]).chmod(0)
    elif verb == 'deep':
        # deep LEVELS [NAME_LENGTH]: built by descriptor, so it can pass the
        # path-length limit with few levels when names are long.
        fd = os.open(str(work), os.O_RDONLY | os.O_DIRECTORY)
        name = 'd' * (int(argv[2]) if len(argv) > 2 else 1)
        for _ in range(int(argv[1])):
            os.mkdir(name, dir_fd=fd)
            next_fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY, dir_fd=fd); os.close(fd); fd = next_fd
        os.close(fd)
    elif verb != 'true': code = 127
    c['State'].update(Running=False, Pid=0, ExitCode=code)

def remove_owned_tree(path):
    """Remove a tree the user owns, however deep or locked, using only
    relative steps: no long path is ever built and one handle is kept."""
    home = os.open('.', os.O_RDONLY)
    try:
        os.chmod(path, 0o700); os.chdir(path)
        names = []
        while True:
            os.chmod('.', 0o700)
            child = None
            for entry in os.scandir('.'):
                if entry.is_dir(follow_symlinks=False):
                    child = entry.name; break
                os.unlink(entry.name)
            if child is not None:
                os.chmod(child, 0o700); os.chdir(child); names.append(child); continue
            if not names: break
            os.chdir('..'); os.rmdir(names.pop())
    finally:
        os.fchdir(home); os.close(home)
    os.rmdir(path)

def podman(args):
    fire_due_timers()
    sub = args[0]
    if sub == 'info':
        return json.dumps({'host': {'security': {'rootless': True}, 'cgroupVersion': 'v2'}, 'version': {'Version': '6.1.1'}})
    if sub == 'ps':
        running = [{'Names': [n]} for n, c in state['containers'].items() if c['State']['Running']]
        if state.get('foreignRunning'): running.append({'Names': ['aios-coding-foreign']})
        return json.dumps(running)
    if sub == 'image':
        image = state.get('image', {'Id': request['imageSha256'], 'Architecture': 'arm64'})
        if state.get('imageMissing') or args[2] != image['Id']: raise LookupError('no such image')
        # An engine answering for another image than the one asked for.
        if state.get('imageIdDrift'): image = dict(image, Id='8' * 64)
        return json.dumps([image])
    if sub == 'create':
        rest = args[1:]; config = {'Env': [], 'Labels': {}}; host = {'SecurityOpt': [], 'RestartPolicy': {}, 'CapAdd': []}
        mounts = []; i = 0; name = None
        while rest[i].startswith('--'):
            flag = rest[i]
            if flag in ['--name', '--env', '--label', '--volume']:
                value = rest[i + 1]; i += 2
                if flag == '--name': name = value
                elif flag == '--env': config['Env'].append(value)
                elif flag == '--label': key, val = value.split('=', 1); config['Labels'][key] = val
                else:
                    src, dst, opts = value.split(':')
                    mounts.append({'Type': 'bind', 'Source': src, 'Destination': dst, 'RW': 'rw' in opts.split(','), 'Propagation': 'rprivate'})
                continue
            i += 1
            key, _, val = flag.partition('=')
            if key == '--network': host['NetworkMode'] = val
            elif key == '--read-only': host['ReadonlyRootfs'] = True
            elif key == '--pid': host['PidMode'] = val
            elif key == '--ipc': host['IpcMode'] = val
            elif key == '--pids-limit': host['PidsLimit'] = int(val)
            elif key == '--memory': host['Memory'] = int(val[:-1]) * 1048576
            elif key == '--security-opt': host['SecurityOpt'].append(val)
            elif key == '--restart': host['RestartPolicy'] = {'Name': val}
            elif key == '--user': config['User'] = val
            elif key == '--workdir': config['WorkingDir'] = val
            elif key == '--entrypoint': config['Entrypoint'] = [val]
            elif key == '--hostname': config['Env'].append('HOSTNAME=' + val)
        image = rest[i]; config['Cmd'] = rest[i + 1:]
        host.update(state.get('inspectDrift', {}))
        state['containers'][name] = {'Image': image, 'Config': config, 'HostConfig': host, 'Mounts': mounts, 'State': {'Running': False, 'Pid': 0, 'ExitCode': 0}}
        return name
    if sub == 'inspect':
        c = state['containers'].get(args[1])
        if not c: raise LookupError('no such container')
        return json.dumps([c])
    if sub == 'start':
        run_check(args[1], state['containers'][args[1]]); return args[1]
    if sub == 'rm':
        name = args[-1]
        c = state['containers'].get(name)
        if not c or (c['State']['Running'] and '--force' not in args): raise LookupError('cannot remove')
        del state['containers'][name]; return name
    if sub == 'kill':
        c = state['containers'].get(args[-1])
        if not c or not c['State']['Running']: raise LookupError('not running')
        c['State'].update(Running=False, Pid=0, ExitCode=137); return args[-1]
    if sub == 'unshare':
        # Root over the user's own files: unreadable and deep trees still go.
        # The guest's GNU flags are checked, then the tree is removed portably,
        # because this simulator also runs on macOS, whose rm has no long
        # options and cannot remove trees past its 1024-byte path limit.
        if args[1:-1] != ['rm', '-rf', '--one-file-system', '--']: raise LookupError('unexpected unshare')
        remove_owned_tree(args[-1])
        return ''
    if sub == 'container' and args[1] == 'exists':
        return None if args[2] in state['containers'] else LookupError
    raise LookupError('unsupported podman ' + sub)

def respond(args):
    name = os.path.basename(args[0]); rest = args[1:]
    state['commands'].append([name, *rest])
    if name == 'findmnt': return json.dumps({'filesystems': [{'fstype': 'ext4', 'target': '/'}]})
    if name == 'uname': return 'aarch64'
    if name == 'systemd-detect-virt': return 'apple'
    if name == 'rpm-ostree':
        return json.dumps({'deployments': [{'booted': True, 'unlocked': 'none', 'container-image-reference': request['imageReference'], 'container-image-reference-digest': 'sha256:' + '1' * 64}]})
    if name == 'sudo':
        if rest[1] == 'podman': return '[]'
        return state.get('productUuid', '11111111-2222-3333-4444-555555555555')
    if name == 'podman': return podman(rest)
    if name == 'systemd-run':
        unit = next(a for a in rest if a.startswith('--unit='))[7:]
        seconds = float(next(a for a in rest if a.startswith('--on-active='))[12:-1])
        if state.get('timerRefused'): raise LookupError('refused')
        active = 'inactive' if state.get('timerInactive') else 'active'
        state['units'][unit + '.timer'] = {'LoadState': 'loaded', 'ActiveState': active, 'due': time.monotonic() + seconds, 'target': rest[-1]}
        state['units'][unit + '.service'] = {'LoadState': 'loaded', 'ActiveState': 'inactive'}
        return ''
    if name == 'systemctl':
        unit = rest[2]
        if rest[1] == 'show':
            u = state['units'].get(unit, {'LoadState': 'not-found', 'ActiveState': 'inactive'})
            return 'LoadState=%s\nActiveState=%s\nJob=' % (u['LoadState'], u['ActiveState'])
        if rest[1] == 'stop':
            state['units'][unit]['ActiveState'] = 'inactive'; return ''
    raise LookupError('unsupported ' + name)

class Completed:
    def __init__(self, out, code):
        self.stdout = types.SimpleNamespace(fileno=lambda: None)
        self.returncode = code

class FakePopen:
    """Answers the management program's bounded `command` helper."""
    def __init__(self, args, **kwargs):
        try:
            out = respond(args); self.code = 0
        except LookupError:
            out = ''; self.code = 125
        save_state()
        r1, w1 = os.pipe(); r2, w2 = os.pipe()
        os.write(w1, (out or '').encode()); os.close(w1); os.close(w2)
        self.stdout = os.fdopen(r1, 'rb'); self.stderr = os.fdopen(r2, 'rb'); self.pid = os.getpid()
    def wait(self, timeout=None): return self.code

def fake_run(args, **kwargs):
    try:
        out = respond(args)
        code = 1 if out is LookupError else 0
    except LookupError:
        code = 125
    save_state()
    return types.SimpleNamespace(returncode=code, stdout=b'', stderr=b'')

def guarded_open(path, flags, *args, **kwargs):
    # A full disk at stop's first fencing write, once.
    if state.get('diskFullOnce') and request['action'] == 'stop' and '.new-' in str(path):
        state.pop('diskFullOnce'); raise OSError(errno.ENOSPC, 'No space left on device')
    return real_open(path, flags, *args, **kwargs)
os.open = guarded_open

subprocess.Popen = FakePopen
subprocess.run = fake_run
os.killpg = lambda pid, sig: None

def running_by_pid(pid):
    return next((c for c in state['containers'].values() if c['State']['Running'] and c['State']['Pid'] == pid), None)

def read_text(path, *args, **kwargs):
    p = str(path)
    if p.endswith('/sys_vendor'): return 'Apple Inc.'
    if p.endswith('/product_name'): return 'Apple Virtualization Generic Platform'
    if p == '/etc/machine-id': return state.get('machineId', '0123456789abcdef0123456789abcdef') + '\n'
    if p == '/usr/share/containers/seccomp.json':
        return json.dumps({'defaultAction': 'SCMP_ACT_ERRNO', 'syscalls': [{'names': ['read', 'unshare', 'setns'], 'action': 'SCMP_ACT_ALLOW'}]})
    match = re.fullmatch(r'/proc/(\d+)/(status|cgroup|stat)', p)
    if match:
        c = running_by_pid(int(match[1]))
        if not c: raise FileNotFoundError(p)
        if match[2] == 'status': return 'NoNewPrivs:\t1\nSeccomp:\t2\nCapEff:\t00000000\n'
        if match[2] == 'cgroup': return '0::/user.slice/' + c['FixtureGroup'] + '\n'
        return match[1] + ' (check) ' + ' '.join(['0'] * 19 + ['777'])
    if p.startswith('/sys/fs/cgroup/') and p.endswith('/cgroup.procs'):
        c = next((c for c in state['containers'].values() if c['State']['Running'] and p.endswith('/' + c.get('FixtureGroup', '') + '/cgroup.procs')), None)
        return str(c['State']['Pid']) + '\n' if c else ''
    return real_read(path, *args, **kwargs)
pathlib.Path.read_text = read_text
pathlib.Path.exists = lambda path: True if str(path).startswith('/sys/fs/cgroup/') else real_exists(path)
pathlib.Path.rglob = lambda path, pattern: [path / 'cgroup.procs'] if str(path).startswith('/sys/fs/cgroup/') else real_rglob(path, pattern)

# Run the program after its request line, keeping any fixture change to R.
namespace['__name__'] = '__main__'
exec(source.split('\n', 2)[2], namespace)
save_state()
