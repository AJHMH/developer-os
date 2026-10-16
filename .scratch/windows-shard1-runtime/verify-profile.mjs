import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
const directory = mkdtempSync(join(tmpdir(), "shard-profile-control-"));
try {
  const reports = join(directory, "reports"),
    script = join(directory, "control.mjs");
  writeFileSync(
    script,
    `import assert from 'node:assert/strict';import fs from 'node:fs';import {join} from 'node:path';import cp from 'node:child_process';const out=process.env.AIOS_PROCESS_PROFILE;const files=fs.readdirSync(out);assert.equal(files.length,1,'initial progress snapshot must exist before synchronous work');const path=join(out,files[0]);fs.rmSync(path);fs.mkdirSync(path);await new Promise(resolve=>setTimeout(resolve,2100));const started=performance.now();const child=cp.spawnSync(process.execPath,['-e','setInterval(()=>{},100)'],{encoding:'utf8',timeout:1000});console.log(JSON.stringify({timedOut:child.error?.code==='ETIMEDOUT',status:child.status,elapsedMs:Math.round(performance.now()-started)}));`,
  );
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      pathToFileURL(
        resolve(".scratch/windows-shard1-runtime/process-profile.mjs"),
      ).href,
      script,
    ],
    {
      encoding: "utf8",
      timeout: 10000,
      env: { ...process.env, AIOS_PROCESS_PROFILE: reports },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const record = JSON.parse(result.stdout);
  assert.equal(record.timedOut, true);
  assert.equal(record.status, null);
  assert.ok(record.elapsedMs >= 900 && record.elapsedMs < 3000);
  assert.match(
    result.stderr,
    /\[windows-shard-profile\].*"snapshotFailed":true/,
  );
  assert.ok(!result.stderr.includes(directory));
  console.log(
    "PASS: initial progress survives and report-write failure cannot interrupt the original child deadline",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
