import assert from "node:assert/strict";
import fs from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pinImpactProblems } from "../scripts/check-pin-impact.mjs";
import { runWatched } from "../scripts/run-tests.mjs";

test("the test watchdog stops a silent run that ignores SIGTERM, and fails it", async () => {
  const started = performance.now();
  const code = await runWatched(
    process.execPath,
    ["-e", 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],
    300,
  );
  assert.equal(code, 1);
  assert.ok(performance.now() - started < 10000);
});

test("the test watchdog leaves a run alone while it has output", async () => {
  const code = await runWatched(
    process.execPath,
    [
      "-e",
      'let n=0;const t=setInterval(()=>{process.stdout.write("");console.error("");if(++n===6){clearInterval(t);process.exitCode=3}},200)',
    ],
    600,
  );
  assert.equal(
    code,
    3,
    "the run's own exit code, past the quiet limit overall",
  );
});

// A second default elsewhere is how `npm test` came to half-work on the Mac.
test("every test takes its interpreter from the shared helper", () => {
  const files = fs
    .readdirSync("tests", { recursive: true })
    .filter((file) => /\.m?js$/.test(file));
  const elsewhere = files.filter(
    (file) =>
      !file.endsWith("python.mjs") &&
      !file.endsWith("test-environment.test.mjs") &&
      /process\.env\.AIOS_TEST_PYTHON/.test(
        fs.readFileSync(join("tests", file), "utf8"),
      ),
  );
  assert.deepEqual(elsewhere, []);
});

const table = (coding, validation = "b".repeat(64)) =>
  `| Coding     | \`${coding}\` |\n| Validation | \`${validation}\` |\n`;
const [before, after] = ["a".repeat(64), "c".repeat(64)];

test("a moved guest digest needs a Pin impact section naming it", () => {
  const base = table(before);
  const head = table(after);
  assert.equal(pinImpactProblems(base, head, "No section").length, 1);
  assert.equal(pinImpactProblems(base, head, null).length, 1);
  assert.equal(
    pinImpactProblems(
      base,
      head,
      `Moved to ${after}.\n\n## Pin impact\n\nNone.\n`,
    ).length,
    1,
    "naming it outside the section doesn't count",
  );
  assert.equal(
    pinImpactProblems(
      base,
      head,
      `## Pin impact\n\nNone.\n\n## Other\n\n${after}\n`,
    ).length,
    1,
    "the section ends at the next heading",
  );
  assert.deepEqual(
    pinImpactProblems(base, head, `## Pin impact\n\nRe-pin to ${after}.\n`),
    [],
  );
});

test("a PR that moves no digest needs no Pin impact section", () => {
  assert.deepEqual(pinImpactProblems(table(before), table(before), ""), []);
});

test("this repo's owner hosts table is one the pin impact check can read", () => {
  const doc = fs.readFileSync("docs/owner-hosts.md", "utf8");
  assert.equal(pinImpactProblems("", doc, "").length, 2);
});
