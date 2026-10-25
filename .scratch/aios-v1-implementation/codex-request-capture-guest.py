# Slice 3 offline capture: the request shape Codex 0.161.0 really sends.
# Runs in the Podman VM guest (`podman machine ssh <machine> python3 < this`).
# A capture-only fake provider listens on the coding container's own loopback,
# entered through its network namespace; the container stays --network=none.
# No inference and no credentials: the provider is canned and the route
# capability is a random local value. Prints one JSON report on stdout.
import base64, gzip, hashlib, json, os, pathlib, secrets, shutil, subprocess, sys, time, uuid

PORT = 18090
MODEL = 'gpt-6.1-sol'
PIN = '0129f94f4f1197bd75f6c4265889061f386ed302bbc50c6e57e3e0660dfb28a7'
TEMPLATE = 'docker.io/library/alpine@sha256:24bb3511a0db7b5114a4aee033c65a8a4148f39b7b80a398e548546db967a36f'
ROUTE_ENV = 'AIOS_MODEL_ROUTE'

RECORDER = r'''
import base64, json, socket, sys
port, out, grant = int(sys.argv[1]), sys.argv[2], sys.argv[3]
VALUES = {'content-type', 'content-encoding', 'accept', 'user-agent', 'openai-beta', 'originator', 'version', 'transfer-encoding', 'connection', 'x-aios-delivery'}
def sse(events):
    return b''.join(b'event: ' + e['type'].encode() + b'\ndata: ' + json.dumps(e).encode() + b'\n\n' for e in events)
def completed(rid):
    return {'type': 'response.completed', 'response': {'id': rid, 'usage': {'input_tokens': 1, 'input_tokens_details': None, 'output_tokens': 1, 'output_tokens_details': None, 'total_tokens': 2}}}
def answer(body, n):
    rid = 'resp_capture_%d' % n
    head = [{'type': 'response.created', 'response': {'id': rid}}]
    items = body.get('input') if isinstance(body.get('input'), list) else []
    last = items[-1].get('type') if items and isinstance(items[-1], dict) else None
    if n >= 2 or (n == 0 and (last or '').endswith('_output')):
        msg = {'type': 'message', 'id': 'msg_%d' % n, 'role': 'assistant', 'content': [{'type': 'output_text', 'text': 'Done.'}]}
        return head + [{'type': 'response.output_item.done', 'item': msg}, completed(rid)], 'message'
    tools = [t for t in body.get('tools') or [] if isinstance(t, dict)]
    # Codex 0.161.0 sends its tools in an `additional_tools` input item, grouped by namespace.
    for item in items:
        if isinstance(item, dict) and item.get('type') == 'additional_tools':
            for t in item.get('tools') or []:
                tools += t.get('tools') or [] if t.get('type') == 'namespace' else [t]
    names = {t.get('name') for t in tools if t.get('type') == 'function'}
    reasoning = {'type': 'reasoning', 'id': 'rs_%d' % n, 'summary': [], 'encrypted_content': base64.b64encode(b'capture-only').decode()}
    call = None
    # First request of a run edits through apply_patch when offered; the next runs a command.
    if n == 0 and any(t.get('type') == 'custom' and t.get('name') == 'apply_patch' for t in tools):
        patch = '*** Begin Patch\n*** Add File: hello-%d.txt\n+hi\n*** End Patch\n' % len(items)
        call = {'type': 'custom_tool_call', 'id': 'ctc_%d' % n, 'call_id': 'call_%d' % n, 'name': 'apply_patch', 'input': patch}
    for name, args in ([] if call else [('exec_command', {'cmd': 'ls /workspace'}), ('shell_command', {'command': 'ls /workspace'}), ('shell', {'command': ['ls', '/workspace']})]):
        if name in names:
            call = {'type': 'function_call', 'id': 'fc_%d' % n, 'call_id': 'call_%d' % n, 'name': name, 'arguments': json.dumps(args)}
            break
    if call is None and any(t.get('type') == 'local_shell' for t in tools):
        call = {'type': 'local_shell_call', 'id': 'lsh_%d' % n, 'call_id': 'call_%d' % n, 'status': 'completed', 'action': {'type': 'exec', 'command': ['true']}}
    if call is None and n == 0 and any(t.get('type') == 'custom' and t.get('name') == 'exec' for t in tools):
        # Code mode: one script edits through the nested apply_patch, then runs a command.
        script = ('text(await tools.apply_patch(%s));\ntext(await tools.exec_command({cmd: "ls /workspace"}));\n'
                  % json.dumps('*** Begin Patch\n*** Add File: hello-%d.txt\n+hi\n*** End Patch\n' % len(items)))
        call = {'type': 'custom_tool_call', 'id': 'ctc_%d' % n, 'call_id': 'call_%d' % n, 'name': 'exec', 'input': script}
    if call is None:
        msg = {'type': 'message', 'id': 'msg_%d' % n, 'role': 'assistant', 'content': [{'type': 'output_text', 'text': 'Done.'}]}
        return head + [{'type': 'response.output_item.done', 'item': msg}, completed(rid)], 'message-no-shell-tool'
    return head + [{'type': 'response.output_item.done', 'item': reasoning}, {'type': 'response.output_item.done', 'item': call}, completed(rid)], call.get('name') or call['type']
def read(conn):
    data = b''
    while b'\r\n\r\n' not in data:
        chunk = conn.recv(65536)
        if not chunk: return None
        data += chunk
    head, rest = data.split(b'\r\n\r\n', 1)
    lines = head.decode('latin-1').split('\r\n')
    method, target, version = (lines[0].split(' ') + ['', '', ''])[:3]
    headers = [(k.strip().lower(), v.strip()) for k, v in (l.split(':', 1) for l in lines[1:] if ':' in l)]
    h = dict(headers)
    if 'chunked' in h.get('transfer-encoding', '').lower():
        body = b''
        while True:
            while b'\r\n' not in rest: rest += conn.recv(65536)
            size, rest = rest.split(b'\r\n', 1)
            size = int(size.split(b';')[0], 16)
            while len(rest) < size + 2: rest += conn.recv(65536)
            body += rest[:size]; rest = rest[size + 2:]
            if size == 0: break
    else:
        length = int(h.get('content-length', '0') or 0)
        while len(rest) < length: rest += conn.recv(65536)
        body = rest[:length]
    return method, target, version, headers, body
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('127.0.0.1', port)); s.listen(8); s.settimeout(1)
print('ready', flush=True)
n = 0
with open(out, 'a') as log:
    while True:
        try: conn, _ = s.accept()
        except socket.timeout: continue
        conn.settimeout(30)
        try:
            got = read(conn)
            if got is None: conn.close(); continue
            method, target, version, headers, raw = got
            h = dict(headers)
            enc = h.get('content-encoding', '').lower()
            body = raw
            if enc == 'gzip':
                import gzip; body = gzip.decompress(raw)
            elif enc == 'zstd':
                from compression import zstd; body = zstd.decompress(raw)
            auth = h.get('authorization', '')
            rec = {'n': n, 'method': method, 'target': target, 'version': version,
                   'headers': [[k, v if k in VALUES else '<redacted>'] for k, v in headers],
                   'authorizationIsBearerGrant': auth == 'Bearer ' + grant,
                   'grantElsewhereInHeaders': any(grant in v for k, v in headers if k != 'authorization'),
                   'grantInBody': grant.encode() in body,
                   'wireBytes': len(raw), 'bodyBytes': len(body), 'bodyB64': base64.b64encode(body).decode()}
            if method == 'POST' and target.split('?')[0] == '/v1/responses':
                try: parsed = json.loads(body)
                except Exception: parsed = {}
                events, rec['answeredWith'] = answer(parsed, n)
                payload = sse(events)
                conn.sendall(b'HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: ' + str(len(payload)).encode() + b'\r\nconnection: close\r\n\r\n' + payload)
            else:
                rec['answeredWith'] = '404'
                conn.sendall(b'HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\nconnection: close\r\n\r\n')
            log.write(json.dumps(rec) + '\n'); log.flush()
            n += 1
        except Exception as e:
            log.write(json.dumps({'n': n, 'error': type(e).__name__ + ': ' + str(e)[:200]}) + '\n'); log.flush()
        finally:
            conn.close()
'''

def run(*args, timeout=30, check=True, **kw):
    r = subprocess.run(list(args), stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, **kw)
    if check and r.returncode:
        raise SystemExit('command failed: %s: %s' % (args[:3], r.stderr.decode()[-500:]))
    return r

def overrides(port):
    p = 'model_providers.capture.'
    return ['-c', 'model_provider="capture"', '-c', p + 'name="Capture only"',
            '-c', p + 'base_url="http://127.0.0.1:%d/v1"' % port, '-c', p + 'env_key="%s"' % ROUTE_ENV,
            '-c', p + 'wire_api="responses"', '-c', p + 'requires_openai_auth=false',
            '-c', p + 'supports_websockets=false', '-c', 'model="%s"' % MODEL, *VARIANT]

# A variant prepends `VARIANT = [...]` extra Codex options to this program, and
# optionally `CATALOG_PATCH = {...}`: fields replaced in the pinned model's entry
# of Codex's own bundled catalog, passed back through `model_catalog_json`.
VARIANT = globals().get('VARIANT', [])
CATALOG_PATCH = globals().get('CATALOG_PATCH')
# The locked argv's sandbox unless a variant prepends `SANDBOX = '...'`.
SANDBOX = globals().get('SANDBOX', 'workspace-write')
# Optional `HELPERS = {container path: [VM file, sha256]}`: further pinned package
# files, hash-checked, copied and bind-mounted read-only beside /codex.
HELPERS = globals().get('HELPERS', {})
if CATALOG_PATCH is not None:
    VARIANT = VARIANT + ['-c', 'model_catalog_json="/session/catalog.json"']

def prompt(text):
    return json.dumps({'request': text, 'criteria': ['hello.txt exists'], 'verification': [], 'clarifications': []})

report = {'started': time.time(), 'variant': VARIANT, 'catalogPatch': CATALOG_PATCH, 'sandbox': SANDBOX, 'helpers': sorted(HELPERS), 'runs': []}
base = pathlib.Path(os.path.expanduser('~/.local/state/aios-request-capture-' + uuid.uuid4().hex))
names = []
try:
    source = pathlib.Path(os.path.expanduser('~/.local/state/aios-offline-v1/codex-0.161.0')).read_bytes()
    if hashlib.sha256(source).hexdigest() != PIN: raise SystemExit('codex pin mismatch')
    base.mkdir(mode=0o700, parents=True)
    work, home = base / 'workspace', base / 'session'
    work.mkdir(mode=0o700); home.mkdir(mode=0o700)
    (work / 'README.md').write_text('capture fixture\n')
    binary = base / 'codex'
    binary.write_bytes(source); binary.chmod(0o500)
    profile = json.loads(pathlib.Path('/usr/share/containers/seccomp.json').read_text())
    for rule in profile['syscalls']: rule['names'] = [x for x in rule['names'] if x not in ['unshare', 'setns']]
    profile['syscalls'] = [r for r in profile['syscalls'] if r['names']]
    (base / 'seccomp.json').write_text(json.dumps(profile))
    mounts = []
    for i, (target, (path, digest)) in enumerate(sorted(HELPERS.items())):
        data = pathlib.Path(os.path.expanduser(path)).read_bytes()
        if hashlib.sha256(data).hexdigest() != digest: raise SystemExit('helper pin mismatch: ' + target)
        copy = base / ('helper-%d' % i)
        copy.write_bytes(data); copy.chmod(0o500)
        mounts += ['--volume', str(copy) + ':' + target + ':ro,Z,rprivate']
    if CATALOG_PATCH is not None:
        dumped = run('podman', 'run', '--rm', '--pull=never', '--network=none', '--read-only', '--cap-drop=ALL', '--userns=keep-id:uid=65534,gid=65534',
                     '--user=65534:65534', '--unsetenv-all', '--env', 'PATH=/usr/bin:/bin', '--env', 'HOME=/session', '--env', 'CODEX_HOME=/session',
                     '--volume', str(home) + ':/session:rw,Z,rprivate', '--volume', str(binary) + ':/codex:ro,Z,rprivate', TEMPLATE, '/codex', 'debug', 'models', timeout=60)
        catalog = json.loads(dumped.stdout)
        entries = [m for m in catalog['models'] if m.get('slug') == MODEL]
        if len(entries) != 1: raise SystemExit('pinned model not in catalog')
        entries[0].update(CATALOG_PATCH)
        (home / 'catalog.json').write_text(json.dumps(catalog))
        report['catalogModels'] = len(catalog['models'])
    grant = secrets.token_hex(32)
    bootstrap = 'while test ! -f /tmp/launch; do sleep 0.1; done; cd /workspace; exec /codex "$@"'
    threadId = None
    for phase in ['launch', 'resume']:
        if phase == 'launch':
            argv = ['exec', '--json', '--skip-git-repo-check', '--sandbox', SANDBOX, *overrides(PORT), prompt('Create hello.txt containing hi.')]
        else:
            if not threadId: break
            argv = ['exec', 'resume', '--json', '--skip-git-repo-check', '-c', 'sandbox_mode="%s"' % SANDBOX, *overrides(PORT), threadId, prompt('Append a second line to hello.txt.')]
        name = 'aios-request-capture-' + uuid.uuid4().hex[:12]; names.append(name)
        run('podman', 'create', '--name', name, '--hostname=aios-coding', '--pull=never', '--network=none', '--read-only', '--cap-drop=ALL',
            '--security-opt=no-new-privileges', '--security-opt=seccomp=' + str(base / 'seccomp.json'), '--userns=keep-id:uid=65534,gid=65534',
            '--user=65534:65534', '--pid=private', '--ipc=private', '--pids-limit=64', '--memory=512m', '--http-proxy=false', '--unsetenv-all',
            '--env', 'PATH=/usr/bin:/bin', '--env', 'HOME=/session', '--env', 'CODEX_HOME=/session', '--env', ROUTE_ENV + '=' + grant,
            '--log-driver=k8s-file', '--restart=no', '--volume', str(work) + ':/workspace:rw,Z,rprivate', '--volume', str(home) + ':/session:rw,Z,rprivate',
            '--volume', str(binary) + ':/codex:ro,Z,rprivate', *mounts, TEMPLATE, '/bin/sh', '-c', bootstrap, '--', *argv)
        run('podman', 'start', name)
        pid = json.loads(run('podman', 'inspect', name).stdout)[0]['State']['Pid']
        out = base / (phase + '-requests.jsonl')
        rec = subprocess.Popen(['podman', 'unshare', 'nsenter', '--net=/proc/%d/ns/net' % pid, 'python3', '-u', '-c', RECORDER, str(PORT), str(out), grant],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
        if rec.stdout.readline().strip() != b'ready': raise SystemExit('recorder not ready: ' + rec.stderr.read(2000).decode())
        # Release Codex only once the recorder is listening.
        run('podman', 'exec', name, 'touch', '/tmp/launch')
        began = time.time()
        waited = run('podman', 'wait', name, timeout=170, check=False)
        exitCode = waited.stdout.decode().strip()
        rec.terminate()
        try: rec.wait(5)
        except subprocess.TimeoutExpired: rec.kill()
        logs = run('podman', 'logs', name, check=False).stdout.decode(errors='replace').splitlines()
        events = []
        for line in logs:
            try:
                e = json.loads(line)
                events.append(e)
                if e.get('type') == 'thread.started': threadId = threadId or e.get('thread_id')
            except Exception:
                events.append({'nonJson': line[:500]})
        requests = [json.loads(l) for l in out.read_text().splitlines()] if out.exists() else []
        report['runs'].append({'phase': phase, 'exit': exitCode, 'seconds': round(time.time() - began, 1),
                               'requests': requests, 'events': events[-200:], 'grantInLogs': any(grant in l for l in logs),
                               'workspace': sorted(p.name for p in work.iterdir())})
    report['threadId'] = threadId
finally:
    for name in names: run('podman', 'rm', '-f', '-t', '0', name, check=False)
    if base.exists(): run('podman', 'unshare', 'rm', '-rf', str(base), check=False)
    report['cleanedUp'] = not base.exists() and all(run('podman', 'container', 'exists', n, check=False).returncode == 1 for n in names)
print(json.dumps(report))
