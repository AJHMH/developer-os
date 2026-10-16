// Temporary diagnostic preload: fixed command families and numeric timing only.
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { performance } from 'node:perf_hooks';
const directory = process.env.AIOS_PROCESS_PROFILE;
if (!directory) throw new Error('Explicit diagnostic output directory required');
mkdirSync(directory, { recursive: true });
const started = performance.now();
const file = process.argv.find(value => value.endsWith('.test.mjs'));
const families = {};
function family(command) {
  const name = basename(String(command));
  return ['git', 'ssh-keygen', 'node', 'python3', 'python'].includes(name) ? name : 'other';
}
function record(command, elapsed) {
  const key = family(command);
  const item = families[key] ??= { count: 0, totalMs: 0, maxMs: 0 };
  item.count++;
  item.totalMs += elapsed;
  item.maxMs = Math.max(item.maxMs, elapsed);
}
const original = cp.spawnSync;
cp.spawnSync = function(command, ...args) {
  const before = performance.now();
  try { return Reflect.apply(original, this, [command, ...args]); }
  finally { record(command, performance.now() - before); }
};
syncBuiltinESMExports();
function flush(completed) {
  writeFileSync(join(directory, `${process.pid}.json`), JSON.stringify({
    schemaVersion: 1, diagnosticOnly: true, file: file ? basename(file) : 'node-process',
    elapsedMs: performance.now() - started, completed, families,
  }));
}
setInterval(() => flush(false), 2000).unref();
process.on('exit', () => flush(true));
