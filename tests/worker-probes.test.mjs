import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  boundaryProbe,
  boundaryProbeNames,
  boundaryProbeOutcomes,
} from "../dist/worker-probes.js";

const posix = {
  skip: process.platform === "win32" ? "The probe is a POSIX script" : false,
};

function run(t, { admitted = true, privateReadable = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "aios-worker-probe-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const admittedPath = join(root, "index.html");
  const privatePath = join(root, "authority.json");
  if (admitted) writeFileSync(admittedPath, "<h1>Contact</h1>\n");
  if (privateReadable) writeFileSync(privatePath, "{}\n");
  const result = spawnSync(
    "/bin/sh",
    ["-c", boundaryProbe, "--", admittedPath, privatePath],
    { encoding: "utf8", timeout: 30000, env: { PATH: process.env.PATH } },
  );
  assert.equal(result.status, 0, result.stderr);
  return Object.fromEntries(
    boundaryProbeOutcomes(result.stdout).map((p) => [p.name, p.outcome]),
  );
}

test("the probe prints exactly one verdict per probe, in order", posix, (t) => {
  const outcomes = run(t);
  assert.deepEqual(Object.keys(outcomes), [...boundaryProbeNames]);
});

test("the probe's own controls detect what they look for", posix, (t) => {
  // The admitted file is the positive control: it must be seen when present.
  assert.equal(run(t)["admitted-visible"], "passed");
  assert.equal(run(t, { admitted: false })["admitted-visible"], "failed");
  // A readable guest-private file is a failure, not a pass.
  assert.equal(run(t)["guest-private"], "passed");
  assert.equal(run(t, { privateReadable: true })["guest-private"], "failed");
});

test("a credential in the environment fails the probe", posix, (t) => {
  const root = mkdtempSync(join(tmpdir(), "aios-worker-probe-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const name of ["SSH_AUTH_SOCK", "GITHUB_TOKEN", "OPENAI_API_KEY"]) {
    const result = spawnSync(
      "/bin/sh",
      ["-c", boundaryProbe, "--", "/nonexistent", "/nonexistent"],
      {
        encoding: "utf8",
        env: { PATH: process.env.PATH, [name]: "synthetic" },
      },
    );
    const outcomes = boundaryProbeOutcomes(result.stdout);
    assert.equal(
      outcomes.find((p) => p.name === "credential-env").outcome,
      "failed",
      name,
    );
  }
});

test("output that is not exactly the probe's verdicts is refused", () => {
  const passing = boundaryProbeNames.map((n) => `passed-${n}`);
  assert.equal(
    boundaryProbeOutcomes(passing.join("\n") + "\n").every(
      (p) => p.outcome === "passed",
    ),
    true,
  );
  for (const output of [
    "",
    passing.slice(1).join("\n"),
    [...passing, "passed-extra"].join("\n"),
    [passing[1], passing[0], ...passing.slice(2)].join("\n"),
    passing.join("\n").replace("passed-tools", "skipped-tools"),
  ])
    assert.throws(() => boundaryProbeOutcomes(output), /malformed/);
});

test("the probe fits a validation check's argument bounds", () => {
  assert.ok(boundaryProbe.length <= 2000);
  assert.equal(/[\u0000-\u001f\u007f]/.test(boundaryProbe), false);
});

test("each probe is one shell word, so no probe body can break out of it", () => {
  for (const name of boundaryProbeNames)
    assert.match(boundaryProbe, new RegExp(`; r ${name} '[^']*'(;|$)`));
});

test(
  "the worker's home may hold only Codex's own bundled skills",
  posix,
  (t) => {
    const outcomes = (layout) => {
      const home = mkdtempSync(join(tmpdir(), "aios-worker-probe-home-"));
      t.after(() => rmSync(home, { recursive: true, force: true }));
      for (const [path, text] of Object.entries(layout)) {
        mkdirSync(join(home, path, ".."), { recursive: true });
        if (text === null) mkdirSync(join(home, path), { recursive: true });
        else writeFileSync(join(home, path), text);
      }
      const result = spawnSync(
        "/bin/sh",
        ["-c", boundaryProbe, "--", "/nonexistent", "/nonexistent"],
        { encoding: "utf8", env: { PATH: process.env.PATH, HOME: home } },
      );
      return Object.fromEntries(
        boundaryProbeOutcomes(result.stdout).map((p) => [p.name, p.outcome]),
      );
    };
    const empty = outcomes({});
    assert.equal(empty["codex-skills"], "passed");
    assert.equal(empty["mcp-config"], "passed");
    assert.equal(empty["hooks-rules-agents"], "passed");
    // What Codex regenerates on every start.
    assert.equal(
      outcomes({ "skills/.system": null })["codex-skills"],
      "passed",
    );
    assert.equal(
      outcomes({ "skills/.system": null, "skills/extra": null })[
        "codex-skills"
      ],
      "failed",
    );
    assert.equal(outcomes({ "skills/owner": null })["codex-skills"], "failed");
    assert.equal(
      outcomes({ "config.toml": "[mcp_servers.x]\n" })["mcp-config"],
      "failed",
    );
    assert.equal(
      outcomes({ "config.toml": "model = 'x'\n" })["mcp-config"],
      "passed",
    );
    for (const file of [
      "hooks.json",
      "rules",
      "AGENTS.md",
      "AGENTS.override.md",
    ])
      assert.equal(
        outcomes({ [file]: "x" })["hooks-rules-agents"],
        "failed",
        file,
      );
  },
);
