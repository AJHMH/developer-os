import assert from "node:assert/strict";
import { test } from "node:test";
import { runWindowsQualification } from "../scripts/run-windows-qualification.mjs";
import { readWindowsQualificationManifest } from "../scripts/run-windows-qualification.mjs";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const names = [
  "controls",
  "authStatus",
  "prepareInference",
  "inference",
  "capability",
  "task",
  "online",
  "report",
];
const manifest = {
  stateDirectory: "/state",
  steps: Object.fromEntries(
    names.map((name) => [
      name,
      { script: "/fake.mjs", args: [name], sha256: "a".repeat(64) },
    ]),
  ),
};
test("Windows preparation stops at the inference approval boundary and keeps per-step arguments separate", async () => {
  const calls = [],
    events = [];
  const result = await runWindowsQualification(
    manifest,
    { phase: "prepare" },
    {
      platform: "win32",
      arch: "x64",
      run: async (step) => {
        calls.push(step);
        return 0;
      },
      announce: (event) => events.push(event),
    },
  );
  assert.equal(result, 0);
  assert.deepEqual(
    calls.map((c) => c.name),
    ["controls", "authStatus", "prepareInference"],
  );
  assert.deepEqual(
    calls.map((c) => c.args),
    [["controls"], ["authStatus"], ["prepareInference"]],
  );
  assert.equal(events.at(-1).status, "approval-required");
});
test("inference and online approvals are mandatory and forwarded only to their own stage", async () => {
  const calls = [];
  const adapters = {
    platform: "win32",
    arch: "x64",
    run: async (step) => {
      calls.push(step);
      return 0;
    },
    announce: () => {},
  };
  await assert.rejects(
    runWindowsQualification(manifest, { phase: "inference" }, adapters),
    /approval/,
  );
  await assert.rejects(
    runWindowsQualification(manifest, { phase: "complete" }, adapters),
    /approval/,
  );
  await assert.rejects(
    runWindowsQualification(
      manifest,
      { phase: "prepare", syntheticUsageApproved: true },
      adapters,
    ),
    /approval/,
  );
  assert.equal(calls.length, 0);
  const runId = "00000000-0000-4000-8000-000000000001";
  await runWindowsQualification(
    manifest,
    { phase: "inference", approveRun: runId, unknownUsageApproved: true },
    adapters,
  );
  assert.deepEqual(
    calls.map((c) => c.args),
    [
      ["authStatus"],
      [
        "inference",
        "--execute",
        "--approve-run",
        runId,
        "--approve-unknown-usage",
      ],
    ],
  );
  calls.length = 0;
  await runWindowsQualification(
    manifest,
    { phase: "complete", syntheticUsageApproved: true },
    adapters,
  );
  assert.deepEqual(
    calls.map((c) => c.args),
    [
      ["capability"],
      ["task"],
      ["online", "--approved-synthetic-unknown-usage"],
      ["report"],
    ],
  );
});
test("a refused prerequisite stops later stages and never retries", async () => {
  const calls = [],
    events = [];
  const result = await runWindowsQualification(
    manifest,
    {
      phase: "inference",
      approveRun: "00000000-0000-4000-8000-000000000001",
      unknownUsageApproved: true,
    },
    {
      platform: "win32",
      arch: "x64",
      run: async (step) => {
        calls.push(step.name);
        return 7;
      },
      announce: (event) => events.push(event),
    },
  );
  assert.equal(result, 7);
  assert.deepEqual(calls, ["authStatus"]);
  assert.equal(events.at(-1).status, "refused");
});
test("planning is portable and starts no child or state lock even without approval", async () => {
  let calls = 0;
  for (const phase of ["prepare", "inference", "complete"]) {
    assert.equal(
      await runWindowsQualification(
        manifest,
        { phase, planOnly: true },
        {
          platform: "linux",
          arch: "x64",
          run: async () => {
            calls++;
          },
          announce: () => {},
        },
      ),
      0,
    );
  }
  assert.equal(calls, 0);
});
test("operator manifests reject script drift and embedded approvals before execution", (t) => {
  const root = mkdtempSync(join(tmpdir(), "windows-plan-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = join(root, "fixture.mjs");
  const bytes = "process.exit(0);";
  writeFileSync(script, bytes);
  const hash = createHash("sha256").update(bytes).digest("hex");
  const value = {
    schema: 1,
    stateDirectory: root,
    steps: Object.fromEntries(
      names.map((name) => [name, { script, sha256: hash, args: [name] }]),
    ),
  };
  const cli = join(root, "cli.js");
  writeFileSync(cli, bytes);
  value.steps.authStatus = {
    script: cli,
    sha256: hash,
    args: [
      "auth-status",
      "--repo",
      root,
      "--state-dir",
      root,
      "--auth-directory",
      root,
      "--auth-account",
      "a".repeat(64),
    ],
  };
  const path = join(root, "manifest.json");
  writeFileSync(path, JSON.stringify(value));
  assert.equal(readWindowsQualificationManifest(path).schema, 1);
  const planned = spawnSync(
    process.execPath,
    [
      resolve("scripts/run-windows-qualification.mjs"),
      "--manifest",
      path,
      "--phase",
      "inference",
      "--plan",
    ],
    { encoding: "utf8" },
  );
  assert.equal(planned.status, 0, planned.stderr);
  assert.equal(
    JSON.parse(planned.stdout).approvalRequired,
    "exact-run-and-unknown-usage",
  );
  assert.equal(existsSync(join(root, ".native-acceptance.lock")), false);
  value.steps.inference.args.push("--approve-run");
  writeFileSync(path, JSON.stringify(value));
  assert.throws(() => readWindowsQualificationManifest(path), /Invalid step/);
  value.steps.inference.args.pop();
  writeFileSync(path, JSON.stringify(value));
  writeFileSync(script, "process.exit(1);");
  assert.throws(
    () => readWindowsQualificationManifest(path),
    /Changed operator script/,
  );
});
test("real child stages share the canonical acceptance lock and stop on script drift", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "windows-lock-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const script = join(root, "fixture.mjs");
  const bytes = "await new Promise(r=>setTimeout(r,100));";
  writeFileSync(script, bytes);
  const value = {
    stateDirectory: root,
    steps: Object.fromEntries(
      names.map((name) => [
        name,
        {
          script,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          args: [],
        },
      ]),
    ),
  };
  const events = [];
  const adapters = {
    platform: "win32",
    arch: "x64",
    announce: (event) => events.push(event),
  };
  const first = runWindowsQualification(value, { phase: "prepare" }, adapters);
  await assert.rejects(
    runWindowsQualification(value, { phase: "prepare" }, adapters),
  );
  assert.equal(await first, 0);
  assert.equal(existsSync(join(root, ".native-acceptance.lock")), false);
  writeFileSync(script, "process.exit(0);");
  events.length = 0;
  await assert.rejects(
    runWindowsQualification(value, { phase: "prepare" }, adapters),
    /Acceptance step unavailable/,
  );
  assert.deepEqual(
    events.map((e) => e.status),
    ["started", "refused"],
  );
  assert.equal(events.at(-1).stage, "controls");
  assert.equal(existsSync(join(root, ".native-acceptance.lock")), false);
});
