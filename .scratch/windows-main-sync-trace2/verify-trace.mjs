import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
const directory = mkdtempSync(join(tmpdir(), "git-trace-control-"));
try {
  const control = join(directory, "refusal.mjs");
  writeFileSync(
    control,
    `import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';const spawn=cp.spawnSync;cp.spawnSync=(command,args,options)=>{if(command==='git'&&args.includes('push')){args=[...args];const at=args.indexOf('push');args.splice(at+2,1,'refs/heads/missing-trace-control');}return spawn(command,args,options);};syncBuiltinESMExports();`,
  );
  const profile = resolve(".scratch/windows-main-sync-trace2/trace-push.mjs");
  const imports = ["--import", pathToFileURL(control).href];
  if (existsSync(profile))
    imports.push("--import", pathToFileURL(profile).href);
  const result = spawnSync(
    process.execPath,
    [
      ...imports,
      "--test",
      "--test-name-pattern=remote advancement invalidates green checks",
      "tests/main-sync.test.mjs",
    ],
    { encoding: "utf8", timeout: 20000 },
  );
  assert.equal(result.status, 1, result.stderr);
  const output = result.stdout + result.stderr;
  const lines = output
    .split("\n")
    .filter((line) => line.includes("[main-sync-trace2] "));
  assert.equal(
    lines.length,
    1,
    "expected bounded trace from real Git push refusal",
  );
  const record = JSON.parse(lines[0].split("[main-sync-trace2] ")[1]);
  assert.equal(record.status, 1);
  assert.equal(record.timeoutMs, 5000);
  assert.equal(record.traceAvailable, true);
  assert.equal(
    record.malformedLines,
    0,
    "a trailing newline is not malformed evidence",
  );
  assert.ok(
    record.events.some((event) => event.event === "exit" && event.code === 1),
  );
  assert.ok(record.events.some((event) => event.command === "push"));
  assert.ok(!JSON.stringify(record).includes("missing-trace-control"));
  assert.ok(!JSON.stringify(record).includes(directory));
  console.log(
    "PASS: real Git refusal retains bounded phase/exit evidence without arguments or fixture paths",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
