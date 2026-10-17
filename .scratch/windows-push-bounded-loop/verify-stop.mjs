import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
const root = mkdtempSync(join(tmpdir(), "loop-stop-control-"));
try {
  const preload = join(root, "refuse.mjs");
  writeFileSync(
    preload,
    `import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';const original=cp.spawnSync;let count=0;cp.spawnSync=(command,args,options)=>{if(command==='git'&&args.includes('push')&&args.includes('core.attributesFile=/nonexistent')&&args.includes('user.email=fixture@example.invalid')&&++count===3){args=[...args];args[args.indexOf('push')+2]='refs/heads/private-refusal-control';}return original(command,args,options);};syncBuiltinESMExports();`,
  );
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      pathToFileURL(preload).href,
      ".scratch/windows-push-bounded-loop/reproduce.mjs",
      "--local-control",
    ],
    { encoding: "utf8", timeout: 60000, env: process.env },
  );
  assert.equal(result.status, 1);
  const report = JSON.parse(
    readFileSync(resolve("tmp/windows-push-loop.json"), "utf8"),
  );
  assert.equal(report.outcome, "failed");
  assert.equal(report.iteration, 1);
  assert.equal(report.completed, 0);
  assert.equal(report.stage, "push");
  assert.ok(!result.stdout.includes('"iteration":2'));
  assert.ok(!result.stderr.includes('"iteration":2'));
  console.log(
    "PASS: actual first loop push refusal stops before a second remote; original test fails",
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
