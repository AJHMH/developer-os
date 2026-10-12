import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { NativePodmanDriver } from "./podman-native.js";
import { podmanMachine } from "./podman-platform.js";
import {
  sha256,
  type OfflineCanaryRuntime,
  type CanaryPins,
} from "./offline-canary.js";
import type { WorkerSession } from "./controller.js";
export const syntheticSiteInput =
  "<!doctype html><title>Developer OS fixture</title><h1>Before</h1>\n";
export const syntheticSiteOutput =
  "<!doctype html><title>Developer OS fixture</title><h1>Ready</h1>\n";
export const syntheticSiteValidator =
  "#!/bin/sh\nset -eu\ngrep -q '<h1>Ready</h1>' index.html\ngrep -q '<title>Developer OS fixture</title>' index.html\n";
export const syntheticTaskVersion = createHash("sha256")
  .update(readFileSync(new URL(import.meta.url)))
  .digest("hex");
export interface SyntheticTaskResult {
  operationId: string;
  version: string;
  inputSha256: string;
  outputSha256: string;
  output: string;
  validation: "passed";
  negativeValidation: "passed";
  httpValidation: "passed";
  collectionSha256: string;
}
export interface SyntheticTaskRuntime extends OfflineCanaryRuntime {
  readonly version: string;
  stage(files: { path: string; bytes: Buffer }[]): void;
  collectTask(
    session: WorkerSession,
    pins: CanaryPins,
  ): Promise<SyntheticTaskResult>;
}
export interface SyntheticTaskEvidence extends CanaryPins {
  mode: "live" | "controlled";
  version: string;
  outcome: "completed" | "refused";
  session?: WorkerSession;
  result?: SyntheticTaskResult;
  shutdownProof?: { remainingProcesses: number; censusSha256: string };
  productionEnabled: false;
}
const guest = String.raw`
import sys,os,json,base64,hashlib,pathlib,stat,subprocess,io,tarfile,fcntl
r=json.loads(sys.stdin.readline())
def h(v): return hashlib.sha256(v).hexdigest()
root=os.path.expanduser('~/.local/state/aios-offline-v1')
def private(p):
 s=os.lstat(p)
 assert stat.S_ISREG(s.st_mode) and s.st_uid==os.getuid() and s.st_nlink==1 and not s.st_mode&0o077 and s.st_size<65536
 assert not os.path.islink(p)
def read(p):
 private(p);return json.loads(pathlib.Path(p).read_text())
assert not os.path.islink(root) and os.stat(root).st_uid==os.getuid() and not os.stat(root).st_mode&0o077
lock=os.open(root+'/lock',os.O_RDWR|os.O_NOFOLLOW)
with os.fdopen(lock,'w') as handle:
 fcntl.flock(handle,fcntl.LOCK_EX)
 s=r['session'];path=root+'/'+s['sandboxId']+'.json';j=read(path)
 assert j['pins']==r['pins'] and j['session']['operationId']==s['operationId']
 authority=read(root+'/authority.json')
 assert authority['fences'][h(s['repositoryKey'].encode())]==s['fence']
 name='aios-offline-'+s['sandboxId']
 def pod(*args,**kw): return subprocess.run(['podman',*args],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=15,check=True,**kw).stdout
 c=json.loads(pod('inspect',name))[0]
 assert c['Config']['Labels']['aios.session']==s['workerSessionId']
 task=root+'/task-'+s['sandboxId']+'.json'
 if r['action']=='execute':
  stage='authority'
  assert not j.get('revoked') and c['State']['Running'] and j['session']['fence']==s['fence']
  assert c['Config']['User']=='65534:65534' and c['HostConfig']['NetworkMode']=='none' and c['HostConfig']['ReadonlyRootfs'] and not c.get('Mounts')
  pod('exec',name,'mkdir','-m','700','/tmp/site')
  archive=io.BytesIO()
  stage='input-transfer'
  with tarfile.open(fileobj=archive,mode='w') as tar:
   for f in r['files']:
    assert f['path'] in ['index.html','validate.sh']
    data=base64.b64decode(f['bytes'],validate=True)
    assert len(data)<4096
    info=tarfile.TarInfo(f['path']);info.size=len(data);info.mode=0o444;info.uid=65534;info.gid=65534
    tar.addfile(info,io.BytesIO(data))
  pod('cp','-',name+':/tmp/site/',input=archive.getvalue())
  script=r'''set -eu
cd /tmp/site
if /bin/sh validate.sh; then exit 1; fi
sed 's/<h1>Before<\/h1>/<h1>Ready<\/h1>/' index.html > replacement.html
mv replacement.html index.html
/bin/sh validate.sh
{ printf 'HTTP/1.0 200 OK\r\nContent-Type: text/html\r\nContent-Length: %s\r\n\r\n' "$(wc -c < index.html)"; cat index.html; } | busybox nc -l -p 18921 -w 3 > /dev/null & server=$!
trap 'kill "$server" 2>/dev/null || true; wait "$server" 2>/dev/null || true' EXIT
sleep 0.1
wget -T 2 -q -O fetched.html http://127.0.0.1:18921/index.html
cmp index.html fetched.html
cat index.html
'''
  stage='isolated-validation'
  output=pod('exec',name,'/bin/sh','-c',script)
  assert output==base64.b64decode(r['expected'],validate=True)
  result=dict(operationId=s['operationId'],version=r['version'],inputSha256=h(base64.b64decode(r['files'][0]['bytes'])),outputSha256=h(output),output=output.decode(),validation='passed',negativeValidation='passed',httpValidation='passed')
  fd=os.open(task,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
  with os.fdopen(fd,'w') as f: json.dump(result,f);f.flush();os.fsync(f.fileno())
  print(json.dumps(dict(completed=True)))
 else:
  stage='collection'
  assert r['action']=='collect' and j.get('revoked') and j.get('stopped') and j['session']==s and not c['State']['Running']
  result=read(task);a=pathlib.Path(task).read_bytes();b=pathlib.Path(task).read_bytes();assert a==b
  assert result['operationId']==s['operationId'] and result['version']==r['version']
  result['collectionSha256']=h(a);print(json.dumps(result))
`;
/** Fixed disposable HTML edit and repository-script validation only; no inference. */
export class NativeSyntheticTask implements SyntheticTaskRuntime {
  readonly mode = "live" as const;
  readonly version = syntheticTaskVersion;
  private files: { path: string; bytes: Buffer }[] | undefined;
  private collectionKey: string | undefined;
  constructor(private readonly native: NativePodmanDriver) {}
  stage(files: { path: string; bytes: Buffer }[]) {
    if (
      files.length !== 2 ||
      files[0]?.path !== "index.html" ||
      files[1]?.path !== "validate.sh" ||
      files[0].bytes.toString() !== syntheticSiteInput ||
      files[1].bytes.toString() !== syntheticSiteValidator
    )
      throw Error("Only the fixed synthetic site is admitted");
    this.files = files.map((f) => ({
      path: f.path,
      bytes: Buffer.from(f.bytes),
    }));
    this.collectionKey = undefined;
  }
  private invoke(action: string, session: WorkerSession, pins: CanaryPins) {
    if (
      !/^[a-f0-9-]{36}$/.test(session.sandboxId) ||
      !/^[a-f0-9-]{36}$/.test(session.operationId)
    )
      throw Error("Invalid synthetic session");
    const host = podmanMachine(this.native.machine);
    const result = spawnSync(
      host.executable,
      [
        "machine",
        "ssh",
        this.native.machine,
        "python3",
        "-u",
        "-c",
        "'import sys,base64;exec(base64.b64decode(sys.stdin.readline()))'",
      ],
      {
        input:
          Buffer.from(
            "stage='authority'\ntry:\n" +
              guest
                .split("\n")
                .map((line) => " " + line)
                .join("\n") +
              "\nexcept BaseException:\n print(stage,file=__import__('sys').stderr);raise SystemExit(1)\n",
          ).toString("base64") +
          "\n" +
          JSON.stringify({
            action,
            session,
            pins,
            version: this.version,
            expected: Buffer.from(syntheticSiteOutput).toString("base64"),
            files: this.files?.map((f) => ({
              path: f.path,
              bytes: f.bytes.toString("base64"),
            })),
          }) +
          "\n",
        encoding: "utf8",
        env: host.env,
        cwd: host.cwd,
        windowsHide: true,
        shell: false,
        timeout: 30000,
        maxBuffer: 65536,
      },
    );
    if (result.status !== 0) {
      const stage = result.stderr.trim();
      if (
        [
          "authority",
          "input-transfer",
          "isolated-validation",
          "collection",
        ].includes(stage)
      )
        process.stderr.write(
          JSON.stringify({ syntheticTaskRefusal: stage }) + "\n",
        );
      throw Error("Synthetic task management refused");
    }
    return JSON.parse(result.stdout);
  }
  async execute(request: Parameters<OfflineCanaryRuntime["execute"]>[0]) {
    if (!this.files || !request.mayDispatch())
      throw Error("Synthetic input or ownership missing");
    const response = await this.native.execute(request);
    if (!request.mayDispatch()) throw Error("Synthetic task authority changed");
    this.invoke("execute", request.session, {
      bindingSha256: request.bindingSha256,
      policySha256: request.policySha256,
    });
    return response;
  }
  stop(session: WorkerSession, pins: CanaryPins) {
    return this.native.stop(session, pins);
  }
  async collect(session: WorkerSession, pins: CanaryPins) {
    const collection = await this.native.collect(session, pins);
    this.collectionKey = sha256(JSON.stringify({ session, pins }));
    return collection;
  }
  async collectTask(
    session: WorkerSession,
    pins: CanaryPins,
  ): Promise<SyntheticTaskResult> {
    const exactPins = {
      bindingSha256: pins.bindingSha256,
      policySha256: pins.policySha256,
    };
    // Native collection creates an exclusive spool and must run exactly once.
    // The controller completed that collection before accepting this task result.
    if (
      this.collectionKey !==
      sha256(JSON.stringify({ session, pins: exactPins }))
    )
      throw Error(
        "Synthetic task requires matching verified native collection",
      );
    return this.invoke("collect", session, exactPins);
  }
}
