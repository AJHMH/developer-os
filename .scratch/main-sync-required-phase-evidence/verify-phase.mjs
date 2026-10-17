import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const root = mkdtempSync(join(tmpdir(), "phase-evidence-control-"));
try {
  const repo = join(root, "repo"),
    remote = join(root, "remote");
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !k.toUpperCase().startsWith("GIT_"),
    ),
  );
  Object.assign(env, {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
  });
  const run = (args) =>
    spawnSync("git", args, { env, encoding: "utf8", timeout: 5000 });
  for (const args of [
    ["init", "--initial-branch=main", repo],
    ["init", "--bare", remote],
    [
      "-C",
      repo,
      "-c",
      "user.name=Control",
      "-c",
      "user.email=control@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--allow-empty",
      "-m",
      "control",
    ],
  ]) {
    const r = run(args);
    assert.equal(r.status, 0, r.stderr);
  }
  const script = join(root, "observe.mjs");
  writeFileSync(
    script,
    `import {observedFixturePush} from ${JSON.stringify(pathToFileURL(resolve("tests/helpers/git-phase-evidence.mjs")).href)};const result=observedFixturePush('git',JSON.parse(process.argv[2]),{env:process.env,encoding:'utf8',timeout:5000});console.log(JSON.stringify({status:result.status,error:result.error?.code??null}));`,
  );
  for (const [branch, status, missing] of [
    ["main", 0, false],
    ["refs/heads/private-missing", 1, false],
    ["main", 0, true],
  ]) {
    const result = spawnSync(
      process.execPath,
      [script, JSON.stringify(["-C", repo, "push", remote, branch])],
      {
        encoding: "utf8",
        timeout: 15000,
        env: missing
          ? {
              ...env,
              TMPDIR: join(root, "absent"),
              TMP: join(root, "absent"),
              TEMP: join(root, "absent"),
            }
          : env,
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, status);
    const line = result.stderr
      .split(/\r?\n/)
      .find((s) => s.startsWith("[main-sync-trace2] "));
    assert.ok(line);
    const record = JSON.parse(line.slice("[main-sync-trace2] ".length));
    assert.equal(record.status, status);
    assert.equal(record.timeoutMs, 5000);
    assert.equal(record.cleanupFailed, false);
    assert.equal(record.traceAvailable, !missing);
    if (!missing) {
      assert.equal(record.malformedLines, 0);
      assert.ok(
        record.events.some((e) => e.event === "exit" && e.code === status),
      );
    }
    assert.ok(!line.includes(root));
    assert.ok(!JSON.stringify(record).includes(branch));
  }
  console.log(
    "PASS: real Git success/refusal and unavailable trace directory preserve native results, deadline and private values",
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
