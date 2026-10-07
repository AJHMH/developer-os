import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const cli = resolve("dist/cli.js");

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "aios-ticket-01-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, "repository");
  mkdirSync(repository);
  writeFileSync(join(repository, "owner.txt"), "Preserve this work.");
  return { root, repository, state: join(root, "state") };
}

function invoke(state, ...args) {
  return spawnSync(process.execPath, [cli, ...args, "--state-dir", state], {
    encoding: "utf8",
    timeout: 10_000,
  });
}

test("a feature request has durable blocked status without touching the repository", (t) => {
  const f = fixture(t);
  const started = invoke(
    f.state,
    "start",
    "--repo",
    f.repository,
    "--request",
    "Add a visible contact hint.",
    "--issue",
    "https://github.com/AJHMH/profile-page/issues/42",
  );
  assert.equal(started.status, 0, started.stderr);
  const delivery = JSON.parse(started.stdout);
  assert.match(delivery.id, /^[0-9a-f-]{36}$/);
  assert.equal(delivery.phase, "blocked");
  assert.equal(delivery.request, "Add a visible contact hint.");
  assert.equal(delivery.repository, f.repository);
  assert.equal(
    delivery.issue,
    "https://github.com/AJHMH/profile-page/issues/42",
  );
  assert.equal(delivery.blocker.code, "DELIVERY_NOT_ENABLED");
  assert.match(delivery.blocker.nextAction, /onboarding/i);
  const reopened = invoke(f.state, "status", "--id", delivery.id);
  assert.equal(reopened.status, 0, reopened.stderr);
  assert.deepEqual(JSON.parse(reopened.stdout), delivery);
  const evidence = JSON.parse(readFileSync(delivery.evidence[0].path, "utf8"));
  assert.equal(evidence.deliveryId, delivery.id);
  assert.equal(evidence.request, "Add a visible contact hint.");
  assert.deepEqual(readdirSync(f.repository), ["owner.txt"]);
  assert.equal(
    readFileSync(join(f.repository, "owner.txt"), "utf8"),
    "Preserve this work.",
  );
});

test("malformed requests create no delivery and leave the target untouched", (t) => {
  const f = fixture(t);
  const invalidRequests = [
    ["start", "--repo", f.repository, "--request", "Valid text", "unexpected"],
    ["start", "--repo", f.repository, "--request", "   "],
    ["start", "--repo", "relative-path", "--request", "Valid text"],
    ["start", "--repo", join(f.root, "missing"), "--request", "Valid text"],
    [
      "start",
      "--repo",
      f.repository,
      "--request",
      "Valid text",
      "--id",
      "unexpected",
    ],
    [
      "start",
      "--repo",
      f.repository,
      "--request",
      "Valid text",
      "--issue",
      "   ",
    ],
  ];
  for (const args of invalidRequests) {
    const result = invoke(f.state, ...args);
    assert.equal(result.status, 1, result.stdout);
    assert.match(
      JSON.parse(
        result.stderr
          .trim()
          .split("\n")
          .find((line) => line.startsWith("{")),
      ).error,
      /.+/,
    );
  }
  const inventory = invoke(f.state, "status");
  assert.equal(inventory.status, 0, inventory.stderr);
  assert.deepEqual(JSON.parse(inventory.stdout), { deliveries: [] });
  assert.deepEqual(readdirSync(f.repository), ["owner.txt"]);
});

test("status and request evidence retain useful context without credential canaries", (t) => {
  const f = fixture(t);
  const token = "synthetic-token-canary-924";
  const password = "synthetic-password-canary-713";
  const key = "synthetic-key-canary-482";
  const started = invoke(
    f.state,
    "start",
    "--repo",
    f.repository,
    "--request",
    `Add a contact hint. token=${token} password: "${password}"\n-----BEGIN PRIVATE KEY-----\n${key}\n-----END PRIVATE KEY-----`,
    "--issue",
    `https://person:${password}@github.com/AJHMH/profile-page/issues/42?token=${token}`,
  );
  assert.equal(started.status, 0, started.stderr);
  const delivery = JSON.parse(started.stdout);
  const reopened = invoke(f.state, "status", "--id", delivery.id);
  const inventory = invoke(f.state, "status");
  const evidence = readFileSync(delivery.evidence[0].path, "utf8");
  for (const output of [
    started.stdout,
    started.stderr,
    reopened.stdout,
    reopened.stderr,
    inventory.stdout,
    evidence,
  ]) {
    for (const canary of [token, password, key])
      assert.equal(output.includes(canary), false, "credential canary leaked");
  }
  assert.match(delivery.request, /Add a contact hint/);
  assert.match(delivery.request, /\[REDACTED\]/);
  assert.match(delivery.issue, /github\.com\/AJHMH\/profile-page\/issues\/42/);
  const malformed = invoke(f.state, "start", `--${token}`);
  assert.equal(malformed.status, 1);
  assert.equal(
    malformed.stderr.includes(token),
    false,
    "parser error echoed untrusted input",
  );
});

test("delivery state cannot be placed inside the target repository", (t) => {
  const f = fixture(t);
  const result = invoke(
    join(f.repository, "controller-state"),
    "start",
    "--repo",
    f.repository,
    "--request",
    "Add a contact hint.",
  );
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /outside.*repository/i);
  assert.deepEqual(readdirSync(f.repository), ["owner.txt"]);
});

test("linked artifact storage cannot redirect a request into the target repository", (t) => {
  const f = fixture(t);
  mkdirSync(f.state);
  symlinkSync(
    f.repository,
    join(f.state, "artifacts"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const result = invoke(
    f.state,
    "start",
    "--repo",
    f.repository,
    "--request",
    "Add a contact hint.",
  );
  assert.equal(result.status, 1, result.stdout);
  assert.deepEqual(readdirSync(f.repository), ["owner.txt"]);
});

test("authorization schemes do not leave their credential in request evidence", (t) => {
  const f = fixture(t);
  const credential = "Q2FuYXJ5QmFzaWNBdXRo";
  const started = invoke(
    f.state,
    "start",
    "--repo",
    f.repository,
    "--request",
    `Add a contact hint. authorization=Basic ${credential}`,
  );
  assert.equal(started.status, 0, started.stderr);
  const delivery = JSON.parse(started.stdout);
  const reopened = invoke(f.state, "status", "--id", delivery.id);
  const artifact = readFileSync(delivery.evidence[0].path, "utf8");
  for (const output of [started.stdout, reopened.stdout, artifact])
    assert.equal(output.includes(credential), false);
  assert.match(delivery.request, /Add a contact hint/);
});
