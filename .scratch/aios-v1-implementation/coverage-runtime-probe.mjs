// Temporary, non-authoritative probe. Never substitutes for Factory validation.
import { execute } from "../../factory/scripts/contract-execution.mjs";
import { readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { availableParallelism, cpus, totalmem } from "node:os";

const concurrency = process.env.PROBE_CONCURRENCY;
if (!["1", "2", "4", "8"].includes(concurrency))
  throw Error("Unsupported diagnostic concurrency");
const root = resolve("baseline");
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const files = readdirSync(root + "/tests")
  .filter((file) => file.endsWith(".test.mjs"))
  .sort()
  .map((file) => "tests/" + file);
const output = resolve("probe-results");
const node = quote(process.execPath);
writeFileSync(output + "/c8.json", JSON.stringify({ exclude: [] }));
const run = `${node} ${quote(resolve("factory/node_modules/c8/bin/c8.js"))} --config ${quote(output + "/c8.json")} --all --src src --include 'src/**/*.ts' --extension .mjs --extension .ts --extension .js --exclude-after-remap --reporter json --reports-dir ${quote(output + "/report")} --temp-directory ${quote(output + "/v8")} ${node} --test --test-concurrency=${concurrency} ${files.map(quote).join(" ")}`;
const result = await execute({ run, timeout_seconds: 120 }, root);
// Fixed trusted test inventory only; do not retain ambient environment values.
writeFileSync(
  output + "/timing.json",
  JSON.stringify(
    {
      diagnosticOnly: true,
      baselineRevision: "1fe02cc983f9f05f215ad5a32068655fb6071ddd",
      concurrency: Number(concurrency),
      availableParallelism: availableParallelism(),
      cpus: cpus().length,
      totalMemoryBytes: totalmem(),
      ...result,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    diagnosticOnly: true,
    concurrency,
    status: result.status,
    timedOut: result.timedOut,
    durationMs: Date.parse(result.finishedAt) - Date.parse(result.startedAt),
  }),
);
process.exitCode = result.status === "passed" ? 0 : 1;
