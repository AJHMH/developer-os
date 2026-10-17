import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { VMManagementChannel } from "../dist/vm-management.js";
import { hostTargets } from "../dist/host-target.js";
import {
  syntheticSiteInput,
  syntheticSiteOutput,
  syntheticSiteValidator,
} from "../dist/synthetic-task.js";

const guestTest = process.platform === "win32" ? test.skip : test;
const hash = (value) => createHash("sha256").update(value).digest("hex");
function fixture(t) {
  const root = realpathSync(mkdtempSync("/tmp/"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = root,
    bin = join(root, "bin"),
    authorityDirectory = join(root, "authority");
  for (const dir of [bin, authorityDirectory]) mkdirSync(dir, { mode: 0o700 });
  const state = {
    running: true,
    session: randomUUID(),
    taskOutput: syntheticSiteOutput,
    deny: true,
  };
  const engine = join(root, "engine.json");
  const saveEngine = () => writeFileSync(engine, JSON.stringify(state));
  saveEngine();
  const executable = join(bin, "podman");
  writeFileSync(
    executable,
    `#!/usr/bin/python3
import os,sys,json
args=sys.argv[1:]
if args[:1]==['machine']:
 os.execv('/usr/bin/python3',['python3'])
if args[-2:]==['--format','json'] and 'version' in args:
 print(json.dumps({'Client':{'Version':'6.1.0'}}));sys.exit(0)
r=json.load(open(os.environ['FAKE_ENGINE']))
if args[0]=='inspect':
 print(json.dumps([{'Config':{'Labels':{'aios.session':r['session']},'User':'65534:65534'},'HostConfig':{'NetworkMode':'none','ReadonlyRootfs':True},'Mounts':[],'State':{'Running':r['running']}}]));sys.exit(0)
if args[0]=='exec':
 if '/proc/self/mountinfo' in args:print('none');sys.exit(0)
 if args[-1].startswith('set -eu'):
  sys.stdout.write(r['taskOutput']);sys.exit(0)
 sys.exit(0 if r['deny'] else 1)
if args[0]=='cp':
 sys.stdin.buffer.read();sys.exit(0)
sys.exit(1)
`,
    { mode: 0o700 },
  );
  const directory = join(home, ".local/state/aios-offline-v1");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const session = {
    deliveryId: randomUUID(),
    operationId: randomUUID(),
    sandboxId: randomUUID(),
    workerSessionId: state.session,
    repositoryKey: "repository",
    runnerId: randomUUID(),
    fence: 2,
    intent: "start",
    state: "dispatched",
  };
  const pins = { bindingSha256: "a".repeat(64), policySha256: "b".repeat(64) };
  const registry = {
    id: hash(authorityDirectory),
    fences: { [hash(session.repositoryKey)]: session.fence },
  };
  const journal = {
    session: { ...session },
    pins: structuredClone(pins),
    revoked: false,
    stopped: false,
  };
  const journalPath = join(directory, session.sandboxId + ".json");
  const save = () => {
    writeFileSync(join(directory, "authority.json"), JSON.stringify(registry), {
      mode: 0o600,
    });
    writeFileSync(journalPath, JSON.stringify(journal), { mode: 0o600 });
  };
  writeFileSync(join(directory, "lock"), "", { mode: 0o600 });
  save();
  const host = {
    ...hostTargets.darwin,
    executable,
    cwd: root,
    osVersion: "23.0.0",
    env: { HOME: home, PATH: bin + ":/usr/bin:/bin", FAKE_ENGINE: engine },
    config: {},
  };
  const channel = new VMManagementChannel(
    "aios-test",
    authorityDirectory,
    () => host,
  );
  return {
    channel,
    session,
    pins,
    registry,
    journal,
    journalPath,
    directory,
    state,
    save,
    saveEngine,
  };
}

guestTest(
  "whole boundary action checks the common private journal, fence and positive/negative controls",
  (t) => {
    const f = fixture(t),
      challenge = randomUUID();
    const result = f.channel.invoke("boundary-probe", {
      session: f.session,
      pins: f.pins,
      challenge,
    });
    assert.deepEqual(result, {
      challenge,
      operationId: f.session.operationId,
      names: ["ssh-gpg", "github-binding", "effective-mounts"],
      positiveControls: true,
      privilegedDenial: true,
    });
  },
);

guestTest(
  "all management actions refuse stale fences, changed session identity and insecure journals",
  (t) => {
    for (const action of ["boundary-probe", "task-execute", "task-collect"]) {
      for (const mutate of [
        (f) => {
          f.registry.fences[hash(f.session.repositoryKey)]++;
          f.save();
        },
        (f) => {
          f.journal.session.runnerId = randomUUID();
          f.save();
        },
        (f) => {
          f.journal.pins.bindingSha256 = "c".repeat(64);
          f.save();
        },
        (f) => {
          chmodSync(f.journalPath, 0o644);
        },
      ]) {
        const f = fixture(t);
        mutate(f);
        assert.throws(() =>
          f.channel.invoke(action, {
            session: f.session,
            pins: f.pins,
            challenge: randomUUID(),
          }),
        );
      }
    }
  },
);

guestTest(
  "synthetic task execution and stopped collection use the same authority journal",
  (t) => {
    const f = fixture(t);
    const request = {
      session: f.session,
      pins: f.pins,
      version: "d".repeat(64),
      expected: Buffer.from(syntheticSiteOutput).toString("base64"),
      files: [
        {
          path: "index.html",
          bytes: Buffer.from(syntheticSiteInput).toString("base64"),
        },
        {
          path: "validate.sh",
          bytes: Buffer.from(syntheticSiteValidator).toString("base64"),
        },
      ],
    };
    assert.deepEqual(f.channel.invoke("task-execute", request), {
      completed: true,
    });
    assert.throws(() => f.channel.invoke("task-collect", request));
    f.session.state = "stopped";
    f.journal.session.state = "stopped";
    f.journal.revoked = true;
    f.journal.stopped = true;
    f.state.running = false;
    f.saveEngine();
    f.save();
    const result = f.channel.invoke("task-collect", request);
    assert.equal(result.output, syntheticSiteOutput);
    assert.equal(result.operationId, f.session.operationId);
    assert.equal(result.validation, "passed");
    assert.equal(result.outputSha256, hash(syntheticSiteOutput));
    assert.match(result.collectionSha256, /^[a-f0-9]{64}$/);
  },
);

guestTest(
  "revoked execution and altered synthetic output cannot pass management actions",
  (t) => {
    const f = fixture(t);
    f.journal.revoked = true;
    f.save();
    assert.throws(() =>
      f.channel.invoke("boundary-probe", {
        session: f.session,
        pins: f.pins,
        challenge: randomUUID(),
      }),
    );
    assert.throws(() =>
      f.channel.invoke("task-execute", { session: f.session, pins: f.pins }),
    );
  },
);
