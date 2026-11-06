# Read-only, owner-run inside the VM: counts the aios-coding-* containers by what
# their guest records say. It prints counts and digest prefixes, and changes nothing.
# See docs/worker-qualification.md.
import collections, json, os, subprocess

root = os.path.expanduser('~/.local/state/aios-coding-v1')
listing = json.loads(subprocess.run(['podman', 'ps', '-a', '--filter', 'name=aios-coding-', '--format', 'json'], stdout=subprocess.PIPE, check=True, timeout=120).stdout)

def kind_of(record):
    admission = record.get('admission')
    if not isinstance(admission, dict): return 'no admission'
    if record.get('cleaned'): return 'cleaned'
    if record.get('reconciled'): return 'reconciled:' + str(record['reconciled'])
    if record.get('recovered'): return 'recovered'
    if record.get('resumedBy'): return 'reserved predecessor'
    if 'threadId' in record: return 'head with thread'
    if 'resumeFrom' in admission: return 'resume without thread'
    return 'start without thread'

counts = collections.Counter()
for container in listing:
    name = container['Names'][0]
    state = container.get('State', '?')
    try:
        with open(root + '/' + name + '.json') as f: record = json.load(f)
    except FileNotFoundError:
        counts[(state, 'no record', '-', '-', '-')] += 1
        continue
    pins = record.get('pins') or {}
    counts[(state, kind_of(record), record.get('phase', '?'), pins.get('policySha256', 'none')[:8], pins.get('bindingSha256', 'none')[:8])] += 1
print('containers', len(listing))
print('count state kind phase policy binding')
for key, value in sorted(counts.items(), key=lambda item: (-item[1], item[0])):
    print(value, *key, sep=' | ')
