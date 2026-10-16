// Explicit synthetic Windows diagnostic. No owner account or inference is used.
import assert from "node:assert/strict";
import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import {
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir, release, availableParallelism } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  initializeWindowsAuthDirectory,
  windowsAuthStore,
} from "../../dist/windows-auth-store.js";

const [output, approval, control, ...extra] = process.argv.slice(2);
assert.equal(process.platform, "win32", "Native Windows observation required");
assert.equal(process.arch, "x64");
assert.ok(output);
assert.equal(approval, "--approve-synthetic-storage-probe");
assert.ok(control === undefined || control === "--first-noop");
assert.equal(extra.length, 0);
const original = cp.spawnSync;
const revision = original("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
  timeout: 5000,
});
assert.equal(revision.status, 0);
assert.match(revision.stdout.trim(), /^[a-f0-9]{40}$/);
closeSync(openSync(output, "wx", 0o600));
const report = {
  scope: "synthetic-windows-storage-phase-timing",
  firstCall: control ? "noop" : "initialize",
  sourceRevision: revision.stdout.trim(),
  helperSourceSha256: createHash("sha256")
    .update(
      readFileSync(new URL("../../src/windows-auth-store.ts", import.meta.url)),
    )
    .digest("hex"),
  startedAt: new Date().toISOString(),
  host: {
    platform: process.platform,
    arch: process.arch,
    release: release(),
    node: process.version,
    availableParallelism: availableParallelism(),
  },
  productionEnabled: false,
  qualified: false,
  outcome: "running",
  observations: [],
  limitations: [
    "Successful timings do not explain the historical timeout",
    "Outside-script time includes startup, instrumentation setup, I/O and exit",
    "Later samples share host runtime caches",
  ],
};
const persist = () => writeFileSync(output, JSON.stringify(report, null, 2));
persist();
let sample = 0;
let controlDone = false;
cp.spawnSync = (executable, args, options) => {
  assert.ok(String(executable).toLowerCase().endsWith("powershell.exe"));
  assert.equal(options.timeout, 15000);
  if (control && !controlDone) {
    controlDone = true;
    const controlArgs = [...args];
    const index = controlArgs.indexOf("-EncodedCommand") + 1;
    assert.ok(index > 0);
    controlArgs[index] = Buffer.from(
      "[Console]::Out.Write('AIOS-profile-control')",
      "utf16le",
    ).toString("base64");
    const started = performance.now();
    const result = original(executable, controlArgs, { ...options, input: "" });
    report.observations.push({
      sample: 0,
      operation: "noop",
      elapsedMs: Math.round(performance.now() - started),
      exitCode: result.status,
      timedOut: result.error?.code === "ETIMEDOUT",
      signaled: Boolean(result.signal),
      phases: [],
    });
    persist();
    assert.equal(result.status, 0, "Read-only control refused");
    assert.equal(
      result.stdout,
      "AIOS-profile-control",
      "Read-only control unavailable",
    );
  }
  const observedArgs = [...args];
  const initialization = !String(options.input).includes("\n");
  if (initialization) {
    const index = observedArgs.indexOf("-EncodedCommand") + 1;
    assert.ok(index > 0);
    let source = Buffer.from(observedArgs[index], "base64").toString("utf16le");
    const mark = (label) =>
      `[Console]::Error.WriteLine('[DEBUG-storage-profile] ${label} '+$aiosProbeClock.ElapsedMilliseconds);\n`;
    for (const [statement, label] of [
      ["$wire=[Console]::In.ReadToEnd()", "stdin-read"],
      [
        "$path=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($wire))",
        "path-decoded",
      ],
      ["$attributes=[IO.File]::GetAttributes($path)", "attributes-read"],
      [
        "$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User",
        "identity-read",
      ],
      ["$acl=[Security.AccessControl.DirectorySecurity]::new()", "acl-created"],
      ["$acl.SetOwner($sid)", "owner-set"],
      ["$acl.SetAccessRuleProtection($true,$false)", "inheritance-set"],
      ["[IO.Directory]::SetAccessControl($path,$acl)", "acl-written"],
    ]) {
      assert.equal(
        source.split(statement).length,
        2,
        "Unsupported probe source",
      );
      source = source.replace(statement, statement + "\n" + mark(label));
    }
    source =
      "$aiosProbeClock=[Diagnostics.Stopwatch]::StartNew();\n" +
      mark("entered") +
      source +
      "\n" +
      mark("script-finished");
    observedArgs[index] = Buffer.from(source, "utf16le").toString("base64");
  }
  const started = performance.now();
  const result = original(executable, observedArgs, options);
  const elapsedMs = Math.round(performance.now() - started);
  const phases = String(result.stderr ?? "")
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = /^\[DEBUG-storage-profile\] ([a-z-]+) (\d{1,9})$/.exec(
        line,
      );
      return match ? [{ name: match[1], elapsedMs: Number(match[2]) }] : [];
    })
    .slice(0, 16);
  const finished = phases.find((phase) => phase.name === "script-finished");
  report.observations.push({
    sample,
    operation: initialization ? "initialize" : "check",
    elapsedMs,
    exitCode: result.status,
    timedOut: result.error?.code === "ETIMEDOUT",
    signaled: Boolean(result.signal),
    phases,
    ...(finished
      ? { outsideMeasuredScriptMs: Math.max(0, elapsedMs - finished.elapsedMs) }
      : {}),
  });
  persist();
  return result;
};
syncBuiltinESMExports();
try {
  for (sample = 1; sample <= 4; sample++) {
    const directory = realpathSync(
      mkdtempSync(join(tmpdir(), "aios-storage-profile-")),
    );
    try {
      initializeWindowsAuthDirectory(directory);
      // Independently exercise the existing strict native ACL observation.
      windowsAuthStore(directory);
    } finally {
      // Only this newly created, empty synthetic setup directory is removed.
      rmSync(directory, { recursive: true, force: true });
    }
  }
  report.outcome = "observed";
} catch {
  report.outcome = "refused";
  process.exitCode = 1;
} finally {
  cp.spawnSync = original;
  syncBuiltinESMExports();
  report.finishedAt = new Date().toISOString();
  persist();
  console.log(
    JSON.stringify({
      outcome: report.outcome,
      observations: report.observations.length,
      productionEnabled: false,
    }),
  );
}
