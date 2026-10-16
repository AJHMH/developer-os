// Temporary diagnostic preload: fixed command families and numeric timing only.
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { cpus, availableParallelism } from 'node:os';
import { performance } from 'node:perf_hooks';
const directory = process.env.AIOS_PROCESS_PROFILE;
if (!directory) throw new Error('Explicit diagnostic output directory required');
mkdirSync(directory, { recursive: true });
const started = performance.now();
const file = process.argv.find(value => value.endsWith('.test.mjs'));
const families = {};
function family(command, args) {
  const name = basename(String(command));
  if (name === 'git') {
    const operation = args.find(value => ['config', 'rev-parse', 'status', 'ls-tree', 'cat-file', 'symbolic-ref', 'update-ref', 'init', 'add', 'commit'].includes(value));
    return 'git:' + (operation ?? 'other');
  }
  return ['ssh-keygen', 'node', 'python3', 'python'].includes(name) ? name : 'other';
}
function record(command, args, elapsed) {
  const key = family(command, args);
  const item = families[key] ??= { count: 0, totalMs: 0, maxMs: 0 };
  item.count++;
  item.totalMs += elapsed;
  item.maxMs = Math.max(item.maxMs, elapsed);
}
const original = cp.spawnSync;
cp.spawnSync = function(command, ...args) {
  const before = performance.now();
  try { return Reflect.apply(original, this, [command, ...args]); }
  finally { record(command, Array.isArray(args[0]) ? args[0] : [], performance.now() - before); }
};
syncBuiltinESMExports();
function flush(completed) {
  writeFileSync(join(directory, `${process.pid}.json`), JSON.stringify({
    schemaVersion: 1, diagnosticOnly: true, file: file ? basename(file) : 'node-process',
    elapsedMs: performance.now() - started, completed, families,
    cpuUsage: process.cpuUsage(), resourceUsage: process.resourceUsage(),
    runtime: {node: process.version, platform: process.platform, architecture: process.arch, parallelism: availableParallelism(), cpuModel: cpus()[0]?.model},
  }));
}
setInterval(() => flush(false), 2000).unref();
process.on('exit', () => flush(true));
