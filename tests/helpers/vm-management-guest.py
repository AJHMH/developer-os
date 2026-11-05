"""Linux/Podman simulator for the offline management guest's VM observation.
Runs the transported program with only its observed commands and VM files
answered from `vm.json` beside the home. No VM or real engine is involved.
"""
import json, os, pathlib, subprocess, sys, types

vm = json.loads(pathlib.Path(os.environ['FAKE_VM']).read_text())
real_read_text = pathlib.Path.read_text

def read_text(path, *args, **kwargs):
    name = str(path)
    if name.endswith('/sys_vendor'): return 'Apple Inc.\n'
    if name.endswith('/product_name'): return 'Apple Virtualization Generic Platform\n'
    if name == '/etc/machine-id': return vm['machineId'] + '\n'
    return real_read_text(path, *args, **kwargs)
pathlib.Path.read_text = read_text

source = sys.stdin.read()
namespace = {}
exec(source.split('\n', 2)[0] + '\n' + source.split('\n', 2)[1], namespace)
R = namespace['R']

def answer(args):
    if args[0] == 'findmnt': return {'filesystems': [{'fstype': 'ext4', 'target': '/'}]}
    if args[0] == 'uname': return 'aarch64'
    if args[0] == 'systemd-detect-virt': return 'apple'
    if args[0] == 'rpm-ostree':
        return {'deployments': [{
            'booted': True,
            'unlocked': 'none',
            'container-image-reference': R['imageReference'],
            'container-image-reference-digest': 'sha256:' + 'a' * 64,
        }]}
    if args[:3] == ['sudo', '-n', 'cat']: return vm['productUuid']
    if args[:3] == ['sudo', '-n', 'podman']: return []
    if args[:2] == ['podman', 'info']:
        return {'host': {'security': {'rootless': True}, 'cgroupVersion': 'v2'}, 'version': {'Version': '6.1.3'}}
    if args[:2] == ['podman', 'ps']: return []
    if args[:3] == ['podman', 'image', 'inspect']:
        return [{
            'RepoDigests': [R['template']],
            'Architecture': R['guestArch'],
            'Config': {'Env': ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin']},
        }]
    raise RuntimeError('unexpected command ' + json.dumps(args))

def run(args, **kwargs):
    value = answer(args)
    output = value if isinstance(value, str) else json.dumps(value)
    return types.SimpleNamespace(returncode=0, stdout=output.encode(), stderr=b'')
subprocess.run = run

exec(source, {'__name__': '__main__'})
