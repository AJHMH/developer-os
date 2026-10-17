// Diagnostic comparison only; never installed in required validation.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statfsSync, statSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
const [factory, consumer, output, order] = process.argv.slice(2);
if (process.platform !== "linux" || !factory || !consumer || !output || !["disk-first", "memory-first"].includes(order) || process.env.NODE_OPTIONS)
  throw Error("Require explicit Linux paths/order without a preload");
const out = resolve(output);
mkdirSync(out, { recursive: false, mode: 0o700 });
const memoryRoot = resolve(process.env.AIOS_MEMORY_FIXTURE_ROOT ?? "");
const memoryInfo = statSync(memoryRoot);
if (!process.env.AIOS_MEMORY_FIXTURE_ROOT || !process.env.RUNNER_TEMP ||
    !memoryRoot.startsWith(realpathSync(process.env.RUNNER_TEMP) + "/") ||
    statfsSync(memoryRoot).type !== 0x01021994 || memoryInfo.uid !== process.getuid() ||
    (memoryInfo.mode & 0o777) !== 0o700)
  throw Error("Require private runner-owned tmpfs inside runner temporary storage");
const { runContract } = await import(pathToFileURL(resolve(factory, "scripts/contract-execution.mjs")));
const original = process.env.TMPDIR;
const bases = { disk: resolve(process.env.RUNNER_TEMP), memory: memoryRoot };
const results = [];
for (const storage of order === "disk-first" ? ["disk", "memory"] : ["memory", "disk"]) {
  const directory = realpathSync(mkdtempSync(join(bases[storage], "fixture-storage-")));
  let result;
  try {
    process.env.TMPDIR = directory;
    result = await runContract(resolve(consumer, "factory-contract.yaml"));
  } finally {
    if (original === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = original;
  }
  // Persist before cleanup; diagnostic write failure fails this proposal only.
  writeFileSync(join(out, storage + ".json"), JSON.stringify(result, null, 2) + "\n");
  results.push({ storage, outcome: result.outcome, terminationFailed: result.results.some(stage => stage.terminationFailed) });
  console.log(JSON.stringify({ storage, stages: result.results.map(({capability,status,timedOut,startedAt,finishedAt}) => ({capability,status,timedOut,startedAt,finishedAt})) }));
  // A failed termination requires operator reconciliation before any new command.
  if (results.at(-1).terminationFailed) { process.exitCode = 1; break; }
  rmSync(directory, { recursive: true });
}
writeFileSync(join(out, "summary.json"), JSON.stringify({ diagnosticOnly: true, order, results }, null, 2) + "\n");
if (results.some(result => result.outcome !== "passed")) process.exitCode = 1;
