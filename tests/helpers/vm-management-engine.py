"""External Linux/Podman simulator for the VM management program.
No VM, provider, image or owner credential is involved. The real generated
program runs against a fake engine held in engine.json. `faults` scripts it:
  {name prefix: {verb: 'exit' | 'timeout'}}
A 'timeout' on create leaves the container behind, as a killed client can.
"""
import sys, os, json, pathlib, subprocess, re, socket, hashlib, urllib.request, io

root = pathlib.Path(sys.argv[1])
os.environ['HOME'] = str(root)
state_path = root / 'engine.json'
state = json.loads(state_path.read_text())
state.setdefault('containers', {})
state.setdefault('commands', [])
state.setdefault('faults', {})
state.setdefault('nextPid', 4000)
real_popen = subprocess.Popen
real_read = pathlib.Path.read_text
real_exists = pathlib.Path.exists
real_rglob = pathlib.Path.rglob
source = sys.stdin.read()
namespace = {}
exec(source.split('\n', 2)[0] + '\n' + source.split('\n', 2)[1], namespace)
request = namespace['R']
if request['action'] == 'codex-protocol':
    state_root = root / '.local/state/aios-offline-v1'
    binary = state_root / 'codex-0.161.0'
    binary.write_bytes(b'synthetic codex')
    binary.chmod(0o500)
    request['target']['codexWorkerSha256'] = hashlib.sha256(b'synthetic codex').hexdigest()


def save_state():
    state_path.write_text(json.dumps(state))


def fault(name, verb):
    for prefix, faults in state['faults'].items():
        if name.startswith(prefix) and verb in faults:
            return faults[verb]
    return None


def bytes_of(value):
    return value if isinstance(value, bytes) else json.dumps(value).encode()


def podman(args):
    verb = args[0]
    if verb == 'version': return 0, b'{}'
    if verb == 'info':
        return 0, bytes_of({'host': {'security': {'rootless': True}, 'cgroupVersion': 'v2'}, 'version': {'Version': '6.1.1'}})
    if verb == 'ps': return 0, bytes_of([])
    if verb == 'image':
        return 0, bytes_of([{'RepoDigests': [request['template']], 'Architecture': request['guestArch'], 'Config': {'Env': ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin']}}])
    if verb == 'unshare': return 0, b''
    if verb == 'container':
        return (0 if args[2] in state['containers'] else 1), b''
    if verb == 'create':
        name = args[args.index('--name') + 1]
        labels = dict(args[i + 1].split('=', 1) for i, a in enumerate(args) if a == '--label')
        action = fault(name, 'create')
        if action == 'exit': return 125, b''
        state['containers'][name] = {
            'Name': name,
            'Mounts': [],
            'Config': {'Env': ['PATH=/usr/bin:/bin', 'HOME=/', 'HOSTNAME=aios-offline'], 'User': '65534:65534', 'Labels': labels},
            'HostConfig': {'PidMode': 'private', 'NetworkMode': 'none', 'ReadonlyRootfs': True, 'SecurityOpt': ['no-new-privileges']},
            'State': {'Running': False, 'Pid': 0, 'Status': 'created'},
        }
        if action == 'timeout': raise subprocess.TimeoutExpired(['podman', *args], 30)
        return 0, b''
    if verb == 'cp':
        name = args[2].split(':')[0]
        if name not in state['containers']: return 125, b''
        return (125 if fault(name, 'cp') == 'exit' else 0), b''
    if verb == 'exec':
        positional = [a for a in args[1:] if not a.startswith('--') and a != '-i']
        name = next((a for a in positional if a in state['containers']), None)
        if name is None: return 125, b''
        if fault(name, 'exec') == 'exit': return 125, b''
        text = ' '.join(args)
        if 'mountinfo' in text: return 0, b'1 0 0:1 / / ro - overlay overlay ro\n'
        if '--version' in args: return 0, b'codex-cli 0.161.0\n'
        if 'passed-host-files' in text:
            lines = ['passed-host-files'] * 3 + ['passed-controller-ledger', 'passed-cross-delivery', 'passed-network-bypass', 'passed-skills-mcp-hooks', 'passed-host-docker', 'passed-escape-unshare', 'passed-escape-chroot', 'passed-escape-cgroup', 'passed-escape-proc', 'passed-owner-credentials']
            return 0, ('\n'.join(lines) + '\n').encode()
        if args[-1] == 'cat': return 0, FRAME['bytes']
        if 'nc' in args: return 1, b''
        return 0, b''
    name = args[-1] if verb in ['inspect', 'logs', 'rm'] else args[1] if verb == 'start' else args[-1]
    container = state['containers'].get(name)
    if container is None: return 125, b''
    action = fault(name, verb)
    if action == 'exit': return 125, b''
    if action == 'timeout': raise subprocess.TimeoutExpired(['podman', *args], 30)
    current = container['State']
    if verb == 'inspect': return 0, bytes_of([container])
    if verb == 'logs': return 0, b'AIOS offline canary complete\n'
    if verb == 'start':
        state['nextPid'] += 1
        current.update(Running=True, Pid=state['nextPid'], Status='running')
        return 0, b''
    if verb == 'stop':
        current.update(Running=False, Pid=0, Status='exited')
        return 0, b''
    if verb == 'rm':
        if current['Running']: return 2, b''
        del state['containers'][name]
        return 0, b''
    return 125, b''


FRAME = {'bytes': b''}


def respond(args, kwargs):
    if args[0] == 'podman':
        return podman(args[1:])
    if args[:3] == ['sudo', '-n', 'podman']: return 0, bytes_of([])
    if args[:2] == ['sudo', '-n']: return 0, b'synthetic-product-uuid\n'
    if args[0] == 'findmnt': return 0, bytes_of({'filesystems': []})
    if args[0] == 'uname': return 0, b'aarch64\n'
    if args[0] == 'systemd-detect-virt': return 0, b'apple\n'
    if args[0] == 'rpm-ostree':
        return 0, bytes_of({'deployments': [{'booted': True, 'unlocked': 'none', 'container-image-reference-digest': 'sha256:' + '1' * 64, 'container-image-reference': request['imageReference']}]})
    return 127, b''


def fake_run(args, **kwargs):
    state['commands'].append([str(a) for a in args])
    if kwargs.get('input') is not None and args[:2] == ['podman', 'exec']:
        FRAME['bytes'] = kwargs['input']
    code, stdout = respond([str(a) for a in args], kwargs)
    save_state()
    return subprocess.CompletedProcess(args, code, stdout if kwargs.get('stdout') == subprocess.PIPE else None, b'')


# A relay answers ready and then lives until its stdin closes, as the real one.
RELAY = "import sys,json;c=json.loads(sys.stdin.readline());print(json.dumps(dict(ready=True,deliveryId=c['deliveryId'])),flush=True);sys.stdin.read()"


def fake_popen(args, **kwargs):
    state['commands'].append([str(a) for a in args])
    save_state()
    if args[:3] == ['podman', 'unshare', 'nsenter']:
        return real_popen([sys.executable, '-c', RELAY], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True)
    return real_popen([sys.executable, '-c', 'import sys;sys.stdin.read()'], **kwargs)


def running_by_pid(pid):
    return next((c for c in state['containers'].values() if c['State']['Running'] and c['State']['Pid'] == pid), None)


def read_text(path, *args, **kwargs):
    p = str(path)
    if p == '/etc/machine-id': return '0123456789abcdef0123456789abcdef\n'
    if p.endswith('/sys_vendor'): return 'Apple Inc.'
    if p.endswith('/product_name'): return 'Apple Virtualization Generic Platform'
    if p == '/usr/share/containers/seccomp.json':
        return json.dumps({'defaultAction': 'SCMP_ACT_ERRNO', 'syscalls': [{'names': ['read', 'unshare', 'setns'], 'action': 'SCMP_ACT_ALLOW'}]})
    match = re.fullmatch(r'/proc/(\d+)/(status|cgroup|stat)', p)
    if match:
        c = running_by_pid(int(match[1]))
        if not c: raise FileNotFoundError(p)
        if match[2] == 'status': return 'NoNewPrivs:\t1\nSeccomp:\t2\nCapEff:\t0\n'
        if match[2] == 'cgroup': return '0::/user.slice/libpod-' + c['Name'] + '\n'
        return match[1] + ' (worker) ' + ' '.join(['0'] * 19 + ['777'])
    if p.startswith('/sys/fs/cgroup/') and p.endswith('/cgroup.procs'):
        c = next((c for c in state['containers'].values() if c['State']['Running'] and p.endswith('/libpod-' + c['Name'] + '/cgroup.procs')), None)
        return str(c['State']['Pid']) + '\n' if c else ''
    return real_read(path, *args, **kwargs)


class Socket(socket.socket):
    # Only the guest's own engine socket is simulated.
    def connect(self, address):
        if str(address).endswith('/podman/podman.sock'): return None
        return super().connect(address)
    def sendall(self, data, *args): return None
    def recv(self, size, *args): return b'HTTP/1.0 200 OK\r\n'


def urlopen(req, timeout=None):
    return io.BytesIO(json.dumps({'canary': request['challenge']['id'], 'result': {'tools': []}}).encode())


subprocess.run = fake_run
subprocess.Popen = fake_popen
pathlib.Path.read_text = read_text
pathlib.Path.exists = lambda path: True if str(path).startswith('/sys/fs/cgroup/') else real_exists(path)
pathlib.Path.rglob = lambda path, pattern: [path / 'cgroup.procs'] if str(path).startswith('/sys/fs/cgroup/') else real_rglob(path, pattern)
socket.socket = Socket
socket.gethostbyname = lambda host: '10.88.0.1'
urllib.request.urlopen = urlopen

namespace['__name__'] = '__main__'
try:
    exec(source.split('\n', 2)[2], namespace)
finally:
    save_state()
