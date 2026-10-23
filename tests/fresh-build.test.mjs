import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { freshBuild } from "../scripts/fresh-build.mjs";

const repository = fileURLToPath(new URL("..", import.meta.url));

/** A tiny TypeScript checkout whose dist/ is compiled from its src/. */
function checkout(t) {
  const root = mkdtempSync(join(tmpdir(), "aios-fresh-build-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "src", "nested"), { recursive: true });
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2023",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        rootDir: "src",
        outDir: "dist",
        declaration: true,
        sourceMap: true,
        types: [],
      },
      include: ["src/**/*.ts"],
    }),
  );
  writeFileSync(join(root, "src", "a.ts"), "export const a: number = 1;\n");
  writeFileSync(
    join(root, "src", "nested", "b.ts"),
    'export const b: string = "b";\n',
  );
  const tsc = join(repository, "node_modules", "typescript", "bin", "tsc");
  const built = spawnSync(process.execPath, [tsc, "-p", root], {
    encoding: "utf8",
  });
  assert.equal(built.status, 0, built.stdout);
  return root;
}

test("a dist/ compiled from the current src/ is fresh and digested", (t) => {
  const root = checkout(t);
  const first = freshBuild(root);
  assert.match(first.distSha256, /^[a-f0-9]{64}$/);
  assert.equal(first.buildFresh, true);
  assert.equal(
    first.freshBuildSha256,
    createHash("sha256")
      .update(readFileSync(join(repository, "scripts", "fresh-build.mjs")))
      .digest("hex"),
  );
  // Leftovers from deleted sources never run, so they are ignored.
  writeFileSync(join(root, "dist", "deleted.js"), "export {};\n");
  assert.deepEqual(freshBuild(root), first);
});

test("a dist/ that is not what src/ compiles to is refused", (t) => {
  for (const [name, change] of [
    [
      "changed source",
      (root) =>
        writeFileSync(join(root, "src", "a.ts"), "export const a = 2;\n"),
    ],
    [
      "new source",
      (root) => writeFileSync(join(root, "src", "c.ts"), "export {};\n"),
    ],
    [
      "edited output",
      (root) =>
        writeFileSync(
          join(root, "dist", "nested", "b.js"),
          'export const b = "x";\n',
        ),
    ],
    ["missing output", (root) => rmSync(join(root, "dist", "a.js"))],
    ["missing dist", (root) => rmSync(join(root, "dist"), { recursive: true })],
  ]) {
    const root = checkout(t);
    change(root);
    assert.throws(
      () => freshBuild(root),
      /dist\/ was not built from the current src\/; run npm run build/,
      name,
    );
  }
});

test("source that does not compile is refused", (t) => {
  const root = checkout(t);
  writeFileSync(join(root, "src", "a.ts"), "export const a: number = 'x';\n");
  assert.throws(() => freshBuild(root), /src\/ does not compile/);
});

test("the check compiles into a private folder and leaves the checkout untouched", (t) => {
  const root = checkout(t);
  const before = readFileSync(join(root, "dist", "a.js"));
  writeFileSync(join(root, "src", "a.ts"), "export const a = 3;\n");
  assert.throws(() => freshBuild(root));
  assert.deepEqual(readFileSync(join(root, "dist", "a.js")), before);
  assert.equal(existsSync(join(root, "tsconfig.tsbuildinfo")), false);
});

// Each runner's well-formed arguments, given the record and report paths.
const runners = {
  "run-native-coding-acceptance.mjs": (_record, report) => [
    "aios-test",
    report,
  ],
  "run-native-coding-admission-acceptance.mjs": (record, report) => [
    "aios-test",
    record,
    report,
  ],
  "run-native-validation-admission-acceptance.mjs": (record, report) => [
    "aios-test",
    record,
    "a".repeat(64),
    report,
  ],
};

for (const [runner, argumentsOf] of Object.entries(runners))
  test(`${runner} refuses a stale build before any effect`, (t) => {
    const root = checkout(t);
    mkdirSync(join(root, "scripts"));
    for (const file of [runner, "fresh-build.mjs"])
      copyFileSync(
        join(repository, "scripts", file),
        join(root, "scripts", file),
      );
    symlinkSync(
      join(repository, "node_modules"),
      join(root, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
    writeFileSync(join(root, "src", "a.ts"), "export const a = 4;\n");
    const report = join(root, "report.json");
    const args = argumentsOf(join(root, "r.json"), report);
    const result = spawnSync(
      process.execPath,
      [join(root, "scripts", runner), ...args, "--approve-offline-native-run"],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /run npm run build/);
    // Refused before the report, the record or any transport is touched.
    assert.equal(existsSync(report), false);
  });
