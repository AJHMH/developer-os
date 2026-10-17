import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
const root = mkdtempSync(join(tmpdir(), "filesystem-profile-control-"));
try {
  const script = join(root, "control.mjs"),
    reports = join(root, "reports");
  writeFileSync(
    script,
    `import assert from 'node:assert/strict';import {writeFileSync,readFileSync,realpathSync,rmSync} from 'node:fs';const path=process.argv[2];writeFileSync(path,'private-sentinel');assert.equal(readFileSync(path,'utf8'),'private-sentinel');assert.equal(realpathSync.native(path),realpathSync(path));rmSync(path);assert.throws(()=>readFileSync(path),{code:'ENOENT'});`,
  );
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      pathToFileURL(
        resolve(".scratch/windows-shard1-runtime/process-profile.mjs"),
      ).href,
      script,
      join(root, "private-path"),
    ],
    {
      encoding: "utf8",
      timeout: 10000,
      env: {
        ...process.env,
        AIOS_PROCESS_PROFILE: reports,
        AIOS_FILESYSTEM_PROFILE: "1",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const raw = readFileSync(join(reports, readdirSync(reports)[0]), "utf8");
  const record = JSON.parse(raw);
  assert.ok(record.filesystem.writeFileSync.count >= 1);
  assert.ok(record.filesystem.readFileSync.count >= 2);
  assert.ok(record.filesystem.realpathNative.count >= 1);
  assert.equal(record.completed, true);
  assert.ok(!raw.includes("private-sentinel"));
  assert.ok(!raw.includes(root));
  console.log(
    "PASS: real filesystem success, refusal, native identity and metadata-only capture",
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
