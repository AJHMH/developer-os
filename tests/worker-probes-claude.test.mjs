import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  boundaryProbeNames,
  boundaryProbeOutcomes,
  claudeCodingBoundaryProbe,
  claudeCodingBoundaryProbeNames,
  codingBoundaryProbe,
  codingBoundaryProbeNames,
} from "../dist/worker-probes.js";

// Claude Code's boundary probe (ADR 0008): Codex's coding probe with Claude's
// home, credentials and binary in their place.
const codexHome = ["codex-skills", "mcp-config", "hooks-rules-agents"];
const codingOnly = codingBoundaryProbeNames.slice(boundaryProbeNames.length);

test("the Claude probe is the shared probe with Claude's home in place of Codex's, plus the coding controls", () => {
  assert.deepEqual(claudeCodingBoundaryProbeNames, [
    ...boundaryProbeNames.filter((name) => !codexHome.includes(name)),
    "claude-config",
    ...codingOnly,
  ]);
  assert.equal(/[\u0000-\u001f\u007f]/.test(claudeCodingBoundaryProbe), false);
  for (const name of claudeCodingBoundaryProbeNames)
    assert.match(
      claudeCodingBoundaryProbe,
      new RegExp(`; r ${name} '[^']*'(;|$)`),
    );
  assert.match(claudeCodingBoundaryProbe, /mode="\$\{3-\}"/);
  assert.doesNotMatch(claudeCodingBoundaryProbe, /\/codex/);
  // Codex's probe is unchanged, and neither result passes for the other.
  assert.notEqual(claudeCodingBoundaryProbe, codingBoundaryProbe);
  assert.throws(
    () =>
      boundaryProbeOutcomes(
        codingBoundaryProbeNames.map((n) => `passed-${n}`).join("\n"),
        claudeCodingBoundaryProbeNames,
      ),
    /malformed/,
  );
});

/** Runs the Claude probe with `HOME`, the managed-settings folder and the
 * binary moved into a temporary root: only the paths change. */
function claude(
  t,
  mode,
  { home = {}, env = {}, managed = false, binary = true, mount = "ro" } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "aios-claude-probe-"));
  t.after(() => {
    spawnSync("chmod", ["-R", "u+w", root]);
    rmSync(root, { recursive: true, force: true });
  });
  mkdirSync(join(root, "home"));
  for (const [path, text] of Object.entries(home)) {
    mkdirSync(join(root, "home", path, ".."), { recursive: true });
    if (text === null) mkdirSync(join(root, "home", path), { recursive: true });
    else writeFileSync(join(root, "home", path), text);
  }
  if (managed) mkdirSync(join(root, "etc-claude-code"));
  if (binary) {
    writeFileSync(join(root, "claude"), "binary");
    spawnSync("chmod", ["0444", join(root, "claude")]);
  }
  writeFileSync(
    join(root, "mountinfo"),
    `40 30 0:50 /claude ${join(root, "claude")} ${mount},relatime - ext4 /dev/vda4 rw\n`,
  );
  const script = claudeCodingBoundaryProbe
    .replaceAll("/etc/claude-code", join(root, "etc-claude-code"))
    .replaceAll("/proc/self/mountinfo", join(root, "mountinfo"))
    .replaceAll("/claude;", join(root, "claude") + ";");
  const result = spawnSync(
    "/bin/sh",
    ["-c", script, "--", "/nonexistent", "/nonexistent", mode],
    {
      encoding: "utf8",
      timeout: 30000,
      env: { PATH: process.env.PATH, HOME: join(root, "home"), ...env },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  return Object.fromEntries(
    boundaryProbeOutcomes(result.stdout, claudeCodingBoundaryProbeNames).map(
      (p) => [p.name, p.outcome],
    ),
  );
}

test("a home or host holding Claude Code settings, memory or extensions fails the probe", (t) => {
  assert.equal(claude(t, "offline")["claude-config"], "passed");
  // What a turn itself leaves in its home is not configuration.
  assert.equal(
    claude(t, "offline", {
      home: { ".claude.json": "{}", "projects/x/s.jsonl": "{}\n" },
    })["claude-config"],
    "passed",
  );
  for (const [path, text] of [
    ["settings.json", "{}"],
    ["settings.local.json", "{}"],
    ["managed-settings.json", "{}"],
    ["CLAUDE.md", "x"],
    ["CLAUDE.local.md", "x"],
    ["agents", null],
    ["commands", null],
    ["skills", null],
    ["hooks", null],
    ["plugins", null],
    ["output-styles", null],
    ["rules", null],
    [".mcp.json", "{}"],
    [".claude", null],
    [".env", "x"],
  ])
    assert.equal(
      claude(t, "offline", { home: { [path]: text } })["claude-config"],
      "failed",
      path,
    );
  assert.equal(
    claude(t, "offline", { managed: true })["claude-config"],
    "failed",
  );
  // Claude Code's own built-in plugin state is the only thing its plugins
  // folder may hold.
  assert.equal(
    claude(t, "offline", { home: { "plugins/store/builtin.json": "{}" } })[
      "claude-config"
    ],
    "passed",
  );
  for (const home of [
    { plugins: null },
    { "plugins/store": null, "plugins/cache": null },
    { "plugins/installed_plugins.json": "{}" },
  ])
    assert.equal(
      claude(t, "offline", { home })["claude-config"],
      "failed",
      JSON.stringify(home),
    );
});

test("a routed worker holds only the relay capability, and an offline one no Anthropic credential", (t) => {
  const token = { ANTHROPIC_AUTH_TOKEN: "c".repeat(64) };
  assert.equal(claude(t, "offline")["credential-env"], "passed");
  assert.equal(claude(t, "routed", { env: token })["credential-env"], "passed");
  assert.equal(claude(t, "routed")["credential-env"], "failed");
  assert.equal(
    claude(t, "routed", { env: { ANTHROPIC_AUTH_TOKEN: "" } })[
      "credential-env"
    ],
    "failed",
  );
  assert.equal(
    claude(t, "offline", { env: token })["credential-env"],
    "failed",
  );
  for (const name of [
    "ANTHROPIC_API_KEY",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "AWS_BEARER_TOKEN_BEDROCK",
    "OPENAI_API_KEY",
    "GITHUB_TOKEN",
  ])
    for (const mode of ["offline", "routed"])
      assert.equal(
        claude(t, mode, { env: { ...token, [name]: "synthetic" } })[
          "credential-env"
        ],
        "failed",
        `${mode} ${name}`,
      );
  // Any other mode is never a pass.
  assert.equal(claude(t, "", { env: token })["credential-env"], "failed");
});

test("the Claude binary is mounted read-only and refuses writes", (t) => {
  assert.equal(claude(t, "offline")["read-only-binaries"], "passed");
  assert.equal(
    claude(t, "offline", { mount: "rw" })["read-only-binaries"],
    "failed",
  );
  assert.equal(
    claude(t, "offline", { binary: false })["read-only-binaries"],
    "failed",
  );
});
