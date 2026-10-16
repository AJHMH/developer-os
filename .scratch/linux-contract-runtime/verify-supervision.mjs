// Linux-only diagnostic regression at the real process/filesystem boundary.
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
const [factory, sampler, expectation] = process.argv.slice(2);
if (
  process.platform !== "linux" ||
  !factory ||
  !sampler ||
  !["red", "green"].includes(expectation)
)
  throw Error(
    "Require Linux, Factory path, sampler path, red/green expectation",
  );
const root = mkdtempSync(join(tmpdir(), "aios-sampler-regression-"));
let runner, child;
try {
  const fake = join(root, "factory");
  mkdirSync(join(fake, "scripts"), { recursive: true });
  const marker = join(root, "child.json");
  const workload = join(root, "workload.mjs");
  writeFileSync(
    workload,
    `import {readFileSync,writeFileSync} from 'node:fs'; const stat=readFileSync('/proc/self/stat','utf8'); const fields=stat.slice(stat.lastIndexOf(')')+2).split(' '); writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,group:Number(fields[2])})); setInterval(()=>{},1000);`,
  );
  const executor = pathToFileURL(
    resolve(factory, "scripts/contract-execution.mjs"),
  ).href;
  writeFileSync(
    join(fake, "scripts/contract-execution.mjs"),
    `import {execute} from ${JSON.stringify(executor)}; export async function runContract(){const r=await execute({run: ${JSON.stringify("node " + workload)},timeout_seconds:4},${JSON.stringify(root)});return {outcome:r.status==='passed'?'passed':'blocked',results:[{capability:'test',...r}]};}`,
  );
  const output = join(root, "output");
  const started = Date.now();
  runner = spawn(process.execPath, [resolve(sampler), fake, root, output], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let stderr = "";
  runner.stderr.on("data", (bytes) => {
    stderr = (stderr + bytes).slice(0, 8192);
  });
  runner.stdout.resume();
  const closed = new Promise((resolve) =>
    runner.on("close", (code, signal) => resolve({ code, signal })),
  );
  for (let i = 0; i < 100 && !existsSync(marker); i++)
    await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(existsSync(marker), "Real supervised command must start");
  child = JSON.parse(readFileSync(marker));
  // EISDIR at the public filesystem seam, after initial sampling succeeded.
  rmSync(join(output, "host.json"));
  mkdirSync(join(output, "host.json"));
  const stop = setTimeout(() => {
    try {
      process.kill(-runner.pid, "SIGKILL");
    } catch {}
  }, 10000);
  const status = await closed;
  clearTimeout(stop);
  const elapsedMs = Date.now() - started;
  if (expectation === "red") {
    assert.equal(existsSync(join(output, "result.json")), false);
    assert.match(stderr, /EISDIR/);
    assert.ok(
      elapsedMs < 3500,
      "Old sampler loses supervisor before 4-second deadline",
    );
    assert.doesNotThrow(
      () => process.kill(child.pid, 0),
      "Old sampler leaves command running",
    );
  } else {
    const result = JSON.parse(readFileSync(join(output, "result.json")));
    assert.equal(result.results[0].timedOut, true);
    assert.equal(result.results[0].terminationFailed, false);
    assert.equal(result.diagnosticSamplingFailed, true);
    assert.ok(
      elapsedMs >= 3900,
      "Supervisor must retain original 4-second deadline",
    );
    assert.notEqual(
      status.code,
      0,
      "Diagnostic report failure remains a refusal",
    );
    let live = false;
    try {
      const stat = readFileSync("/proc/" + child.pid + "/stat", "utf8");
      live = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0] !== "Z";
    } catch {}
    assert.equal(
      live,
      false,
      "Workload must be stopped by its original deadline",
    );
  }
  console.log(
    JSON.stringify({
      expectation,
      elapsedMs,
      supervisionPreserved: expectation === "green",
    }),
  );
} finally {
  if (child)
    try {
      process.kill(-child.group, "SIGKILL");
    } catch {}
  if (runner)
    try {
      process.kill(-runner.pid, "SIGKILL");
    } catch {}
  rmSync(root, { recursive: true, force: true });
}
