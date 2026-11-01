import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const shells = new Set(["sh", "bash", "zsh", "shell", "powershell", "pwsh"]);

function markdown(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return markdown(path);
    return entry.name.endsWith(".md") ? [path] : [];
  });
}

// Lines inside shell fences that carry a `<placeholder>`.
function placeholders(path) {
  const found = [];
  let fence;
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((line, index) => {
      const opening = /^\s*```(\S*)/.exec(line);
      if (opening) {
        fence = fence === undefined ? opening[1] : undefined;
        return;
      }
      if (shells.has(fence) && /<[A-Za-z][^<>]*>/.test(line))
        found.push(`${relative(root, path)}:${index + 1}: ${line.trim()}`);
    });
  return found;
}

// Owners paste these commands as they are: zsh reads `<` as a redirect,
// PowerShell refuses it, and inside quotes it becomes a literal path. A value
// the owner supplies is a named variable that the fence checks before use.
test("owner-facing shell commands name their inputs as variables, not <placeholders>", () => {
  const files = [join(root, "README.md"), ...markdown(join(root, "docs"))];
  assert.deepEqual(files.flatMap(placeholders), []);
});

// A guest program change invalidates every owner admission record that pins
// it, so it must not land without the owner hosts table naming it.
test("the owner hosts table names the current guest program digests", async () => {
  const admitted = (guest) =>
    new RegExp(`^\\| ${guest} +\\| \`([a-f0-9]{64})\` +\\|$`, "m").exec(
      readFileSync(join(root, "docs", "owner-hosts.md"), "utf8"),
    )?.[1];
  const coding = await import("../dist/podman-coding.js");
  const validation = await import("../dist/podman-validation.js");
  assert.deepEqual(
    {
      coding: admitted("Coding"),
      validation: admitted("Validation"),
    },
    {
      coding: coding.managementPolicySha256,
      validation: validation.managementPolicySha256,
    },
    "A guest program changed: the owner must re-pin that admission record on both hosts; then update docs/owner-hosts.md",
  );
});
