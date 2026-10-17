import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
const root = mkdtempSync(join(tmpdir(), "paired-stop-control-"));
try {
  const preload = join(root, "refuse.mjs");
  writeFileSync(
    preload,
    `import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import {workerData} from 'node:worker_threads';import {writeFileSync} from 'node:fs';if(workerData?.kind==='bounded-push-pair'){const stop=new Int32Array(workerData.stop);if(workerData.id===2){const until=performance.now()+10000;while(Atomics.load(stop,0)===0&&performance.now()<until)Atomics.wait(stop,0,0,10);if(Atomics.load(stop,0)===0)throw Error('Control barrier was not released');}const original=cp.spawnSync;let pushes=0,calls=0;cp.spawnSync=(command,args,options)=>{writeFileSync(${JSON.stringify(root)}+'/calls-'+workerData.id,String(++calls));if(workerData.id===1&&command==='git'&&args.includes('push')&&args.includes('core.attributesFile=/nonexistent')&&args.includes('user.email=fixture@example.invalid')&&++pushes===3){args=[...args];args[args.indexOf('push')+2]='refs/heads/private-refusal-control';}return original(command,args,options);};syncBuiltinESMExports();}`,
  );
  const coordinator =
    process.argv[2] ?? ".scratch/windows-push-bounded-loop/paired.mjs";
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      pathToFileURL(preload).href,
      "--test-reporter=tap",
      coordinator,
      "--local-control",
    ],
    { encoding: "utf8", timeout: 60000, env: process.env },
  );
  assert.equal(result.status, 1, result.stderr);
  const line = result.stdout
    .split(/\r?\n/)
    .find((l) => l.startsWith("[push-loop-pair] "));
  assert.ok(line);
  const summary = JSON.parse(line.slice("[push-loop-pair] ".length));
  assert.equal(summary.outcome, "failed");
  assert.equal(summary.diagnosticFailed, false);
  const first = summary.workers.find((w) => w.id === 1),
    peer = summary.workers.find((w) => w.id === 2);
  assert.equal(first.outcome, "failed");
  assert.equal(first.completed, 0);
  assert.equal(peer.outcome, "peer-stopped");
  assert.equal(peer.completed, 0);
  assert.notEqual(peer.code, 0);
  assert.ok(
    !existsSync(join(root, "calls-2")),
    "peer must not enter any original native call after barrier release",
  );
  assert.ok(Number(readFileSync(join(root, "calls-1"), "utf8")) > 0);
  console.log(
    "PASS: one real Git refusal releases peer barrier; shared guard prevents every subsequent peer native call",
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
