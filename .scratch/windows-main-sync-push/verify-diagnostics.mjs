// Diagnostic regression at the external child-process seam, not historical cause proof.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
const directory = mkdtempSync(join(tmpdir(), "main-sync-diagnostic-"));
try {
  const preload = join(directory, "process-seam.mjs");
  writeFileSync(
    preload,
    `
import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
const spawn = cp.spawnSync;
cp.spawnSync = (command,args,options) => {
 if(command==='git' && args.includes('push')) return spawn(process.execPath,['-e','setInterval(()=>{},100)'],options);
 return spawn(command,args,options);
};
syncBuiltinESMExports();
`,
  );
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      pathToFileURL(preload).href,
      "--test",
      "--test-name-pattern=remote advancement invalidates green checks",
      "tests/main-sync.test.mjs",
    ],
    { encoding: "utf8", timeout: 20000 },
  );
  assert.equal(result.status, 1, result.stderr);
  const output = result.stdout + result.stderr;
  assert.match(output, /\[main-sync-git\]/);
  assert.match(output, /"errorCode":"ETIMEDOUT"/);
  assert.match(output, /"operation":"push"/);
  assert.match(output, /"timeoutMs":5000/);
  assert.ok(!output.includes("setInterval"));
  console.log(
    "PASS: actual five-second external process timeout retains bounded Git operation/error evidence",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
