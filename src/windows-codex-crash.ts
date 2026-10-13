/** Fixed trusted-management helper. Opens exact process handles before validating
 * identities; never signals a reused PID or falls back to name-based killing. */
export const windowsCodexCrashFixture = String.raw`
import os,sys,json,pathlib,signal
expected=json.loads(sys.argv[1]);handles=[]
try:
 if not expected['pids'] or not expected['cgroup'].startswith('/') or '..' in expected['cgroup']: raise RuntimeError('Invalid crash binding')
 for pid,start in expected['pids'].items():
  fd=os.pidfd_open(int(pid),0);handles.append(fd)
  actual=pathlib.Path('/proc/'+pid+'/stat').read_text().rsplit(')',1)[1].split()[19]
  groups=pathlib.Path('/proc/'+pid+'/cgroup').read_text().splitlines()
  group=next(line[3:] for line in groups if line.startswith('0::/'))
  if actual!=start or (group!=expected['cgroup'] and not group.startswith(expected['cgroup']+'/')): raise RuntimeError('Crash identity changed')
 for fd in handles: signal.pidfd_send_signal(fd,signal.SIGKILL,None,0)
finally:
 for fd in handles: os.close(fd)
`;
