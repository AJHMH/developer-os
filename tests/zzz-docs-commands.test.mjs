import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;
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
