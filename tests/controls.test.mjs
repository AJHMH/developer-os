import "./helpers/owner-host-stand-in.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { realpathSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeliveryController } from "../dist/controller.js";
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "aios-controls-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "repo");
  mkdirSync(repository);
  const state = join(root, "state");
  return { root, repository, state, controller: new DeliveryController(state) };
}
test("repository ownership queues later requests and is retained across restart and independent repositories", (t) => {
  const f = fixture(t);
  const first = f.controller.start({
    repository: f.repository,
    request: "First feature",
  });
  const reopened = new DeliveryController(f.state);
  const second = reopened.start({
    repository: f.repository,
    request: "Second feature",
  });
  assert.equal(first.ownership.held, true);
  assert.equal(second.phase, "queued");
  assert.equal(second.ownership.held, false);
  const other = join(f.root, "other");
  mkdirSync(other);
  const independent = reopened.start({
    repository: other,
    request: "Independent feature",
  });
  assert.equal(independent.ownership.held, true);
  assert.equal(reopened.status(first.id).phase, "blocked");
});

test("pause, resume and cancel preserve work and require an explicit safe release before advancing the queue", async (t) => {
  const f = fixture(t);
  const first = f.controller.start({
    repository: f.repository,
    request: "Preserve feature",
  });
  const second = f.controller.start({
    repository: f.repository,
    request: "Next feature",
  });
  const paused = await f.controller.pause(first.id);
  assert.equal(paused.phase, "paused");
  assert.equal(paused.priorPhase, "blocked");
  assert.equal(paused.ownership.held, true);
  const resumed = await new DeliveryController(f.state).resume(first.id);
  assert.equal(resumed.phase, "blocked");
  assert.equal(resumed.request, "Preserve feature");
  const cancelled = await f.controller.cancel(first.id);
  assert.equal(cancelled.phase, "cancelled");
  assert.equal(f.controller.status(second.id).phase, "queued");
  assert.throws(() => f.controller.resume(first.id), /cancelled/i);
  f.controller.release(first.id);
  assert.equal(f.controller.status(first.id).ownership.held, false);
  assert.equal(f.controller.status(second.id).ownership.held, true);
  assert.equal(f.controller.status(second.id).phase, "blocked");
});

import { writeFileSync, readFileSync } from "node:fs";
const healthyUsage = async () => ({
  observedAt: new Date().toISOString(),
  accountId: "controlled-owner",
  authMode: "chatgpt",
  exhausted: false,
  windows: [
    {
      id: "weekly",
      usedPercent: 4,
      resetsAt: Math.floor(Date.now() / 1000) + 86400,
    },
  ],
});
function readyFixture(t, worker, subscription = healthyUsage) {
  const f = fixture(t);
  const policyPath = join(f.root, "policy.json");
  writeFileSync(
    policyPath,
    JSON.stringify({
      repository: "AJHMH/profile-page",
      defaultBranch: "main",
      factoryCommit: "a".repeat(40),
      approver: "aaron-howard",
      appLogin: "factory[bot]",
      publicationLogin: "aaron-howard",
      requiredChecks: ["lint"],
      validation: ["isolated-node"],
    }),
  );
  const inspect = () => ({
    localRepository: "AJHMH/profile-page",
    localDefaultBranch: "main",
    repository: "AJHMH/profile-page",
    defaultBranch: "main",
    factoryCommit: "a".repeat(40),
    appLogin: "factory[bot]",
    appRepositoryAccess: true,
    eligibleApprovers: ["aaron-howard"],
    protectionsEnforced: true,
    forcePushBlocked: true,
    signedCommitsRequired: true,
    everyPullRequestReviewRequired: false,
    requiredChecks: ["lint"],
    trustedCheckPublishers: true,
    publicationLogin: "aaron-howard",
    publicationAccess: true,
    localSignature: {
      commit: "b".repeat(40),
      valid: true,
      login: "aaron-howard",
    },
    githubSignature: {
      commit: "b".repeat(40),
      valid: true,
      login: "aaron-howard",
    },
    validation: ["isolated-node"],
  });
  f.options = { policyPath, inspect };
  f.controller = new DeliveryController(f.state, f.options, {
    worker,
    subscription,
  });
  return f;
}
const receipt = (session, status) => ({ ...session, status });
import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
const cli = resolve("dist/cli.js");
function invoke(f, ...args) {
  return spawnSync(process.execPath, [cli, ...args, "--state-dir", f.state], {
    encoding: "utf8",
    timeout: 10000,
  });
}
test("public CLI pause/resume/cancel/release/recover address explicit delivery IDs and preserve blocked state", (t) => {
  const f = fixture(t);
  const started = invoke(
    f,
    "start",
    "--repo",
    f.repository,
    "--request",
    "CLI feature",
  );
  assert.equal(started.status, 0, started.stderr);
  const id = JSON.parse(started.stdout).id;
  for (const [command, phase] of [
    ["pause", "paused"],
    ["recover", "paused"],
    ["resume", "blocked"],
    ["cancel", "cancelled"],
    ["recover", "cancelled"],
    ["release", "cancelled"],
  ]) {
    const response = invoke(f, command, "--id", id);
    assert.equal(response.status, 0, response.stderr);
    assert.equal(JSON.parse(response.stdout).phase, phase);
  }
  assert.equal(
    JSON.parse(invoke(f, "status", "--id", id).stdout).ownership.held,
    false,
  );
  const missing = invoke(f, "pause");
  assert.equal(missing.status, 1);
  const invalid = invoke(
    f,
    "cancel",
    "--id",
    id,
    "--request",
    "password=cli-canary",
  );
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stderr.includes("cli-canary"), false);
});

test("competing CLI processes admit exactly one owner for the same repository", async (t) => {
  const f = fixture(t);
  const submit = (request) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [
        cli,
        "start",
        "--repo",
        f.repository,
        "--request",
        request,
        "--state-dir",
        f.state,
      ]);
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (data) => (stdout += data));
      child.stderr.on("data", (data) => (stderr += data));
      child.on("error", reject);
      child.on("close", (code) => {
        try {
          assert.equal(code, 0, stderr);
          resolve(JSON.parse(stdout));
        } catch (error) {
          reject(error);
        }
      });
    });
  const deliveries = await Promise.all([
    submit("First concurrent feature"),
    submit("Second concurrent feature"),
  ]);
  assert.deepEqual(deliveries.map((d) => d.phase).sort(), [
    "blocked",
    "queued",
  ]);
  assert.equal(deliveries.filter((d) => d.ownership.held).length, 1);
  const owner = deliveries.find((d) => d.ownership.held);
  await f.controller.pause(owner.id);
  assert.equal(
    f.controller.list().deliveries.filter((d) => d.ownership.held).length,
    1,
  );
});

import { pathToFileURL } from "node:url";
test("verified clones of one canonical repository share delivery ownership", (t) => {
  const f = readyFixture(t, { qualified: () => true });
  const first = f.controller.start({
    repository: f.repository,
    request: "Original clone feature",
  });
  const clone = join(f.root, "clone");
  mkdirSync(clone);
  const second = f.controller.start({
    repository: clone,
    request: "Other clone feature",
  });
  assert.equal(first.ownership.held, true);
  assert.equal(second.phase, "queued");
  assert.equal(second.ownership.held, false);
});

test("resuming a paused queued request acquires a safely released empty repository", async (t) => {
  const f = fixture(t);
  const first = f.controller.start({
    repository: f.repository,
    request: "Owner",
  });
  const second = f.controller.start({
    repository: f.repository,
    request: "Queued",
  });
  await f.controller.pause(second.id);
  await f.controller.cancel(first.id);
  f.controller.release(first.id);
  const resumed = f.controller.resume(second.id);
  assert.equal(resumed.phase, "blocked");
  assert.equal(resumed.ownership.held, true);
});

import { DatabaseSync } from "node:sqlite";
test("resuming a released paused owner queues behind the current repository owner", async (t) => {
  const f = fixture(t);
  const first = f.controller.start({
    repository: f.repository,
    request: "Released paused feature",
  });
  const second = f.controller.start({
    repository: f.repository,
    request: "Current owner",
  });
  await f.controller.pause(first.id);
  f.controller.release(first.id);
  assert.equal(f.controller.status(second.id).ownership.held, true);
  const resumed = f.controller.resume(first.id);
  assert.equal(resumed.phase, "queued");
  assert.equal(resumed.ownership.held, false);
  await f.controller.cancel(second.id);
  f.controller.release(second.id);
  assert.equal(f.controller.status(first.id).ownership.held, true);
  assert.equal(
    f.controller.status(first.id).request,
    "Released paused feature",
  );
});
test("legacy intake ledger migration preserves requests and assigns conservative ownership through public status", (t) => {
  const f = fixture(t);
  mkdirSync(f.state);
  mkdirSync(join(f.state, "artifacts"));
  // Fixture represents the published v1 ledger; observations use only controller status/list.
  const legacy = new DatabaseSync(join(f.state, "deliveries.sqlite"));
  legacy.exec(
    "CREATE TABLE deliveries(id TEXT PRIMARY KEY, document TEXT NOT NULL); PRAGMA user_version=1;",
  );
  const ids = [
    "00000000-0000-0000-0000-000000000001",
    "00000000-0000-0000-0000-000000000002",
  ];
  for (const [index, id] of ids.entries()) {
    const artifact = join(f.state, "artifacts", `${id}.json`);
    writeFileSync(
      artifact,
      JSON.stringify({
        deliveryId: id,
        request: index === 0 ? "Legacy first" : "Legacy second",
      }),
    );
    legacy.prepare("INSERT INTO deliveries VALUES (?,?)").run(
      id,
      JSON.stringify({
        id,
        repository: f.repository,
        request: index === 0 ? "Legacy first" : "Legacy second",
        phase: "blocked",
        issue: null,
        createdAt: "2026-10-07T00:00:00.000Z",
        blocker: {
          code: "DELIVERY_NOT_ENABLED",
          message: "Intake only",
          nextAction: "Complete onboarding",
        },
        evidence: [{ kind: "request", path: artifact }],
      }),
    );
  }
  legacy.close();
  const reopened = new DeliveryController(f.state);
  const first = reopened.status(ids[0]);
  const second = reopened.status(ids[1]);
  assert.equal(first.request, "Legacy first");
  assert.equal(first.ownership.held, true);
  assert.equal(first.onboarding.ready, false);
  assert.equal(second.request, "Legacy second");
  assert.equal(second.phase, "queued");
  assert.equal(second.ownership.held, false);
  assert.equal(
    readFileSync(first.evidence[0].path, "utf8").includes("Legacy first"),
    true,
  );
});
