import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
const root = mkdtempSync(join(tmpdir(), "storage-process-control-"));
try {
  const helper = pathToFileURL(
    resolve("tests/helpers/storage-process-diagnostics.mjs"),
  ).href;
  const script = join(root, "control.mjs");
  writeFileSync(
    script,
    `import assert from 'node:assert/strict';import {openSync,closeSync} from 'node:fs';import {observeStorageProcess} from ${JSON.stringify(helper)};const options={encoding:'utf8',timeout:1000,input:'private-input'};const success=observeStorageProcess('control',process.execPath,['-e',"process.stdin.resume();process.stdout.write('private-output');process.stderr.write('private-error')"],options);assert.equal(success.status,0);assert.equal(success.stdout,'private-output');assert.equal(success.stderr,'private-error');const missing=observeStorageProcess('control',${JSON.stringify(join(root, "missing"))},[],{encoding:'utf8',timeout:1000});assert.equal(missing.error.code,'ENOENT');const timeout=(descriptor=2)=>observeStorageProcess('control',process.execPath,['-e','setInterval(()=>{},10)'],{encoding:'utf8',timeout:100},descriptor);assert.equal(timeout().error.code,'ETIMEDOUT');const readonly=openSync(import.meta.filename,'r');assert.equal(timeout(readonly).error.code,'ETIMEDOUT');closeSync(readonly);console.log('control-passed');`,
  );
  const result = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /control-passed/);
  const records = result.stderr
    .split(/\r?\n/)
    .filter((line) => line.startsWith("[storage-process] "))
    .map((line) => JSON.parse(line.slice("[storage-process] ".length)));
  assert.ok(records.some((r) => r.event === "finished" && r.status === 0));
  assert.ok(records.some((r) => r.errorCode === "ENOENT"));
  assert.ok(records.some((r) => r.errorCode === "ETIMEDOUT"));
  for (const forbidden of [
    root,
    "private-input",
    "private-output",
    "private-error",
  ])
    assert.ok(!result.stderr.includes(forbidden));
  console.log(
    "PASS: native success/refusal/timeout, metadata privacy, and read-only diagnostic sink preserve results",
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
