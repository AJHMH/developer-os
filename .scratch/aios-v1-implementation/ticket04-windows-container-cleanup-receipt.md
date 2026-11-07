# Issue 04: Windows coding re-pin, container census and cleanup

6 November 2026, about 20:00 to 20:15 CST. Windows x64, Hyper-V VM
`aios-podman-noshare`, checkout `D:/repos/developer-os`. The owner ran every
command and pasted its output. No inference, no credentials, no usage spent,
and no acceptance ran. Production remains disabled.

## Why

The owner's handoff from the Mac asked to confirm that the Windows coding
admission record names the current coding guest program, then find out what
was in the VM and clear any buildup the evidence supported. It used the
[coding container census](../../docs/worker-qualification.md#coding-container-census)
and the [abandoned-session sweep](../../docs/worker-qualification.md#abandoned-coding-sessions).

## Update and build

`git pull --ff-only` moved local `main` from `84b80d7` to `03f2903`, and
`npm ci --ignore-scripts` and `npm run build` passed. That range changes
`src/podman-coding.ts`, so the coding guest's policy pin moved. `podman
machine list` showed `aios-podman-noshare` running, and the unused machines
`podman-machine-default` (WSL) and `aios-podman-prototype` (never started).

## Re-pin

| Record     | Before                                                             | After                                                              |
| ---------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Coding     | `5345ab2b34f662e221f58c033afaafb569155989c8c9d830ec2936d89fc4a038` | `89f2db6033e05941ec94dbb11e0215a1161d469429b85af47ba8fff5442c6a1c` |
| Validation | `585cd02cc6a9eff07e8e4f1f16d96719b3f24f40f0f7f57b349a7c0d1927448f` | unchanged                                                          |

The "after" values are the digests in `docs/owner-hosts.md`. The owner
copied the coding record to a backup, then rewrote only
`pins.policySha256` and `approvedAt`, the latter with `toISOString()`, so in
the canonical form. The record kept exactly `scope`, `pins` and `approvedAt`,
the only keys `ownerAdmission` in `src/coding-admission.ts` accepts. The
sweep's count then ran under the record without refusal, which confirms that
the guest accepts it. The backup was deleted afterwards.

## Census and sweep

The census, after the re-pin:

| Containers | State   | Kind                 | Phase   | Policy     | Binding    |
| ---------- | ------- | -------------------- | ------- | ---------- | ---------- |
| 5          | exited  | head with thread     | stopped | `7b587bd9` | `f6dbbfd8` |
| 3          | exited  | reserved predecessor | stopped | `7b587bd9` | `f6dbbfd8` |
| 2          | exited  | head with thread     | stopped | `5345ab2b` | `f6dbbfd8` |
| 1          | created | recovered            | stopped | `7b587bd9` | `f6dbbfd8` |
| 1          | exited  | start without thread | stopped | `5345ab2b` | `f6dbbfd8` |

Every session was `stopped`, and none was a `resume without thread`, so none
had a pending recovery or reconciliation route.

The sweep, through the shared runner and the ticket 19 state directory:

| Run                 | Output                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Count               | `{"apply":false,"removed":0,"abandoned":4,"refused":0,"kept":{"cleaned":4,"unprepared":6,"unstopped":0,"lineage":37}}` |
| `--approve-removal` | `{"apply":true,"removed":4,"abandoned":0,"refused":0,"kept":{"cleaned":4,"unprepared":6,"unstopped":0,"lineage":37}}`  |

Of the 4 abandoned sessions, 2 had containers, the `recovered` one and the
`start without thread` one, and 2 had only folders. The sweep removed their
folders and containers and kept their records as tombstones. The census then
showed the 10 containers of the first three rows.

## One-off removal of containers with older pins

None of the 10 remaining containers carried the current coding pin, and a
resume must carry its predecessor's pins, so none could resume under the
current guest. The owner removed them with a one-off script that isn't in the
repository. It first ran on the Mac VM `aios-macos-noshare`, and reached
Windows through an email draft that had lost its indentation. The script was
rebuilt and tested against a fake `podman`, covering every keep and remove
case, a running container, a bad argument, and the script piped on stdin with
CRLF line endings. Its text is below.

| Step                                                                                          | Output                                                                                                       |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| SHA-256 of the copy run                                                                       | `562241528eeed60adc6d0dcc28d69f225e849cb5a684ab02dcb35248300668c0`                                           |
| First attempt                                                                                 | The file wasn't on the PC yet, so `Get-Content` failed and nothing reached the VM. Kept as a failed attempt. |
| Preview, `Get-Content -Raw … \| podman machine ssh aios-podman-noshare /usr/bin/python3 -I -` | `{"apply": false, "would remove": 10}`                                                                       |
| `… - --apply`                                                                                 | `{"apply": true, "removed": 10}`                                                                             |

That was the first Windows run of a script through that pipe. The census
runs the same way, and both worked.

What the removal kept: every folder and record, and lineage cleanup, whose
guest code treats a missing container as already gone. What it ended:
collecting from or observing those sessions, and resuming them after a
rollback to the `7b587bd9` or `5345ab2b` guest. The 2 heads at `5345ab2b`
were the ones a rollback to the previous guest would have needed; the owner
chose to remove them too, as on the Mac. It freed no disk used by folders.
The script was deleted afterwards.

## End state

- The census showed `containers 0`.
- The sweep's count showed
  `{"apply":false,"removed":0,"abandoned":0,"refused":0,"kept":{"cleaned":8,"unprepared":6,"unstopped":0,"lineage":37}}`.

The owner's handoff reported the same treatment of the Mac VM earlier the
same day: re-pinned to `89f2db60`, a stale lock directory removed, 3
abandoned sessions swept, and 50 exited containers with older pins removed by
the same script, ending at `abandoned 0, refused 0, cleaned 9, unprepared 32,
lineage 43`. This receipt didn't observe that run, and it has no receipt of
its own.

## Not covered

- The coding acceptances under the new coding pin on Windows. The last
  passing Windows acceptances on record ran from `84b80d7` on 1 November
  ([`docs/feature-candidate.md`](../../docs/feature-candidate.md)).
- The disk used by the remaining session folders, those of the 37 lineage
  sessions and any the 6 unprepared ones have, and whether older sessions
  still hold their private `codex` copies.
- The validation guest. Its record was already current, and nothing in the
  VM was checked for it.

Production remains disabled.

## The script

```python
# One-off, owner-run: removes stopped aios-coding-* containers whose guest record
# carries pins other than the current guest's, so no resume can ever accept them.
# Without --apply it only counts. It keeps every folder and record, never forces a
# removal, and leaves any session that still has a recovery or reconcile route.
import collections, fcntl, json, os, subprocess, sys

CURRENT = '89f2db6033e05941ec94dbb11e0215a1161d469429b85af47ba8fff5442c6a1c'
PODMAN = '/usr/bin/podman'
apply = sys.argv[1:] == ['--apply']
if sys.argv[1:] not in ([], ['--apply']): sys.exit('usage: [--apply]')
root = os.path.expanduser('~/.local/state/aios-coding-v1')


def query(*args):
    return json.loads(subprocess.run([PODMAN, *args], stdout=subprocess.PIPE, check=True, timeout=120).stdout)


def reason(name, state, record, labels, authority):
    # Why this container stays, or None when it may go.
    if state != 'exited': return 'not exited'
    if record is None: return 'no record'
    if record.get('phase') != 'stopped': return 'not stopped'
    if record.get('cleaned'): return 'already cleaned'
    if (record.get('pins') or {}).get('policySha256') == CURRENT: return 'current pins'
    if labels != {'aios.coding.authority': authority, 'aios.coding.session': record.get('identity')}: return 'labels differ'
    admission = record.get('admission')
    if isinstance(admission, dict) and 'resumeFrom' in admission and 'threadId' not in record: return 'resume without thread'
    return None


lockfd = os.open(os.path.expanduser('~/.local/state/aios-offline-v1/lock'), os.O_RDWR)
with os.fdopen(lockfd, 'w') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    if query('ps', '--format', 'json'): sys.exit('refused: a container is running')
    with open(root + '/authority.json') as f: authority = json.load(f)
    outcome = collections.Counter()
    for container in query('ps', '-a', '--filter', 'name=aios-coding-', '--format', 'json'):
        name = container['Names'][0]
        try:
            with open(root + '/' + name + '.json') as f: record = json.load(f)
        except FileNotFoundError:
            record = None
        inspected = query('container', 'inspect', name)[0]
        kept = reason(name, inspected['State']['Status'], record, inspected['Config'].get('Labels') or {}, authority)
        if kept: outcome['kept: ' + kept] += 1
        elif not apply: outcome['would remove'] += 1
        elif subprocess.run([PODMAN, 'rm', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60).returncode == 0: outcome['removed'] += 1
        else: outcome['refused by engine'] += 1
print(json.dumps(dict(apply=apply, **outcome), sort_keys=True))
```
