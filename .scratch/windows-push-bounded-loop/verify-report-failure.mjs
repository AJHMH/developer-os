import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
const root = mkdtempSync(join(tmpdir(), "paired-report-control-"));
try {
  const preload = join(root, "report-failure.mjs");
  writeFileSync(
    preload,
    `import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';import {workerData} from 'node:worker_threads';import {mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';if(workerData?.kind==='bounded-push-pair'){const stop=new Int32Array(workerData.stop);if(workerData.id===1)mkdirSync(join(workerData.outputDirectory,'worker-1.json'));else{const until=performance.now()+10000;while(Atomics.load(stop,0)===0&&performance.now()<until)Atomics.wait(stop,0,0,10);if(Atomics.load(stop,0)===0)throw Error('Control barrier was not released');}const original=cp.spawnSync;cp.spawnSync=(...args)=>{writeFileSync(${JSON.stringify(root)}+'/calls-'+workerData.id,'native-called');return original(...args);};syncBuiltinESMExports();}`,
  );
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      pathToFileURL(preload).href,
      process.argv[2] ?? ".scratch/windows-push-bounded-loop/paired.mjs",
      "--local-control",
    ],
    { encoding: "utf8", timeout: 60000, env: process.env },
  );
  assert.equal(result.status, 1);
  const line = result.stdout
    .split(/\r?\n/)
    .find((l) => l.startsWith("[push-loop-pair] "));
  assert.ok(line);
  const summary = JSON.parse(line.slice("[push-loop-pair] ".length));
  assert.equal(summary.outcome, "failed");
  assert.equal(summary.diagnosticFailed, true);
  for (const id of [1, 2])
    assert.ok(
      !existsSync(join(root, "calls-" + id)),
      "report failure must stop all new native calls",
    );
  console.log(
    "PASS: real report destination failure stops both workers before any original native call",
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
